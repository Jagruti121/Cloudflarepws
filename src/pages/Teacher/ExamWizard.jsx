import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage } from '../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Navbar from '../../components/Navbar';
import ProtectedRoute from '../../components/ProtectedRoute';
import ExcelJS from 'exceljs';
import RosterSelectionPanel from '../../components/RosterSelectionPanel';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const ExamWizard = () => {
  const { currentUser } = useAuth();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const location = useLocation(); 
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState(''); 
  const [showConfirmModal, setShowConfirmModal] = useState(false); 
  const [showHelpModal, setShowHelpModal] = useState(false); // State for Help Popup

  // --- DATA VIEWER MODAL STATE ---
  const [viewerModal, setViewerModal] = useState(null); // { type: 'students'|'questions', data: [] }
  
  // --- Config State ---
  const [subjectName, setSubjectName] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [labNumber, setLabNumber] = useState(''); 
  const [studentDepartment, setStudentDepartment] = useState('');
  const [studentYear, setStudentYear] = useState('');
  const [durationHours, setDurationHours] = useState('0');
  const [durationMinutes, setDurationMinutes] = useState('0');
  const [practicalMarks, setPracticalMarks] = useState('');
  const [vivaMarks, setVivaMarks] = useState('');
  const [journalMarks, setJournalMarks] = useState('');
  const [step1Error, setStep1Error] = useState('');

  // --- Data Arrays ---
  // STUDENT CAPCUT: studentsFile/students state replaced with roster state
  const [masterRoster, setMasterRoster] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [rosterKeyId, setRosterKeyId] = useState('');
  const [questionsFile, setQuestionsFile] = useState(null);
  const [questions, setQuestions] = useState([]);

  // --- Subject Tagging State ---
  const [subjectCount, setSubjectCount] = useState(1);
  const [showSubjectCountModal, setShowSubjectCountModal] = useState(false);
  const [showTaggingModal, setShowTaggingModal] = useState(false);
  const [subjectTags, setSubjectTags] = useState({});
  const [isQuestionBankReady, setIsQuestionBankReady] = useState(false); 

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

  useEffect(() => {
    if (location.state?.template) {
        const t = location.state.template;
        setSubjectName(t.subjectName || '');
        if (t.subjectName) {
            setSessionCode(generateSessionCode(t.subjectName));
        }
        setLabNumber(t.labNumber || '');
        setStudentDepartment(t.studentDepartment || '');
        setStudentYear(t.studentYear || '');
        setDurationHours(t.durationHours || '0');
        setDurationMinutes(t.durationMinutes || '0');
        setPracticalMarks(t.practicalMarks || '');
        setVivaMarks(t.vivaMarks || '');
        setJournalMarks(t.journalMarks || '');
        // STUDENT CAPCUT: restore selected students from template (roster must be fetched separately)
        if (t.selectedStudents) setSelectedStudents(t.selectedStudents);
        setQuestions(t.questions || []);
        if (t.subjectCount) setSubjectCount(t.subjectCount);
        if (t.subjectTags) setSubjectTags(t.subjectTags);
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

  const handleSubjectChange = (e) => {
    const subject = e.target.value;
    setSubjectName(subject);
    if (subject.trim().length > 0) {
      setSessionCode(generateSessionCode(subject));
    } else {
      setSessionCode('');
    }
  };

  // --- 📥 DOWNLOAD TEMPLATE FUNCTION ---
  const handleDownloadTemplate = async (type) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(type === 'student' ? 'Student List' : 'Question Bank');

    if (type === 'student') {
        sheet.columns = [
            { header: 'Roll No', key: 'roll', width: 15 },
            { header: 'Name', key: 'name', width: 30 },
            { header: 'Image (Insert in Cell)', key: 'image', width: 25 }
        ];
        sheet.addRow({ roll: '101', name: 'Student Name Here', image: '' });
    } else {
        sheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Topic', key: 'topic', width: 50 },
            { header: 'Image (Insert in Cell)', key: 'image', width: 25 },
            { header: 'Marks', key: 'marks', width: 10 }
        ];
        sheet.addRow({ id: '1', topic: 'Write a program to...', image: '', marks: 10 });
    }

    // Generate and Download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = type === 'student' ? 'Student_List_Template.xlsx' : 'Question_Bank_Template.xlsx';
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  // --- 📸 SMART IMAGE EXTRACTOR ---
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

  // ── EXCEL SANITIZATION ─────────────────────────────────────────────────
  // Strips all ExcelJS rich text / formatting (including bold) from a cell value.
  // Handles: plain strings, numbers, RichText objects ({ richText: [...] }),
  // hyperlink objects ({ text, hyperlink }), formula results, dates, booleans.
  // Returns a clean string or the raw value for numbers.
  const sanitizeCellValue = (cellValue) => {
    if (cellValue === null || cellValue === undefined) return '';
    // ExcelJS RichText: { richText: [{ text: 'hello', font: { bold: true } }, ...] }
    if (typeof cellValue === 'object' && cellValue.richText && Array.isArray(cellValue.richText)) {
      return cellValue.richText.map(part => (part.text || '')).join('').trim();
    }
    // Hyperlink object: { text: '...', hyperlink: '...' }
    if (typeof cellValue === 'object' && cellValue.text) {
      return String(cellValue.text).trim();
    }
    // Formula result
    if (typeof cellValue === 'object' && cellValue.result !== undefined) {
      return String(cellValue.result).trim();
    }
    // Date
    if (cellValue instanceof Date) {
      return cellValue.toISOString();
    }
    return String(cellValue).trim();
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // We only attach photos if there are selected students
    if (selectedStudents.length === 0) {
      alert("❌ Please select students from the roster first.");
      e.target.value = '';
      return;
    }

    const storagePrefix = sessionCode ? `${sessionCode}_students` : `temp_students_${Date.now()}`;

    try {
        setLoading(true);
        setLoadingText("Scanning Excel for Photos...");

        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1);

        // ── HEADER VALIDATION ──────────────────────────────────────────────
        // Column A: Roll No | Column B: Image
        const headerRow = worksheet.getRow(1);
        const col1 = sanitizeCellValue(headerRow.getCell(1).value).toLowerCase().replace(/[^a-z0-9]/g, '');
        const col2 = sanitizeCellValue(headerRow.getCell(2).value).toLowerCase().replace(/[^a-z0-9]/g, '');

        const validCol1 = ['rollno', 'roll', 'serialno'].some(v => col1.includes(v)) || col1.includes('number');
        const validCol2 = col2.includes('image') || col2.includes('img') || col2.includes('photo');

        if (!validCol1 || !validCol2) {
            alert(
                `❌ Invalid Excel Format!\n\n` +
                `Your file headers: "${sanitizeCellValue(headerRow.getCell(1).value)}" | "${sanitizeCellValue(headerRow.getCell(2).value)}"\n\n` +
                `Expected format:\n` +
                `  Column A: Roll No\n` +
                `  Column B: Image\n\n` +
                `Please upload a file with the correct headers.`
            );
            e.target.value = '';
            setLoading(false);
            setLoadingText('');
            return;
        }

        const imageMap = extractImagesFromWorkbook(workbook, worksheet);
        let imageCount = 0;
        let attachedCount = 0;
        
        const photoUpdates = {}; // mapping of roll_no -> image URL

        // CapCut Enforcement Map: only allow roll numbers present in selectedStudents
        // The master roster uses `rollNumber`, but some parts might use `roll_no`. We handle both.
        const allowedRolls = new Set(selectedStudents.map(s => String(s.rollNumber || s.roll_no).trim()));

        const rowPromises = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip Header
            
            const promise = async () => {
                const rollRaw = sanitizeCellValue(row.getCell(1).value);
                if (!rollRaw) return;

                const roll_no = String(rollRaw).trim();
                
                // CAPCUT ENFORCEMENT: Ignore if not in Master Roster selection
                if (!allowedRolls.has(roll_no)) {
                    return;
                }

                let imageUrl = "";

                if (imageMap[rowNumber]) {
                    try {
                        imageCount++;
                        const imgData = imageMap[rowNumber];
                        const blob = new Blob([imgData.buffer], { type: `image/${imgData.extension}` });
                        const fileName = `${roll_no}_photo.${imgData.extension}`;
                        const storageRef = ref(storage, `student_profiles/${storagePrefix}/${fileName}`);
                        await uploadBytes(storageRef, blob);
                        imageUrl = await getDownloadURL(storageRef);
                    } catch (err) {
                        console.error(`Upload error for ${roll_no}`, err);
                    }
                } 
                else {
                    const cell2 = row.getCell(2);
                    if (cell2.value) {
                        if (typeof cell2.value === 'object' && cell2.value.text) imageUrl = cell2.value.text;
                        else if (typeof cell2.value === 'string') imageUrl = cell2.value;
                    }
                }
                
                if (imageUrl) {
                    photoUpdates[roll_no] = imageUrl;
                    attachedCount++;
                }
            };
            rowPromises.push(promise());
        });

        if (rowPromises.length > 0) setLoadingText(`Uploading detected photos...`);

        await Promise.all(rowPromises);
        
        if (attachedCount > 0) {
            // Merge photos into selectedStudents state
            setSelectedStudents(prev => prev.map(student => {
                const roll = String(student.rollNumber || student.roll_no).trim();
                if (photoUpdates[roll]) {
                    return { ...student, image: photoUpdates[roll] };
                }
                return student;
            }));
            alert(`✅ PHOTOS ATTACHED!\n\n• Successfully attached ${attachedCount} photos to selected students.\n• Unselected roll numbers in the Excel were automatically ignored.`);
        } else {
            alert("⚠️ No valid photos were found to attach to the selected students.");
        }
        
    } catch (error) {
        alert("Error processing file: " + error.message);
    } finally {
        e.target.value = ''; // reset file input
        setLoading(false);
        setLoadingText('');
    }
  };

  const handleQuestionsUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setQuestionsFile(file);
    const storagePrefix = sessionCode ? `${sessionCode}_questions` : `temp_questions_${Date.now()}`;

    try {
        setLoading(true);
        setLoadingText("Scanning Question Bank...");

        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1); 

        const imageMap = extractImagesFromWorkbook(workbook, worksheet);
        const imageCount = Object.keys(imageMap).length;

        const rowPromises = [];
        let qCount = 0;

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const promise = async () => {
                const idRaw = sanitizeCellValue(row.getCell(1).value);    
                const topicRaw = sanitizeCellValue(row.getCell(2).value); 
                const marksRaw = sanitizeCellValue(row.getCell(4).value); 

                if (!idRaw || !topicRaw) return null;

                qCount++;
                const question_id = idRaw;
                const topic = topicRaw;
                const marks = parseInt(marksRaw) || 0;
                let imageUrl = "";

                if (imageMap[rowNumber]) {
                    try {
                        const imgData = imageMap[rowNumber];
                        const blob = new Blob([imgData.buffer], { type: `image/${imgData.extension}` });
                        const fileName = `Q${question_id}_${Date.now()}.${imgData.extension}`;
                        const storageRef = ref(storage, `question_images/${storagePrefix}/${fileName}`);
                        await uploadBytes(storageRef, blob);
                        imageUrl = await getDownloadURL(storageRef);
                    } catch (err) {
                        console.error("Question Img Error", err);
                    }
                } 
                else {
                    const cell3 = row.getCell(3);
                    if (cell3.value) {
                        if (typeof cell3.value === 'object' && cell3.value.text) imageUrl = cell3.value.text;
                        else if (typeof cell3.value === 'string') imageUrl = cell3.value;
                    }
                }
                return { question_id, topic, marks, image: imageUrl };
            };
            rowPromises.push(promise());
        });

        if (imageCount > 0) setLoadingText(`Uploading ${imageCount} question diagrams...`);

        const results = await Promise.all(rowPromises);
        const validQuestions = results.filter(q => q !== null && q.marks > 0);

        if (validQuestions.length === 0) {
            alert("❌ No valid questions found.");
            setQuestions([]);
        } else {
            setQuestions(validQuestions);
            alert(`✅ UPLOAD SUCCESS:\n\n• Questions Found: ${validQuestions.length}\n• Diagrams Detected: ${imageCount}`);
            // Intercept: block Next/Save and show Subject Count modal
            setIsQuestionBankReady(false);
            setSubjectTags({});
            setSubjectCount(1);
            setShowSubjectCountModal(true);
        }

    } catch (error) {
        alert("Error processing questions: " + error.message);
    } finally {
        setLoading(false);
        setLoadingText('');
    }
  };

  const validatePracticalMarksDistribution = (practicalMarks, questionsList) => {
    const targetMarks = parseInt(practicalMarks);
    if (!targetMarks || !questionsList.length) return true;

    // AB-Mode: check that at least one valid Subject A + Subject B pair sums to targetMarks
    if (subjectCount === 2) {
      const poolA = questionsList.filter(q => subjectTags[q.question_id] === 'A');
      const poolB = questionsList.filter(q => subjectTags[q.question_id] === 'B');
      const hasValidPair = poolA.some(qA =>
        poolB.some(qB => qA.marks + qB.marks === targetMarks)
      );
      if (!hasValidPair) {
        alert(
          `⚠️ No valid Subject A + Subject B combination sums to ${targetMarks} marks.\n\n` +
          `Subject A marks: [${poolA.map(q => q.marks).join(', ')}]\n` +
          `Subject B marks: [${poolB.map(q => q.marks).join(', ')}]\n\n` +
          `Please adjust practical marks or re-tag questions.`
        );
        return false;
      }
      return true;
    }

    // Single-subject mode: subset-sum feasibility check
    const marks = questionsList.map(q => q.marks);
    const n = marks.length;
    // Use dynamic programming to check if any subset sums to targetMarks
    const dp = new Array(targetMarks + 1).fill(false);
    dp[0] = true;
    for (let i = 0; i < n; i++) {
      const m = marks[i];
      // Traverse backwards to avoid using the same question twice
      for (let s = targetMarks; s >= m; s--) {
        if (dp[s - m]) dp[s] = true;
      }
    }
    if (!dp[targetMarks]) {
      alert(
        `⚠️ No combination of questions sums exactly to ${targetMarks} marks.\n\n` +
        `Question marks available: [${marks.join(', ')}]\n\n` +
        `Please adjust practical marks or add more questions to the bank.`
      );
      return false;
    }
    return true;
  };

  const generateSlips = (studentsList, questionsList, totalPracticalMarks, examSubjectCount, examSubjectTags) => {
    const slips = {};

    // ── MODE 2: Two-Subject A/B Matching ──
    if (examSubjectCount === 2) {
      const poolA = questionsList.filter(q => examSubjectTags[q.question_id] === 'A');
      const poolB = questionsList.filter(q => examSubjectTags[q.question_id] === 'B');

      // Find all valid (A, B) pairs where marks sum to totalPracticalMarks
      const validPairs = [];
      for (const qA of poolA) {
        for (const qB of poolB) {
          if (qA.marks + qB.marks === totalPracticalMarks) {
            validPairs.push([qA, qB]);
          }
        }
      }

      if (validPairs.length === 0) {
        throw new Error(
          `No valid Subject A + Subject B combination sums to ${totalPracticalMarks} marks.\n\n` +
          `Subject A questions (${poolA.length}): marks = [${poolA.map(q => q.marks).join(', ')}]\n` +
          `Subject B questions (${poolB.length}): marks = [${poolB.map(q => q.marks).join(', ')}]\n\n` +
          `Please adjust marks or re-tag questions.`
        );
      }

      studentsList.forEach((student) => {
        const randomIndex = Math.floor(Math.random() * validPairs.length);
        slips[student.roll_no] = [...validPairs[randomIndex]];
      });
      return slips;
    }

    // ── MODE 1: Original single-subject greedy algorithm ──
    studentsList.forEach((student) => {
      const selectedQuestions = [];
      let currentSum = 0;
      const shuffled = [...questionsList].sort(() => Math.random() - 0.5);
      for (const question of shuffled) {
        if (currentSum + question.marks <= totalPracticalMarks) {
          selectedQuestions.push(question);
          currentSum += question.marks;
          if (currentSum === totalPracticalMarks) break;
        }
      }
      slips[student.roll_no] = selectedQuestions;
    });
    return slips;
  };

  const handleSaveTemplate = async () => {
    const templateName = prompt("Template Name:", subjectName);
    if (!templateName) return;
    setLoading(true);
    try {
        // TASK 1.1 FIX: Persist correct template_type and is_ab_method flag.
        // subjectCount === 2 means AB Method is active.
        const isAbMethod = subjectCount === 2;
        await addDoc(collection(db, 'colleges', tenantId, 'exam_templates'), {
            template_name: templateName,
            template_type: 'practical',
            is_ab_method: isAbMethod,
            teacher_email: currentUser.email,
            created_at: serverTimestamp(),
            subjectName, labNumber, studentDepartment, studentYear,
            durationHours, durationMinutes, practicalMarks, vivaMarks, journalMarks,
            selectedStudents, questions,
            subjectCount, subjectTags
        });
        alert("✅ Template Saved!");
        navigate('/teacher/dashboard');
    } catch (error) { alert("Failed: " + error.message); } 
    finally { setLoading(false); }
  };

  const handlePreLaunchValidation = () => {
    const cleanSessionCode = sessionCode.trim();
    const cleanSubject = subjectName.trim();
    const hrs = parseInt(durationHours) || 0;
    const mins = parseInt(durationMinutes) || 0;
    const totalDurationMinutes = (hrs * 60) + mins;

    if (!cleanSubject || !cleanSessionCode || !practicalMarks || !labNumber || !studentDepartment || !studentYear) {
      alert('Fill all required fields.'); return;
    }
    if (totalDurationMinutes <= 0) { alert('Duration > 0 required.'); return; }
    // STUDENT CAPCUT: check selectedStudents instead of old students array
    if (selectedStudents.length === 0) { alert('Please select at least one student from the roster.'); return; }
    if (questions.length === 0) { alert('Upload question bank.'); return; }
    if (!validatePracticalMarksDistribution(practicalMarks, questions)) return;

    setShowConfirmModal(true);
  };

  // STUDENT CAPCUT: executeLaunch now calls the server endpoint instead of
  // writing directly to Firestore from the client. The server validates ALL
  // selected roll numbers against the master roster before any write.
  const executeLaunch = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setLoadingText('Launching Session...');

    const cleanSessionCode = sessionCode.trim().toUpperCase();

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/api/exam-sessions/launch-with-roster`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          sessionCode: cleanSessionCode,
          subjectName: subjectName.trim(),
          labNumber: labNumber.trim(),
          studentDepartment: studentDepartment.trim(),
          studentYear: studentYear.trim(),
          durationHours,
          durationMinutes,
          practicalMarks,
          vivaMarks: vivaMarks || '0',
          journalMarks: journalMarks || '0',
          examType: 'practical',
          selectedStudents,  // validated server-side against master roster
          questions,
          subjectCount,
          subjectTags,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to launch exam session.');
      }

      navigate('/teacher/dashboard');
    } catch (error) {
      alert('Error launching exam: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={['teacher']}>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <h1 className="text-3xl font-bold text-gray-800 mb-8">
            {location.state?.template ? `Edit Exam: ${location.state.template.template_name}` : "Create New Exam"}
          </h1>

          {/* Progress Steps */}
          <div className="mb-10">
            <div className="flex items-center justify-between w-full relative">
              <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10"></div>
              {[{ num: 1, label: 'Config' }, { num: 2, label: 'Students' }, { num: 3, label: 'Questions' }, { num: 4, label: 'Save Template' }, { num: 5, label: 'Launch' }].map((s, index, arr) => (
                <div key={s.num} className={`flex items-center ${index !== arr.length - 1 ? 'flex-1' : ''}`}>
                  <div className="relative flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors duration-300 z-10 bg-gray-50 ${step >= s.num ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300'}`}>{s.num}</div>
                    <div className={`absolute top-12 text-xs font-medium w-32 text-center ${step >= s.num ? 'text-blue-700' : 'text-gray-400'}`}>{s.label}</div>
                  </div>
                  {index !== arr.length - 1 && (<div className={`flex-1 h-1 mx-2 rounded ${step > s.num ? 'bg-blue-600' : 'bg-gray-300'}`}></div>)}
                </div>
              ))}
            </div>
            <div className="h-8"></div> 
          </div>

          {/* STEP 1: CONFIGURATION */}
          {step === 1 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4">Exam Configuration</h2>
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div><label className="block text-gray-700 font-bold mb-2">Subject Name *</label><input type="text" value={subjectName} onChange={handleSubjectChange} className="w-full border rounded-lg px-4 py-2" required /></div>
                  <div><label className="block text-gray-700 font-bold mb-2">Session Code *</label><input type="text" value={sessionCode} readOnly className="w-full border rounded-lg px-4 py-2 bg-gray-100 cursor-not-allowed text-gray-500" title="Session code is auto-generated and cannot be modified" required /></div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 font-bold mb-2">Student Department *</label>
                    <select value={studentDepartment} onChange={(e) => { setStudentDepartment(e.target.value); setStep1Error(''); }} className={`w-full border-2 rounded-lg px-4 py-2 bg-white transition ${step1Error && !studentDepartment ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'}`} required>
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
                    {/* TASK 2.3 FIX: Renamed 'Student Year' → 'Student Semester' with Sem I–VIII options.
                        State variable kept as 'studentYear' for Firestore backward-compatibility. */}
                    <label className="block text-gray-700 font-bold mb-2">Student Semester *</label>
                    <select value={studentYear} onChange={(e) => { setStudentYear(e.target.value); setStep1Error(''); }} className={`w-full border-2 rounded-lg px-4 py-2 bg-white transition ${step1Error && !studentYear ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'}`} required>
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
                    {step1Error && !studentYear && (
                      <p className="text-red-500 text-xs mt-1 font-semibold flex items-center gap-1" style={{ animation: 'tooltipShake 0.3s ease-out' }}>
                        <span>⚠️</span> Please select a Semester
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                   <div><label className="block text-gray-700 font-bold mb-2">Lab / Room Number *</label><input type="text" value={labNumber} onChange={(e) => setLabNumber(e.target.value)} className="w-full border rounded-lg px-4 py-2" required /></div>
                   <div><label className="block text-gray-700 font-bold mb-2">Exam Duration *</label>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1"><input type="number" min="0" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} className="w-full border rounded-lg px-4 py-2" /><span className="text-xs text-gray-500">Hours</span></div>
                      <span className="font-bold">:</span>
                      <div className="flex-1"><input type="number" min="0" max="59" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} className="w-full border rounded-lg px-4 py-2" /><span className="text-xs text-gray-500">Minutes</span></div>
                    </div>
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg border">
                  <div><label className="block text-gray-700 font-bold mb-2">Practical Marks *</label><input type="number" value={practicalMarks} onChange={(e) => setPracticalMarks(e.target.value)} className="w-full border rounded-lg px-4 py-2" required /></div>
                  <div><label className="block text-gray-700 font-bold mb-2">Viva Marks</label><input type="number" value={vivaMarks} onChange={(e) => setVivaMarks(e.target.value)} className="w-full border rounded-lg px-4 py-2" /></div>
                  <div><label className="block text-gray-700 font-bold mb-2">Journal Marks</label><input type="number" value={journalMarks} onChange={(e) => setJournalMarks(e.target.value)} className="w-full border rounded-lg px-4 py-2" /></div>
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
                      const totalMins = (parseInt(durationHours)||0)*60 + (parseInt(durationMinutes)||0);
                      if (!studentDepartment || !studentYear) {
                        setStep1Error('Please select a Department and Year to continue.');
                        return;
                      }
                      if (!labNumber || totalMins <= 0 || !subjectName.trim()) { 
                        alert("Please fill all required fields and set a valid duration."); 
                        return; 
                      } 

                      const pMarks = parseInt(practicalMarks) || 0;
                      const vMarks = parseInt(vivaMarks) || 0;
                      const jMarks = parseInt(journalMarks) || 0;
                      if (pMarks < 0 || vMarks < 0 || jMarks < 0) {
                        setStep1Error('Marks cannot be negative. Please enter valid marks starting from 0.');
                        return;
                      } 

                      setLoading(true);
                      setLoadingText('Validating Session Code...');
                      
                      let currentCode = sessionCode;
                      if (!currentCode) {
                        currentCode = generateSessionCode(subjectName);
                      }

                      try {
                        let snap = await getDoc(doc(db, 'exam_index', currentCode));
                        if (snap.exists()) {
                          // Attempt 2
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
                    className={`w-full px-4 py-3 rounded-lg transition mt-4 font-bold text-lg flex items-center justify-center gap-2 ${
                      !studentDepartment || !studentYear 
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transform hover:scale-[1.01]'
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

          {/* STEP 2: STUDENTS — STUDENT CAPCUT: Replaced with RosterSelectionPanel */}
          {step === 2 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Select Students</h2>
                <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-full font-semibold">
                  Pre-Approved Roster
                </span>
              </div>
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-4 text-sm text-blue-800">
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
              
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                  <span>📸</span> Optional: Attach Student Photos
                </h3>
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-4 text-sm text-yellow-800">
                  <strong>Security Rule:</strong> Upload an Excel file with <strong>Column A: Roll No</strong> and <strong>Column B: Image</strong>. The system will strictly map photos ONLY to the students you selected above. Any unknown Roll Numbers will be automatically discarded.
                </div>
                <div className="space-y-4">
                  <div>
                    <input 
                      type="file" 
                      accept=".xlsx" 
                      onChange={handlePhotoUpload} 
                      disabled={selectedStudents.length === 0}
                      className="w-full border rounded-lg px-4 py-2 disabled:opacity-50" 
                    />
                  </div>
                  {selectedStudents.some(s => s.image) && (
                    <div className="flex items-center gap-3 bg-green-50 p-3 border border-green-200 rounded-lg">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-sm">✅</div>
                      <p className="font-bold text-green-800 text-sm">
                        Photos attached to {selectedStudents.filter(s => s.image).length} / {selectedStudents.length} selected students.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-4 mt-4">
                <button onClick={() => setStep(1)} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg">Back</button>
                <button
                  onClick={() => setStep(3)}
                  disabled={selectedStudents.length === 0}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  Next: Upload Questions ({selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} selected)
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: QUESTIONS */}
          {step === 3 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-bold">Upload Question Bank</h2>
                  <div className="flex gap-2">
                      <button onClick={() => handleDownloadTemplate('question')} className="text-sm bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-200 transition flex items-center gap-1 font-bold">
                          📥 Download Template
                      </button>
                      <button onClick={() => setShowHelpModal(true)} className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-bold hover:bg-gray-300" title="How to add images?">?</button>
                  </div>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-4 text-sm text-yellow-800">
                  <strong>Instruction:</strong> Upload <strong>Excel (.xlsx)</strong>.<br/>
                  <strong>Columns:</strong> <code>ID</code> | <code>Topic</code> | <code>Image</code> (Col C) | <code>Marks</code> (Col D)
              </div>
              <div className="space-y-4">
                <div><label className="block text-gray-700 font-bold mb-2">Question Bank Excel (.xlsx)</label><input type="file" accept=".xlsx" onChange={handleQuestionsUpload} className="w-full border rounded-lg px-4 py-2" /></div>
                {questions.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between bg-green-50 p-4 border border-green-200 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-xl">✅</div>
                        <div>
                          <p className="font-bold text-green-800">{questions.length} questions loaded!</p>
                          <p className="text-xs text-green-600">{questions.filter(q => q.image).length} diagrams detected</p>
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
                <div className="flex gap-4">
                  <button onClick={() => setStep(2)} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg">Back</button>
                  <button onClick={() => { if(!validatePracticalMarksDistribution(practicalMarks, questions)) return; setStep(4); }} disabled={questions.length === 0 || !isQuestionBankReady} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">Next: Save Template</button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: SAVE TEMPLATE */}
          {step === 4 && (
            <div className="bg-white rounded-lg shadow-md p-6 text-center">
              <h2 className="text-2xl font-bold mb-4">Save as Template?</h2>
              <div className="flex gap-4 justify-center">
                  <button onClick={() => setStep(5)} className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-bold">Skip & Continue</button>
                  <button onClick={handleSaveTemplate} disabled={loading} className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-bold shadow-md">💾 Save Template</button>
              </div>
            </div>
          )}

          {/* STEP 5: LAUNCH */}
          {step === 5 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4">Review & Launch</h2>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-bold mb-2">Exam Details:</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <p><strong>Subject:</strong> {subjectName}</p>
                    <p><strong>Session:</strong> {sessionCode}</p>
                    <p><strong>Students:</strong> {selectedStudents.length}</p>
                    <p><strong>Questions:</strong> {questions.length}</p>
                  </div>
                </div>
                <div className="grid md:grid-cols-1 gap-4 mt-6">
                    <button onClick={handlePreLaunchValidation} disabled={loading} className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-4 rounded-lg font-bold shadow-lg text-lg flex justify-center items-center gap-2">
                        <span>🚀</span> Launch Exam Now
                    </button>
                </div>
                <div className="text-center mt-4"><button onClick={() => setStep(4)} className="text-gray-500 hover:text-gray-700 text-sm underline">Back to Save Template</button></div>
              </div>
            </div>
          )}

          {/* ==================== DATA VIEWER MODAL ==================== */}
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
                      ? 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)'
                      : 'linear-gradient(135deg, #92400e 0%, #f59e0b 100%)'
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-2xl">
                      {viewerModal.type === 'students' ? '👨‍🎓' : '📋'}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">
                        {viewerModal.type === 'students' ? 'Student List' : 'Question Bank'}
                      </h3>
                      <p className="text-sm text-white text-opacity-80">
                        {viewerModal.data.length} {viewerModal.type === 'students' ? 'students' : 'questions'} •{' '}
                        {viewerModal.type === 'students'
                          ? `${viewerModal.data.filter(s => s.image).length} with photos`
                          : `${viewerModal.data.filter(q => q.image).length} with diagrams`
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
                        <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
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
                        <span className="text-gray-600">Total Marks: <strong className="text-gray-800">{viewerModal.data.reduce((s, q) => s + (q.marks || 0), 0)}</strong></span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span className="text-gray-600">With Diagram: <strong className="text-gray-800">{viewerModal.data.filter(q => q.image).length}</strong></span>
                      </div>
                    </>
                  )}
                </div>

                {/* Table Body */}
                <div className="overflow-auto flex-1">
                  {viewerModal.type === 'students' ? (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-blue-600 text-white">
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
                          <tr key={idx} className={`border-b border-gray-100 hover:bg-blue-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{idx + 1}</td>
                            <td className="px-4 py-3">
                              {s.image ? (
                                <img
                                  src={s.image}
                                  alt={s.name}
                                  className="w-12 h-12 rounded-xl object-cover border-2 border-blue-100 shadow-sm"
                                  onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}
                                />
                              ) : null}
                              <div
                                className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center text-blue-600 font-bold text-lg"
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
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-amber-600 text-white">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold w-10">#</th>
                          <th className="text-left px-4 py-3 font-semibold w-16">ID</th>
                          <th className="text-left px-4 py-3 font-semibold">Topic / Question</th>
                          <th className="text-left px-4 py-3 font-semibold w-28">Diagram</th>
                          <th className="text-right px-4 py-3 font-semibold w-20">Marks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewerModal.data.map((q, idx) => (
                          <tr key={idx} className={`border-b border-gray-100 hover:bg-amber-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{idx + 1}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-amber-700 font-bold text-xs">
                                Q{q.question_id}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-800 font-medium leading-snug">{q.topic}</td>
                            <td className="px-4 py-3">
                              {q.image ? (
                                <a href={q.image} target="_blank" rel="noopener noreferrer" className="group relative block">
                                  <img
                                    src={q.image}
                                    alt="diagram"
                                    className="w-14 h-10 rounded-lg object-cover border border-amber-200 group-hover:border-amber-400 transition shadow-sm"
                                    onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}
                                  />
                                  <div className="w-14 h-10 rounded-lg bg-amber-100 items-center justify-center text-amber-600 text-xs font-semibold" style={{ display: 'none' }}>View</div>
                                </a>
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                                {q.marks} pts
                              </span>
                            </td>
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

          {/* ==================== SUBJECT COUNT MODAL (Pop-up 1) ==================== */}
          {showSubjectCountModal && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8" style={{ animation: 'viewerIn 0.25s ease-out' }}>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">Subject Configuration</h3>
                    <p className="text-sm text-gray-500 mt-1">Does this Question Bank contain questions for 1 or 2 subjects?</p>
                  </div>
                  <button onClick={() => { setShowSubjectCountModal(false); setIsQuestionBankReady(true); }} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">&times;</button>
                </div>

                <div className="space-y-3 mb-8">
                  <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition ${
                    subjectCount === 1 ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                    <input type="radio" name="subjectCount" value={1} checked={subjectCount === 1} onChange={() => setSubjectCount(1)} className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-bold text-gray-800">1 Subject</p>
                      <p className="text-xs text-gray-500">All questions belong to a single subject</p>
                    </div>
                  </label>
                  <label className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition ${
                    subjectCount === 2 ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}>
                    <input type="radio" name="subjectCount" value={2} checked={subjectCount === 2} onChange={() => setSubjectCount(2)} className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-bold text-gray-800">2 Subjects</p>
                      <p className="text-xs text-gray-500">You will tag each question as Subject A or Subject B</p>
                    </div>
                  </label>
                </div>

                <button
                  onClick={() => {
                    setShowSubjectCountModal(false);
                    if (subjectCount === 1) {
                      setIsQuestionBankReady(true);
                    } else {
                      // Open tagging modal for 2 subjects
                      setSubjectTags({});
                      setShowTaggingModal(true);
                    }
                  }}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg transition shadow-md"
                >
                  {subjectCount === 1 ? 'Continue' : 'Next: Tag Questions →'}
                </button>
              </div>
            </div>
          )}

          {/* ==================== QUESTION TAGGING MODAL (Pop-up 2) ==================== */}
          {showTaggingModal && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4"
              style={{ backdropFilter: 'blur(10px)', background: 'rgba(15,23,42,0.6)' }}
            >
              <div
                className="bg-white rounded-3xl shadow-2xl w-full flex flex-col"
                style={{ maxWidth: '900px', maxHeight: '88vh', animation: 'viewerIn 0.28s cubic-bezier(.16,1,.3,1)' }}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 rounded-t-3xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-2xl">🏷️</div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Tag Questions by Subject</h3>
                      <p className="text-sm text-white text-opacity-80">
                        {Object.keys(subjectTags).length} / {questions.length} tagged
                      </p>
                    </div>
                  </div>
                  <button onClick={() => { setShowTaggingModal(false); setShowSubjectCountModal(true); }} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Stats Bar */}
                <div className="flex gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                    <span className="text-gray-600">Total: <strong className="text-gray-800">{questions.length}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                    <span className="text-gray-600">Subject A: <strong className="text-gray-800">{Object.values(subjectTags).filter(t => t === 'A').length}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                    <span className="text-gray-600">Subject B: <strong className="text-gray-800">{Object.values(subjectTags).filter(t => t === 'B').length}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                    <span className="text-gray-600">Untagged: <strong className="text-gray-800">{questions.length - Object.keys(subjectTags).length}</strong></span>
                  </div>
                </div>

                {/* Table Body */}
                <div className="overflow-auto flex-1">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-purple-600 text-white">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold w-10">#</th>
                        <th className="text-left px-4 py-3 font-semibold w-16">ID</th>
                        <th className="text-left px-4 py-3 font-semibold">Topic / Question</th>
                        <th className="text-right px-4 py-3 font-semibold w-20">Marks</th>
                        <th className="text-center px-4 py-3 font-semibold w-48">Subject Allocation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questions.map((q, idx) => (
                        <tr key={q.question_id} className={`border-b border-gray-100 hover:bg-purple-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                          <td className="px-4 py-3 text-gray-400 text-xs font-mono">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-purple-100 text-purple-700 font-bold text-xs">Q{q.question_id}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-800 font-medium leading-snug">{q.topic}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">{q.marks} pts</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-4">
                              <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 cursor-pointer text-xs font-bold transition ${
                                subjectTags[q.question_id] === 'A' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-blue-300'
                              }`}>
                                <input type="radio" name={`tag-${q.question_id}`} value="A" checked={subjectTags[q.question_id] === 'A'} onChange={() => setSubjectTags(prev => ({ ...prev, [q.question_id]: 'A' }))} className="w-3.5 h-3.5 text-blue-600" />
                                Sub A
                              </label>
                              <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 cursor-pointer text-xs font-bold transition ${
                                subjectTags[q.question_id] === 'B' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-orange-300'
                              }`}>
                                <input type="radio" name={`tag-${q.question_id}`} value="B" checked={subjectTags[q.question_id] === 'B'} onChange={() => setSubjectTags(prev => ({ ...prev, [q.question_id]: 'B' }))} className="w-3.5 h-3.5 text-orange-600" />
                                Sub B
                              </label>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-3xl flex-shrink-0">
                  <button onClick={() => { setShowTaggingModal(false); setShowSubjectCountModal(true); }} className="text-gray-500 hover:text-gray-800 font-medium text-sm">← Back</button>
                  <button
                    onClick={() => { setShowTaggingModal(false); setIsQuestionBankReady(true); }}
                    disabled={Object.keys(subjectTags).length !== questions.length}
                    className="px-8 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ✅ Confirm Tags ({Object.keys(subjectTags).length}/{questions.length})
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* --- HELP MODAL --- */}
          {showHelpModal && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-fade-in-up">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">How to Insert Images Correctly</h3>
                    <button onClick={() => setShowHelpModal(false)} className="text-gray-500 hover:text-gray-800 font-bold text-xl">&times;</button>
                </div>
                <div className="space-y-4 text-sm text-gray-700">
                    <p className="font-semibold text-blue-700 bg-blue-50 p-2 rounded">Use Google Sheets for best results:</p>
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
                <button onClick={() => setShowHelpModal(false)} className="mt-6 w-full bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700">Got it!</button>
              </div>
            </div>
          )}

          {/* --- CONFIRM MODAL --- */}
          {showConfirmModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 text-center animate-fade-in-up">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">🚀</span></div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Launch Exam Session?</h3>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setShowConfirmModal(false)} className="px-5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-bold">No, Wait</button>
                  <button onClick={executeLaunch} className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-md">Yes, Launch!</button>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="fixed inset-0 bg-white bg-opacity-95 flex flex-col items-center justify-center z-[60]">
                <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-blue-600 mb-6"></div>
                <h2 className="text-3xl font-bold text-blue-800 mb-2 animate-pulse">{loadingText || "Processing..."}</h2>
                <p className="text-gray-500 text-lg">Please wait while we upload images and setup data.</p>
            </div>
          )}

        </div>
      </div>
    </ProtectedRoute>
  );
};

export default ExamWizard;