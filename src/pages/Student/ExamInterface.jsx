import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, updateDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, auth } from '../../firebase';
import { jsPDF } from 'jspdf';
import Modal, { useModal } from '../../components/Modal';
import McqFieldRenderer from '../../components/McqFieldRenderer';


const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const ExamInterface = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionCode = searchParams.get('session');
  const rollNo = searchParams.get('roll');
  const tenantId = searchParams.get('tenant');

  const [student, setStudent] = useState(null);
  const [examConfig, setExamConfig] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingQuestions, setUploadingQuestions] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [collegeName, setCollegeName] = useState('');

  // ── Feature 1: Upload progress state ──
  const [uploadProgress, setUploadProgress] = useState({}); // { [idx]: { percent, eta, startTime } }

  // ── Feature 3: Auto-save state ──
  const [autoSaveStatus, setAutoSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const lastSavedAnswersRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const isAutoSavingRef = useRef(false);

  // ── Save Draft throttle state ──
  // Tracks the last time a Save Draft call was actually sent to the DB.
  // Ensures only ONE DB write per 10-minute window, even if the button
  // is clicked rapidly or multiple times.
  const saveDraftLastFiredRef = useRef(null); // timestamp (ms) of last successful DB write
  const isSaveDraftInFlightRef = useRef(false); // prevents concurrent in-flight calls
  const [saveDraftStatus, setSaveDraftStatus] = useState(''); // '' | 'saving' | 'saved' | 'throttled' | 'error'

  // ── Feature 4: Previous status tracking for rejection detection ──
  const prevStatusRef = useRef(null);

  // ── Feature 2: Modal hook ──
  const { modalProps, showAlert, showConfirm } = useModal();

  useEffect(() => {
    if (!sessionCode || !rollNo || !tenantId) { navigate('/student/login'); return; }

    const examRef = doc(db, 'colleges', tenantId, 'exams', sessionCode);
    const unsubscribeExam = onSnapshot(examRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setExamConfig(data);
        if (data.is_active === false) { showAlert('Session Ended', '⚠️ This exam session has ended globally.', 'warning').then(() => navigate('/student/login')); }
        if (data.is_active && data.started_at && data.duration_minutes) {
          const endTime = new Date(data.started_at.toDate().getTime() + data.duration_minutes * 60000);
          const timerInterval = setInterval(() => { setTimeRemaining(endTime - new Date()); }, 1000);
          return () => clearInterval(timerInterval);
        }
      } else { showAlert('Invalid Session', 'This session does not exist.', 'error').then(() => navigate('/student/login')); }
    });

    const studentRef = doc(db, 'colleges', tenantId, 'students', `${sessionCode}_${rollNo}`);
    const unsubscribeStudent = onSnapshot(studentRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();

        // ── Feature 4: Detect rejection (approval_requested → in_progress) ──
        if (prevStatusRef.current === 'approval_requested' && data.status === 'in_progress') {
          showAlert(
            'Submission Rejected',
            'The teacher has rejected your submission. Please make the necessary changes.',
            'error'
          );
        }
        prevStatusRef.current = data.status;

        if ((data.status === 'submitted' || data.status === 'absent' || data.session_ended) && !isSubmitting) {
          if (student?.status !== 'submitted') { showAlert('Session Ended', 'Your session has ended.', 'warning').then(() => navigate('/student/login')); return; }
        }
        setStudent({ id: snapshot.id, ...data });

        // ── BUG 1 FIX: Always sync teacher-controlled fields (is_approved, is_rejected)
        // from the DB snapshot, but never let a DB snapshot overwrite the student's
        // in-progress typing (code field). We do a targeted merge.
        setAnswers(prev => {
          const dbAnswers = data.answers || {};

          if (data.is_slip_changed) {
            // Acknowledge the slip change: use the DB answers strictly, ignoring local unsaved code.
            // Also update the DB to clear this flag so we can resume normal local-code prioritization.
            updateDoc(studentRef, { is_slip_changed: false }).catch(console.error);
            lastSavedAnswersRef.current = JSON.stringify(dbAnswers);
            return dbAnswers;
          }

          const merged = { ...prev };
          Object.keys(dbAnswers).forEach(qKey => {
            merged[qKey] = {
              ...prev[qKey],           // keep local edits (code, file refs)
              ...dbAnswers[qKey],      // apply all DB fields
              // But restore local code if student has unsaved typing
              code: (prev[qKey]?.code !== undefined && lastSavedAnswersRef.current !== null)
                ? prev[qKey].code
                : (dbAnswers[qKey]?.code || ''),
            };
          });
          return merged;
        });

        // Initialize the last-saved ref on first load so auto-save doesn't fire immediately
        if (lastSavedAnswersRef.current === null) {
          lastSavedAnswersRef.current = JSON.stringify(data.answers || {});
        }
        if (data.status === 'registered') try { await updateDoc(studentRef, { status: 'in_progress' }); } catch (e) { console.error(e); }
      } else { navigate('/student/login'); }
    });

    // Read college name from session storage (populated during login)
    const storedCollegeName = sessionStorage.getItem('pms_college_name');
    if (storedCollegeName) {
      setCollegeName(storedCollegeName);
    }

    return () => { unsubscribeExam(); unsubscribeStudent(); };
  }, [sessionCode, rollNo, tenantId, navigate]);

  // ── Feature 3: Auto-save core ──────────────────────────────────────────────
  // Stable ref holding the latest answers so the save function and 10-minute
  // timer never need `answers` in their dependency arrays (avoids interval
  // churn on every keystroke).
  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // Stable ref for student data (exam_type, assigned_questions, status, etc.)
  const studentRef_data = useRef(student);
  useEffect(() => { studentRef_data.current = student; }, [student]);

  // ── Core save function (extracted so both the timer and force-end can call it)
  const performAutoSave = useCallback(async () => {
    const currentStudent = studentRef_data.current;
    const currentAnswers = answersRef.current;
    if (!currentStudent || !tenantId || !sessionCode || !rollNo) return false;
    if (currentStudent.exam_type === 'internal') return false; // MCQ: no auto-save

    const currentJson = JSON.stringify(currentAnswers);
    if (currentJson === lastSavedAnswersRef.current) return false; // Nothing changed — skip

    if (isAutoSavingRef.current) return false; // Already in flight
    isAutoSavingRef.current = true;
    setAutoSaveStatus('saving');

    try {
      const sRef = doc(db, 'colleges', tenantId, 'students', `${sessionCode}_${rollNo}`);

      // Dot-notation field updates — never overwrites teacher-controlled fields
      // (is_approved, is_rejected) that live under the same answers map.
      const dotNotationUpdate = {};
      const prev = JSON.parse(lastSavedAnswersRef.current || '{}');
      Object.entries(currentAnswers).forEach(([qKey, qVal]) => {
        const prevVal = prev[qKey] || {};
        if (qVal.code !== prevVal.code) dotNotationUpdate[`answers.${qKey}.code`] = qVal.code || '';
        if (qVal.file_uploaded !== prevVal.file_uploaded) dotNotationUpdate[`answers.${qKey}.file_uploaded`] = qVal.file_uploaded || false;
        if (qVal.file_name !== prevVal.file_name) dotNotationUpdate[`answers.${qKey}.file_name`] = qVal.file_name || null;
        if (qVal.file_url !== prevVal.file_url) dotNotationUpdate[`answers.${qKey}.file_url`] = qVal.file_url || null;
        if (qVal.storage_ref !== prevVal.storage_ref) dotNotationUpdate[`answers.${qKey}.storage_ref`] = qVal.storage_ref || null;
      });

      if (Object.keys(dotNotationUpdate).length > 0) {
        await updateDoc(sRef, dotNotationUpdate);
      }

      // Upload code files to Firebase Storage
      if (currentStudent.assigned_questions) {
        const codePromises = [];
        currentStudent.assigned_questions.forEach((_, index) => {
          const code = currentAnswers[`q${index + 1}`]?.code;
          const prevCode = prev[`q${index + 1}`]?.code;
          // Only upload if code actually changed for this question
          if (code?.trim() && code !== prevCode) {
            const refPtr = ref(storage, `exam_uploads/${sessionCode}/${rollNo}/${sessionCode}_${rollNo}_q${index + 1}_code.txt`);
            codePromises.push(uploadBytesResumable(refPtr, new Blob([code], { type: 'text/plain' })));
          }
        });
        if (codePromises.length > 0) await Promise.all(codePromises);
      }

      lastSavedAnswersRef.current = currentJson;
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus((s) => s === 'saved' ? '' : s), 2000);
      return true;
    } catch (e) {
      console.error('Auto-save error:', e);
      setAutoSaveStatus('error');
      setTimeout(() => setAutoSaveStatus((s) => s === 'error' ? '' : s), 3000);
      return false;
    } finally {
      isAutoSavingRef.current = false;
    }
  }, [tenantId, sessionCode, rollNo]);

  // ── 10-Minute throttle constant (shared by Save Draft button & force-end) ──
  const SAVE_DRAFT_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

  // NOTE: The periodic auto-save timer has been removed.
  // Students save manually via the "Save Draft" button.
  // The force-end effect below still auto-saves when the teacher ends the session.

  // ── Teacher Force-End detection ───────────────────────────────────────────
  // When the teacher ends the session (is_active=false or session_ended=true),
  // immediately force a final save BEFORE the component navigates away.
  // Handles BOTH exam types:
  //   • Practical: calls performAutoSave (code + file refs)
  //   • Internal (MCQ): directly writes selected_option for each question
  const hasForceEndFiredRef = useRef(false);

  useEffect(() => {
    if (!student || !examConfig) return;
    if (hasForceEndFiredRef.current) return; // Only fire once

    const teacherEndedGlobally = examConfig.is_active === false;
    const teacherEndedForStudent = student.session_ended === true;

    if (teacherEndedGlobally || teacherEndedForStudent) {
      hasForceEndFiredRef.current = true;

      // Kill the timer ref (no longer used, but kept for safety)
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      const currentStudent = studentRef_data.current;
      const currentAnswers = answersRef.current;

      if (!currentStudent) return;

      if (currentStudent.exam_type === 'internal') {
        // ── Internal (MCQ) force-end save ──
        // performAutoSave skips internal exams, so we save MCQ answers directly.
        const sRef = doc(db, 'colleges', tenantId, 'students', `${sessionCode}_${rollNo}`);
        const dotUpdate = {};
        Object.entries(currentAnswers).forEach(([qKey, qVal]) => {
          dotUpdate[`answers.${qKey}.selected_option`] = qVal.selected_option || null;
        });
        if (Object.keys(dotUpdate).length > 0) {
          updateDoc(sRef, dotUpdate).catch((e) => {
            console.error('[ForceEnd] Internal exam save error:', e);
          });
        }
        console.log('[ForceEnd] Internal exam answers saved on teacher end.');
      } else {
        // ── Practical force-end save ──
        performAutoSave().finally(() => {
          console.log('[AutoSave] Force-end final save completed.');
        });
      }
    }
  }, [examConfig?.is_active, student?.session_ended, student?.exam_type, performAutoSave, tenantId, sessionCode, rollNo]);

  // ── Save Draft handler (manual button, practical exams only) ─────────────
  // Rules:
  //  1. Only sends one DB call per 10-minute window regardless of how many times
  //     the button is pressed.
  //  2. If a call is already in-flight, subsequent clicks are silently dropped.
  //  3. If the teacher ends the session, the force-end effect below saves
  //     independently without going through this throttle.
  const handleSaveDraft = useCallback(async () => {
    if (isSaveDraftInFlightRef.current) return; // already in flight — drop click

    const now = Date.now();
    if (
      saveDraftLastFiredRef.current !== null &&
      now - saveDraftLastFiredRef.current < SAVE_DRAFT_THROTTLE_MS
    ) {
      // Within the 10-minute throttle window — show feedback and drop.
      const remainingMs = SAVE_DRAFT_THROTTLE_MS - (now - saveDraftLastFiredRef.current);
      const remainingMin = Math.ceil(remainingMs / 60000);
      setSaveDraftStatus('throttled');
      setTimeout(() => setSaveDraftStatus((s) => s === 'throttled' ? '' : s), 3000);
      console.log(`[SaveDraft] Throttled — next save allowed in ~${remainingMin} min`);
      return;
    }

    isSaveDraftInFlightRef.current = true;
    setSaveDraftStatus('saving');

    const saved = await performAutoSave();

    if (saved) {
      saveDraftLastFiredRef.current = Date.now();
      setSaveDraftStatus('saved');
      setTimeout(() => setSaveDraftStatus((s) => s === 'saved' ? '' : s), 3000);
    } else {
      // performAutoSave returns false if nothing changed or already saving —
      // treat "nothing changed" as a soft success so the user gets feedback.
      const currentStudent = studentRef_data.current;
      const currentJson = JSON.stringify(answersRef.current);
      if (currentJson === lastSavedAnswersRef.current) {
        // Data hasn't changed since last save — already up to date.
        setSaveDraftStatus('saved');
        saveDraftLastFiredRef.current = Date.now();
        setTimeout(() => setSaveDraftStatus((s) => s === 'saved' ? '' : s), 3000);
      } else {
        setSaveDraftStatus('error');
        setTimeout(() => setSaveDraftStatus((s) => s === 'error' ? '' : s), 3000);
      }
    }

    isSaveDraftInFlightRef.current = false;
  }, [performAutoSave, SAVE_DRAFT_THROTTLE_MS]);

  const formatTime = (ms) => {
    if (ms === null) return "--:--:--";
    const seconds = Math.floor((Math.abs(ms) / 1000) % 60);
    const minutes = Math.floor((Math.abs(ms) / (1000 * 60)) % 60);
    const hours = Math.floor((Math.abs(ms) / (1000 * 60 * 60)));
    return `${ms < 0 ? '-' : ''}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatEta = (seconds) => {
    if (seconds === null || seconds === Infinity || isNaN(seconds)) return '';
    if (seconds < 1) return '< 1s';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `~${m}m ${s}s remaining`;
    return `~${s}s remaining`;
  };

  const handleCodeChange = (idx, code) => { setAnswers(prev => ({ ...prev, [`q${idx + 1}`]: { ...prev[`q${idx + 1}`], code } })); };
  const handleLogoutClick = () => { if (['submitted', 'approved'].includes(student.status)) navigate('/student/login'); else setShowLogoutConfirm(true); };
  const confirmLogout = () => navigate('/student/login');

  const saveCodeToFiles = async () => {
    if (student.exam_type === 'internal') return; // Don't upload code files for MCQs
    const promises = [];
    student.assigned_questions.forEach((_, index) => {
      const code = answers[`q${index + 1}`]?.code;
      if (code?.trim()) {
        const refPtr = ref(storage, `exam_uploads/${sessionCode}/${rollNo}/${sessionCode}_${rollNo}_q${index + 1}_code.txt`);
        promises.push(uploadBytesResumable(refPtr, new Blob([code], { type: 'text/plain' })));
      }
    });
    await Promise.all(promises);
  };

  // ── Feature 6: Convert image (JPG/PNG) to single-page PDF blob ──
  const convertImageToPdf = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            // Determine orientation based on image dimensions
            const isLandscape = img.width > img.height;
            const pdfDoc = new jsPDF({
              orientation: isLandscape ? 'landscape' : 'portrait',
              unit: 'px',
              format: [img.width, img.height],
            });
            pdfDoc.addImage(e.target.result, file.type === 'image/png' ? 'PNG' : 'JPEG', 0, 0, img.width, img.height);
            const pdfBlob = pdfDoc.output('blob');
            resolve(pdfBlob);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  // ── Feature 1 + 5 + 6: File upload with progress, relaxed validation, image conversion ──
  const handleFileUpload = async (idx, file) => {
    if (!file) return;

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      await showAlert('Invalid File', 'Please upload a PDF, JPG, or PNG file.', 'error');
      return;
    }

    setUploadingQuestions(prev => ({ ...prev, [idx]: true }));
    const key = `q${idx + 1}`;

    try {
      // Delete previous file if exists
      if (answers[key]?.storage_ref) try { await deleteObject(ref(storage, answers[key].storage_ref)); } catch (e) { }

      // ── Feature 6: Convert image to PDF if needed ──
      let uploadFile = file;
      let displayName = file.name;
      const isImage = file.type === 'image/jpeg' || file.type === 'image/png';
      if (isImage) {
        const pdfBlob = await convertImageToPdf(file);
        const pdfFileName = file.name.replace(/\.(jpg|jpeg|png)$/i, '.pdf');
        uploadFile = new File([pdfBlob], pdfFileName, { type: 'application/pdf' });
        displayName = `${file.name} (converted to PDF)`;
      }

      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `exam_uploads/${sessionCode}/${rollNo}/q${idx + 1}_${safeName}`;
      const storageRef = ref(storage, path);

      // ── Feature 1: Use uploadBytesResumable for progress tracking ──
      const uploadTask = uploadBytesResumable(storageRef, uploadFile);
      const startTime = Date.now();

      await new Promise((resolve, reject) => {
        uploadTask.on('state_changed',
          (snapshot) => {
            const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            const elapsed = (Date.now() - startTime) / 1000; // seconds
            const rate = snapshot.bytesTransferred / elapsed; // bytes per second
            const remaining = snapshot.totalBytes - snapshot.bytesTransferred;
            const eta = rate > 0 ? remaining / rate : null;

            setUploadProgress(prev => ({
              ...prev,
              [idx]: { percent, eta, startTime }
            }));
          },
          (error) => {
            reject(error);
          },
          () => {
            resolve(uploadTask.snapshot);
          }
        );
      });

      const url = await getDownloadURL(uploadTask.snapshot.ref);
      setAnswers(prev => ({ ...prev, [key]: { ...prev[key], file_uploaded: true, file_name: displayName, file_url: url, storage_ref: path } }));

    } catch (e) {
      await showAlert('Upload Failed', e.message, 'error');
    } finally {
      setUploadingQuestions(prev => { const n = { ...prev }; delete n[idx]; return n; });
      setUploadProgress(prev => { const n = { ...prev }; delete n[idx]; return n; });
    }
  };

  // ── Feature 6: Handle paste events for image pasting ──
  const handlePaste = useCallback(async (idx, e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type === 'image/png' || item.type === 'image/jpeg') {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const extension = item.type === 'image/png' ? 'png' : 'jpg';
          const fileName = `pasted_image_q${idx + 1}.${extension}`;
          const file = new File([blob], fileName, { type: item.type });
          await handleFileUpload(idx, file);
        }
        return;
      }
    }
  }, [handleFileUpload]);

  const handleRemoveFile = async (idx) => {
    const confirmed = await showConfirm('Remove File', 'Are you sure you want to remove this uploaded file?', 'warning', 'Remove', 'Keep');
    if (!confirmed) return;
    const key = `q${idx + 1}`;
    if (answers[key]?.storage_ref) try { await deleteObject(ref(storage, answers[key].storage_ref)); } catch (e) { }
    setAnswers(prev => ({ ...prev, [key]: { ...prev[key], file_uploaded: false, file_name: null, file_url: null, storage_ref: null } }));
  };

  const handleAction = async (status) => {
    if (isSubmitting) return; // SECURITY FIX I-2: Guard against double-click
    if (status === 'submitted') {
      const confirmed = await showConfirm('Final Submit', 'Are you sure you want to submit? This action cannot be undone.', 'warning', 'Submit', 'Cancel');
      if (!confirmed) return;
    }
    try {
      setIsSubmitting(true);
      await saveCodeToFiles();

      const studentRef = doc(db, 'colleges', tenantId, 'students', student.id);

      if (status === 'submitted') {
        // SECURITY FIX HIGH-02: Read the submit token issued at login time.
        // The backend verifies this token cryptographically before writing.
        const submitToken = sessionStorage.getItem('pms_submit_token');
        if (!submitToken) {
          throw new Error('Your session has expired. Please log in again to submit.');
        }

        const payload = {
          submitToken,
          tenantId,
          sessionCode,
          rollNo,
          answers
        };

        const response = await fetch(`${API_URL}/api/student/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to submit exam.');
        }

        // Clear the submit token after successful submission (one-time use)
        sessionStorage.removeItem('pms_submit_token');
        sessionStorage.removeItem('pms_student_doc_id');

        // ── DPDP Consent Log ──
        // One document per session (student_consent_logs/{sessionCode}).
        // Each student's entry is stored under their rollNo key so that all
        // consents for a session live in a single document.
        if (auth.currentUser) {
          const consentDocRef = doc(db, 'student_consent_logs', sessionCode);
          try {
            await setDoc(consentDocRef, {
              exam_session_id: sessionCode,
              college_id: tenantId,
              // Dot-notation merge: writes only this student's sub-key,
              // leaving every other rollNo in the document untouched.
              [`students.${rollNo}`]: {
                anonymous_uid: auth.currentUser.uid,
                student_identifier: rollNo,
                legalConsent: {
                  acceptedAt: serverTimestamp(),
                  dpaAccepted: true,
                  privacyPolicyAccepted: true,
                  termsAccepted: true,
                  userAgent: navigator.userAgent,
                  versionAccepted: 'v1.2',
                },
              },
            }, { merge: true });
          } catch (logErr) {
            console.error('Failed to log consent:', logErr);
          }
        }
        
        await showAlert('Submitted!', 'Your exam has been submitted successfully.', 'success');
        navigate('/student/login');
      } else {
        // Draft saves (approval_requested) are idempotent — no transaction needed
        // ── BUG 1 FIX: Use dot-notation for approval request too.
        const dotUpdate = { status };
        Object.entries(answers).forEach(([qKey, qVal]) => {
          if (student.exam_type === 'internal') {
            dotUpdate[`answers.${qKey}.selected_option`] = qVal.selected_option || null;
          } else {
            dotUpdate[`answers.${qKey}.code`] = qVal.code || '';
            dotUpdate[`answers.${qKey}.file_uploaded`] = qVal.file_uploaded || false;
            dotUpdate[`answers.${qKey}.file_name`] = qVal.file_name || null;
            dotUpdate[`answers.${qKey}.file_url`] = qVal.file_url || null;
            dotUpdate[`answers.${qKey}.storage_ref`] = qVal.storage_ref || null;
          }
        });
        await updateDoc(studentRef, dotUpdate);
        await showAlert(
          status === 'approval_requested' ? 'Approval Requested' : 'Saved',
          status === 'approval_requested' ? 'Your submission has been sent for teacher approval.' : 'Draft saved successfully!',
          'success'
        );
      }
    } catch (e) {
      await showAlert('Error', e.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };


  if (!student) return <div className="text-center p-10">Loading...</div>;

  // ── TASK 1 & 2: Granular per-question approval state ──────────────────────
  // All derived from the answers map which is kept in sync by the onSnapshot
  // listener above — so any teacher write triggers an instant UI re-render.
  const numQ = student.assigned_questions?.length || 0;

  // A question is "acted on" if the teacher set is_approved OR is_rejected
  const allQuestionsApproved = numQ > 0 && student.assigned_questions.every(
    (_, i) => answers[`q${i + 1}`]?.is_approved === true
  );
  const anyQuestionRejected = student.assigned_questions?.some(
    (_, i) => answers[`q${i + 1}`]?.is_rejected === true
  );
  const anyQuestionApproved = student.assigned_questions?.some(
    (_, i) => answers[`q${i + 1}`]?.is_approved === true
  );

  // isLocked: disable code/file editing while fully awaiting approval.
  // But if any question was rejected, the student must be able to edit again.
  const isLocked = (
    (student.status === 'approval_requested' && !anyQuestionRejected) ||
    student.status === 'approved' ||
    student.status === 'submitted'
  ) || student.session_ended;

  // Show "Ask for Approval" when:
  //   • Student is actively editing (not submitted, not fully approved), OR
  //   • Some questions were rejected (partial retry needed)
  // Hide it when ALL questions are approved (no more asking needed)
  const showAskApprovalBtn = (student.status === 'in_progress' || anyQuestionRejected) &&
    !allQuestionsApproved &&
    student.status !== 'submitted' &&
    !student.session_ended;

  // Show "Final Submit" whenever at least one question is approved
  const showFinalSubmitBtn = anyQuestionApproved && student.status !== 'submitted';

  // Show pure "Pending Approval" banner only when waiting with zero decisions yet
  const showPendingBanner = student.status === 'approval_requested' &&
    !anyQuestionRejected && !allQuestionsApproved;

  const isUploading = Object.keys(uploadingQuestions).length > 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-12">

      <div className="bg-blue-600 text-white shadow-lg sticky top-0 z-[50] px-4 py-3 flex justify-between items-center">
        <h1 className="text-xl font-bold flex items-center gap-2">
          {collegeName ? (
            <>
              <span className="bg-white text-blue-600 px-2 py-0.5 rounded shadow-sm text-sm tracking-wider uppercase font-extrabold border border-blue-200">
                {collegeName}
              </span>
              <span>{student.session_code}</span>
            </>
          ) : (
            <span>Exam Portal - {student.session_code}</span>
          )}
        </h1>
        <div className="flex items-center gap-4">
          {/* ── Feature 3: Auto-save status indicator ── */}
          {student.exam_type !== 'internal' && autoSaveStatus === 'saving' && (
            <div className="flex items-center gap-2 text-sm font-medium bg-blue-700 px-3 py-1 rounded animate-save-pulse">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Auto-saving...
            </div>
          )}
          {student.exam_type !== 'internal' && autoSaveStatus === 'saved' && (
            <div className="flex items-center gap-1.5 text-sm font-medium bg-green-600 px-3 py-1 rounded">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              Saved
            </div>
          )}
          {student.exam_type !== 'internal' && autoSaveStatus === 'error' && (
            <div className="flex items-center gap-1.5 text-sm font-medium bg-red-600 px-3 py-1 rounded">
              ⚠ Save failed
            </div>
          )}

          {timeRemaining !== null && <div className={`font-mono font-bold text-xl px-4 py-1 rounded ${timeRemaining < 0 ? 'bg-red-600 animate-pulse' : 'bg-blue-800'}`}>⏳ {formatTime(timeRemaining)}</div>}
          <button onClick={handleLogoutClick} className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded font-bold border border-red-400">Logout</button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-[95vw]">

        {/* STUDENT PROFILE */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex items-center gap-6 border-l-8 border-blue-600">
          <div className="flex-shrink-0">
            {student.image && !imgError ? (
              <img src={student.image} alt="Profile" onError={() => setImgError(true)} onClick={() => setZoomedImage(student.image)} className="w-24 h-24 rounded-lg object-cover border-4 border-gray-200 shadow-sm cursor-pointer hover:scale-105 transition" />
            ) : (
              <div className="w-24 h-24 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-3xl">{student.name?.substring(0, 2).toUpperCase() || 'ST'}</div>
            )}
          </div>
          <div>
            <h2 className="text-3xl font-bold text-gray-800">{student.name}</h2>
            <div className="text-lg text-gray-500 font-medium">Roll: <span className="text-black font-bold">{student.roll_no}</span></div>
            <div className="mt-2 inline-block px-3 py-1 bg-blue-50 text-blue-700 text-sm font-bold rounded-full border border-blue-200">Active Session</div>
          </div>
        </div>

        {/* QUESTIONS GRID */}
        <div className={`grid gap-6 ${examConfig?.allowed_url ? 'grid-cols-2' : 'grid-cols-1 max-w-5xl mx-auto'}`}>
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4 border-b pb-2 text-gray-700">Your Assigned Questions</h2>
              <div className="space-y-8">
                {student.assigned_questions?.map((q, idx) => {
                  const ans = answers[`q${idx + 1}`] || { code: '', file_uploaded: false };
                  const uploading = uploadingQuestions[idx];
                  const progress = uploadProgress[idx];
                  return (
                    <div key={idx} className="border-2 border-gray-200 rounded-xl p-5 hover:border-blue-300 transition bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className="font-bold text-lg text-blue-900">Question {idx + 1}</div>
                          {ans.is_approved && <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded border border-green-200">✅ Approved</span>}
                          {ans.is_rejected && <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-1 rounded border border-red-200">❌ Rejected — Please redo</span>}
                        </div>
                        <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded">Max: {q.marks}</span>
                      </div>

                      {/* QUESTION TEXT / IMAGE */}
                      <div className="font-semibold text-gray-900 mb-4 text-base leading-relaxed">
                        <McqFieldRenderer
                          value={q.question || q.topic}
                          onZoom={setZoomedImage}
                        />
                      </div>

                      {/* QUESTION IMAGE */}
                      {q.image && (
                        <div className="mb-4 bg-gray-50 p-2 rounded border border-gray-200 inline-block">
                          <img src={q.image} alt="Question Diagram" className="max-h-64 object-contain rounded cursor-pointer" onClick={() => setZoomedImage(q.image)} title="Click to Zoom" />
                        </div>
                      )}

                      {student.exam_type === 'internal' ? (
                        <div className="mt-4 space-y-3">
                          {['A', 'B', 'C', 'D'].map(optKey => {
                            const optText = q[`opt${optKey}`];
                            if (!optText) return null;
                            const isSelected = ans.selected_option === optText;
                            return (
                              <label key={optKey} className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300 bg-white'}`}>
                                <input
                                  type="radio"
                                  name={`q${idx}`}
                                  value={optText}
                                  checked={isSelected}
                                  onChange={() => {
                                    if (isLocked) return;
                                    setAnswers(prev => ({ ...prev, [`q${idx + 1}`]: { ...prev[`q${idx + 1}`], selected_option: optText } }));
                                  }}
                                  disabled={isLocked}
                                  className="w-5 h-5 text-blue-600 border-gray-300 focus:ring-blue-500 flex-shrink-0"
                                />
                                <span className="font-bold text-blue-700 flex-shrink-0">({optKey})</span>
                                <McqFieldRenderer
                                  value={optText}
                                  isOption
                                  onZoom={setZoomedImage}
                                  className="flex-1"
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          <div className="mb-4">
                            <label className="block text-gray-600 font-bold mb-2 text-sm uppercase">Type Code / Answer:</label>
                            <textarea
                              value={ans.code || ''}
                              onChange={e => handleCodeChange(idx, e.target.value)}
                              disabled={(isLocked || ans.is_approved) && !ans.is_rejected}
                              onCopy={e => e.stopPropagation()}
                              onPaste={(e) => { handlePaste(idx, e); e.stopPropagation(); }}
                              onCut={e => e.stopPropagation()}
                              className="w-full border border-gray-300 rounded-lg px-4 py-3 h-40 font-mono text-sm focus:ring-2 focus:ring-blue-500"
                              placeholder="// Type here... (You can also paste an image directly!)"
                            />
                          </div>

                          <div className="bg-white p-4 rounded-lg border border-gray-200">
                            <label className="block text-gray-600 font-bold mb-2 text-sm uppercase">{ans.file_uploaded ? "✅ File Uploaded" : "Upload Output (PDF, JPG, or PNG)"}</label>
                            <div className="flex items-center gap-4">
                              <input
                                type="file"
                                onChange={e => handleFileUpload(idx, e.target.files[0])}
                                disabled={((isLocked || ans.is_approved) && !ans.is_rejected) || uploading}
                                accept="application/pdf,image/jpeg,image/png"
                                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                              />
                            </div>

                            {/* ── Feature 1: Upload progress bar ── */}
                            {uploading && progress && (
                              <div className="mt-3">
                                <div className="flex justify-between items-center mb-1.5">
                                  <span className="text-sm font-semibold text-blue-700">{progress.percent}% uploaded</span>
                                  <span className="text-xs text-gray-500">{formatEta(progress.eta)}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
                                  <div
                                    className="progress-bar-fill h-full rounded-full relative"
                                    style={{
                                      width: `${progress.percent}%`,
                                      background: progress.percent < 100
                                        ? 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #3b82f6 100%)'
                                        : 'linear-gradient(90deg, #22c55e 0%, #4ade80 50%, #22c55e 100%)',
                                    }}
                                  >
                                    <div className="absolute inset-0 progress-bar-shimmer rounded-full" />
                                  </div>
                                </div>
                              </div>
                            )}
                            {uploading && !progress && (
                              <div className="text-blue-600 text-sm font-bold animate-pulse mt-2">Preparing upload...</div>
                            )}

                            {ans.file_uploaded && !uploading && (
                              <div className="mt-3 flex justify-between bg-green-50 p-2 rounded border border-green-200">
                                <span className="text-green-700 text-sm font-medium truncate max-w-[200px]">📄 {ans.file_name}</span>
                                {(!(isLocked || ans.is_approved) || ans.is_rejected) && <button onClick={() => handleRemoveFile(idx)} className="text-xs text-red-600 font-bold border border-red-200 px-2 rounded bg-white">Remove</button>}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>


            {/* ── ACTION BUTTONS ── */}
            <div className="bg-white rounded-lg shadow-md p-6 flex justify-between gap-4 border-t-2 border-gray-100">
              {student.exam_type === 'internal' ? (
                /* ── INTERNAL EXAM: Single direct submit (auto-graded, no approval flow) ── */
                <div className="w-full flex justify-end items-center gap-4">
                  {student.status === 'submitted' ? (
                    <div className="bg-green-100 text-green-800 px-6 py-3 rounded-lg font-bold">✅ Submitted & Graded</div>
                  ) : (
                    <button
                      onClick={() => handleAction('submitted')}
                      disabled={isSubmitting || isLocked}
                      className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg transition disabled:opacity-50"
                    >
                      {isSubmitting ? 'Submitting...' : '✅ Submit Exam'}
                    </button>
                  )}
                </div>
              ) : (
                /* ── PRACTICAL EXAM: Original approval-flow buttons ── */
                <>
                  {/* LEFT: Ask for Approval */}
                  <div>
                    {showAskApprovalBtn && (
                      <button
                        onClick={() => handleAction('approval_requested')}
                        disabled={isSubmitting || isUploading}
                        className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-lg font-bold transition disabled:opacity-50"
                      >
                        {anyQuestionRejected ? '🔁 Re-submit for Approval' : 'Ask for Approval'}
                      </button>
                    )}
                  </div>
                  {/* RIGHT: Status indicators and Final Submit */}
                  <div className="flex items-center gap-3">
                    {showPendingBanner && (
                      <div className="bg-yellow-100 text-yellow-800 px-6 py-3 rounded-lg font-bold">⏳ Pending Approval</div>
                    )}
                    {student.status === 'submitted' && (
                      <div className="bg-green-100 text-green-800 px-6 py-3 rounded-lg font-bold">✅ Submitted</div>
                    )}
                    {showFinalSubmitBtn && (
                      <button
                        onClick={() => handleAction('submitted')}
                        disabled={isSubmitting || isUploading}
                        className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg transition disabled:opacity-50"
                      >
                        ✅ Final Submit
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── SAVE DRAFT BUTTON (Practical exams only) ──
                Appears below the main action buttons. Only visible when the exam
                is active (not submitted / not locked by teacher end).
                The 10-minute throttle prevents DB spam even if pressed many times. */}
            {student.exam_type !== 'internal' && !isLocked && student.status !== 'submitted' && (
              <div className="bg-white rounded-lg shadow-md px-6 py-4 flex items-center justify-between border-t border-gray-100 mt-2">
                <div className="text-sm text-gray-500">
                  💾 Save your progress to the database manually.
                </div>
                <div className="flex items-center gap-3">
                  {/* Save Draft status feedback */}
                  {saveDraftStatus === 'saving' && (
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Saving...
                    </div>
                  )}
                  {saveDraftStatus === 'saved' && (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-green-700">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Draft Saved!
                    </div>
                  )}
                  {saveDraftStatus === 'throttled' && (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-orange-600">
                      ⏳ Already saved recently. Please wait before saving again.
                    </div>
                  )}
                  {saveDraftStatus === 'error' && (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                      ⚠ Save failed. Try again.
                    </div>
                  )}
                  <button
                    onClick={handleSaveDraft}
                    disabled={saveDraftStatus === 'saving' || isSubmitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold shadow transition disabled:opacity-50 flex items-center gap-2"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Save Draft
                  </button>
                </div>
              </div>
            )}
          </div>

          {examConfig?.allowed_url && (
            <div className="sticky top-20 h-[85vh] bg-gray-100 rounded-lg border-2 border-blue-200 overflow-hidden shadow-inner flex flex-col">
              <div className="bg-gray-200 px-4 py-2 text-xs font-mono text-gray-600 border-b">Resource Window (Read Only)</div>
              <iframe src={examConfig.allowed_url} title="Resource" className="w-full h-full bg-white" sandbox="allow-scripts allow-same-origin allow-forms" />
            </div>
          )}
        </div>
        <div className="text-center mt-12 mb-8"><p className="text-2xl font-serif text-gray-400 italic">all the best</p></div>
      </div>

      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 text-center max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Leave Session?</h3>
            <p className="text-gray-600 mb-6">Not submitted yet. Log out?</p>
            <div className="flex gap-3 justify-center"><button onClick={() => setShowLogoutConfirm(false)} className="px-5 py-2 bg-gray-200 rounded font-bold">Cancel</button><button onClick={confirmLogout} className="px-5 py-2 bg-red-600 text-white rounded font-bold">Yes, Logout</button></div>
          </div>
        </div>
      )}

      {zoomedImage && (
        <div className="fixed inset-0 z-[9999] bg-black bg-opacity-90 flex items-center justify-center p-4" onClick={() => setZoomedImage(null)}>
          <div className="relative max-w-4xl max-h-full">
            <button onClick={() => setZoomedImage(null)} className="absolute -top-12 right-0 text-white text-4xl font-bold">&times;</button>
            <img src={zoomedImage} alt="Full Size" className="max-w-full max-h-[85vh] rounded-lg border-4 border-white" onClick={e => e.stopPropagation()} />
          </div>
        </div>
      )}

      {/* ── Feature 2: Global Modal (rendered once, controlled by useModal hook) ── */}
      <Modal {...modalProps} />
    </div>
  );
};

export default ExamInterface;