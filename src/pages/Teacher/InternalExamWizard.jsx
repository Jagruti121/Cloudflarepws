import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Navbar from '../../components/Navbar';
import ProtectedRoute from '../../components/ProtectedRoute';
import ExcelJS from 'exceljs';
import { uploadCompressedImage, compressImageToWebP } from '../../utils/uploadCompressedImage';
import McqFieldRenderer, { isFirebaseUrl } from '../../components/McqFieldRenderer';
import RosterSelectionPanel from '../../components/RosterSelectionPanel';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const InternalExamWizard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { tenantId } = useTenant();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // --- DATA VIEWER MODAL STATE ---
  const [viewerModal, setViewerModal] = useState(null); // { type: 'students'|'questions', data: [] }

  // --- Configuration State (Step 1) ---
  const [subjectName, setSubjectName] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [studentDepartment, setStudentDepartment] = useState('');
  const [studentSemester, setStudentSemester] = useState('');
  const [labNumber, setLabNumber] = useState('');
  const [examDate, setExamDate] = useState('');
  const [durationHours, setDurationHours] = useState('0');
  const [durationMinutes, setDurationMinutes] = useState('0');
  const [internalMarks, setInternalMarks] = useState('');
  const [step1Error, setStep1Error] = useState('');

  // --- Student List State (Step 2) ---
  // STUDENT CAPCUT: studentsFile/students state replaced with roster state
  const [masterRoster, setMasterRoster] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [rosterKeyId, setRosterKeyId] = useState('');

  // --- Upload State (Step 3) ---
  const [questionsFile, setQuestionsFile] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [isQuestionBankReady, setIsQuestionBankReady] = useState(false);

  const fileInputRef = useRef(null);

  // ══════════════════════════════════════════════════════════════════════
  //  SESSION CODE GENERATION
  // ══════════════════════════════════════════════════════════════════════

  const generateSessionCode = (subject) => {
    let letters = subject.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 4) {
      letters = letters.padEnd(4, 'X');
    }
    const base = letters.substring(0, 4).toUpperCase();
    const num = Math.floor(100 + Math.random() * 900);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letter = chars.charAt(Math.floor(Math.random() * chars.length));
    return `${base}${num}${letter}`;
  };

  const handleSubjectChange = (e) => {
    const subject = e.target.value;
    setSubjectName(subject);
    if (subject.trim().length > 0) {
      setSessionCode(generateSessionCode(subject));
    } else {
      setSessionCode('');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  TEMPLATE RESTORATION (from saved templates)
  // ══════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (location.state?.template) {
      const t = location.state.template;
      setSubjectName(t.subjectName || '');
      if (t.subjectName) {
        setSessionCode(generateSessionCode(t.subjectName));
      }
      setStudentDepartment(t.studentDepartment || '');
      setStudentSemester(t.studentSemester || '');
      setLabNumber(t.labNumber || '');
      setExamDate(t.examDate || '');
      setDurationHours(t.durationHours || '0');
      setDurationMinutes(t.durationMinutes || '0');
      setDurationMinutes(t.durationMinutes || '0');
      setInternalMarks(t.internalMarks || '');
      // STUDENT CAPCUT: restore selected students from template (roster must be fetched separately)
      if (t.selectedStudents) setSelectedStudents(t.selectedStudents);
      setQuestions(t.questions || []);
      if ((t.questions || []).length > 0) setIsQuestionBankReady(true);
    }
  }, [location.state]);

  // STUDENT CAPCUT: Fetch master roster from server when entering Step 2
  useEffect(() => {
    if (step === 2 && tenantId && !masterRoster.length) {
      fetchRoster();
    }
  }, [step, tenantId]);

  const fetchRoster = async () => {
    setRosterLoading(true);
    setRosterError('');
    try {
      // First, get the rosterKeyId from the college's settings
      const settingsSnap = await getDoc(doc(db, 'colleges', tenantId, 'config', 'settings'));
      const keyId = settingsSnap.exists() ? settingsSnap.data().rosterKeyId : null;
      if (!keyId) {
        setRosterError('No approved roster found for your college. Please contact your administrator.');
        setRosterLoading(false);
        return;
      }
      setRosterKeyId(keyId);
      // Fetch roster via authenticated server endpoint
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/api/roster/${keyId}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch roster');
      setMasterRoster(data.students || []);
    } catch (err) {
      setRosterError(err.message || 'Failed to load roster.');
    } finally {
      setRosterLoading(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  EXCEL SANITIZATION (from Practical Wizard)
  // ══════════════════════════════════════════════════════════════════════
  // Strips all ExcelJS rich text / formatting from a cell value.
  // Handles: plain strings, numbers, RichText objects, hyperlinks, formula results, dates, booleans.

  const sanitizeCellValue = (cellValue) => {
    if (cellValue === null || cellValue === undefined) return '';
    if (typeof cellValue === 'object' && cellValue.richText && Array.isArray(cellValue.richText)) {
      return cellValue.richText.map(part => (part.text || '')).join('').trim();
    }
    if (typeof cellValue === 'object' && cellValue.text) {
      return String(cellValue.text).trim();
    }
    if (typeof cellValue === 'object' && cellValue.result !== undefined) {
      return String(cellValue.result).trim();
    }
    if (cellValue instanceof Date) {
      return cellValue.toISOString();
    }
    return String(cellValue).trim();
  };

  // ══════════════════════════════════════════════════════════════════════
  //  SMART IMAGE EXTRACTOR (from Practical Wizard)
  //  Row-only map — used for student photo extraction (col C per row)
  // ══════════════════════════════════════════════════════════════════════

  const extractImagesFromWorkbook = (workbook, worksheet) => {
    const imageMap = {};
    const mediaList = workbook.model.media || [];

    worksheet.getImages().forEach(image => {
      const rowNumber = Math.round(image.range.tl.nativeRow) + 1;
      const media = mediaList.find(m => m.index == image.imageId);

      if (media) {
        imageMap[rowNumber] = {
          buffer: media.buffer,
          extension: media.extension || 'png'
        };
      }
    });
    return imageMap;
  };

  // ══════════════════════════════════════════════════════════════════════
  //  MCQ IMAGE EXTRACTOR — Column-Aware
  //  Returns imageMap[rowNumber][colNumber] = { buffer, extension }
  //  so each content cell (Q, optA-D) can be individually checked.
  // ══════════════════════════════════════════════════════════════════════

  const extractMcqImagesFromWorkbook = (workbook, worksheet) => {
    const imageMap = {};
    const mediaList = workbook.model.media || [];

    worksheet.getImages().forEach(image => {
      // nativeRow/nativeCol are 0-indexed; add 1 to match ExcelJS 1-indexed API
      const rowNumber = Math.round(image.range.tl.nativeRow) + 1;
      const colNumber = Math.round(image.range.tl.nativeCol) + 1;
      const media = mediaList.find(m => m.index == image.imageId);

      if (media) {
        if (!imageMap[rowNumber]) imageMap[rowNumber] = {};
        imageMap[rowNumber][colNumber] = {
          buffer: media.buffer,
          extension: media.extension || 'png'
        };
      }
    });
    return imageMap;
  };

  // ══════════════════════════════════════════════════════════════════════
  //  DOWNLOAD TEMPLATE FUNCTION
  // ══════════════════════════════════════════════════════════════════════

  const handleDownloadTemplate = async (type) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(type === 'student' ? 'Student List' : 'MCQ Question Bank');

    if (type === 'student') {
      sheet.columns = [
        { header: 'Roll No', key: 'roll', width: 15 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Image (Insert in Cell)', key: 'image', width: 25 }
      ];
      sheet.addRow({ roll: '101', name: 'Student Name Here', image: '' });
    } else {
      // ── Unified Mixed-Media MCQ Template (text OR image per cell) ──
      // Columns A-H:
      //   A = ID (text)  B = Question (text or image)  C-F = Options A-D (text or image)
      //   G = Marks (number)  H = Answer (A/B/C/D) — TEXT ONLY
      sheet.columns = [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Question  (text OR insert image in cell)', key: 'question', width: 42 },
        { header: 'Option A  (text OR image)', key: 'optA', width: 28 },
        { header: 'Option B  (text OR image)', key: 'optB', width: 28 },
        { header: 'Option C  (text OR image)', key: 'optC', width: 28 },
        { header: 'Option D  (text OR image)', key: 'optD', width: 28 },
        { header: 'Marks', key: 'marks', width: 10 },
        { header: 'Answer (A/B/C/D) — TEXT ONLY', key: 'answer', width: 28 }
      ];
      // Style header row
      sheet.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
        cell.alignment = { wrapText: true, vertical: 'middle' };
      });
      // Highlight the Answer column green — always text
      sheet.getCell('H1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
      // Example text row
      sheet.addRow({
        id: '1',
        question: 'What is the time complexity of binary search?',
        optA: 'O(n)',
        optB: 'O(log n)',
        optC: 'O(n^2)',
        optD: 'O(1)',
        marks: 1,
        answer: 'B'
      });
      // Second example row (leave content cells blank so teacher can insert images)
      sheet.addRow({ id: '2', question: '', optA: '', optB: '', optC: '', optD: '', marks: 1, answer: 'A' });
      sheet.getRow(1).height = 36;
    }

    // Generate and Download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = type === 'student' ? 'Student_List_Template.xlsx' : 'MCQ_Question_Bank_Template.xlsx';
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  // ══════════════════════════════════════════════════════════════════════
  //  STEP 2: STUDENT LIST UPLOAD (Replicated from Practical Wizard)
  // ══════════════════════════════════════════════════════════════════════

  const handleStudentsUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStudentsFile(file);
    const storagePrefix = sessionCode ? `${sessionCode}_students` : `temp_students_${Date.now()}`;

    try {
      setLoading(true);
      setLoadingText("Scanning Excel for Photos...");

      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);

      // ── HEADER VALIDATION ──────────────────────────────────────────────
      // The student Excel file MUST have columns: Roll No | Name | Image
      // Reject any file that doesn't match this format.
      const headerRow = worksheet.getRow(1);
      const col1 = sanitizeCellValue(headerRow.getCell(1).value).toLowerCase().replace(/[^a-z0-9]/g, '');
      const col2 = sanitizeCellValue(headerRow.getCell(2).value).toLowerCase().replace(/[^a-z0-9]/g, '');
      const col3 = sanitizeCellValue(headerRow.getCell(3).value).toLowerCase().replace(/[^a-z0-9]/g, '');

      const validCol1 = ['rollno', 'roll'].includes(col1);
      const validCol2 = col2 === 'name';
      const validCol3 = col3.includes('image') || col3.includes('img') || col3.includes('photo');

      if (!validCol1 || !validCol2 || !validCol3) {
          alert(
              `❌ Invalid Excel Format!\n\n` +
              `Your file headers: "${sanitizeCellValue(headerRow.getCell(1).value)}" | "${sanitizeCellValue(headerRow.getCell(2).value)}" | "${sanitizeCellValue(headerRow.getCell(3).value)}"\n\n` +
              `Expected format:\n` +
              `  Column A: Roll No\n` +
              `  Column B: Name\n` +
              `  Column C: Image\n\n` +
              `Please download the template and re-upload.`
          );
          setStudentsFile(null);
          setStudents([]);
          e.target.value = '';
          setLoading(false);
          setLoadingText('');
          return;
      }
      // ── END HEADER VALIDATION ──────────────────────────────────────────

      const imageMap = extractImagesFromWorkbook(workbook, worksheet);
      const imageCount = Object.keys(imageMap).length;

      const rowPromises = [];
      let studentCount = 0;

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip Header

        const promise = async () => {
          const rollRaw = sanitizeCellValue(row.getCell(1).value);
          const nameRaw = sanitizeCellValue(row.getCell(2).value);

          if (!rollRaw || !nameRaw) return null;

          studentCount++;
          const roll_no = rollRaw;
          const name = nameRaw;
          let imageUrl = "";

          if (imageMap[rowNumber]) {
            try {
              const imgData = imageMap[rowNumber];
              const blob = new Blob([imgData.buffer], { type: `image/${imgData.extension}` });
              const fileName = `${roll_no}_${name.replace(/\s+/g, '_')}.${imgData.extension}`;
              const storageRef = ref(storage, `student_profiles/${storagePrefix}/${fileName}`);
              await uploadBytes(storageRef, blob);
              imageUrl = await getDownloadURL(storageRef);
            } catch (err) {
              console.error(`Upload error for ${name}`, err);
            }
          }
          else {
            const cell3 = row.getCell(3);
            if (cell3.value) {
              if (typeof cell3.value === 'object' && cell3.value.text) imageUrl = cell3.value.text;
              else if (typeof cell3.value === 'string') imageUrl = cell3.value;
            }
          }
          return { roll_no, name, image: imageUrl };
        };
        rowPromises.push(promise());
      });

      if (imageCount > 0) setLoadingText(`Uploading ${imageCount} detected photos...`);

      const results = await Promise.all(rowPromises);
      const validStudents = results.filter(s => s !== null);

      if (validStudents.length === 0) {
        alert("❌ No valid students found. Ensure Col A = Roll, Col B = Name.");
        setStudents([]);
      } else {
        setStudents(validStudents);
        alert(`✅ UPLOAD SUCCESS:\n\n• Students Found: ${validStudents.length}\n• Photos Detected: ${imageCount}\n\nIf Photos Detected is 0, click the (?) Help icon to see how to insert images correctly.`);
      }

    } catch (error) {
      alert("Error processing file: " + error.message);
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  STEP 3: MCQ QUESTION BANK UPLOAD — Unified Mixed-Media Pipeline
  //  Uses ExcelJS (not SheetJS/XLSX) so embedded cell images are preserved.
  // ══════════════════════════════════════════════════════════════════════

  // --- Validation Algorithm (Subset Sum via Dynamic Programming) ---
  // Checks if there is at least one combination of questions (by marks)
  // that sums exactly to the target marks.
  //
  // ⚠️ FLOAT SUPPORT: Marks may be fractional (e.g. 0.5 increments).
  // To keep the DP array integer-indexed we scale all marks ×10 before
  // running the algorithm (0.5 → 5, 1.0 → 10, 2.0 → 20, etc.).
  // This safely handles any value that is a multiple of 0.5.
  const validateMCQMarks = (parsedQuestions, targetMarks) => {
    const SCALE = 10;
    const scaledTarget = Math.round(parseFloat(targetMarks) * SCALE);
    const dp = new Array(scaledTarget + 1).fill(false);
    dp[0] = true; // sum of 0 is always possible

    for (const q of parsedQuestions) {
      const mark = Math.round(parseFloat(q.marks) * SCALE);
      if (isNaN(mark) || mark <= 0) continue;

      // Traverse backwards to avoid using the same question multiple times
      for (let i = scaledTarget; i >= mark; i--) {
        if (dp[i - mark]) {
          dp[i] = true;
        }
      }
    }

    return dp[scaledTarget];
  };

  // ──────────────────────────────────────────────────────────────────────
  //  resolveField — Core helper that resolves a single MCQ content cell.
  //
  //  • If the cell position has an embedded image in imageMap → compress
  //    (≤10KB WebP) → upload to Firebase → return { value: url, isImage: true }
  //  • If the cell has text value → return { value: text, isImage: false }
  //  • On compression failure → throws Error with field label in message
  // ──────────────────────────────────────────────────────────────────────
  const resolveField = async (imageMap, rowNumber, colNumber, textFallback, fieldLabel, rowIndex) => {
    const imgData = imageMap[rowNumber]?.[colNumber];
    if (imgData) {
      try {
        const blob = new Blob([imgData.buffer], { type: `image/${imgData.extension}` });
        const storagePath = `mcq_images/${sessionCode}/r${rowIndex}_c${colNumber}.webp`;
        const { url } = await uploadCompressedImage(blob, storagePath, storage);
        return url; // Firebase download URL (string)
      } catch (compressionErr) {
        throw new Error(
          `⚠️ Row ${rowIndex + 1}, ${fieldLabel}: ${compressionErr.message}`
        );
      }
    }
    // No image — use text cell value
    return sanitizeCellValue(textFallback);
  };

  // --- Unified MCQ Excel Parser (ExcelJS — preserves embedded images) ---
  const handleQuestionsUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setQuestionsFile(file);

    // Guard: validate target marks before spending time parsing
    const targetMarks = parseFloat(internalMarks);
    if (isNaN(targetMarks) || targetMarks <= 0) {
      alert("❌ Invalid target marks. Please go back and configure Internal Marks.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setLoading(true);
      setLoadingText('Scanning Excel for embedded images...');

      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);

      if (!worksheet) {
        alert('❌ No worksheet found in the uploaded file.');
        return;
      }

      // Build the column-aware image map: imageMap[row][col] = { buffer, extension }
      const imageMap = extractMcqImagesFromWorkbook(workbook, worksheet);
      const totalImages = Object.values(imageMap).reduce(
        (sum, colMap) => sum + Object.keys(colMap).length, 0
      );

      if (totalImages > 0) {
        setLoadingText(`Compressing and Uploading Media... (${totalImages} image${totalImages > 1 ? 's' : ''} detected)`);
      } else {
        setLoadingText('Parsing question bank...');
      }

      // MCQ column map (1-indexed ExcelJS columns):
      //   col 1=ID  col 2=Question  col 3=OptA  col 4=OptB  col 5=OptC  col 6=OptD
      //   col 7=Marks  col 8=Answer
      const COL = { ID: 1, Q: 2, A: 3, B: 4, C: 5, D: 6, MARKS: 7, ANS: 8 };

      // Collect per-row async resolution promises
      const rowPromises = [];
      let dataRowCount = 0;

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header

        const idRaw = sanitizeCellValue(row.getCell(COL.ID).value);
        // Check if the row is entirely empty (no ID, no image in Q column)
        const hasQImage = !!(imageMap[rowNumber]?.[COL.Q]);
        const hasQText = !!sanitizeCellValue(row.getCell(COL.Q).value);
        if (!idRaw && !hasQImage && !hasQText) return; // blank row — skip

        const rowIndex = rowNumber - 1; // 1-indexed row → 0-indexed for display
        dataRowCount++;

        const promise = (async () => {
          // Resolve all 5 content fields concurrently
          const [questionVal, optAVal, optBVal, optCVal, optDVal] = await Promise.all([
            resolveField(imageMap, rowNumber, COL.Q, row.getCell(COL.Q).value, 'Question', rowIndex),
            resolveField(imageMap, rowNumber, COL.A, row.getCell(COL.A).value, 'Option A', rowIndex),
            resolveField(imageMap, rowNumber, COL.B, row.getCell(COL.B).value, 'Option B', rowIndex),
            resolveField(imageMap, rowNumber, COL.C, row.getCell(COL.C).value, 'Option C', rowIndex),
            resolveField(imageMap, rowNumber, COL.D, row.getCell(COL.D).value, 'Option D', rowIndex),
          ]);

          const marksRaw = sanitizeCellValue(row.getCell(COL.MARKS).value);
          const answerRaw = sanitizeCellValue(row.getCell(COL.ANS).value).toUpperCase().trim();

          return {
            rowNumber,
            id: idRaw,
            question: questionVal,
            optA: optAVal,
            optB: optBVal,
            optC: optCVal,
            optD: optDVal,
            marks: marksRaw,
            answer: answerRaw,
          };
        })();

        rowPromises.push(promise);
      });

      if (dataRowCount === 0) {
        alert('❌ Question bank is empty or missing data rows.');
        setQuestionsFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Wait for ALL image uploads to complete before validating
      const resolvedRows = await Promise.all(rowPromises);

      // ── Per-row validation ──
      const parsedQuestions = [];
      for (const qObj of resolvedRows) {
        const { rowNumber, id, question, optA, optB, optC, optD, marks, answer } = qObj;

        // Required field check (a field is valid if it's a non-empty string OR a Firebase URL)
        const isPresent = (v) => (typeof v === 'string' && v.trim().length > 0) || isFirebaseUrl(v);

        if (!id || !isPresent(question) || !isPresent(optA) || !isPresent(optB) || !isPresent(optC) || !isPresent(optD) || !marks || !answer) {
          alert(`❌ Row ${rowNumber} is missing required fields. Ensure Columns A-H are fully populated.`);
          setQuestions([]);
          setQuestionsFile(null);
          setIsQuestionBankReady(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        if (!['A', 'B', 'C', 'D'].includes(answer)) {
          alert(`❌ Row ${rowNumber} has an invalid Answer '${answer}'. Must be A, B, C, or D (text only).`);
          setQuestions([]);
          setQuestionsFile(null);
          setIsQuestionBankReady(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        parsedQuestions.push({ id, question, optA, optB, optC, optD, marks, answer });
      }

      // ── Marks validation (subset-sum DP) ──
      const isValidCombo = validateMCQMarks(parsedQuestions, targetMarks);
      if (!isValidCombo) {
        alert(`❌ Validation Failed: The uploaded questions do not contain a valid combination of marks that sums exactly to the Internal Marks target (${targetMarks}).`);
        setQuestions([]);
        setQuestionsFile(null);
        setIsQuestionBankReady(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setQuestions(parsedQuestions);
      setIsQuestionBankReady(true);
      const imgCount = totalImages;
      alert(
        `✅ SUCCESS: Parsed ${parsedQuestions.length} MCQ questions.\n` +
        (imgCount > 0
          ? `📸 ${imgCount} image${imgCount > 1 ? 's' : ''} compressed & uploaded to Firebase.\n`
          : '') +
        `✏️ Text questions/options are stored as-is.`
      );
    } catch (err) {
      console.error('[MCQ Upload Error]', err);
      alert('❌ Upload Failed:\n\n' + err.message);
      setQuestions([]);
      setQuestionsFile(null);
      setIsQuestionBankReady(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  CORE BUSINESS LOGIC: TWO-TIER RANDOMIZATION ALGORITHM
  // ══════════════════════════════════════════════════════════════════════

  /**
   * TIER 1 — Global Pool Selection
   * 
   * Selects exactly `requiredMarks` worth of questions from the full question bank.
   * Uses a greedy approach after shuffling to randomly pick questions whose marks
   * sum to exactly the required total. This subset is computed ONCE and shared
   * by ALL students.
   * 
   * @param {Array} questionBank - Full uploaded question bank (may be oversized)
   * @param {number} requiredMarks - Target marks (N) from Step 1 Configuration
   * @returns {Array} Base Exam Set — exactly N marks worth of randomly selected questions
   */
  const selectBaseExamSet = (questionBank, requiredMarks) => {
    // If total marks of all questions equals required marks, use all questions
    // parseFloat preserves fractional marks (e.g. 0.5) during summing.
    const totalBankMarks = questionBank.reduce((sum, q) => sum + parseFloat(q.marks), 0);
    // Use a tolerance comparison to handle floating-point rounding (e.g. 4.9999... ≈ 5.0)
    if (Math.abs(totalBankMarks - requiredMarks) < 0.001) {
      return [...questionBank];
    }

    // Shuffle the question bank randomly (Fisher-Yates) before greedy selection
    const shuffled = [...questionBank];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Greedy selection: pick questions until we hit exactly requiredMarks
    const selected = [];
    let currentSum = 0;
    for (const question of shuffled) {
      const qMark = parseFloat(question.marks);
      if (currentSum + qMark <= requiredMarks + 0.001) {
        selected.push(question);
        currentSum = Math.round((currentSum + qMark) * 10) / 10; // keep 1 decimal precision
        if (Math.abs(currentSum - requiredMarks) < 0.001) break;
      }
    }

    // Safety check: if greedy didn't find exact match, try backtracking approach
    if (Math.abs(currentSum - requiredMarks) >= 0.001) {
      // Fallback: Use subset-sum DP to find exact combination
      const result = findExactSubset(shuffled, requiredMarks);
      if (result) return result;
    }

    return selected;
  };

  /**
   * Fallback subset-sum finder using DP with path reconstruction.
   * Guarantees an exact match when the greedy approach fails.
   * 
   * @param {Array} questions - Shuffled question array
   * @param {number} target - Target marks total
   * @returns {Array|null} Subset of questions summing exactly to target, or null
   */
  const findExactSubset = (questions, target) => {
    const n = questions.length;
    // ⚠️ FLOAT SUPPORT: Scale all marks ×10 so the DP stays integer-indexed.
    // This supports any mark value that is a multiple of 0.5 (0.5→5, 1.0→10, …).
    const SCALE = 10;
    const scaledTarget = Math.round(parseFloat(target) * SCALE);

    // dp[i] = index of the question that was used to reach scaled sum i, or -1
    const dp = new Array(scaledTarget + 1).fill(-2); // -2 = unreachable
    dp[0] = -1; // -1 = base case (sum 0 is reachable with no questions)
    const parent = new Array(scaledTarget + 1).fill(-1);

    for (let qi = 0; qi < n; qi++) {
      const mark = Math.round(parseFloat(questions[qi].marks) * SCALE);
      if (isNaN(mark) || mark <= 0) continue;

      // Traverse backwards to avoid using the same question multiple times
      for (let s = scaledTarget; s >= mark; s--) {
        if (dp[s] === -2 && dp[s - mark] !== -2) {
          dp[s] = qi;
          parent[s] = s - mark;
        }
      }
    }

    if (dp[scaledTarget] === -2) return null;

    // Reconstruct the subset
    const subset = [];
    let s = scaledTarget;
    while (s > 0) {
      subset.push(questions[dp[s]]);
      s = parent[s];
    }
    return subset;
  };

  /**
   * TIER 2 — Per-Student Fisher-Yates Shuffle
   * 
   * Takes the Base Exam Set and returns a NEW array with the same questions
   * in a randomly shuffled order. Each student gets a unique permutation.
   * Uses the Fisher-Yates (Knuth) in-place shuffle algorithm for O(n) 
   * unbiased randomization.
   * 
   * @param {Array} baseExamSet - The shared Base Exam Set (N questions)
   * @returns {Array} A new array with the same questions in a shuffled order
   */
  const shuffleForStudent = (baseExamSet) => {
    // Clone the array and objects, explicitly omitting the 'answer' property
    // SECURITY FIX: Never expose correct answers to the client!
    const shuffled = baseExamSet.map(({ answer, ...rest }) => rest);

    // Fisher-Yates shuffle: iterate from end to start, swapping each element
    // with a randomly selected element from the remaining unshuffled portion
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  };

  // ══════════════════════════════════════════════════════════════════════
  //  STEP 4: SAVE TEMPLATE
  // ══════════════════════════════════════════════════════════════════════

  const handleSaveTemplate = async () => {
    const templateName = prompt("Template Name:", subjectName);
    if (!templateName) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'colleges', tenantId, 'exam_templates'), {
        template_name: templateName,
        template_type: 'internal',
        teacher_email: currentUser.email,
        created_at: serverTimestamp(),
        subjectName, labNumber, studentDepartment, studentSemester,
        examDate, durationHours, durationMinutes, internalMarks,
        selectedStudents, questions
      });
      alert("✅ Template Saved!");
      navigate('/teacher/dashboard');
    } catch (error) { alert("Failed: " + error.message); }
    finally { setLoading(false); }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  STEP 5: PRE-LAUNCH VALIDATION & LAUNCH
  // ══════════════════════════════════════════════════════════════════════

  const handlePreLaunchValidation = () => {
    const cleanSessionCode = sessionCode.trim().toUpperCase();
    const cleanSubject = subjectName.trim();
    const totalDurationMinutes = (parseInt(durationHours) || 0) * 60 + (parseInt(durationMinutes) || 0);

    if (!cleanSubject || !cleanSessionCode || !internalMarks || !labNumber || !studentDepartment || !studentSemester || !examDate) {
      alert('Fill all required fields.'); return;
    }
    if (totalDurationMinutes <= 0) { alert("Duration > 0 required."); return; }
    // STUDENT CAPCUT: check selectedStudents instead of old students array
    if (selectedStudents.length === 0) { alert('Please select at least one student from the roster.'); return; }
    if (questions.length === 0) { alert('Upload question bank.'); return; }

    // Validate total marks
    const bankTotal = questions.reduce((sum, q) => sum + parseInt(q.marks || 0, 10), 0);
    if (bankTotal !== parseInt(internalMarks, 10)) {
      alert(`Questions total marks (${bankTotal}) does not match exam configuration (${internalMarks}).`);
      return;
    }

    setShowConfirmModal(true);
  };

  // STUDENT CAPCUT: executeLaunch now calls the server endpoint instead of
  // writing directly to Firestore from the client.
  const executeLaunch = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setLoadingText("Launching Internal Exam Session...");

    const cleanSessionCode = sessionCode.trim().toUpperCase();
    const totalDurationMinutes = (parseInt(durationHours) || 0) * 60 + (parseInt(durationMinutes) || 0);
    // parseFloat preserves fractional internal marks (e.g. 0.5, 1.5, 2.5)
    const totalInternalMarks = parseFloat(internalMarks) || 0;

    try {
      // ── 1. Create exam document ──
      await setDoc(doc(db, 'colleges', tenantId, 'exams', cleanSessionCode), {
        subject_name: subjectName.trim(),
        exam_type: 'internal',
        teacher_email: currentUser.email,
        lab_number: labNumber.trim(),
        student_department: studentDepartment.trim(),
        student_semester: studentSemester.trim(),
        exam_date: examDate,
        duration_minutes: totalDurationMinutes,
        started_at: Timestamp.now(),
        total_marks: totalInternalMarks,
        internal_marks: totalInternalMarks,
        is_active: true,
        created_at: new Date()
      });

      // ── 2. Upload all questions to Firestore ──
      const questionsRef = collection(db, 'colleges', tenantId, 'questions');
      for (const question of questions) {
        await addDoc(questionsRef, {
          session_code: cleanSessionCode,
          question_id: question.id,
          question_text: question.question,
          optA: question.optA,
          optB: question.optB,
          optC: question.optC,
          optD: question.optD,
          marks: parseFloat(question.marks),  // preserve fractional marks (e.g. 0.5)
          answer: question.answer
        });
      }

      // ── 3. TWO-TIER RANDOMIZATION ──
      // TIER 1: Select the Base Exam Set (computed ONCE, shared by all students)
      setLoadingText("Selecting exam questions from bank...");
      const baseExamSet = selectBaseExamSet(questions, totalInternalMarks);

      // Log for verification: the base set is the same for all students
      console.log(`[InternalExam] Base Exam Set: ${baseExamSet.length} questions, ` +
        `total marks: ${baseExamSet.reduce((s, q) => s + parseFloat(q.marks), 0)}`);

      // ── 4. Create student documents with per-student shuffled questions ──
      setLoadingText("Assigning questions to students...");
      for (const student of students) {
        const studentId = `${cleanSessionCode}_${student.roll_no}`;

        // TIER 2: Fisher-Yates shuffle for this specific student
        const shuffledQuestions = shuffleForStudent(baseExamSet);

        await setDoc(doc(db, 'colleges', tenantId, 'students', studentId), {
          roll_no: student.roll_no,
          name: student.name,
          image: student.image || "",
          session_code: cleanSessionCode,
          lab_number: labNumber.trim(),
          department: studentDepartment.trim(),
          semester: studentSemester.trim(),
          status: 'registered',
          exam_type: 'internal',
          assigned_questions: shuffledQuestions,
          answers: {},
          scores: { internal: 0, total: 0 }
        });
      }

      // ── 5. Create root-level exam_index for student login resolution ──
      await setDoc(doc(db, 'exam_index', cleanSessionCode), {
        tenantId: tenantId
      });

      navigate(`/teacher/monitor/internal/${cleanSessionCode}`);
    } catch (error) {
      alert('Error creating exam: ' + error.message);
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  //  VALIDATION HELPERS
  // ══════════════════════════════════════════════════════════════════════

  const isStep1Valid = subjectName && sessionCode && studentDepartment && studentSemester && labNumber && examDate && (durationHours || durationMinutes) && internalMarks;

  // ══════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════

  return (
    <ProtectedRoute allowedRoles={['teacher']}>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Navbar />

        <div className="flex-grow container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-8">
            {location.state?.template ? `Edit Internal Exam: ${location.state.template.template_name}` : "Create Internal Exam (MCQ)"}
          </h1>

          {/* ══════════ 5-STEP PROGRESS INDICATOR ══════════ */}
          <div className="mb-10">
            <div className="flex items-center justify-between w-full relative">
              <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10"></div>
              {[
                { num: 1, label: 'Config' },
                { num: 2, label: 'Students' },
                { num: 3, label: 'Questions' },
                { num: 4, label: 'Save Template' },
                { num: 5, label: 'Launch' }
              ].map((s, index, arr) => (
                <div key={s.num} className={`flex items-center ${index !== arr.length - 1 ? 'flex-1' : ''}`}>
                  <div className="relative flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors duration-300 z-10 bg-gray-50 ${step >= s.num ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-300'}`}>{s.num}</div>
                    <div className={`absolute top-12 text-xs font-medium w-32 text-center ${step >= s.num ? 'text-purple-700' : 'text-gray-400'}`}>{s.label}</div>
                  </div>
                  {index !== arr.length - 1 && (<div className={`flex-1 h-1 mx-2 rounded ${step > s.num ? 'bg-purple-600' : 'bg-gray-300'}`}></div>)}
                </div>
              ))}
            </div>
            <div className="h-8"></div>
          </div>

          {/* ══════════ STEP 1: CONFIGURATION (Unchanged) ══════════ */}
          {step === 1 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4">Exam Configuration</h2>
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Subject Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={subjectName}
                      onChange={handleSubjectChange}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none"
                      placeholder="e.g. Operating Systems"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Session Code</label>
                    <input
                      type="text"
                      value={sessionCode}
                      readOnly
                      className="w-full border border-gray-200 bg-gray-100 text-gray-600 rounded-lg px-4 py-2.5 cursor-not-allowed font-mono"
                      title="Session code is auto-generated and cannot be modified"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Department <span className="text-red-500">*</span></label>
                    <select
                      value={studentDepartment}
                      onChange={(e) => { setStudentDepartment(e.target.value); setStep1Error(''); }}
                      className={`w-full border-2 rounded-lg px-4 py-2.5 bg-white transition ${step1Error && !studentDepartment ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'}`}
                    >
                      <option value="">-- Select Department --</option>
                      <option value="BScIT">BScIT</option>
                      <option value="BScCS">BScCS</option>
                      <option value="BScDS">BScDS</option>
                    </select>
                    {step1Error && !studentDepartment && (
                      <p className="text-red-500 text-xs mt-1 font-semibold flex items-center gap-1" style={{ animation: 'tooltipShake 0.3s ease-out' }}>
                        <span>⚠️</span> Please select a Department
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Semester <span className="text-red-500">*</span></label>
                    <select
                      value={studentSemester}
                      onChange={(e) => { setStudentSemester(e.target.value); setStep1Error(''); }}
                      className={`w-full border-2 rounded-lg px-4 py-2.5 bg-white transition ${step1Error && !studentSemester ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'}`}
                    >
                      <option value="">-- Select Semester --</option>
                      <option value="1st Semester">1st Semester</option>
                      <option value="2nd Semester">2nd Semester</option>
                      <option value="3rd Semester">3rd Semester</option>
                      <option value="4th Semester">4th Semester</option>
                      <option value="5th Semester">5th Semester</option>
                      <option value="6th Semester">6th Semester</option>
                      <option value="7th Semester">7th Semester</option>
                      <option value="8th Semester">8th Semester</option>
                    </select>
                    {step1Error && !studentSemester && (
                      <p className="text-red-500 text-xs mt-1 font-semibold flex items-center gap-1" style={{ animation: 'tooltipShake 0.3s ease-out' }}>
                        <span>⚠️</span> Please select a Semester
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Room / Lab Number <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={labNumber}
                      onChange={(e) => setLabNumber(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none"
                      placeholder="e.g. Room 402"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Exam Date <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      value={examDate}
                      onChange={(e) => setExamDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Exam Duration <span className="text-red-500">*</span></label>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <input
                          type="number"
                          min="0"
                          value={durationHours}
                          onChange={(e) => setDurationHours(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none"
                          placeholder="0"
                        />
                        <span className="text-xs text-gray-500 block mt-1">Hours</span>
                      </div>
                      <div className="flex-1">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={durationMinutes}
                          onChange={(e) => setDurationMinutes(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none"
                          placeholder="0"
                        />
                        <span className="text-xs text-gray-500 block mt-1">Minutes</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Internal Marks (Total) <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      min="1"
                      value={internalMarks}
                      onChange={(e) => setInternalMarks(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-purple-500 outline-none"
                      placeholder="e.g. 20"
                    />
                  </div>
                </div>

                {/* Step 1 Error Tooltip */}
                {step1Error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 font-medium flex items-center gap-2" style={{ animation: 'tooltipShake 0.3s ease-out' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.96-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    {step1Error}
                  </div>
                )}

                <div className="relative">
                  <button
                    onClick={async () => {
                      if (!studentDepartment || !studentSemester) {
                        setStep1Error('Please select a Department and Semester to continue.');
                        return;
                      }
                      if (!labNumber || !subjectName.trim() || !examDate || (!durationHours && !durationMinutes) || !internalMarks) {
                        alert("Please fill all required fields.");
                        return;
                      }
                      if (parseFloat(internalMarks) < 0) {
                        alert("Internal marks cannot be negative.");
                        return;
                      }

                      // Validate session code uniqueness against exam_index
                      setLoading(true);
                      setLoadingText('Validating Session Code...');

                      let currentCode = sessionCode;
                      if (!currentCode) {
                        currentCode = generateSessionCode(subjectName);
                      }

                      try {
                        let snap = await getDoc(doc(db, 'exam_index', currentCode));
                        if (snap.exists()) {
                          // Attempt 2: regenerate
                          currentCode = generateSessionCode(subjectName);
                          snap = await getDoc(doc(db, 'exam_index', currentCode));
                          if (snap.exists()) {
                            setLoading(false);
                            setStep1Error('The generated session code already exists. Please change the subject name slightly or try again.');
                            return;
                          }
                        }
                      } catch (err) {
                        console.error("Error validating session code:", err);
                        setLoading(false);
                        setStep1Error('Failed to validate session code due to network error.');
                        return;
                      }

                      setSessionCode(currentCode);
                      setStep1Error('');
                      setLoading(false);
                      setStep(2);
                    }}
                    disabled={!isStep1Valid}
                    className={`w-full px-4 py-3 rounded-lg transition mt-4 font-bold text-lg flex items-center justify-center gap-2 ${!isStep1Valid
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg transform hover:scale-[1.01]'
                      }`}
                  >
                    Next: Upload Students →
                  </button>
                </div>

                <style>{`
                  @keyframes tooltipShake {
                    0%, 100% { transform: translateX(0); }
                    20% { transform: translateX(-4px); }
                    40% { transform: translateX(4px); }
                    60% { transform: translateX(-2px); }
                    80% { transform: translateX(2px); }
                  }
                `}</style>
              </div>
            </div>
          )}

          {/* ══════════ STEP 2: STUDENTS — STUDENT CAPCUT: Replaced with RosterSelectionPanel ══════════ */}
          {step === 2 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Select Students</h2>
                <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1.5 rounded-full font-semibold">
                  Pre-Approved Roster
                </span>
              </div>
              <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg mb-4 text-sm text-purple-800">
                <strong>Instruction:</strong> Select which students from your college's approved roster will participate in this exam session.
              </div>
              <RosterSelectionPanel
                roster={masterRoster}
                loading={rosterLoading}
                error={rosterError}
                onRetry={fetchRoster}
                onSelectionChange={setSelectedStudents}
                initialSelection={selectedStudents}
              />
              <div className="flex gap-4 mt-4">
                <button onClick={() => setStep(1)} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg font-bold">Back</button>
                <button
                  onClick={() => setStep(3)}
                  disabled={selectedStudents.length === 0}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 font-bold"
                >
                  Next: Upload Questions ({selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} selected)
                </button>
              </div>
            </div>
          )}

          {/* ══════════ STEP 3: QUESTION BANK UPLOAD (MCQ) — Unified Mixed-Media ══════════ */}
          {step === 3 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Upload MCQ Question Bank</h2>
                <div className="flex gap-2">
                  <button onClick={() => handleDownloadTemplate('question')} className="text-sm bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-200 transition flex items-center gap-1 font-bold">
                    📥 Download Template
                  </button>
                  <button onClick={() => setShowHelpModal(true)} className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-bold hover:bg-gray-300" title="Help">?</button>
                </div>
              </div>

              {/* ── Unified Info Banner ── */}
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4 text-sm text-purple-900 mb-6">
                <p className="font-bold mb-2 flex items-center gap-2">ℹ️ Formatting Guidelines</p>
                <p className="mb-2">Your .xlsx file can contain both text and images. No special modes required.</p>
                <ul className="list-disc pl-5 mb-2 text-xs text-purple-800 space-y-1">
                  <li><strong>Text:</strong> Type directly into the cells.</li>
                  <li><strong>Images:</strong> Insert images directly in the cell (Google Sheets recommended).</li>
                  <li><strong>Format:</strong> A: ID · B: Question · C-F: Options A-D · G: Marks · H: Answer (A/B/C/D)</li>
                </ul>
              </div>

              <div className="border-2 border-dashed border-purple-300 rounded-xl p-4 bg-purple-50 hover:bg-purple-100 transition flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 text-left">
                  <div className="text-3xl">📊</div>
                  <div>
                    <p className="text-sm font-semibold text-purple-700 mb-0.5">Upload your MCQ Question Bank</p>
                    <p className="text-xs text-gray-500">Accepts <strong>.xlsx</strong> — images embedded in cells are automatically detected</p>
                  </div>
                </div>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleQuestionsUpload}
                  ref={fileInputRef}
                  className="block w-full sm:w-auto text-sm text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                />
              </div>

              {questions.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between bg-green-50 p-4 border border-green-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-xl">✅</div>
                      <div>
                        <p className="font-bold text-green-800">{questions.length} MCQ questions loaded!</p>
                        <p className="text-xs text-green-600">Total marks in bank: {questions.reduce((s, q) => s + parseInt(q.marks, 10), 0)} | Required: {internalMarks}</p>
                      </div>
                    </div>
                    <button
                      id="view-questions-btn"
                      onClick={() => setViewerModal({ type: 'questions', data: questions })}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-white text-sm transition shadow-md hover:shadow-lg"
                      style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      View Bank
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-8 flex gap-4">
                <button onClick={() => setStep(2)} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg font-bold">Back</button>
                <button onClick={() => setStep(4)} disabled={questions.length === 0 || !isQuestionBankReady} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 font-bold">Next: Save Template</button>
              </div>
            </div>
          )}

          {/* ══════════ STEP 4: SAVE TEMPLATE (Replicated from Practical Wizard) ══════════ */}
          {step === 4 && (
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <h2 className="text-2xl font-bold mb-4">Save as Template?</h2>
              <p className="text-gray-500 mb-6">You can save this exam configuration as a reusable template for future use.</p>
              <div className="flex gap-4 justify-center">
                <button onClick={() => setStep(5)} className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-bold">Skip & Continue</button>
                <button onClick={handleSaveTemplate} disabled={loading} className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-bold shadow-md">💾 Save Template</button>
              </div>
            </div>
          )}

          {/* ══════════ STEP 5: REVIEW & LAUNCH (Replicated from Practical Wizard) ══════════ */}
          {step === 5 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4">Review & Launch</h2>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-bold mb-2">Exam Details:</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <p><strong>Subject:</strong> {subjectName}</p>
                    <p><strong>Session:</strong> {sessionCode}</p>
                    <p><strong>Students:</strong> {students.length}</p>
                    <p><strong>Questions in Bank:</strong> {questions.length}</p>
                    <p><strong>Internal Marks:</strong> {internalMarks}</p>
                    <p><strong>Duration:</strong> {(parseInt(durationHours) || 0) * 60 + (parseInt(durationMinutes) || 0)} minutes</p>
                    <p><strong>Department:</strong> {studentDepartment}</p>
                    <p><strong>Semester:</strong> {studentSemester}</p>
                    <p><strong>Lab/Room:</strong> {labNumber}</p>
                    <p><strong>Exam Date:</strong> {examDate}</p>
                  </div>
                </div>

                {/* Randomization Info Box */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
                  <p className="font-bold mb-1">🔀 Question Randomization</p>
                  <p>
                    {questions.length > parseInt(internalMarks || 0, 10)
                      ? `From the ${questions.length}-question bank, ${internalMarks} marks worth of questions will be randomly selected to form the Base Exam Set. All students receive the same questions, but in a unique shuffled order.`
                      : `All ${questions.length} questions will be assigned to every student, each in a unique shuffled order.`
                    }
                  </p>
                </div>

                <div className="grid md:grid-cols-1 gap-4 mt-6">
                  <button onClick={handlePreLaunchValidation} disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-4 rounded-lg font-bold shadow-lg text-lg flex justify-center items-center gap-2">
                    <span>🚀</span> Launch Internal Exam Now
                  </button>
                </div>
                <div className="text-center mt-4"><button onClick={() => setStep(4)} className="text-gray-500 hover:text-gray-700 text-sm underline">Back to Save Template</button></div>
              </div>
            </div>
          )}

          {/* ══════════ DATA VIEWER MODAL ══════════ */}
          {viewerModal && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ backdropFilter: 'blur(10px)', background: 'rgba(15,23,42,0.6)' }}
              onClick={() => setViewerModal(null)}
            >
              <div
                className="bg-white rounded-3xl shadow-2xl w-full flex flex-col"
                style={{ maxWidth: '860px', maxHeight: '88vh', animation: 'viewerIn 0.28s cubic-bezier(.16,1,.3,1)' }}
                onClick={e => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div
                  className="flex items-center justify-between px-6 py-4 rounded-t-3xl flex-shrink-0"
                  style={{
                    background: viewerModal.type === 'students'
                      ? 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)'
                      : 'linear-gradient(135deg, #92400e 0%, #f59e0b 100%)'
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-2xl">
                      {viewerModal.type === 'students' ? '👨‍🎓' : '📋'}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">
                        {viewerModal.type === 'students' ? 'Student List' : 'MCQ Question Bank'}
                      </h3>
                      <p className="text-sm text-white text-opacity-80">
                        {viewerModal.data.length} {viewerModal.type === 'students' ? 'students' : 'questions'} •{' '}
                        {viewerModal.type === 'students'
                          ? `${viewerModal.data.filter(s => s.image).length} with photos`
                          : `Total marks: ${viewerModal.data.reduce((s, q) => s + parseInt(q.marks, 10), 0)}`
                        }
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setViewerModal(null)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Stats Bar */}
                <div className="flex gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
                  {viewerModal.type === 'students' ? (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                        <span className="text-gray-600">Total: <strong className="text-gray-800">{viewerModal.data.length}</strong></span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span className="text-gray-600">With Photo: <strong className="text-gray-800">{viewerModal.data.filter(s => s.image).length}</strong></span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                        <span className="text-gray-600">No Photo: <strong className="text-gray-800">{viewerModal.data.filter(s => !s.image).length}</strong></span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                        <span className="text-gray-600">Total Questions: <strong className="text-gray-800">{viewerModal.data.length}</strong></span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                        <span className="text-gray-600">Total Marks: <strong className="text-gray-800">{viewerModal.data.reduce((s, q) => s + parseInt(q.marks, 10), 0)}</strong></span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span className="text-gray-600">Required: <strong className="text-gray-800">{internalMarks}</strong></span>
                      </div>
                    </>
                  )}
                </div>

                {/* Table Body */}
                <div className="overflow-auto flex-1">
                  {viewerModal.type === 'students' ? (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-purple-600 text-white">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold w-10">#</th>
                          <th className="text-left px-4 py-3 font-semibold w-24">Photo</th>
                          <th className="text-left px-4 py-3 font-semibold">Roll No</th>
                          <th className="text-left px-4 py-3 font-semibold">Full Name</th>
                          <th className="text-left px-4 py-3 font-semibold w-28">Photo Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewerModal.data.map((s, idx) => (
                          <tr key={idx} className={`border-b border-gray-100 hover:bg-purple-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{idx + 1}</td>
                            <td className="px-4 py-3">
                              {s.image ? (
                                <img
                                  src={s.image}
                                  alt={s.name}
                                  className="w-12 h-12 rounded-xl object-cover border-2 border-purple-100 shadow-sm"
                                  onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                />
                              ) : null}
                              <div
                                className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-100 to-indigo-200 flex items-center justify-center text-purple-600 font-bold text-lg"
                                style={{ display: s.image ? 'none' : 'flex' }}
                              >
                                {(s.name || '?')[0].toUpperCase()}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono font-bold text-gray-800">{s.roll_no}</td>
                            <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                            <td className="px-4 py-3">
                              {s.image ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> Photo
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-semibold">
                                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span> None
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    /* MCQ Questions Viewer — Mixed-Media aware (text + images) */
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-amber-600 text-white">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold w-10">#</th>
                          <th className="text-left px-4 py-3 font-semibold w-16">ID</th>
                          <th className="text-left px-4 py-3 font-semibold">Question</th>
                          <th className="text-left px-4 py-3 font-semibold">Options</th>
                          <th className="text-right px-4 py-3 font-semibold w-20">Marks</th>
                          <th className="text-center px-4 py-3 font-semibold w-16">Ans</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewerModal.data.map((q, idx) => (
                          <tr key={idx} className={`border-b border-gray-100 hover:bg-amber-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{idx + 1}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-amber-700 font-bold text-xs">
                                Q{q.id}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-medium leading-snug max-w-[220px]">
                              <McqFieldRenderer value={q.question} />
                            </td>
                            <td className="px-4 py-3 max-w-[260px]">
                              <div className="space-y-1">
                                {['A', 'B', 'C', 'D'].map(k => (
                                  <div key={k} className="flex items-start gap-1">
                                    <span className={`font-bold text-xs flex-shrink-0 mt-0.5 ${q.answer === k ? 'text-green-600' : 'text-gray-400'}`}>({k})</span>
                                    <McqFieldRenderer value={q[`opt${k}`]} isOption />
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                                {q.marks} pts
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-green-600">{q.answer}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-3xl flex-shrink-0">
                  <p className="text-xs text-gray-400">Showing all {viewerModal.data.length} {viewerModal.type === 'students' ? 'students' : 'questions'}</p>
                  <button
                    onClick={() => setViewerModal(null)}
                    className="px-5 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          <style>{`
            @keyframes viewerIn {
              from { opacity: 0; transform: scale(0.95) translateY(16px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>

          {/* ══════════ HELP MODAL ══════════ */}
          {showHelpModal && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-fade-in-up">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-gray-800">How to Insert Images Correctly</h3>
                  <button onClick={() => setShowHelpModal(false)} className="text-gray-500 hover:text-gray-800 font-bold text-xl">&times;</button>
                </div>
                <div className="space-y-4 text-sm text-gray-700">
                  <p className="font-semibold text-purple-700 bg-purple-50 p-2 rounded">Use Google Sheets for best results:</p>
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Open your Excel sheet in <strong>Google Sheets</strong>.</li>
                    <li>Select the cell in the <strong>Image Column</strong> (e.g., Column C).</li>
                    <li>Go to <strong>Insert &gt; Image</strong>.</li>
                    <li><strong>IMPORTANT:</strong> Choose <strong>"Insert image in the cell"</strong>.</li>
                    <li>Upload your image.</li>
                    <li>Once done for all rows, go to <strong>File &gt; Download &gt; Microsoft Excel (.xlsx)</strong>.</li>
                    <li>Upload that file here.</li>
                  </ol>
                </div>
                <button onClick={() => setShowHelpModal(false)} className="mt-6 w-full bg-purple-600 text-white py-2 rounded-lg font-bold hover:bg-purple-700">Got it!</button>
              </div>
            </div>
          )}

          {/* ══════════ CONFIRM LAUNCH MODAL ══════════ */}
          {showConfirmModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 text-center animate-fade-in-up">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">🚀</span></div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Launch Internal Exam?</h3>
                <p className="text-sm text-gray-500 mb-4">
                  {students.length} students will receive {internalMarks} marks worth of MCQ questions in unique shuffled orders.
                </p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setShowConfirmModal(false)} className="px-5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-bold">No, Wait</button>
                  <button onClick={executeLaunch} className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-md">Yes, Launch!</button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ LOADING OVERLAY ══════════ */}
          {loading && (
            <div className="fixed inset-0 bg-white bg-opacity-95 flex flex-col items-center justify-center z-[60]">
              <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-purple-600 mb-6"></div>
              <h2 className="text-3xl font-bold text-purple-800 mb-2 animate-pulse">{loadingText || "Processing..."}</h2>
              <p className="text-gray-500 text-lg">Please wait while we process your data.</p>
            </div>
          )}

        </div>
      </div>
    </ProtectedRoute>
  );
};

export default InternalExamWizard;
