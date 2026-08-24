import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs, writeBatch, deleteField, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, deleteObject, listAll, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import Navbar from '../../components/Navbar';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useTenant } from '../../context/TenantContext';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Utility to detect image URLs
const isImageUrl = (content) => {
  if (typeof content !== 'string' || !content) return false;
  return (content.startsWith('http://') || content.startsWith('https://')) && 
         (content.includes('firebasestorage.googleapis.com') || /\.(webp|png|jpg|jpeg|gif)$/i.test(content));
};

const Monitor = () => {
  const { sessionCode: paramsSessionCode } = useParams();
  const [searchParams] = useSearchParams();
  const sessionCode = paramsSessionCode || searchParams.get('session') || '';
  const { tenantId } = useTenant();
  const { currentUser } = useAuth();
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [vivaMarks, setVivaMarks] = useState('');
  const [journalMarks, setJournalMarks] = useState('');
  const [questionScores, setQuestionScores] = useState({});
  const [questionRemarks, setQuestionRemarks] = useState({});
  const [remarkSaveStatus, setRemarkSaveStatus] = useState({});
  const remarkDebounceTimers = useRef({});

  // --- NOTE STATE (debounced auto-save) ---
  const [noteText, setNoteText] = useState('');
  const [noteSaveStatus, setNoteSaveStatus] = useState(''); // '' | 'Saving...' | 'Saved' | 'Error'
  const noteDebounceTimer = useRef(null);

  const [examDetails, setExamDetails] = useState(null);
  const [questionBank, setQuestionBank] = useState([]);
  const [isChangingSlip, setIsChangingSlip] = useState(false);
  const [builderQuestions, setBuilderQuestions] = useState([]);
  const [slotChange, setSlotChange] = useState(null);
  const [slipSearchQuery, setSlipSearchQuery] = useState('');

  const [isEndSessionModalOpen, setIsEndSessionModalOpen] = useState(false);
  const [endSessionStep, setEndSessionStep] = useState(1);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [isEnding, setIsEnding] = useState(false);

  // ── Feature 1: Granular Session Resume State ──
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumeStep, setResumeStep] = useState(1); // 1 = options, 2 = student picker
  const [resumeSelectedIds, setResumeSelectedIds] = useState([]);
  const [isResuming, setIsResuming] = useState(false);

  const [timeRemaining, setTimeRemaining] = useState(null);
  const [isTimeUpModalOpen, setIsTimeUpModalOpen] = useState(false);
  const [hasTimeAlertShown, setHasTimeAlertShown] = useState(false);
  const [isDownloadingFiles, setIsDownloadingFiles] = useState(false);

  // --- STATUS FILTER STATE ---
  const [statusFilter, setStatusFilter] = useState(null); // null = show all

  // --- NEW: Zoom Image State ---
  const [zoomedImage, setZoomedImage] = useState(null);

  // --- BUFFER STUDENT STATE ---
  const [gearMenuOpen, setGearMenuOpen] = useState(false);
  const [showBufferModal, setShowBufferModal] = useState(false);
  const [bufferName, setBufferName] = useState('');
  const [bufferRoll, setBufferRoll] = useState('');
  const [bufferLoading, setBufferLoading] = useState(false);
  const [bufferError, setBufferError] = useState('');

  // --- SHARE SESSION STATE ---
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareEmailTags, setShareEmailTags] = useState([]);
  const [shareSearchResults, setShareSearchResults] = useState([]);
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState({ type: '', text: '' });
  const [allTeachers, setAllTeachers] = useState([]);
  const shareDropdownRef = useRef(null);

  // Close gear dropdown on outside click
  useEffect(() => {
    if (!gearMenuOpen) return;
    const handleOutside = (e) => {
      const container = document.getElementById('gear-menu-container');
      if (container && !container.contains(e.target)) setGearMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [gearMenuOpen]);

  // --- SHARE SESSION LOGIC ---
  useEffect(() => {
    if (!tenantId || !currentUser) return;
    const fetchTeachers = async () => {
      try {
        const teachersSnap = await getDocs(collection(db, 'colleges', tenantId, 'teachers'));
        const teachersList = teachersSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(t => t.email !== currentUser.email);
        setAllTeachers(teachersList);
      } catch (err) {
        console.error('Error fetching teachers:', err);
      }
    };
    fetchTeachers();
  }, [tenantId, currentUser]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (shareDropdownRef.current && !shareDropdownRef.current.contains(e.target)) {
        setShareDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (shareEmail.trim().length === 0) {
      const taggedEmails = new Set(shareEmailTags.map(t => t.toLowerCase()));
      setShareSearchResults(allTeachers.filter(t => !taggedEmails.has(t.email?.toLowerCase())).slice(0, 8));
    } else {
      const term = shareEmail.toLowerCase();
      const taggedEmails = new Set(shareEmailTags.map(t => t.toLowerCase()));
      const filtered = allTeachers.filter(t =>
        !taggedEmails.has(t.email?.toLowerCase()) && (
          (t.email?.toLowerCase() || '').includes(term) ||
          (t.name?.toLowerCase() || '').includes(term) ||
          (t.department?.toLowerCase() || '').includes(term)
        )
      );
      setShareSearchResults(filtered.slice(0, 8));
    }
  }, [shareEmail, allTeachers, shareEmailTags]);

  const handleSelectTeacher = (teacher) => {
    if (!shareEmailTags.includes(teacher.email)) {
      setShareEmailTags(prev => [...prev, teacher.email]);
    }
    setShareEmail('');
    setShareDropdownOpen(false);
  };

  const handleShareEmailKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
    if (e.key === 'Backspace' && shareEmail === '' && shareEmailTags.length > 0) {
      setShareEmailTags(prev => prev.slice(0, -1));
    }
  };

  const handleRemoveTag = (emailToRemove) => {
    setShareEmailTags(prev => prev.filter(e => e !== emailToRemove));
  };

  const handleShareSession = async () => {
    let finalTags = [...shareEmailTags];

    if (finalTags.length === 0) {
      setShareMessage({ type: 'error', text: 'Please add at least one recipient email.' });
      return;
    }

    const selfEmail = currentUser.email.toLowerCase();
    if (finalTags.includes(selfEmail)) {
      setShareMessage({ type: 'error', text: 'You cannot share a session with yourself.' });
      return;
    }

    setShareLoading(true);
    setShareMessage({ type: '', text: '' });

    try {
      let senderName = currentUser.displayName || currentUser.email;
      try {
        const senderQuery = query(collection(db, 'colleges', tenantId, 'teachers'), where('email', '==', currentUser.email));
        const senderSnap = await getDocs(senderQuery);
        if (!senderSnap.empty) {
          senderName = senderSnap.docs[0].data().name || senderName;
        }
      } catch (e) { /* fallback */ }

      const results = { success: [], notFound: [], alreadyShared: [] };

      for (const recipientEmail of finalTags) {
        const teachersQuery = query(collection(db, 'colleges', tenantId, 'teachers'), where('email', '==', recipientEmail));
        const teachersSnap = await getDocs(teachersQuery);

        if (teachersSnap.empty) {
          results.notFound.push(recipientEmail);
          continue;
        }

        const recipientData = teachersSnap.docs[0].data();

        const existingQuery = query(
          collection(db, 'colleges', tenantId, 'shared_sessions'),
          where('session_code', '==', sessionCode),
          where('recipient_email', '==', recipientEmail)
        );
        const existingSnap = await getDocs(existingQuery);

        if (!existingSnap.empty) {
          results.alreadyShared.push(recipientEmail);
          continue;
        }

        await addDoc(collection(db, 'colleges', tenantId, 'shared_sessions'), {
          session_code: sessionCode,
          sender_email: currentUser.email,
          sender_name: senderName,
          recipient_email: recipientEmail,
          recipient_name: recipientData.name || '',
          status: 'pending',
          shared_at: serverTimestamp(),
          subject_name: examDetails?.subject_name || '',
          student_department: examDetails?.student_department || '',
          student_year: examDetails?.student_year || '',
          lab_number: examDetails?.lab_number || '',
        });

        results.success.push(recipientData.name || recipientEmail);
      }

      let msg = '';
      if (results.success.length > 0) msg += `✅ Shared with: ${results.success.join(', ')}. `;
      if (results.alreadyShared.length > 0) msg += `⚠️ Already shared: ${results.alreadyShared.join(', ')}. `;
      if (results.notFound.length > 0) msg += `❌ Not registered: ${results.notFound.join(', ')}.`;

      const hasErrors = results.notFound.length > 0 || results.alreadyShared.length > 0;
      setShareMessage({
        type: results.success.length > 0 ? (hasErrors ? 'warning' : 'success') : 'error',
        text: msg.trim()
      });

      if (results.success.length > 0 && !hasErrors) {
        setTimeout(() => {
          setShowShareModal(false);
          setShareEmailTags([]);
          setShareEmail('');
        }, 2000);
      }
    } catch (error) {
      console.error('Error sharing session:', error);
      setShareMessage({ type: 'error', text: 'Failed to share session: ' + error.message });
    } finally {
      setShareLoading(false);
    }
  };


  useEffect(() => {
    if (!sessionCode || !tenantId) return;

    const examRef = doc(db, 'colleges', tenantId, 'exams', sessionCode);
    const unsubscribeExam = onSnapshot(examRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setExamDetails(data);

        if (data.is_active && data.started_at && data.duration_minutes) {
          const startTime = data.started_at.toDate();
          const endTime = new Date(startTime.getTime() + data.duration_minutes * 60000);

          const timerInterval = setInterval(() => {
            const now = new Date();
            const diff = endTime - now;
            setTimeRemaining(diff);

            if (diff <= 0 && diff > -1000 && !hasTimeAlertShown) {
              setHasTimeAlertShown(true);
              setIsTimeUpModalOpen(true);
            }
          }, 1000);

          return () => clearInterval(timerInterval);
        }
      }
    });

    const fetchQuestionBank = async () => {
      try {
        const qBankQuery = query(collection(db, 'colleges', tenantId, 'questions'), where('session_code', '==', sessionCode));
        const qBankSnap = await getDocs(qBankQuery);
        const questions = [];
        qBankSnap.forEach(doc => questions.push({ id: doc.id, ...doc.data() }));
        setQuestionBank(questions);
      } catch (error) { console.error(error); }
    };
    fetchQuestionBank();

    const q = query(collection(db, 'colleges', tenantId, 'students'), where('session_code', '==', sessionCode));
    const unsubscribeStudents = onSnapshot(q, (snapshot) => {
      const studentsList = [];
      snapshot.forEach((doc) => { studentsList.push({ id: doc.id, ...doc.data() }); });
      const sortedList = studentsList.sort((a, b) =>
        (a.roll_no || '').localeCompare(b.roll_no || '', undefined, { numeric: true })
      );
      setStudents(sortedList);
      
      setSelectedStudent(prev => {
        if (!prev) return null;
        return sortedList.find(s => s.id === prev.id) || prev;
      });
    });

    return () => {
      unsubscribeExam();
      unsubscribeStudents();
    };
  }, [sessionCode, hasTimeAlertShown, tenantId]);

  // ── TASK 1.2 FIX: Auto-resolve session state when all students reach a terminal status.
  // Runs reactively on every students / examDetails change.
  // Terminal states: absent, submitted, approved, or is_graded=true, or session_ended=true.
  useEffect(() => {
    if (!examDetails?.is_active || !sessionCode || !tenantId) return;
    if (students.length === 0) return;

    const allTerminal = students.every(s => {
      if (s.status === 'absent') return true;
      if (s.status === 'submitted') return true;
      if (s.status === 'approved') return true;
      if (s.is_graded) return true;
      // session_ended covers students stopped via "End for Specific"
      if (s.session_ended) return true;
      return false;
    });

    if (allTerminal) {
      // Atomically close the session — no confirm dialog needed, this is automatic.
      updateDoc(doc(db, 'colleges', tenantId, 'exams', sessionCode), { is_active: false })
        .catch(err => console.error('[Auto-End] Failed to close session:', err));
    }
  }, [students, examDetails?.is_active, sessionCode, tenantId]);

  const formatTime = (ms) => {
    if (ms === null) return "--:--:--";
    const isNegative = ms < 0;
    const absMs = Math.abs(ms);
    const seconds = Math.floor((absMs / 1000) % 60);
    const minutes = Math.floor((absMs / (1000 * 60)) % 60);
    const hours = Math.floor((absMs / (1000 * 60 * 60)));
    return `${isNegative ? '-' : ''}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleContinueOvertime = () => { setIsTimeUpModalOpen(false); };

  const handleNextStudent = () => {
    if (!selectedStudent) return;
    const currentIndex = students.findIndex(s => s.id === selectedStudent.id);
    if (currentIndex < students.length - 1) {
      openStudentView(students[currentIndex + 1]);
    } else {
      alert("End of student list.");
    }
  };

  const handlePrevStudent = () => {
    if (!selectedStudent) return;
    const currentIndex = students.findIndex(s => s.id === selectedStudent.id);
    if (currentIndex > 0) {
      openStudentView(students[currentIndex - 1]);
    }
  };

  const openStudentView = (student) => {
    setSelectedStudent(student);
    setVivaMarks(student.scores?.viva || '');
    setJournalMarks(student.scores?.journal || '');

    const loadedScores = {};
    const loadedRemarks = {};
    student.assigned_questions?.forEach((_, index) => {
      const key = `q${index + 1}`;
      loadedScores[key] = student.answers?.[key]?.score || '';
      loadedRemarks[key] = student.answers?.[key]?.remark || '';
    });
    setQuestionScores(loadedScores);
    setQuestionRemarks(loadedRemarks);
    setRemarkSaveStatus({});
    setIsChangingSlip(false);
  };

  // Load note text when a student is selected
  useEffect(() => {
    if (selectedStudent) {
      setNoteText(selectedStudent.teacher_note || '');
      setNoteSaveStatus('');
      // Cancel any pending note timer from a previous student
      if (noteDebounceTimer.current) {
        clearTimeout(noteDebounceTimer.current);
      }
    }
  }, [selectedStudent?.id]);

  const handleQuestionScoreChange = (key, value, maxMarks) => {
    const val = parseInt(value) || 0;
    if (val < 0) { alert(`Marks cannot be negative (0 minimum)`); return; }
    if (val > maxMarks) { alert(`Marks cannot exceed max marks of ${maxMarks}`); return; }
    setQuestionScores(prev => ({ ...prev, [key]: value }));
  };

  const handleRemarkChange = (answerKey, newRemark) => {
    setQuestionRemarks(prev => ({ ...prev, [answerKey]: newRemark }));
    setRemarkSaveStatus(prev => ({ ...prev, [answerKey]: 'Saving...' }));

    if (remarkDebounceTimers.current[answerKey]) {
      clearTimeout(remarkDebounceTimers.current[answerKey]);
    }

    remarkDebounceTimers.current[answerKey] = setTimeout(async () => {
      try {
        await updateDoc(doc(db, 'colleges', tenantId, 'students', selectedStudent.id), {
          [`answers.${answerKey}.remark`]: newRemark
        });
        setRemarkSaveStatus(prev => ({ ...prev, [answerKey]: 'Saved' }));
        setTimeout(() => setRemarkSaveStatus(prev => ({ ...prev, [answerKey]: '' })), 2000);
      } catch (error) {
        console.error('Save failed', error);
        setRemarkSaveStatus(prev => ({ ...prev, [answerKey]: 'Error' }));
      }
    }, 2000);
  };

  // ── TASK 1 FIX: Recalculate top-level status after every per-question approve/reject.
  // This is what makes the student's UI react instantly via the onSnapshot listener.
  const recalculateStudentStatus = (updatedAnswers, numQuestions) => {
    const allApproved = Array.from({ length: numQuestions }, (_, i) =>
      updatedAnswers[`q${i + 1}`]?.is_approved
    ).every(Boolean);
    const anyRejected = Array.from({ length: numQuestions }, (_, i) =>
      updatedAnswers[`q${i + 1}`]?.is_rejected
    ).some(Boolean);

    if (allApproved) return 'approved';      // → student sees Final Submit only
    if (anyRejected) return 'in_progress';   // → student goes back to editing
    return 'approval_requested';             // → still waiting on other questions
  };

  const handleApproveQuestion = async (answerKey, currentStatus) => {
    try {
      const numQ = selectedStudent.assigned_questions?.length || 0;
      // Build a snapshot of answers with the toggled value applied
      const simulatedAnswers = { ...(selectedStudent.answers || {}) };
      simulatedAnswers[answerKey] = {
        ...(simulatedAnswers[answerKey] || {}),
        is_approved: !currentStatus,
        is_rejected: false,
      };
      const newStatus = recalculateStudentStatus(simulatedAnswers, numQ);

      await updateDoc(doc(db, 'colleges', tenantId, 'students', selectedStudent.id), {
        [`answers.${answerKey}.is_approved`]: !currentStatus,
        [`answers.${answerKey}.is_rejected`]: false,
        status: newStatus,
      });
    } catch (error) {
      alert("Error approving question: " + error.message);
    }
  };

  const handleRejectQuestion = async (answerKey, currentStatus) => {
    try {
      const numQ = selectedStudent.assigned_questions?.length || 0;
      const simulatedAnswers = { ...(selectedStudent.answers || {}) };
      simulatedAnswers[answerKey] = {
        ...(simulatedAnswers[answerKey] || {}),
        is_rejected: !currentStatus,
        is_approved: false,
      };
      const newStatus = recalculateStudentStatus(simulatedAnswers, numQ);

      await updateDoc(doc(db, 'colleges', tenantId, 'students', selectedStudent.id), {
        [`answers.${answerKey}.is_rejected`]: !currentStatus,
        [`answers.${answerKey}.is_approved`]: false,
        status: newStatus,
      });
    } catch (error) {
      alert("Error rejecting question: " + error.message);
    }
  };

  // ── NOTE: 2-second debounced auto-save ──────────────────────────────────────
  // Every keystroke resets the 2000ms timer. The Firestore write only fires
  // after the user has stopped typing for a full 2 seconds.
  const handleNoteChange = (value) => {
    setNoteText(value);
    setNoteSaveStatus('Saving...');

    // Clear the previous pending timer on every keystroke
    if (noteDebounceTimer.current) {
      clearTimeout(noteDebounceTimer.current);
    }

    // Schedule a new write — fires only if no keystroke occurs in the next 2000ms
    noteDebounceTimer.current = setTimeout(async () => {
      try {
        await updateDoc(doc(db, 'colleges', tenantId, 'students', selectedStudent.id), {
          teacher_note: value
        });
        setNoteSaveStatus('Saved');
        // Auto-clear the 'Saved' indicator after 2 more seconds
        setTimeout(() => setNoteSaveStatus(''), 2000);
      } catch (error) {
        console.error('Note save failed:', error);
        setNoteSaveStatus('Error');
      }
    }, 2000);
  };

  const handleSaveAllGrades = async () => {
    try {
      const viva = parseInt(vivaMarks || 0);
      const journal = parseInt(journalMarks || 0);
      let totalPractical = 0;
      const updatedAnswers = { ...selectedStudent.answers };

      if (examDetails?.exam_type === 'internal') {
        // Auto-grade internal (MCQ) exam: compute score per question from answer key
        selectedStudent.assigned_questions?.forEach((assignedQuestion, index) => {
          const key = `q${index + 1}`;
          const answer = updatedAnswers[key];
          const fullQuestion = questionBank.find(q => q.question_id === (assignedQuestion.question_id || assignedQuestion.id)) || assignedQuestion;

          let correctOptionText = null;
          const answerRaw = fullQuestion.answer?.toString().trim();
          if (answerRaw) {
            const answerUpper = answerRaw.toUpperCase();
            if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
              correctOptionText = fullQuestion[`opt${answerUpper}`] || fullQuestion[`opt${answerUpper.toLowerCase()}`];
            } else {
              for (const letter of ['A', 'B', 'C', 'D']) {
                const optText = (fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`])?.toString().trim();
                if (optText && optText.toUpperCase() === answerUpper) {
                  correctOptionText = fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`];
                  break;
                }
              }
              if (!correctOptionText) correctOptionText = fullQuestion.answer;
            }
          }

          const isCorrect = !!(answer?.selected_option && correctOptionText && answer.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase());
          const qScore = isCorrect ? (parseFloat(assignedQuestion.marks) || 0) : 0;
          totalPractical += qScore;
          if (!updatedAnswers[key]) updatedAnswers[key] = {};
          updatedAnswers[key] = { ...updatedAnswers[key], score: qScore, is_correct: isCorrect };
        });
      } else if (canGradePractical) {
        selectedStudent.assigned_questions.forEach((_, index) => {
          const key = `q${index + 1}`;
          const score = parseInt(questionScores[key] || 0);
          totalPractical += score;
          if (!updatedAnswers[key]) updatedAnswers[key] = {};
          updatedAnswers[key] = { ...updatedAnswers[key], score: score };
        });
      } else {
        totalPractical = selectedStudent.scores?.practical || 0;
      }

      if (viva < 0) { alert('Viva marks cannot be negative.'); return; }
      if (journal < 0) { alert('Journal marks cannot be negative.'); return; }
      if (examDetails?.viva_marks !== undefined && viva > examDetails.viva_marks) { alert(`Viva marks cannot exceed ${examDetails.viva_marks}.`); return; }
      if (examDetails?.journal_marks !== undefined && journal > examDetails.journal_marks) { alert(`Journal marks cannot exceed ${examDetails.journal_marks}.`); return; }

      const grandTotal = examDetails?.exam_type === 'internal' 
        ? totalPractical 
        : totalPractical + viva + journal;

      await updateDoc(doc(db, 'colleges', tenantId, 'students', selectedStudent.id), {
        answers: updatedAnswers,
        'scores.practical': totalPractical,
        'scores.viva': examDetails?.exam_type === 'internal' ? 0 : viva,
        'scores.journal': examDetails?.exam_type === 'internal' ? 0 : journal,
        'scores.total': grandTotal,
        is_graded: true
      });
      alert(`Grades Saved! Total: ${grandTotal}`);
    } catch (error) { alert("Error saving grades: " + error.message); }
  };

  const handleApprove = async (studentId) => { try { await updateDoc(doc(db, 'colleges', tenantId, 'students', studentId), { status: 'approved' }); setSelectedStudent(null); } catch (error) { alert(error.message); } };
  const handleReject = async (studentId) => { if (!window.confirm("Reject submission? Student will be able to edit.")) return; try { await updateDoc(doc(db, 'colleges', tenantId, 'students', studentId), { status: 'in_progress', rejection_reason: 'The teacher has rejected your submission. Please make the necessary changes.', rejected_at: new Date().toISOString() }); alert("Submission Rejected."); setSelectedStudent(null); } catch (error) { alert(error.message); } };
  const handleResumeSession = async (studentId) => { if (!window.confirm("Undo 'End Session'?")) return; try { await updateDoc(doc(db, 'colleges', tenantId, 'students', studentId), { session_ended: false }); alert("Session Resumed."); setSelectedStudent(null); } catch (error) { alert(error.message); } };

  // ── GLOBAL SESSION RESUME ───────────────────────────────────────────────────
  const handleOpenResumeModal = () => {
    setResumeStep(1);
    setResumeSelectedIds([]);
    setShowResumeModal(true);
  };

  // Resume for ALL students — re-opens session and allows absent/registered students to rejoin
  const handleResumeForAll = async () => {
    setIsResuming(true);
    try {
      const batch = writeBatch(db);
      const examRef = doc(db, 'colleges', tenantId, 'exams', sessionCode);
      batch.update(examRef, { is_active: true });

      // Audit snapshot
      const snapshotRef = doc(db, 'colleges', tenantId, 'exams', sessionCode, 'resume_snapshots', `resume_${Date.now()}`);
      batch.set(snapshotRef, {
        resumed_at: new Date(),
        resumed_by: currentUser?.email || 'unknown',
        scope: 'all',
        student_states: students.map(s => ({ id: s.id, roll_no: s.roll_no, name: s.name, status: s.status })),
      });

      // BUG 2 FIX: Reset absent students back to 'registered' so they can log in again.
      students.forEach(s => {
        const sRef = doc(db, 'colleges', tenantId, 'students', s.id);
        if (s.status === 'absent') {
          batch.update(sRef, { status: 'registered', session_ended: false });
        } else if (s.session_ended) {
          batch.update(sRef, { session_ended: false });
        }
      });

      await batch.commit();
      setShowResumeModal(false);
      alert('✅ Session Resumed for ALL students!\n\nAbsent students can now log back in.');
    } catch (error) {
      alert('Failed to resume session: ' + error.message);
    } finally {
      setIsResuming(false);
    }
  };

  // Resume for SPECIFIC students only
  const handleResumeForSpecific = async () => {
    if (resumeSelectedIds.length === 0) return;
    setIsResuming(true);
    try {
      const batch = writeBatch(db);
      const examRef = doc(db, 'colleges', tenantId, 'exams', sessionCode);
      batch.update(examRef, { is_active: true });

      const snapshotRef = doc(db, 'colleges', tenantId, 'exams', sessionCode, 'resume_snapshots', `resume_${Date.now()}`);
      batch.set(snapshotRef, {
        resumed_at: new Date(),
        resumed_by: currentUser?.email || 'unknown',
        scope: 'specific',
        resumed_student_ids: resumeSelectedIds,
      });

      // BUG 2 FIX: Reset only selected students' status so they can re-enter.
      students.forEach(s => {
        if (!resumeSelectedIds.includes(s.id)) return;
        const sRef = doc(db, 'colleges', tenantId, 'students', s.id);
        const updates = { session_ended: false };
        // If they were marked absent, put them back to registered so login works.
        if (s.status === 'absent') updates.status = 'registered';
        batch.update(sRef, updates);
      });

      await batch.commit();
      setShowResumeModal(false);
      setResumeSelectedIds([]);
      alert(`✅ Session Resumed for ${resumeSelectedIds.length} selected student(s).`);
    } catch (error) {
      alert('Failed to resume session: ' + error.message);
    } finally {
      setIsResuming(false);
    }
  };

  // --- LOGIC FIX: Absent students NOT forced to score 0 in DB ---
  const handleEndForAll = async () => {
    if (!window.confirm("🔴 DANGER: Stop exam for ALL students?")) return;
    setIsEnding(true);
    try {
      const batch = writeBatch(db);
      const examRef = doc(db, 'colleges', tenantId, 'exams', sessionCode);
      batch.update(examRef, { is_active: false });
      let absentsMarked = 0;
      students.forEach(student => {
        const sRef = doc(db, 'colleges', tenantId, 'students', student.id);
        if (student.status === 'registered') {
          // Just mark status, preserve score field integrity
          batch.update(sRef, { status: 'absent' });
          absentsMarked++;
        } else if (student.status === 'in_progress') {
          batch.update(sRef, { status: 'submitted' });
        }
      });
      await batch.commit();
      alert(`Session Ended Globally.\n${absentsMarked} students marked as ABSENT.`);
      setIsEndSessionModalOpen(false);
      setIsTimeUpModalOpen(false);
    } catch (error) { alert("Failed: " + error.message); } finally { setIsEnding(false); }
  };

  const handleEndForSpecific = async () => {
    if (selectedStudentIds.length === 0) return;
    if (!window.confirm(`End session for ${selectedStudentIds.length} students?`)) return;
    setIsEnding(true);
    try {
      const batch = writeBatch(db);
      selectedStudentIds.forEach(id => { const sRef = doc(db, 'colleges', tenantId, 'students', id); batch.update(sRef, { session_ended: true }); });
      await batch.commit();
      alert("Session ended for selected students.");
      setSelectedStudentIds([]);
      setEndSessionStep(1);
      setIsEndSessionModalOpen(false);
    } catch (error) { alert("Failed: " + error.message); } finally { setIsEnding(false); }
  };

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      const activeIds = students.filter(s => s.status === 'in_progress' || s.status === 'registered').map(s => s.id);
      setSelectedStudentIds(activeIds);
    } else { setSelectedStudentIds([]); }
  };

  const toggleStudentSelection = (id) => {
    setSelectedStudentIds(prev => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
  };

  // --- LOGIC FIX: Export ABSENT string ---
  const handleExportAttendance = () => {
    if (students.length === 0) return;
    const attendanceData = students.map((student, index) => ({
      'Serial No': index + 1,
      'Roll Number': student.roll_no,
      'Full Name': student.name,
      'Attendance': (student.status === 'absent' || student.status === 'registered') ? 'Absent' : 'Present'
    }));
    const worksheet = XLSX.utils.json_to_sheet(attendanceData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
    XLSX.writeFile(workbook, `${sessionCode}_Attendance.xlsx`);
  };

  // --- RESULT EXPORT: Differentiates between Internal and Practical exam formats ---
  const handleExportResults = () => {
    if (students.length === 0) return;
    const dateObj = examDetails?.created_at?.toDate ? examDetails.created_at.toDate() : new Date();
    const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    const dept = (examDetails?.student_department || 'Unknown').toUpperCase();
    const subject = (examDetails?.subject_name || 'Unknown').toUpperCase();

    if (examDetails?.exam_type === 'internal') {
      // ── INTERNAL EXAM FORMAT ──
      // Header: DATE / DEPARTMENT + SUBJECT + SEM
      // Columns: Serial Number | Roll Number | Full Name | Total Marks
      const sem = (examDetails?.student_semester || examDetails?.student_year || 'Unknown').toUpperCase();

      const dataRows = students.map((student, index) => {
        const isAbsent = student.status === 'absent' || student.status === 'registered';
        if (isAbsent) return [index + 1, student.roll_no, student.name, '-'];

        // ── DOUBLE-VERIFY: Recompute score from answer key at export time ──
        // Never trust stored scores alone — recompute from questionBank to catch
        // any stale or incorrectly-graded data.
        let recomputedTotal = 0;
        student.assigned_questions?.forEach((assignedQuestion, qIndex) => {
          const answerKey = `q${qIndex + 1}`;
          const answer = student.answers?.[answerKey];
          const fullQuestion = questionBank.find(q => q.question_id === (assignedQuestion.question_id || assignedQuestion.id)) || assignedQuestion;

          let correctOptionText = null;
          const answerRaw = fullQuestion.answer?.toString().trim();
          if (answerRaw) {
            const answerUpper = answerRaw.toUpperCase();
            if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
              correctOptionText = fullQuestion[`opt${answerUpper}`] || fullQuestion[`opt${answerUpper.toLowerCase()}`];
            } else {
              for (const letter of ['A', 'B', 'C', 'D']) {
                const optText = (fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`])?.toString().trim();
                if (optText && optText.toUpperCase() === answerUpper) {
                  correctOptionText = fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`];
                  break;
                }
              }
              if (!correctOptionText) correctOptionText = fullQuestion.answer;
            }
          }

          if (answer?.selected_option && correctOptionText) {
            const isCorrect = answer.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase();
            if (isCorrect) {
              recomputedTotal = Math.round((recomputedTotal + (parseFloat(assignedQuestion.marks) || 0)) * 10) / 10;
            }
          }
        });

        // Cross-check: warn in console if stored score differs from recomputed
        const storedTotal = student.scores?.total ?? student.scores?.internal ?? 0;
        if (storedTotal !== recomputedTotal) {
          console.warn(`[Export Verify] Score mismatch for ${student.name} (Roll: ${student.roll_no}): stored=${storedTotal}, recomputed=${recomputedTotal}. Using recomputed.`);
        }

        return [index + 1, student.roll_no, student.name, recomputedTotal];
      });

      const worksheetData = [
        [`DATE : ${dateStr}`],
        [`DEPARTMENT: ${dept} SUBJECT: ${subject}  SEM: ${sem}`],
        [],
        ['Serial Number', 'Roll Number', 'Full Name', 'Total Marks'],
        ...dataRows
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Column widths for readability
      worksheet['!cols'] = [
        { wch: 14 }, { wch: 13 }, { wch: 22 }, { wch: 12 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
      XLSX.writeFile(workbook, `${sessionCode}_Internal_Results.xlsx`);
    } else {
      // ── PRACTICAL EXAM FORMAT (original) ──
      const year = (examDetails?.student_year || 'Unknown').toUpperCase();

      const dataRows = students.map((student, index) => {
        const isAbsent = student.status === 'absent' || student.status === 'registered';
        return [
          index + 1,
          student.roll_no,
          student.name,
          isAbsent ? 'ABSENT' : (student.scores?.practical || 0),
          isAbsent ? '-' : (student.scores?.viva || 0),
          isAbsent ? '-' : (student.scores?.journal || 0),
          isAbsent ? 'ABSENT' : (student.scores?.total || 0)
        ];
      });

      const worksheetData = [
        [`DATE : ${dateStr}`],
        [`DEPARTMENT: ${dept}    SUBJECT: ${subject}    YEAR: ${year}`],
        [],
        ['Serial Number', 'Roll Number', 'Full Name', 'Practical', 'Viva', 'Journal', 'Total'],
        ...dataRows
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
      XLSX.writeFile(workbook, `${sessionCode}_Results.xlsx`);
    }
  };

  const canChangeSlip = examDetails?.is_active && selectedStudent?.status !== 'submitted';
  const isSessionActive = examDetails?.is_active;
  const canGradePractical = !isSessionActive || selectedStudent?.status === 'submitted';
  const allGraded = students.length > 0 && students.every(s => s.is_graded || s.status === 'absent');
  const activeStudentsList = students.filter(s => s.status !== 'submitted' && s.status !== 'approved' && s.status !== 'absent');

  const handleOpenSlipChange = () => {
    if (!examDetails?.practical_marks) { alert("Error: Practical marks not defined."); return; }
    setBuilderQuestions([...(selectedStudent.assigned_questions || [])]);
    setSlotChange(null);
    setIsChangingSlip(true);
  };

  // Feature 2: Assign new slip (combination) to student, with granular data clearing.
  const handleAssignSlip = async (newQuestions) => {
    if (!newQuestions || newQuestions.length === 0) return;
    try {
      const oldQuestions = selectedStudent.assigned_questions || [];
      const currentAnswers = selectedStudent.answers || {};

      const newFullQuestions = newQuestions.map(q => ({ question_id: q.question_id, topic: q.topic, marks: q.marks, image: q.image || '' }));

      // Preserve data for unchanged questions, clear data for new questions
      const newAnswers = {};
      newFullQuestions.forEach((newQ, idx) => {
        const answerKey = `q${idx + 1}`;
        const oldIndex = oldQuestions.findIndex(oq => oq.question_id === newQ.question_id);
        if (oldIndex !== -1) {
          const oldAnswerKey = `q${oldIndex + 1}`;
          if (currentAnswers[oldAnswerKey]) newAnswers[answerKey] = { ...currentAnswers[oldAnswerKey] };
        } else {
          newAnswers[answerKey] = { code: '', file_uploaded: false, file_name: null, file_url: null, is_approved: false, is_rejected: false };
        }
      });

      const updatePayload = {
        assigned_questions: newFullQuestions,
        answers: newAnswers,
        is_slip_changed: true,
      };
      if (selectedStudent.status === 'approved' || selectedStudent.status === 'approval_requested') {
        updatePayload.status = 'in_progress';
      }

      await updateDoc(doc(db, 'colleges', tenantId, 'students', selectedStudent.id), updatePayload);
      alert('Slip changed successfully!');
      setIsChangingSlip(false);
    } catch (err) {
      alert('Failed to assign slip: ' + err.message);
    }
  };

  const handleDownloadSessionFiles = async () => {
    if (!window.confirm("⚠️ Download and DELETE all session files?")) return;
    setIsDownloadingFiles(true);
    const zip = new JSZip();
    const batch = writeBatch(db);
    const deletePromises = [];
    let filesFoundCount = 0;

    try {
      const sessionFolderRef = ref(storage, `exam_uploads/${sessionCode}`);
      const studentListResult = await listAll(sessionFolderRef);
      for (const studentFolderRef of studentListResult.prefixes) {
        const fileListResult = await listAll(studentFolderRef);
        for (const fileRef of fileListResult.items) {
          try {
            filesFoundCount++;
            const url = await getDownloadURL(fileRef);
            const response = await fetch(url);
            if (!response.ok) throw new Error("Fetch failed");
            const blob = await response.blob();
            zip.file(fileRef.name, blob);
            deletePromises.push(deleteObject(fileRef));
          } catch (err) { console.error(err); }
        }
      }
      if (filesFoundCount === 0) { alert("No files found."); setIsDownloadingFiles(false); return; }
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `${sessionCode}_Files.zip`);
      students.forEach(student => {
        if (student.answers) {
          const sRef = doc(db, 'colleges', tenantId, 'students', student.id);
          const updateData = {};
          let needsUpdate = false;
          Object.keys(student.answers).forEach(key => {
            if (student.answers[key].file_uploaded) {
              // Mark as downloaded but preserve file_name so teacher can see what was uploaded
              updateData[`answers.${key}.file_uploaded`] = 'downloaded';
              updateData[`answers.${key}.file_url`] = deleteField();
              updateData[`answers.${key}.storage_ref`] = deleteField();
              // Keep file_name intact for display purposes
              needsUpdate = true;
            }
          });
          if (needsUpdate) batch.update(sRef, updateData);
        }
      });
      await Promise.all(deletePromises);
      await batch.commit();
      alert("Success! Files downloaded and deleted.");
    } catch (error) { alert("Error: " + error.message); }
    finally { setIsDownloadingFiles(false); }
  };

  // ===================================================
  // BUFFER STUDENT — Add a walk-in student mid-session
  // ===================================================
  const generateSlipForStudent = (targetMarks) => {
    if (!targetMarks || questionBank.length === 0) return [];
    // Find a valid combination of questions summing to targetMarks
    const findCombo = (startIdx, current, currentSum) => {
      if (currentSum === targetMarks) return [...current];
      if (currentSum > targetMarks || startIdx >= questionBank.length) return null;
      for (let i = startIdx; i < questionBank.length; i++) {
        const q = questionBank[i];
        current.push(q);
        const result = findCombo(i + 1, current, currentSum + q.marks);
        if (result) return result;
        current.pop();
      }
      return null;
    };
    // Shuffle first for randomness
    const shuffled = [...questionBank].sort(() => Math.random() - 0.5);
    const findComboShuffled = (startIdx, current, currentSum) => {
      if (currentSum === targetMarks) return [...current];
      if (currentSum > targetMarks || startIdx >= shuffled.length) return null;
      for (let i = startIdx; i < shuffled.length; i++) {
        const q = shuffled[i];
        current.push(q);
        const result = findComboShuffled(i + 1, current, currentSum + q.marks);
        if (result) return result;
        current.pop();
      }
      return null;
    };
    return findComboShuffled(0, [], 0) || [];
  };

  const handleAddBufferStudent = async () => {
    const nameClean = bufferName.trim();
    const rollClean = bufferRoll.trim();
    if (!nameClean || !rollClean) { setBufferError('Name and Roll Number are required.'); return; }

    // Check for duplicate roll
    const duplicate = students.find(s => s.roll_no.toLowerCase() === rollClean.toLowerCase());
    if (duplicate) { setBufferError(`Roll No "${rollClean}" already exists in this session.`); return; }

    setBufferLoading(true);
    setBufferError('');

    try {
      const isInternal = examDetails?.exam_type === 'internal';
      const studentId = `${sessionCode}_${rollClean}`;
      const batch = writeBatch(db);
      const studentRef = doc(db, 'colleges', tenantId, 'students', studentId);

      let assignedQuestions = [];
      let studentDoc = {};

      if (isInternal) {
        // ── INTERNAL EXAM: Assign MCQ questions from the question bank ──
        // The questionBank for internal exams has: question_id, question_text, optA-D, answer, marks
        const targetMarks = parseInt(examDetails?.internal_marks || examDetails?.total_marks || 0);

        // Use the same subset-sum greedy approach as the launch wizard
        const shuffled = [...questionBank].sort(() => Math.random() - 0.5);
        const selected = [];
        let currentSum = 0;
        for (const q of shuffled) {
          const m = parseInt(q.marks, 10);
          if (currentSum + m <= targetMarks) {
            selected.push(q);
            currentSum += m;
            if (currentSum === targetMarks) break;
          }
        }
        // Fisher-Yates shuffle for per-student order randomization
        for (let i = selected.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [selected[i], selected[j]] = [selected[j], selected[i]];
        }
        assignedQuestions = selected;

        // Map to the exact schema used when the internal exam was launched
        const mappedQuestions = assignedQuestions.map(q => ({
          question_id: q.question_id || q.id || '',
          question: q.question_text || q.question || '',
          question_text: q.question_text || q.question || '',
          optA: q.optA || '',
          optB: q.optB || '',
          optC: q.optC || '',
          optD: q.optD || '',
          marks: parseInt(q.marks, 10) || 0,
          answer: q.answer || ''
        }));

        studentDoc = {
          roll_no: rollClean,
          name: nameClean,
          image: '',
          session_code: sessionCode,
          lab_number: examDetails?.lab_number || '',
          department: examDetails?.student_department || '',
          semester: examDetails?.student_semester || '',
          status: 'registered',
          exam_type: 'internal',
          assigned_questions: mappedQuestions,
          answers: {},
          scores: { internal: 0, total: 0 },
          is_buffer_student: true,
          added_at: new Date()
        };
      } else {
        // ── PRACTICAL EXAM: Original slip-based assignment ──
        const targetMarks = examDetails?.practical_marks;
        assignedQuestions = generateSlipForStudent(targetMarks);

        studentDoc = {
          roll_no: rollClean,
          name: nameClean,
          image: '',
          session_code: sessionCode,
          lab_number: examDetails?.lab_number || '',
          department: examDetails?.student_department || '',
          year: examDetails?.student_year || '',
          status: 'registered',
          assigned_questions: assignedQuestions.map(q => ({
            question_id: q.question_id,
            topic: q.topic,
            marks: q.marks,
            image: q.image || ''
          })),
          answers: {},
          scores: { practical: 0, viva: 0, journal: 0, total: 0 },
          is_buffer_student: true,
          added_at: new Date()
        };
      }

      // ATOMIC: Both the student record and audit log written in a single batch
      batch.set(studentRef, studentDoc);

      const auditRef = doc(db, 'colleges', tenantId, 'exams', sessionCode, 'buffer_audit', studentId);
      batch.set(auditRef, {
        roll_no: rollClean,
        name: nameClean,
        added_by: currentUser?.email || 'unknown',
        added_at: new Date()
      });

      await batch.commit();

      // Reset & close
      setBufferName('');
      setBufferRoll('');
      setShowBufferModal(false);
      setGearMenuOpen(false);

      const qCount = assignedQuestions.length;
      const marksLabel = isInternal
        ? (examDetails?.internal_marks || examDetails?.total_marks || '?')
        : (examDetails?.practical_marks || '?');
      alert(`✅ Buffer Student Added!\n\n👤 ${nameClean} (${rollClean})\n📋 ${qCount > 0 ? `${qCount} question(s) assigned (${marksLabel} marks total)` : '⚠️ No questions assigned — question bank may not have a valid combination for the configured marks.'}\n\nThe student can now log in using Session Code: ${sessionCode}`);
    } catch (err) {
      setBufferError('Failed to add student: ' + err.message);
    } finally {
      setBufferLoading(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={['teacher']}>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto px-4 py-8">

          <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <div className='flex items-center gap-4'>
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Live Monitor - {sessionCode}</h1>
                {!isSessionActive && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="bg-red-100 text-red-800 text-sm font-bold px-2 py-1 rounded border border-red-200 inline-block">🔴 Session Ended</span>
                    <button
                      onClick={handleOpenResumeModal}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-3 py-1 rounded-lg shadow-sm transition flex items-center gap-1"
                    >
                      ▶️ Resume Session
                    </button>
                  </div>
                )}
              </div>
              {isSessionActive && timeRemaining !== null && (
                <div className={`text-2xl font-mono font-bold px-4 py-2 rounded-lg border-2 ${timeRemaining < 0 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-gray-800 text-green-400 border-gray-700'}`}>
                  ⏳ {formatTime(timeRemaining)}
                  {timeRemaining < 0 && <span className="text-xs block text-center font-sans">Overtime</span>}
                </div>
              )}
            </div>
            <div className="flex gap-3 items-center">
              {!isSessionActive && (
                <>
                  <button onClick={handleExportAttendance} className="bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200 px-4 py-2 rounded-lg transition font-bold">📋 Attendance</button>
                  <button onClick={handleExportResults} disabled={!allGraded} className={`px-4 py-2 rounded-lg font-bold ${allGraded ? "bg-green-600 text-white" : "bg-gray-300 text-gray-500"}`}>🏆 Results</button>
                </>
              )}
              {isSessionActive && (
                <div className="flex items-center gap-2">
                  {/* 🛑 Stop Session */}
                  <button
                    onClick={() => { setEndSessionStep(1); setIsEndSessionModalOpen(true); }}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold shadow-sm"
                  >
                    🛑 Stop Session
                  </button>

                  {/* ⚙️ Gear Menu */}
                  <div className="relative" id="gear-menu-container">
                    <button
                      id="gear-menu-btn"
                      onClick={() => setGearMenuOpen(o => !o)}
                      className="w-10 h-10 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition shadow-sm"
                      title="Session Options"
                      aria-label="Session options menu"
                      aria-expanded={gearMenuOpen}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform duration-300 ${gearMenuOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>

                    {/* Dropdown */}
                    {gearMenuOpen && (
                      <div
                        id="gear-dropdown"
                        className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
                        style={{ animation: 'gearMenuIn 0.18s cubic-bezier(.16,1,.3,1)' }}
                      >
                        {/* Header */}
                        <div className="px-4 py-2.5 bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-100">
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Session Options</p>
                        </div>

                        {/* Buffer Student */}
                        <button
                          id="buffer-student-btn"
                          onClick={() => { setGearMenuOpen(false); setBufferName(''); setBufferRoll(''); setBufferError(''); setShowBufferModal(true); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition group border-b border-gray-50"
                        >
                          <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-orange-100 group-hover:bg-orange-200 transition flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                            </svg>
                          </span>
                          <div>
                            <p className="text-sm font-semibold leading-tight">Buffer Student</p>
                            <p className="text-xs text-gray-400">Add a walk-in student</p>
                          </div>
                        </button>

                        {/* Share Live Session */}
                        <button
                          id="share-session-btn"
                          onClick={() => { setGearMenuOpen(false); setShareEmailTags([]); setShareEmail(''); setShareMessage({type:'',text:''}); setShowShareModal(true); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition group"
                        >
                          <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-100 group-hover:bg-blue-200 transition flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                          </span>
                          <div>
                            <p className="text-sm font-semibold leading-tight">Share Session</p>
                            <p className="text-xs text-gray-400">Invite colleagues to monitor</p>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* --- STATUS LEGEND (Interactive Filter) --- */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold text-gray-800">Status Legend</h2>
              {statusFilter !== null && (
                <button
                  onClick={() => setStatusFilter(null)}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-500 px-3 py-1 rounded-full transition"
                >
                  ✕ Show All Students
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-3">Click a status to filter the student list</p>
            <div className="flex flex-wrap gap-3 items-center text-sm font-medium">
              <button
                onClick={() => setStatusFilter(statusFilter === 'absent' ? null : 'absent')}
                className={`flex items-center gap-2 px-3 py-2 rounded border transition cursor-pointer select-none ${
                  statusFilter === 'absent'
                    ? 'bg-red-500 text-white border-red-600 shadow-md scale-105'
                    : 'bg-red-100 text-red-900 border-red-500 hover:bg-red-200'
                }`}
              >🔴 ABSENT</button>

              <button
                onClick={() => setStatusFilter(statusFilter === 'in_progress' ? null : 'in_progress')}
                className={`flex items-center gap-2 px-3 py-2 rounded border transition cursor-pointer select-none ${
                  statusFilter === 'in_progress'
                    ? 'bg-green-600 text-white border-green-700 shadow-md scale-105'
                    : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
                }`}
              >⚪ JOINED</button>

              <button
                onClick={() => setStatusFilter(statusFilter === 'approval_requested' ? null : 'approval_requested')}
                className={`flex items-center gap-2 px-3 py-2 rounded border transition cursor-pointer select-none ${
                  statusFilter === 'approval_requested'
                    ? 'bg-yellow-500 text-white border-yellow-600 shadow-md scale-105'
                    : 'bg-yellow-100 text-yellow-900 border-yellow-300 hover:bg-yellow-200'
                }`}
              >🟡 APPROVAL REQ</button>

              <button
                onClick={() => setStatusFilter(statusFilter === 'submitted' ? null : 'submitted')}
                className={`flex items-center gap-2 px-3 py-2 rounded border transition cursor-pointer select-none ${
                  statusFilter === 'submitted'
                    ? 'bg-green-700 text-white border-green-800 shadow-md scale-105'
                    : 'bg-green-100 text-green-900 border-green-500 hover:bg-green-200'
                }`}
              >🟢 SUBMITTED</button>

              <button
                onClick={() => setStatusFilter(statusFilter === 'graded' ? null : 'graded')}
                className={`flex items-center gap-2 px-3 py-2 rounded border-2 transition cursor-pointer select-none ${
                  statusFilter === 'graded'
                    ? 'bg-blue-600 text-white border-blue-700 shadow-md scale-105'
                    : 'bg-white text-blue-900 border-blue-600 hover:bg-blue-50'
                }`}
              >✅ GRADED</button>

              <button
                onClick={() => setStatusFilter(statusFilter === 'registered' ? null : 'registered')}
                className={`flex items-center gap-2 px-3 py-2 rounded border transition cursor-pointer select-none ${
                  statusFilter === 'registered'
                    ? 'bg-gray-500 text-white border-gray-600 shadow-md scale-105'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                }`}
              >⚪ NOT JOINED</button>
            </div>
            {statusFilter !== null && (
              <p className="text-xs text-blue-600 mt-3 font-medium">
                🔍 Filtered by: <span className="uppercase font-bold">{statusFilter === 'graded' ? 'GRADED' : statusFilter === 'in_progress' ? 'JOINED' : statusFilter === 'approval_requested' ? 'APPROVAL REQ' : statusFilter === 'registered' ? 'NOT JOINED' : statusFilter.toUpperCase()}</span>
                {' '}— {students.filter(s => {
                  if (statusFilter === 'graded') return s.is_graded;
                  if (statusFilter === 'absent') return s.status === 'absent';
                  if (statusFilter === 'in_progress') return s.status === 'in_progress' && !s.is_graded;
                  if (statusFilter === 'approval_requested') return s.status === 'approval_requested' && !s.is_graded;
                  if (statusFilter === 'submitted') return s.status === 'submitted' && !s.is_graded;
                  if (statusFilter === 'registered') return s.status === 'registered';
                  return true;
                }).length} student(s)
              </p>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            {students.length === 0 ? <p className="text-center text-gray-500">No students found.</p> : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {students.filter(student => {
                  if (statusFilter === null) return true;
                  if (statusFilter === 'graded') return student.is_graded;
                  if (statusFilter === 'absent') return student.status === 'absent';
                  if (statusFilter === 'in_progress') return student.status === 'in_progress' && !student.is_graded;
                  if (statusFilter === 'approval_requested') return student.status === 'approval_requested' && !student.is_graded;
                  if (statusFilter === 'submitted') return student.status === 'submitted' && !student.is_graded;
                  if (statusFilter === 'registered') return student.status === 'registered';
                  return true;
                }).map((student) => {

                  // --- NEW LOGIC HIERARCHY IN OLD UI STRUCTURE ---
                  let boxClass = 'border-gray-300 bg-white';
                  let textColor = 'text-gray-800';
                  let statusText = 'NOT JOINED';
                  let showScore = false;

                  // 1. ABSENT (Priority 1)
                  if (student.status === 'absent') {
                    boxClass = 'border-red-500 bg-red-50';
                    textColor = 'text-red-900';
                    statusText = 'ABSENT';
                  }
                  // 2. GRADED
                  else if (student.is_graded) {
                    boxClass = 'border-blue-600 border-2 bg-white'; // Tick mark style requested
                    textColor = 'text-blue-900';
                    statusText = `GRADED`;
                    showScore = true;
                  }
                  // 3. SUBMITTED
                  else if (student.status === 'submitted') {
                    boxClass = 'border-green-600 bg-green-100';
                    textColor = 'text-green-900';
                    statusText = 'SUBMITTED';
                  }
                  // 5. SESSION ENDED (but not submitted/graded)
                  else if (student.session_ended || !isSessionActive) {
                    boxClass = 'border-gray-500 bg-gray-100';
                    textColor = 'text-gray-800';
                    statusText = 'ENDED';
                  }
                  // 6. APPROVAL
                  else if (student.status === 'approval_requested') {
                    boxClass = 'border-yellow-400 bg-yellow-100';
                    textColor = 'text-yellow-900';
                    statusText = 'APPROVAL REQ';
                  }
                  // 7. APPROVED
                  else if (student.status === 'approved') {
                    boxClass = 'border-green-400 bg-green-50 shadow-md';
                    textColor = 'text-green-900';
                    statusText = 'APPROVED';
                  }
                  // 8. PRESENT (JOINED)
                  else if (student.status === 'in_progress') {
                    boxClass = 'border-green-300 bg-white';
                    textColor = 'text-green-800';
                    statusText = 'JOINED';
                  }

                  return (
                    <div key={student.id} className={`border-2 rounded-lg p-4 cursor-pointer transition ${boxClass} hover:shadow-lg relative overflow-hidden`} onClick={() => openStudentView(student)}>
                      {/* Top Right Badge (Old UI Style) */}
                      <div className="absolute top-0 right-0 flex flex-col items-end">
                        {showScore && <div className="text-white text-xs font-bold px-2 py-1 rounded-bl bg-blue-600 shadow-sm">Score: {(() => {
                          if (examDetails?.exam_type === 'internal') {
                            let liveInternalTotal = 0;
                            student.assigned_questions?.forEach((assignedQuestion, index) => {
                              const answerKey = `q${index + 1}`;
                              const answer = student.answers?.[answerKey];
                              const fullQuestion = questionBank.find(q => q.question_id === (assignedQuestion.question_id || assignedQuestion.id)) || assignedQuestion;
                              
                              let correctOptionText = null;
                              const answerRaw = fullQuestion.answer?.toString().trim();
                              if (answerRaw) {
                                const answerUpper = answerRaw.toUpperCase();
                                if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
                                  correctOptionText = fullQuestion[`opt${answerUpper}`] || fullQuestion[`opt${answerUpper.toLowerCase()}`];
                                } else {
                                  for (const letter of ['A', 'B', 'C', 'D']) {
                                    const optText = (fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`])?.toString().trim();
                                    if (optText && optText.toUpperCase() === answerUpper) {
                                      correctOptionText = fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`];
                                      break;
                                    }
                                  }
                                  if (!correctOptionText) correctOptionText = fullQuestion.answer;
                                }
                              }

                              const isCorrect = !!(answer?.selected_option && correctOptionText && answer.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase());
                              liveInternalTotal += (answer?.score ?? (isCorrect ? (parseFloat(assignedQuestion.marks) || 0) : 0));
                            });
                            return liveInternalTotal;
                          }
                          return student.scores?.total || 0;
                        })()}</div>}
                      </div>

                      <div className={`font-bold text-lg ${textColor}`}>{student.name}</div>
                      <div className={`text-sm mb-3 ${textColor}`}>Roll: {student.roll_no}</div>
                      <div className={`inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wide border ${boxClass.includes('bg-white') ? 'bg-gray-100 border-gray-200' : 'bg-white bg-opacity-50 border-transparent'}`}>
                        {statusText}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedStudent && (
            // TASK 3: Backdrop click closes the modal
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedStudent(null)}>
              <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-6 border-b pb-4">
                    <div>
                      <h2 className="text-2xl font-bold">{selectedStudent.name} ({selectedStudent.roll_no})</h2>
                      <div className="mt-2 flex gap-2">
                        <StatusBadge status={selectedStudent.status} />
                        {selectedStudent.is_slip_changed && <span className="bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded border border-orange-200 flex items-center gap-1">⚠️ Slip Changed</span>}
                        {selectedStudent.is_graded && <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded border border-green-200 flex items-center gap-1">🎓 Graded</span>}
                        {selectedStudent.teacher_note && <span className="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-1 rounded border border-purple-200 flex items-center gap-1">📝 Note Added</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      {selectedStudent.session_ended && (
                        <button onClick={() => handleResumeSession(selectedStudent.id)} className="bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200 px-3 py-1 rounded text-sm font-bold transition flex items-center gap-1">↩️ Undo End Session</button>
                      )}
                      {selectedStudent.is_buffer_student && (
                        <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-1 rounded border border-amber-300 flex items-center gap-1">🅱️ Buffer Student</span>
                      )}
                      {canChangeSlip && !isChangingSlip && examDetails?.exam_type !== 'internal' && <button onClick={handleOpenSlipChange} className="bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded text-sm font-medium transition">🔄 Change Slip</button>}
                      <button onClick={() => setSelectedStudent(null)} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">×</button>
                    </div>
                  </div>

                  {isChangingSlip ? (() => {
                    const targetMarks = selectedStudent.assigned_questions?.reduce((sum, q) => sum + (Number(q.marks) || 0), 0) || 0;
                    const isTwoSubjectMode = examDetails?.subject_count === 2;
                    
                    // Generate combinations
                    const combinations = [];

                    if (isTwoSubjectMode && targetMarks > 0 && questionBank.length > 0) {
                      // ── A/B MODE: Pair one Subject A with one Subject B ──
                      const poolA = questionBank.filter(q => q.subject_tag === 'A');
                      const poolB = questionBank.filter(q => q.subject_tag === 'B');
                      const currentIds = new Set((selectedStudent.assigned_questions || []).map(q => q.question_id));

                      for (const qA of poolA) {
                        for (const qB of poolB) {
                          if (combinations.length >= 50) break;
                          if (Number(qA.marks) + Number(qB.marks) === targetMarks) {
                            // Skip if it's the exact same slip
                            const isSame = currentIds.size === 2 && currentIds.has(qA.question_id) && currentIds.has(qB.question_id);
                            if (!isSame) combinations.push([qA, qB]); // Strict [A, B] ordering
                          }
                        }
                        if (combinations.length >= 50) break;
                      }
                    } else if (targetMarks > 0 && questionBank.length > 0) {
                      // ── SINGLE-SUBJECT MODE: Original recursive generator ──
                      const generate = (startIndex, currentCombo, currentSum) => {
                        if (combinations.length >= 50) return;
                        if (currentSum === targetMarks) {
                          const isSame = currentCombo.length === (selectedStudent.assigned_questions?.length || 0) &&
                                         currentCombo.every(q => selectedStudent.assigned_questions.find(sq => sq.question_id === q.question_id));
                          if (!isSame) combinations.push([...currentCombo]);
                          return;
                        }
                        if (currentSum > targetMarks) return;
                        for (let i = startIndex; i < questionBank.length; i++) {
                          const q = questionBank[i];
                          if (currentSum + Number(q.marks) <= targetMarks) {
                            currentCombo.push(q);
                            generate(i + 1, currentCombo, currentSum + Number(q.marks));
                            currentCombo.pop();
                          }
                        }
                      };
                      generate(0, [], 0);
                    }

                    // Filter combinations by search
                    const filteredCombinations = combinations.filter(combo => {
                      if (!slipSearchQuery.trim()) return true;
                      const q = slipSearchQuery.toLowerCase();
                      return combo.some(question => question.topic?.toLowerCase().includes(q));
                    });

                    return (
                      <div className="bg-[#f8faff] border border-[#d0def0] rounded-xl p-6 mb-6">
                        <div className="flex flex-col gap-6">
                          
                          {/* Section A: CURRENT SLIP */}
                          <div className="bg-white border border-[#d0def0] rounded-lg p-5">
                            <h3 className="font-bold text-slate-700 uppercase text-sm tracking-wide mb-4">CURRENT SLIP</h3>
                            <div className="space-y-3">
                              {(selectedStudent.assigned_questions || []).map((q, idx) => (
                                <div key={`curr-${idx}`} className="bg-[#fefce8] border border-yellow-200 rounded-lg p-4">
                                  <p className="text-sm text-gray-800 mb-3 leading-relaxed">{q.topic}</p>
                                  <div className="flex items-center gap-2">
                                    <span className="bg-white border border-gray-200 text-gray-500 text-xs px-2 py-0.5 rounded">Q{idx + 1}</span>
                                    <span className="text-gray-500 text-xs">({q.marks} marks)</span>
                                    {isTwoSubjectMode && (
                                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${idx === 0 ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                        {idx === 0 ? 'Subject A' : 'Subject B'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Section B: Available Combinations */}
                          <div className="w-full">
                            <div className="flex justify-between items-center mb-4 px-1">
                              <h3 className="font-bold text-blue-900 text-lg">Available Combinations</h3>
                              <div className="flex items-center gap-2">
                                {isTwoSubjectMode && (
                                  <span className="bg-purple-100 text-purple-700 text-xs font-bold px-3 py-1 rounded">A/B Mode</span>
                                )}
                                <span className="bg-blue-100/70 text-blue-700 text-xs font-medium px-3 py-1 rounded">
                                  Target Marks: {targetMarks}
                                </span>
                              </div>
                            </div>

                            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                              {filteredCombinations.length > 0 ? filteredCombinations.map((combo, idx) => (
                                <div key={`combo-${idx}`} className="bg-white border border-gray-200 rounded-lg p-5">
                                  <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-blue-600 text-sm tracking-wide">OPTION {idx + 1}</h4>
                                    <button 
                                      onClick={() => handleAssignSlip(combo)}
                                      className="border border-blue-600 text-blue-700 hover:bg-blue-50 px-5 py-1.5 rounded text-sm font-bold transition flex-shrink-0"
                                    >
                                      Assign
                                    </button>
                                  </div>
                                  <ul className="list-disc pl-5 space-y-2 mt-2">
                                    {combo.map((q, qIdx) => (
                                      <li key={`combo-${idx}-q${qIdx}`} className="text-sm text-gray-600 leading-relaxed">
                                        {q.topic} <span className="text-gray-400">({q.marks}m)</span>
                                        {isTwoSubjectMode && (
                                          <span className={`ml-2 text-xs font-bold px-1.5 py-0.5 rounded ${qIdx === 0 ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                                            {qIdx === 0 ? 'Sub A' : 'Sub B'}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )) : (
                                <div className="text-center py-8 text-gray-500 bg-white border border-gray-200 rounded-lg">
                                  {isTwoSubjectMode
                                    ? `No valid Subject A + Subject B combinations found for ${targetMarks} marks.`
                                    : `No combinations found for ${targetMarks} marks.`
                                  }
                                </div>
                              )}
                            </div>
                            
                            {/* Footer */}
                            <div className="mt-6 flex justify-end pt-4 border-t border-[#d0def0]">
                              <button 
                                onClick={() => { setIsChangingSlip(false); setSlipSearchQuery(''); }} 
                                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded text-sm transition"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })() : (
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-gray-800 text-lg">Student Progress & Evaluation</h3>
                        <div className="flex gap-2">
                          <button onClick={handlePrevStudent} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded transition">← Prev</button>
                          <button onClick={handleNextStudent} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded transition">Next →</button>
                        </div>
                      </div>

                      {selectedStudent.assigned_questions?.map((assignedQuestion, index) => {
                        const answerKey = `q${index + 1}`;
                        const answer = selectedStudent.answers?.[answerKey];
                        const score = questionScores[answerKey] || '';

                        // For internal exams: look up the full question from the questionBank.
                        // assigned_questions only stores question_id/marks/topic — NOT options or answer key.
                        const fullQuestion = examDetails?.exam_type === 'internal'
                          ? (questionBank.find(q => q.question_id === (assignedQuestion.question_id || assignedQuestion.id)) || assignedQuestion)
                          : assignedQuestion;
                        const question = fullQuestion;

                        return (
                          <div key={index} className="border-2 border-gray-200 rounded-xl overflow-hidden">
                            <div className="bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center">
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-gray-700">Question {index + 1}</span>
                                <span className="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded">Max Marks: {question.marks}</span>
                              </div>
                              {/* TASK 2.2 FIX: Only show Approve/Reject buttons when the student
                                  has an active approval request, or a prior decision exists on this answer.
                                  Teachers should not be able to pre-approve before the student submits. */}
                              {examDetails?.exam_type !== 'internal' &&
                                (selectedStudent?.status === 'approval_requested' ||
                                  answer?.is_approved ||
                                  answer?.is_rejected) && (
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => handleApproveQuestion(answerKey, answer?.is_approved)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded transition shadow-sm border ${answer?.is_approved ? 'bg-green-600 text-white border-green-700 hover:bg-green-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                                  >
                                    {answer?.is_approved ? '✅ Approved' : 'Approve'}
                                  </button>
                                  <button 
                                    onClick={() => handleRejectQuestion(answerKey, answer?.is_rejected)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded transition shadow-sm border ${answer?.is_rejected ? 'bg-red-600 text-white border-red-700 hover:bg-red-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                                  >
                                    {answer?.is_rejected ? '❌ Rejected' : 'Reject'}
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="p-4 space-y-4">
                              <div className="text-gray-800 font-medium">
                                {isImageUrl(question.question_text || question.question || question.topic) ? (
                                  <img 
                                    src={question.question_text || question.question || question.topic} 
                                    alt="Question" 
                                    style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '4px' }}
                                  />
                                ) : (
                                  question.question_text || question.question || question.topic
                                )}
                              </div>

                              {/* 🌟 QUESTION IMAGE (Added inside old UI structure) */}
                              {question.image && (
                                <div className="mb-4">
                                  <div className="text-xs text-gray-500 mb-1 uppercase font-bold">Diagram:</div>
                                  <img src={question.image} alt="Diagram" className="h-24 object-contain border rounded cursor-pointer hover:opacity-80" onClick={() => setZoomedImage(question.image)} />
                                </div>
                              )}

                              {examDetails?.exam_type === 'internal' ? (() => {
                                // Determine the correct answer letter and option text from the FULL question data
                                let correctOptionText = null;
                                const answerRaw = question.answer?.toString().trim();
                                if (answerRaw) {
                                  const answerUpper = answerRaw.toUpperCase();
                                  if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
                                    correctOptionText = question[`opt${answerUpper}`] || question[`opt${answerUpper.toLowerCase()}`];
                                  } else {
                                    // Fallback: Excel answer might contain the full option text
                                    for (const letter of ['A', 'B', 'C', 'D']) {
                                      const optText = (question[`opt${letter}`] || question[`opt${letter.toLowerCase()}`])?.toString().trim();
                                      if (optText && optText.toUpperCase() === answerUpper) {
                                        correctOptionText = question[`opt${letter}`] || question[`opt${letter.toLowerCase()}`];
                                        break;
                                      }
                                    }
                                    if (!correctOptionText) correctOptionText = question.answer;
                                  }
                                }

                                // Compute isCorrect live — answer.is_correct only exists after final submission.
                                // We derive it directly so highlights work even mid-exam.
                                const isCorrect = !!(answer?.selected_option && correctOptionText && answer.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase());
                                const marksForQ = answer?.score ?? (isCorrect ? (parseFloat(assignedQuestion.marks) || 0) : 0);
                                return (
                                  <div className="mt-3">
                                    {/* Auto-grade result badge — shown as soon as student selects an option */}
                                    {answer?.selected_option && correctOptionText && (
                                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold mb-3 ${isCorrect ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-red-100 text-red-800 border border-red-300'}`}>
                                        {isCorrect ? `✅ Correct (+${marksForQ} marks)` : `❌ Incorrect (0 marks)`}
                                      </div>
                                    )}
                                    {answer?.selected_option && !correctOptionText && (
                                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold mb-3 bg-yellow-100 text-yellow-800 border border-yellow-300">
                                        ⚠ Answer key not found in question bank
                                      </div>
                                    )}
                                    <div className="space-y-2 bg-gray-50 p-4 rounded-lg border border-gray-200">
                                      {['A', 'B', 'C', 'D'].map((optKey) => {
                                        const optVal = question[`opt${optKey}`] || question[`opt${optKey.toLowerCase()}`];
                                        if (!optVal) return null;
                                        const isSelected = answer?.selected_option && optVal && answer.selected_option.toString().trim().toLowerCase() === optVal.toString().trim().toLowerCase();
                                        const isCorrectOpt = correctOptionText && optVal ? optVal.toString().trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase() : false;
                                        let rowClass = 'bg-white border-gray-200 text-gray-700';
                                        if (isCorrectOpt && isSelected) rowClass = 'bg-green-100 border-green-500 text-green-900 font-bold';
                                        else if (isCorrectOpt) rowClass = 'bg-green-50 border-green-300 text-green-800';
                                        else if (isSelected) rowClass = 'bg-red-100 border-red-400 text-red-900 font-bold';
                                        return (
                                          <div key={optKey} className={`flex items-center gap-3 p-3 rounded-lg border ${rowClass}`}>
                                            <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2 ${isSelected ? (isCorrectOpt ? 'border-green-600 bg-green-600' : 'border-red-500 bg-red-500') : (isCorrectOpt ? 'border-green-400' : 'border-gray-400')}`}>
                                              {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span>({optKey.toLowerCase()})</span>
                                              {isImageUrl(optVal) ? (
                                                <img 
                                                  src={optVal} 
                                                  alt={`Option ${optKey}`}
                                                  style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '4px' }}
                                                />
                                              ) : (
                                                <span>{optVal}</span>
                                              )}
                                            </div>
                                            {isCorrectOpt && <span className="ml-auto text-xs font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded">✓ Correct Answer</span>}
                                            {isSelected && !isCorrectOpt && <span className="ml-auto text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded">Student's Choice</span>}
                                          </div>
                                        );
                                      })}
                                      {!answer?.selected_option && (
                                        <div className="text-sm text-red-400 italic mt-2">No option selected by student.</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })() : (
                                <>
                                  <div className="bg-gray-50 p-3 rounded border border-gray-200">
                                    <span className="text-xs font-bold text-gray-500 uppercase">Student Answer Code:</span>
                                    <pre className="mt-1 text-sm overflow-x-auto whitespace-pre-wrap font-mono text-gray-800 bg-white p-2 rounded border border-gray-100">
                                      {answer?.code || <span className="text-gray-400 italic">No answer text provided yet.</span>}
                                    </pre>
                                  </div>

                                  <div className="flex items-center gap-4">
                                    {answer?.file_url ? (
                                      <a href={answer.file_url} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-2 bg-blue-100 text-blue-800 border border-blue-300 px-4 py-2 rounded-lg hover:bg-blue-200 transition font-bold shadow-sm">
                                        <span>📄</span> View Uploaded PDF
                                      </a>
                                    ) : answer?.file_uploaded === 'downloaded' || answer?.file_name ? (
                                      <span className="text-sm text-green-700 border border-green-200 bg-green-50 px-3 py-2 rounded flex items-center gap-2">
                                        <span>✅</span> <strong>{answer.file_name || 'File'}</strong> — Already downloaded via session files
                                      </span>
                                    ) : (
                                      <span className="text-sm text-red-400 italic border border-red-100 bg-red-50 px-3 py-2 rounded">No PDF Uploaded</span>
                                    )}
                                  </div>
                                  
                                  {canGradePractical && (
                                    <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end gap-6 bg-yellow-50 -mx-4 -mb-4 p-4">
                                      <div className="flex items-center gap-3 flex-shrink-0">
                                        <label className="font-bold text-gray-700">Marks for Q{index + 1}:</label>
                                        <input type="number" min="0" max={question.marks} value={score} onChange={(e) => handleQuestionScoreChange(answerKey, e.target.value, question.marks)} className="w-24 border-2 border-yellow-300 rounded-lg px-3 py-2 text-center font-bold text-lg focus:outline-none focus:border-yellow-500 bg-white" placeholder="0" />
                                        <span className="text-gray-500 text-sm">/ {question.marks}</span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div className="bg-gray-800 text-white p-6 rounded-xl shadow-lg mt-8">
                        <h3 className="font-bold text-xl mb-4 border-b border-gray-600 pb-2">Final Grading Summary</h3>

                        <div className={`grid ${examDetails?.exam_type === 'internal' ? 'md:grid-cols-1' : 'md:grid-cols-3'} gap-6 mb-6`}>
                          {examDetails?.exam_type !== 'internal' && (
                            <>
                              <div>
                                <label className="block text-gray-400 text-sm font-bold mb-2">Viva Marks (Max: {examDetails?.viva_marks || 0})</label>
                                <input type="number" value={vivaMarks} onChange={(e) => setVivaMarks(e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="0" />
                              </div>
                              <div>
                                <label className="block text-gray-400 text-sm font-bold mb-2">Journal Marks (Max: {examDetails?.journal_marks || 0})</label>
                                <input type="number" value={journalMarks} onChange={(e) => setJournalMarks(e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="0" />
                              </div>
                            </>
                          )}
                          <div className="bg-gray-700 rounded-lg p-3 flex flex-col justify-center items-center">
                            <span className="text-gray-400 text-xs uppercase">Total Score</span>
                            <span className="text-3xl font-bold text-green-400">
                              {(() => {
                                if (examDetails?.exam_type === 'internal') {
                                  // Compute LIVE total for internal exams
                                  let liveInternalTotal = 0;
                                  selectedStudent.assigned_questions?.forEach((assignedQuestion, index) => {
                                    const answerKey = `q${index + 1}`;
                                    const answer = selectedStudent.answers?.[answerKey];
                                    const fullQuestion = questionBank.find(q => q.question_id === (assignedQuestion.id)) || assignedQuestion;
                                    
                                    let correctOptionText = null;
                                    const answerRaw = fullQuestion.answer?.toString().trim();
                                    if (answerRaw) {
                                      const answerUpper = answerRaw.toUpperCase();
                                      if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
                                        correctOptionText = fullQuestion[`opt${answerUpper}`] || fullQuestion[`opt${answerUpper.toLowerCase()}`];
                                      } else {
                                        for (const letter of ['A', 'B', 'C', 'D']) {
                                          const optText = (fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`])?.toString().trim();
                                          if (optText && optText.toUpperCase() === answerUpper) {
                                            correctOptionText = fullQuestion[`opt${letter}`] || fullQuestion[`opt${letter.toLowerCase()}`];
                                            break;
                                          }
                                        }
                                        if (!correctOptionText) correctOptionText = fullQuestion.answer;
                                      }
                                    }

                                    const isCorrect = !!(answer?.selected_option && correctOptionText && answer.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase());
                                    liveInternalTotal += (answer?.score ?? (isCorrect ? (parseFloat(assignedQuestion.marks) || 0) : 0));
                                  });
                                  return liveInternalTotal;
                                }
                                // Practical exam logic
                                return (canGradePractical ? Object.values(questionScores).reduce((a, b) => a + (parseInt(b) || 0), 0) : (selectedStudent.scores?.practical || 0)) + ((parseInt(vivaMarks) || 0) + (parseInt(journalMarks) || 0));
                              })()}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center gap-4">
                          {/* Note textarea — auto-saves with 2s debounce */}
                          <div className="flex-1">
                            <label className="block text-gray-400 text-xs font-bold mb-1 uppercase tracking-wide flex items-center gap-2">
                              Note
                              {noteSaveStatus && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-normal normal-case tracking-normal ${
                                  noteSaveStatus === 'Saved' ? 'bg-green-700 text-green-200'
                                  : noteSaveStatus === 'Error' ? 'bg-red-700 text-red-200'
                                  : 'bg-gray-600 text-gray-300'
                                }`}>
                                  {noteSaveStatus === 'Saving...' ? (
                                    <span className="flex items-center gap-1">
                                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                      Saving...
                                    </span>
                                  ) : noteSaveStatus === 'Saved' ? '✅ Saved' : '⚠️ Error'}
                                </span>
                              )}
                            </label>
                            <textarea
                              value={noteText}
                              onChange={(e) => handleNoteChange(e.target.value)}
                              placeholder="Add a private note for this student..."
                              className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none placeholder-gray-400"
                              rows={2}
                            />
                          </div>
                          <button onClick={handleSaveAllGrades} className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg transition transform hover:scale-105 self-end">💾 Save Grades</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {isEndSessionModalOpen && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden animate-fade-in-up">
                <div className="bg-red-600 text-white px-6 py-4 flex justify-between items-center">
                  <h3 className="text-xl font-bold">End Session Options</h3>
                  <button onClick={() => setIsEndSessionModalOpen(false)} className="text-white hover:text-red-200 font-bold text-lg">✕</button>
                </div>
                {endSessionStep === 1 ? (
                  <div className="p-8 space-y-4">
                    <p className="text-gray-600 mb-4">How would you like to end the exam?</p>
                    <button onClick={handleEndForAll} className="w-full bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-800 p-4 rounded-xl flex items-center gap-4 transition group">
                      <span className="text-2xl">🌍</span>
                      <div className="text-left">
                        <div className="font-bold text-lg">End for EVERYONE</div>
                        <div className="text-xs text-red-600">Forces submission for all students and closes session.</div>
                      </div>
                    </button>
                    <button onClick={() => setEndSessionStep(2)} className="w-full bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 text-blue-800 p-4 rounded-xl flex items-center gap-4 transition group">
                      <span className="text-2xl">🎯</span>
                      <div className="text-left">
                        <div className="font-bold text-lg">End for SPECIFIC Students</div>
                        <div className="text-xs text-blue-600">Select students to stop. Others continue.</div>
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col h-[500px]">
                    <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                      <span className="font-bold text-gray-700">Select Students to Stop:</span>
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input type="checkbox" onChange={toggleSelectAll} className="w-4 h-4 text-blue-600 rounded" />
                        Select All Active
                      </label>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                      {activeStudentsList.length === 0 ? (
                        <div className="text-center text-gray-400 py-10">No active students found.</div>
                      ) : (
                        activeStudentsList.map(s => (
                          <label key={s.id} className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition ${selectedStudentIds.includes(s.id) ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                            <input type="checkbox" checked={selectedStudentIds.includes(s.id)} onChange={() => toggleStudentSelection(s.id)} className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500" />
                            <div>
                              <div className="font-bold text-gray-800">{s.roll_no} - {s.name}</div>
                              <div className="text-xs text-gray-500 uppercase">{s.status.replace('_', ' ')}</div>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                    <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                      <button onClick={() => setEndSessionStep(1)} className="text-gray-500 hover:text-gray-800 font-medium">← Back</button>
                      <button onClick={handleEndForSpecific} disabled={selectedStudentIds.length === 0 || isEnding} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition">
                        {isEnding ? 'Processing...' : `End for Selected (${selectedStudentIds.length})`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== RESUME SESSION MODAL (Feature 1) ==================== */}
          {showResumeModal && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
                <div className="bg-blue-600 text-white px-6 py-4 flex justify-between items-center">
                  <h3 className="text-xl font-bold">▶️ Resume Session</h3>
                  <button onClick={() => setShowResumeModal(false)} className="text-white hover:text-blue-200 font-bold text-lg">✕</button>
                </div>

                {resumeStep === 1 ? (
                  <div className="p-8 space-y-4">
                    <p className="text-gray-600 mb-4 text-sm">Choose who should be allowed to rejoin the session:</p>
                    <button
                      onClick={handleResumeForAll}
                      disabled={isResuming}
                      className="w-full bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 text-blue-800 p-4 rounded-xl flex items-center gap-4 transition disabled:opacity-50"
                    >
                      <span className="text-2xl">🌍</span>
                      <div className="text-left">
                        <div className="font-bold text-lg">Resume for All Students</div>
                        <div className="text-xs text-blue-600">Re-activates session. Absent students can log back in.</div>
                      </div>
                    </button>
                    <button
                      onClick={() => setResumeStep(2)}
                      className="w-full bg-green-50 hover:bg-green-100 border-2 border-green-200 text-green-800 p-4 rounded-xl flex items-center gap-4 transition"
                    >
                      <span className="text-2xl">🎯</span>
                      <div className="text-left">
                        <div className="font-bold text-lg">Resume for Specific Students</div>
                        <div className="text-xs text-green-600">Select which students are allowed to rejoin.</div>
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col h-[520px]">
                    <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                      <span className="font-bold text-gray-700">Select Students to Resume:</span>
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          onChange={(e) => {
                            if (e.target.checked) setResumeSelectedIds(students.map(s => s.id));
                            else setResumeSelectedIds([]);
                          }}
                          checked={resumeSelectedIds.length === students.length && students.length > 0}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        Select All
                      </label>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                      {students.length === 0 ? (
                        <div className="text-center text-gray-400 py-10">No students in this session.</div>
                      ) : (
                        students.map(s => (
                          <label key={s.id} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${resumeSelectedIds.includes(s.id) ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                            <div>
                              <div className="font-bold text-gray-800">{s.roll_no} — {s.name}</div>
                              <div className="text-xs text-gray-500 uppercase mt-0.5">{s.status.replace('_', ' ')}</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={resumeSelectedIds.includes(s.id)}
                              onChange={() => setResumeSelectedIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])}
                              className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 ml-4"
                            />
                          </label>
                        ))
                      )}
                    </div>
                    <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                      <button onClick={() => setResumeStep(1)} className="text-gray-500 hover:text-gray-800 font-medium">← Back</button>
                      <button
                        onClick={handleResumeForSpecific}
                        disabled={resumeSelectedIds.length === 0 || isResuming}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition"
                      >
                        {isResuming ? 'Resuming...' : `Resume for Selected (${resumeSelectedIds.length})`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isTimeUpModalOpen && (
            <div className="fixed inset-0 bg-red-900 bg-opacity-90 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-8 text-center border-4 border-red-500">
                <h2 className="text-3xl font-bold text-red-600 mb-2">⏰ Time is Up!</h2>
                <div className="flex flex-col gap-3 mt-6">
                  <button onClick={() => { setIsTimeUpModalOpen(false); setEndSessionStep(1); setIsEndSessionModalOpen(true); }} className="w-full bg-red-600 text-white font-bold py-3 rounded-lg shadow-md">🛑 Stop Session Now</button>
                  <button onClick={handleContinueOvertime} className="w-full bg-gray-200 text-gray-800 font-semibold py-3 rounded-lg">Let Students Continue (Overtime)</button>
                </div>
              </div>
            </div>
          )}

          {/* --- NEW: FULL SCREEN ZOOM MODAL --- */}
          {zoomedImage && (
            <div className="fixed inset-0 z-[9999] bg-black bg-opacity-90 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setZoomedImage(null)}>
              <div className="relative max-w-[90vw] max-h-[90vh]">
                <button onClick={() => setZoomedImage(null)} className="absolute -top-10 right-0 text-white text-4xl hover:text-gray-300 font-bold leading-none">&times;</button>
                <img src={zoomedImage} alt="Zoomed Diagram" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl border-2 border-white object-contain" onClick={(e) => e.stopPropagation()} />
              </div>
            </div>
          )}

        </div>
        {/* ==================== BUFFER STUDENT MODAL ==================== */}
        {showBufferModal && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(10px)', background: 'rgba(15,23,42,0.6)' }}
            onClick={() => { if (!bufferLoading) setShowBufferModal(false); }}
            id="buffer-modal-overlay"
          >
            <div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
              style={{ animation: 'bufferModalIn 0.28s cubic-bezier(.16,1,.3,1)' }}
              onClick={e => e.stopPropagation()}
              id="buffer-student-modal"
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-6 py-5"
                style={{ background: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-2xl">🚶</div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Add Buffer Student</h3>
                    <p className="text-orange-100 text-sm">Walk-in student for this session</p>
                  </div>
                </div>
                <button
                  onClick={() => { if (!bufferLoading) setShowBufferModal(false); }}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition"
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Session Info Banner */}
              <div className="px-6 py-3 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
                <span className="text-orange-500 text-sm">📡</span>
                <span className="text-orange-800 text-sm font-semibold">Session: {sessionCode}</span>
                <span className="mx-2 text-orange-200">|</span>
                <span className="text-orange-700 text-xs">{examDetails?.practical_marks} practical marks</span>
              </div>

              {/* Form Body */}
              <div className="px-6 py-5 space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </span>
                    <input
                      id="buffer-name-input"
                      type="text"
                      value={bufferName}
                      onChange={e => { setBufferName(e.target.value); setBufferError(''); }}
                      placeholder="e.g. John Doe"
                      className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition text-sm"
                      disabled={bufferLoading}
                      autoFocus
                    />
                  </div>
                </div>

                {/* Roll Number */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                    Roll Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                      </svg>
                    </span>
                    <input
                      id="buffer-roll-input"
                      type="text"
                      value={bufferRoll}
                      onChange={e => { setBufferRoll(e.target.value); setBufferError(''); }}
                      placeholder="e.g. 201"
                      className="w-full border-2 border-gray-200 rounded-xl pl-10 pr-4 py-3 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition text-sm"
                      disabled={bufferLoading}
                    />
                  </div>
                </div>



                {/* Auto-assign info */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
                  <span className="text-blue-500 text-lg flex-shrink-0">ℹ️</span>
                  <div>
                    <p className="text-blue-800 text-xs font-semibold">Questions will be auto-assigned</p>
                    <p className="text-blue-600 text-xs mt-0.5">
                      A random slip matching <strong>{examDetails?.practical_marks} practical marks</strong> will be assigned automatically from the question bank.
                    </p>
                  </div>
                </div>

                {/* Error */}
                {bufferError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                    <span className="flex-shrink-0">⚠️</span>
                    <span>{bufferError}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={() => setShowBufferModal(false)}
                  disabled={bufferLoading}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  id="add-buffer-student-btn"
                  onClick={handleAddBufferStudent}
                  disabled={!bufferName.trim() || !bufferRoll.trim() || bufferLoading}
                  className="flex-1 py-3 rounded-xl font-bold text-white transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: !bufferName.trim() || !bufferRoll.trim() || bufferLoading
                      ? '#9ca3af'
                      : 'linear-gradient(135deg, #ea580c, #f97316)'
                  }}
                >
                  {bufferLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Adding Student...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                      </svg>
                      Add Student
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== SHARE SESSION MODAL ==================== */}
        {showShareModal && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(10px)', background: 'rgba(15,23,42,0.6)' }}
            onClick={() => { if (!shareLoading) setShowShareModal(false); }}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
              style={{ animation: 'bufferModalIn 0.28s cubic-bezier(.16,1,.3,1)' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-6 py-5"
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Share Live Session</h3>
                    <p className="text-blue-100 text-sm">Invite colleagues to monitor {sessionCode}</p>
                  </div>
                </div>
                <button
                  onClick={() => { if (!shareLoading) setShowShareModal(false); }}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition"
                  aria-label="Close"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="p-6">
                <div ref={shareDropdownRef} className="relative">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Recipients</label>
                  
                  <div 
                    className="flex flex-wrap gap-2 p-2 border-2 border-gray-200 rounded-xl focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition min-h-[48px] items-center cursor-text"
                    onClick={() => document.getElementById('share-session-email-input')?.focus()}
                  >
                    {shareEmailTags.map((email) => {
                      const teacher = allTeachers.find(t => t.email?.toLowerCase() === email.toLowerCase());
                      return (
                        <span 
                          key={email}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                          style={{ background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', color: '#1d4ed8' }}
                        >
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ background: `hsl(${(teacher?.name || email).charCodeAt(0) * 7 % 360}, 60%, 50%)` }}
                          >
                            {(teacher?.name || email)[0].toUpperCase()}
                          </span>
                          <span className="truncate max-w-[140px]" title={`${teacher?.name || ''} <${email}>`}>
                            {teacher?.name || email}
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleRemoveTag(email); }}
                            className="ml-0.5 hover:text-red-600 transition text-blue-400 flex-shrink-0"
                            title="Remove"
                          >✕</button>
                        </span>
                      );
                    })}
                    
                    <input
                      type="text"
                      value={shareEmail}
                      onChange={(e) => {
                        setShareEmail(e.target.value);
                        setShareDropdownOpen(true);
                        setShareMessage({ type: '', text: '' });
                      }}
                      onKeyDown={handleShareEmailKeyDown}
                      onFocus={() => setShareDropdownOpen(true)}
                      placeholder={shareEmailTags.length === 0 ? "Search by name or email..." : "Add more..."}
                      className="flex-1 min-w-[120px] outline-none text-sm py-1 bg-transparent"
                      id="share-session-email-input"
                    />
                  </div>

                  {shareDropdownOpen && shareSearchResults.length > 0 && (
                    <div 
                      className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                      style={{ maxHeight: '220px', overflowY: 'auto' }}
                    >
                      {shareSearchResults.map((teacher) => (
                        <button
                          key={teacher.id}
                          onClick={() => handleSelectTeacher(teacher)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition text-left border-b border-gray-50 last:border-b-0"
                        >
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                            style={{ background: `hsl(${(teacher.name || '').charCodeAt(0) * 7 % 360}, 60%, 55%)` }}
                          >
                            {(teacher.name || 'U')[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{teacher.name}</p>
                            <p className="text-xs text-gray-500 truncate">{teacher.email}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {shareMessage.text && (
                  <div className={`mt-4 p-3 rounded-xl text-sm font-medium ${
                    shareMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 
                    shareMessage.type === 'warning' ? 'bg-yellow-50 text-yellow-800 border border-yellow-300' :
                    'bg-green-50 text-green-700 border border-green-200'
                  }`}>
                    {shareMessage.text}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 rounded-b-3xl">
                <button
                  onClick={() => setShowShareModal(false)}
                  disabled={shareLoading}
                  className="px-5 py-2.5 rounded-xl font-bold text-gray-600 hover:bg-gray-200 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleShareSession}
                  disabled={shareLoading || shareEmailTags.length === 0}
                  className="px-6 py-2.5 rounded-xl font-bold text-white shadow-md transition flex items-center gap-2 disabled:cursor-not-allowed"
                  style={{ 
                    background: (shareLoading || shareEmailTags.length === 0) ? '#9ca3af' : 'linear-gradient(135deg, #2563eb, #3b82f6)'
                  }}
                >
                  {shareLoading ? 'Sharing...' : 'Share Session'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Gear / Buffer Modal Animations + Close on outside click */}
        <style>{`
          @keyframes gearMenuIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.96); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes bufferModalIn {
            from { opacity: 0; transform: scale(0.94) translateY(20px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

      </div>
    </ProtectedRoute>
  );
};

export default Monitor;