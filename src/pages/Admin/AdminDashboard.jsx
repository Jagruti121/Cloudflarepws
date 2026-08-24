import { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, deleteDoc, doc, setDoc, getDoc, updateDoc, writeBatch, where, onSnapshot } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import * as XLSX from 'xlsx';
import { db } from '../../firebase';
import Navbar from '../../components/Navbar';
import GetHelpModal from '../../components/GetHelpModal';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useTenant } from '../../context/TenantContext';
import { useAuth } from '../../context/AuthContext';
import PracticalSessionTable from './PracticalSessionTable';
import InternalSessionTable from './InternalSessionTable';

// Mask an email for display: shows first 3 chars + domain, hides middle
// e.g. john.doe@example.com → joh****@example.com
const maskEmail = (email) => {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const visible = Math.min(3, local.length);
  return local.slice(0, visible) + '****@' + domain;
};

// Allow only 10 digits in phone fields
const sanitizePhone = (val) => val.replace(/\D/g, '').slice(0, 10);

const AdminDashboard = () => {
  const { tenantId, tenantLoading } = useTenant();
  // TASK 1.3: Get current user role to conditionally show admin-only settings.
  const { userRole, currentUser } = useAuth();
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ email: '', password: '', name: '', department: '' });

  // --- CONSENT GATE STATE ---
  const [consentStatus, setConsentStatus] = useState('checking');
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);

  // --- PRE-ASSIGNED FACULTY STATE ---
  const [facultyEmails, setFacultyEmails] = useState([]);
  const [pendingFacultyModal, setPendingFacultyModal] = useState(null); // stores the email string when open

  // --- SUBMISSION STATE ---
  const [groupedSessions, setGroupedSessions] = useState({});
  const [selectedSessionKey, setSelectedSessionKey] = useState(null);
  const [exportLoading, setExportLoading] = useState(false);

  // --- BULK TEACHER CREATION STATE ---
  const [bulkTeachers, setBulkTeachers] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkInfo, setShowBulkInfo] = useState(false);

  // --- SEARCH & BULK DELETE STATE ---
  const [teacherSearch, setTeacherSearch] = useState('');
  const [selectedTeacherIds, setSelectedTeacherIds] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // --- SEARCH STATES ---
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');

  // --- EXAM TYPE FILTER (All Student Submissions section) ---
  // 'all' | 'practical' | 'internal'
  const [examTypeFilter, setExamTypeFilter] = useState('all');

  // --- SESSION DELETE STATE ---
  const [sessionToDelete, setSessionToDelete] = useState(null);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');

  // --- DOWNLOAD EXCEL KEY MODAL ---
  const [showDownloadKeyModal, setShowDownloadKeyModal] = useState(false);
  const [downloadKey, setDownloadKey] = useState('');
  const [downloadKeyError, setDownloadKeyError] = useState('');

  // --- EDIT TEACHER STATE ---
  const [editingTeacher, setEditingTeacher] = useState(null); // { id, name, department }

  // --- OTP REQUEST STATE ---
  const [pendingOtpRequests, setPendingOtpRequests] = useState([]); // list of {id, teacherEmail, otp}
  const [dismissedOtpIds, setDismissedOtpIds] = useState(new Set());

  // secondaryAuth removed — teacher creation/deletion now handled server-side
  // via /api/teachers/create and /api/teachers/delete-auth (Admin SDK),
  // which bypasses reCAPTCHA Enterprise that blocked client-side Auth calls.

  // --- SETTINGS DROPDOWN STATE ---
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsDropdownRef = useRef(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  // --- SECONDARY ADMIN MODAL STATE ---
  const [showSecondAdminModal, setShowSecondAdminModal] = useState(false);
  const [secondAdminStep, setSecondAdminStep] = useState(1); // 1=password, 2=otp-sent, 3=otp-verify, 4=set-pw, 5=success
  const [secondAdminFlowToken, setSecondAdminFlowToken] = useState('');
  const [secondAdminOtpSentToken, setSecondAdminOtpSentToken] = useState('');
  const [secondAdminSetPwToken, setSecondAdminSetPwToken] = useState('');
  const [secondAdminPrimaryPw, setSecondAdminPrimaryPw] = useState('');
  const [secondAdminOtp, setSecondAdminOtp] = useState('');
  const [secondAdminNewPw, setSecondAdminNewPw] = useState('');
  const [secondAdminConfirmPw, setSecondAdminConfirmPw] = useState('');
  const [secondAdminMaskedEmail, setSecondAdminMaskedEmail] = useState('');
  const [secondAdminLoading, setSecondAdminLoading] = useState(false);
  const [secondAdminError, setSecondAdminError] = useState('');
  const [isSecondaryAdmin, setIsSecondaryAdmin] = useState(false);
  const [hasSecondaryPasswordSetup, setHasSecondaryPasswordSetup] = useState(false);

  // --- REPLACE ADMIN MODAL STATE ---
  const [showReplaceAdminModal, setShowReplaceAdminModal] = useState(false);
  const [replaceAdminStep, setReplaceAdminStep] = useState(1); // 1=intro, 2=super-otp, 3=new-admin-form, 4=new-admin-otp, 5=success
  const [replaceAdminSuperOtpToken, setReplaceAdminSuperOtpToken] = useState('');
  const [replaceAdminNewAdminToken, setReplaceAdminNewAdminToken] = useState('');
  const [replaceAdminNewAdminOtpToken, setReplaceAdminNewAdminOtpToken] = useState('');
  const [replaceAdminSuperOtp, setReplaceAdminSuperOtp] = useState('');
  const [replaceAdminMaskedSuperEmail, setReplaceAdminMaskedSuperEmail] = useState('');
  const [replaceAdminNewEmail, setReplaceAdminNewEmail] = useState('');
  const [replaceAdminNewPhone, setReplaceAdminNewPhone] = useState('');
  const [replaceAdminNewPassword, setReplaceAdminNewPassword] = useState('');
  const [replaceAdminConfirmPassword, setReplaceAdminConfirmPassword] = useState('');
  const [replaceAdminNewOtp, setReplaceAdminNewOtp] = useState('');
  const [replaceAdminLoading, setReplaceAdminLoading] = useState(false);
  const [replaceAdminError, setReplaceAdminError] = useState('');
  // Teacher picker state (Step 3)
  const [replaceAdminSelectedTeacher, setReplaceAdminSelectedTeacher] = useState(null);
  const [replaceAdminTeacherSearch, setReplaceAdminTeacherSearch] = useState('');
  const [replaceAdminPickerOpen, setReplaceAdminPickerOpen] = useState(false);
  const [replaceAdminIsPrimary, setReplaceAdminIsPrimary] = useState(true);
  const [replaceAdminExcludeEmails, setReplaceAdminExcludeEmails] = useState(new Set());
  const replaceAdminPickerRef = useRef(null);
  // OTP timers & attempt tracking
  const [superOtpTimer, setSuperOtpTimer] = useState(60);
  const [superOtpExpired, setSuperOtpExpired] = useState(false);
  const [superOtpAttempts, setSuperOtpAttempts] = useState(0);
  const [superOtpTimerKey, setSuperOtpTimerKey] = useState(0);
  const [newOtpTimer, setNewOtpTimer] = useState(60);
  const [newOtpExpired, setNewOtpExpired] = useState(false);
  const [newOtpAttempts, setNewOtpAttempts] = useState(0);
  const [newOtpTimerKey, setNewOtpTimerKey] = useState(0);

  // --- CLICK-OUTSIDE FOR TEACHER PICKER DROPDOWN ---
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (replaceAdminPickerRef.current && !replaceAdminPickerRef.current.contains(e.target)) {
        setReplaceAdminPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- OTP COUNTDOWN TIMERS FOR REPLACE ADMIN ---
  useEffect(() => {
    if (replaceAdminStep !== 2) return;
    setSuperOtpTimer(60);
    setSuperOtpExpired(false);
    const interval = setInterval(() => {
      setSuperOtpTimer(prev => {
        if (prev <= 1) { clearInterval(interval); setSuperOtpExpired(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [replaceAdminStep, superOtpTimerKey]);

  useEffect(() => {
    if (replaceAdminStep !== 4) return;
    setNewOtpTimer(60);
    setNewOtpExpired(false);
    const interval = setInterval(() => {
      setNewOtpTimer(prev => {
        if (prev <= 1) { clearInterval(interval); setNewOtpExpired(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [replaceAdminStep, newOtpTimerKey]);

  useEffect(() => {
    if (!tenantId) return;

    const settingsRef = doc(db, 'colleges', tenantId, 'config', 'settings');
    const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
      if (snapshot.exists() && snapshot.data().facultyEmails) {
        setFacultyEmails(snapshot.data().facultyEmails);
      } else {
        setFacultyEmails([]);
      }
      
      if (snapshot.exists()) {
        setHasSecondaryPasswordSetup(!!snapshot.data().secondaryAdminPasswordSet);
      }
    }, (err) => {
      console.error("Error listening to tenant settings:", err);
    });

    return () => unsubSettings();
  }, [tenantId]);

  // --- CLOSE SETTINGS DROPDOWN ON OUTSIDE CLICK ---
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(e.target)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const initDashboard = async () => {
      // Wait for tenant resolution to complete before doing anything
      if (tenantLoading) return;

      if (!tenantId) {
        // Tenant resolved but no tenantId available — stop loading
        setLoading(false);
        return;
      }

      // Note: teachers are now loaded by the real-time onSnapshot below.
      await fetchData();
    };

    initDashboard();
  }, [tenantId, tenantLoading]);

  // TASK 3.1 FIX: Replace one-time getDocs teacher fetch with onSnapshot for real-time updates.
  // This eliminates polling and ensures the teacher list auto-updates without page refresh.
  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    const teachersRef = collection(db, 'colleges', tenantId, 'teachers');
    const unsubTeachers = onSnapshot(
      teachersRef,
      (snapshot) => {
        const teachersList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setTeachers(teachersList);
        setLoading(false);
      },
      (err) => {
        console.error('[Real-Time] Teachers listener error:', err);
        setLoading(false);
      }
    );
    return () => unsubTeachers();
  }, [tenantId]);

  // --- REAL-TIME OTP LISTENER ---
  useEffect(() => {
    if (!tenantId) return;
    const now = new Date();
    const otpQuery = query(
      collection(db, 'colleges', tenantId, 'otp_requests'),
      where('status', '==', 'pending')
    );
    const unsubOtp = onSnapshot(otpQuery, (snapshot) => {
      const requests = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const expiresAt = data.expiresAt?.toDate?.() || new Date(0);
        if (expiresAt > new Date()) {
          requests.push({ id: docSnap.id, ...data });
        }
      });
      setPendingOtpRequests(requests);
    });
    return () => unsubOtp();
  }, [tenantId]);

  // --- HELPER: FORMAT DATE ---
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      if (isNaN(date.getTime())) return 'N/A';

      return date.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    } catch (e) {
      return 'N/A';
    }
  };

  // Converts "6th Semester" → "Sem 6", "Sem VI" → "Sem 6", etc.
  const formatSemester = (raw) => {
    if (!raw) return 'N/A';
    const str = String(raw).trim();
    const digitMatch = str.match(/^(\d+)/);
    if (digitMatch) return `Sem ${digitMatch[1]}`;
    const romanMap = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8' };
    const romanMatch = str.match(/^Sem\s*([IVX]+)$/i);
    if (romanMatch) {
      const roman = romanMatch[1].toUpperCase();
      return romanMap[roman] ? `Sem ${romanMap[roman]}` : str;
    }
    return str;
  };

  // TASK 3.1 FIX: fetchTeachers is now replaced by the onSnapshot listener above.
  // Kept as a no-op stub to avoid breaking any direct call-sites that may still reference it.
  const fetchTeachers = async () => { };

  const fetchData = async () => {
    if (!tenantId) return;
    try {
      const examsQuery = query(collection(db, 'colleges', tenantId, 'exams'));
      const examsSnapshot = await getDocs(examsQuery);
      const examMap = {};

      examsSnapshot.forEach((examDoc) => {
        const data = examDoc.data();
        examMap[examDoc.id] = {
          created_at: data.created_at,
          lab_number: data.lab_number,
          subject_name: data.subject_name,
          exam_type: data.exam_type || 'practical',
          teacher_email: data.teacher_email || '',
          student_department: data.student_department || '',
          student_semester: data.student_semester || data.student_year || '',
          // Internal exams store explicit exam_date; practical exams use created_at
          exam_date_obj: data.exam_date ? new Date(data.exam_date) : null,
          is_active: data.is_active ?? false,
        };
      });

      const studentsQuery = query(collection(db, 'colleges', tenantId, 'students'));
      const studentsSnapshot = await getDocs(studentsQuery);
      const submissions = [];
      studentsSnapshot.forEach((doc) => {
        submissions.push({ id: doc.id, ...doc.data() });
      });

      const groups = {};

      Object.keys(examMap).forEach(code => {
        groups[code] = {
          session_code: code,
          lab_number: examMap[code].lab_number || 'N/A',
          date_obj: examMap[code].created_at,
          exam_date_obj: examMap[code].exam_date_obj,
          subject_name: examMap[code].subject_name || '',
          exam_type: examMap[code].exam_type,
          created_by: examMap[code].teacher_email,
          student_department: examMap[code].student_department,
          student_semester: examMap[code].student_semester,
          is_active: examMap[code].is_active,
          students: [],
          count: 0
        };
      });

      submissions.forEach(sub => {
        const code = sub.session_code || 'Unknown';

        if (!groups[code]) {
          groups[code] = {
            session_code: code,
            lab_number: sub.lab_number || 'N/A',
            date_obj: sub.joined_at,
            exam_date_obj: null,
            subject_name: '',
            exam_type: sub.exam_type || 'practical',
            created_by: '',
            student_department: sub.department || '',
            student_semester: sub.semester || sub.year || '',
            students: [],
            count: 0
          };
        }

        groups[code].students.push(sub);
        groups[code].count++;
      });

      setGroupedSessions(groups);

    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  // --- FILTERING & SORTING ---

  const filteredTeachers = teachers.filter(t => {
    const term = teacherSearch.toLowerCase();
    return (
      (t.name?.toLowerCase() || '').includes(term) ||
      (t.email?.toLowerCase() || '').includes(term) ||
      (t.department?.toLowerCase() || '').includes(term)
    );
  });

  const filteredSessions = Object.values(groupedSessions)
    .filter(session => {
      // Exam type filter
      if (examTypeFilter === 'practical' && session.exam_type !== 'practical') return false;
      if (examTypeFilter === 'internal' && session.exam_type !== 'internal') return false;
      // Text search
      const term = sessionSearch.toLowerCase();
      return (
        (session.session_code?.toLowerCase() || '').includes(term) ||
        (session.lab_number?.toLowerCase() || '').includes(term) ||
        (session.subject_name?.toLowerCase() || '').includes(term)
      );
    })
    .sort((a, b) => {
      const dateA = a.date_obj?.toDate ? a.date_obj.toDate() : new Date(a.date_obj || 0);
      const dateB = b.date_obj?.toDate ? b.date_obj.toDate() : new Date(b.date_obj || 0);
      return dateB - dateA;
    });

  const getFilteredStudentsForSession = () => {
    if (!selectedSessionKey || !groupedSessions[selectedSessionKey]) return [];

    const students = groupedSessions[selectedSessionKey].students;
    const term = submissionSearch.toLowerCase();

    const sortedStudents = [...students].sort((a, b) =>
      (a.roll_no || '').localeCompare(b.roll_no || '', undefined, { numeric: true })
    );

    if (!term) return sortedStudents;

    return sortedStudents.filter(sub =>
      (sub.roll_no?.toLowerCase() || '').includes(term) ||
      (sub.name?.toLowerCase() || '').includes(term)
    );
  };

  const handleAddTeacher = async (e) => {
    e.preventDefault();
    try {
      // Create Firebase Auth account server-side (Admin SDK bypasses reCAPTCHA Enterprise)
      const createResp = await fetch(`${API_URL}/api/teachers/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newTeacher.email.trim(),
          password: newTeacher.password,
          tenantId,
        }),
      });
      const createResult = await createResp.json();
      if (!createResp.ok) throw new Error(createResult.error || 'Failed to create teacher account.');

      const uid = createResult.uid;

      await setDoc(doc(db, 'colleges', tenantId, 'teachers', uid), {
        name: newTeacher.name,
        email: newTeacher.email.trim().toLowerCase(),
        department: newTeacher.department,
        password: newTeacher.password,
        role: 'teacher'
      });
      // Create root-level teacher_users lookup for login resolution
      await setDoc(doc(db, 'teacher_users', uid), {
        tenantId: tenantId,
        email: newTeacher.email.trim().toLowerCase()
      });
      alert('Teacher account created successfully!');
      setNewTeacher({ email: '', password: '', name: '', department: '' });
      setShowAddForm(false);

      // If provisioned from pending, clear the modal and update tenant settings array
      if (pendingFacultyModal) {
        setPendingFacultyModal(null);
        if (tenantId) {
          try {
            const updatedEmails = facultyEmails.filter(e => e !== newTeacher.email);
            setFacultyEmails(updatedEmails);
            await updateDoc(doc(db, 'colleges', tenantId, 'config', 'settings'), {
              facultyEmails: updatedEmails
            });
          } catch (err) {
            console.error('Error removing email from pending list:', err);
          }
        }
      }

      fetchTeachers();
    } catch (error) {
      alert('Error creating teacher: ' + error.message);
    }
  };

  const handleSelectAllTeachers = (e) => {
    if (e.target.checked) {
      const allIds = new Set(filteredTeachers.map(t => t.id));
      setSelectedTeacherIds(allIds);
    } else {
      setSelectedTeacherIds(new Set());
    }
  };

  const handleSelectOneTeacher = (id) => {
    const newSet = new Set(selectedTeacherIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedTeacherIds(newSet);
  };

  const handleBulkDeleteTeachers = async () => {
    if (selectedTeacherIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedTeacherIds.size} teacher(s)?`)) return;

    setIsDeleting(true);
    try {
      const batch = writeBatch(db);

      for (const id of selectedTeacherIds) {
        // Delete Firebase Auth account server-side (Admin SDK, no reCAPTCHA)
        try {
          await fetch(`${API_URL}/api/teachers/delete-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: id, tenantId }),
          });
        } catch (authErr) {
          console.warn(`Could not delete auth for uid ${id}:`, authErr.message);
        }
        const docRef = doc(db, 'colleges', tenantId, 'teachers', id);
        batch.delete(docRef);
        // Also delete root-level teacher_users lookup
        batch.delete(doc(db, 'teacher_users', id));
      }
      await batch.commit();

      alert(`Successfully deleted ${selectedTeacherIds.size} teacher(s).`);
      setSelectedTeacherIds(new Set());
      fetchTeachers();
    } catch (error) {
      console.error('Bulk delete error:', error);
      alert('Failed to delete teachers: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const normalizeRow = (row) => {
      const normalized = {};
      Object.entries(row || {}).forEach(([key, value]) => {
        const cleanKey = String(key || '').toLowerCase().trim();
        const cleanVal = typeof value === 'string' ? value.trim() : value;
        normalized[cleanKey] = cleanVal;
      });
      return normalized;
    };

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    const normalizedRows = jsonData.map(normalizeRow);

    const parsed = normalizedRows
      .map((row) => ({
        name: String(row['full name'] || row['name'] || '').trim(),
        email: String(row['email id'] || row['email'] || '').trim(),
        password: String(row['password'] || '').trim(),
        department: String(row['department'] || '').trim(),
      }))
      .filter((t) => t.name && t.email && t.password && t.department);

    if (parsed.length === 0) {
      alert('Bulk upload: no valid rows found.');
      setBulkTeachers([]);
      return;
    }
    setBulkTeachers(parsed);
  };

  const handleBulkCreate = async () => {
    if (bulkTeachers.length === 0) return;
    setBulkLoading(true);
    const results = { success: 0, failed: 0, errors: [] };

    for (const teacher of bulkTeachers) {
      try {
        // Create Firebase Auth account server-side (Admin SDK bypasses reCAPTCHA Enterprise)
        const createResp = await fetch(`${API_URL}/api/teachers/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: teacher.email, password: teacher.password, tenantId }),
        });
        const createResult = await createResp.json();
        if (!createResp.ok) throw new Error(createResult.error || 'Auth creation failed');

        const uid = createResult.uid;
        await setDoc(doc(db, 'colleges', tenantId, 'teachers', uid), {
          name: teacher.name,
          email: teacher.email.trim().toLowerCase(),
          department: teacher.department,
          password: teacher.password,
          role: 'teacher',
        });
        // Create root-level teacher_users lookup
        await setDoc(doc(db, 'teacher_users', uid), {
          tenantId: tenantId,
          email: teacher.email.trim().toLowerCase()
        });
        results.success += 1;
      } catch (error) {
        results.failed += 1;
        results.errors.push(`${teacher.email}: ${error.message}`);
      }
    }
    setBulkLoading(false);
    fetchTeachers();
    alert(`Bulk upload completed. Success: ${results.success}, Failed: ${results.failed}`);
    setBulkTeachers([]);
  };

  // --- DOWNLOAD BULK TEMPLATE ---
  const handleDownloadTemplate = () => {
    const templateData = [
      { 'Full Name': '', 'Email ID': '', 'Password': '', 'Department': '' }
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Teachers');
    worksheet['!cols'] = [
      { wch: 25 }, // Full Name
      { wch: 30 }, // Email ID
      { wch: 20 }, // Password
      { wch: 20 }, // Department
    ];
    XLSX.writeFile(workbook, 'bulk_teacher_template.xlsx');
  };

  const handleDeleteTeacher = async (teacherId) => {
    if (!globalThis.confirm('Delete this teacher?')) return;
    try {
      // Delete Firebase Auth account server-side (Admin SDK, no reCAPTCHA)
      try {
        await fetch(`${API_URL}/api/teachers/delete-auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: teacherId, tenantId }),
        });
      } catch (authErr) {
        console.warn(`Could not delete auth account for uid ${teacherId}:`, authErr.message);
      }

      await deleteDoc(doc(db, 'colleges', tenantId, 'teachers', teacherId));
      // Also delete root-level teacher_users lookup
      try { await deleteDoc(doc(db, 'teacher_users', teacherId)); } catch (e) { console.warn('teacher_users cleanup:', e); }

      // Cleanup email from product keys and settings so Super Admin gets real-time update
      try {
        await fetch(`${API_URL}/api/admin/remove-teacher-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, email: teacher.email })
        });
      } catch (e) { console.warn('email cleanup:', e); }

      fetchTeachers();
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  // --- EDIT TEACHER ---
  const handleEditTeacher = (teacher) => {
    setEditingTeacher({ id: teacher.id, name: teacher.name || '', department: teacher.department || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingTeacher) return;
    try {
      await updateDoc(doc(db, 'colleges', tenantId, 'teachers', editingTeacher.id), {
        name: editingTeacher.name.trim(),
        department: editingTeacher.department.trim(),
      });
      alert('Teacher updated successfully!');
      setEditingTeacher(null);
      fetchTeachers();
    } catch (error) {
      alert('Error updating teacher: ' + error.message);
    }
  };

  const confirmDeleteSession = (e, sessionCode) => {
    e.stopPropagation();
    setSessionToDelete(sessionCode);
    setConfirmDeleteText('');
  };

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);

      const examRef = doc(db, 'colleges', tenantId, 'exams', sessionToDelete);
      batch.delete(examRef);

      const studentsQ = query(collection(db, 'colleges', tenantId, 'students'), where('session_code', '==', sessionToDelete));
      const studentsSnap = await getDocs(studentsQ);
      studentsSnap.forEach(doc => batch.delete(doc.ref));

      const questionsQ = query(collection(db, 'colleges', tenantId, 'questions'), where('session_code', '==', sessionToDelete));
      const questionsSnap = await getDocs(questionsQ);
      questionsSnap.forEach(doc => batch.delete(doc.ref));

      // Also delete exam_index entry
      batch.delete(doc(db, 'exam_index', sessionToDelete));

      await batch.commit();

      alert(`Session ${sessionToDelete} history deleted successfully.`);

      const newGroups = { ...groupedSessions };
      delete newGroups[sessionToDelete];
      setGroupedSessions(newGroups);
      setSessionToDelete(null);

    } catch (error) {
      console.error("Error deleting session:", error);
      alert("Failed to delete session: " + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- DOWNLOAD EXCEL OF PASSWORDS ---
  const handleDownloadExcel = () => {
    setDownloadKey('');
    setDownloadKeyError('');
    setShowDownloadKeyModal(true);
  };

  const handleDownloadKeySubmit = async () => {
    setExportLoading(true);
    setDownloadKeyError('');
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Not logged in");

      // Verify the admin's password via the backend (works for both
      // email/password AND Google OAuth admins, since the backend uses
      // the Admin SDK to validate — no client-side re-auth needed).
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const verifyResp = await fetch(`${API_URL}/api/secondary-admin/verify-primary-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryEmail: currentUser.email, primaryPassword: downloadKey }),
      });
      const verifyData = await verifyResp.json();
      if (!verifyResp.ok) throw new Error(verifyData.error || 'Invalid password. Access denied.');
      // Fetch real-time data directly from the database for the Excel sheet
      const teachersRef = collection(db, 'colleges', tenantId, 'teachers');
      const snapshot = await getDocs(teachersRef);
      const realTimeTeachers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const excelData = realTimeTeachers.map(t => ({
        'Teacher ID': t.id || '',
        'Name': t.name || '',
        'Email ID': t.email || '',
        'Department': t.department || '',
        'Password': t.password || 'N/A',
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Teacher Passwords');

      const colWidths = [
        { wch: 30 }, // Teacher ID
        { wch: 25 }, // Name
        { wch: 30 }, // Email ID
        { wch: 20 }, // Department
        { wch: 20 }, // Password
      ];
      worksheet['!cols'] = colWidths;

      XLSX.writeFile(workbook, `teacher_passwords_${new Date().toISOString().split('T')[0]}.xlsx`);

      setShowDownloadKeyModal(false);
      setDownloadKey('');
      setDownloadKeyError('');
    } catch (err) {
      console.error(err);
      // Show the server's error message (e.g. "Invalid password. Access denied.")
      // rather than always overriding with a hardcoded string.
      setDownloadKeyError(err.message || 'Invalid password. Access denied.');
    } finally {
      setExportLoading(false);
    }
  };

  // ─── SECONDARY ADMIN SETUP HANDLERS ────────────────────────────────────────

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  // Step 1: Verify primary admin password
  const handleSecondAdminStep1 = async () => {
    if (!secondAdminPrimaryPw) return;
    setSecondAdminLoading(true);
    setSecondAdminError('');
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('You are not logged in. Please refresh and try again.');

      const resp = await fetch(`${API_URL}/api/secondary-admin/verify-primary-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryEmail: currentUser.email, primaryPassword: secondAdminPrimaryPw }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Password verification failed.');

      setSecondAdminFlowToken(data.flowToken);
      setSecondAdminStep(2);
    } catch (err) {
      setSecondAdminError(err.message);
    } finally {
      setSecondAdminLoading(false);
    }
  };

  // Step 2: Send OTP to secondary admin email
  const handleSecondAdminSendOtp = async () => {
    setSecondAdminLoading(true);
    setSecondAdminError('');
    try {
      const resp = await fetch(`${API_URL}/api/secondary-admin/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowToken: secondAdminFlowToken }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to send OTP.');

      setSecondAdminOtpSentToken(data.otpSentToken);
      setSecondAdminMaskedEmail(data.maskedEmail || '');
      setSecondAdminOtp('');
      setSecondAdminStep(3);
    } catch (err) {
      setSecondAdminError(err.message);
    } finally {
      setSecondAdminLoading(false);
    }
  };

  // Step 3: Verify OTP
  const handleSecondAdminVerifyOtp = async () => {
    if (secondAdminOtp.length !== 6) return;
    setSecondAdminLoading(true);
    setSecondAdminError('');
    try {
      const resp = await fetch(`${API_URL}/api/secondary-admin/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpSentToken: secondAdminOtpSentToken, otp: secondAdminOtp }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'OTP verification failed.');

      setSecondAdminSetPwToken(data.setPasswordToken);
      setSecondAdminStep(4);
    } catch (err) {
      setSecondAdminError(err.message);
    } finally {
      setSecondAdminLoading(false);
    }
  };

  // Step 4: Set new password
  const handleSecondAdminSetPassword = async () => {
    if (secondAdminNewPw !== secondAdminConfirmPw) {
      setSecondAdminError('Passwords do not match.');
      return;
    }
    if (secondAdminNewPw.length < 8) {
      setSecondAdminError('Password must be at least 8 characters.');
      return;
    }
    setSecondAdminLoading(true);
    setSecondAdminError('');
    try {
      const resp = await fetch(`${API_URL}/api/secondary-admin/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setPasswordToken: secondAdminSetPwToken, newPassword: secondAdminNewPw }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to set password.');

      setSecondAdminStep(5);
    } catch (err) {
      setSecondAdminError(err.message);
    } finally {
      setSecondAdminLoading(false);
    }
  };
  // ─── END SECONDARY ADMIN HANDLERS ──────────────────────────────────────────

  // ─── REPLACE ADMIN HANDLERS ────────────────────────────────────────────────

  const resetReplaceAdminState = () => {
    setReplaceAdminStep(1);
    setReplaceAdminSuperOtpToken('');
    setReplaceAdminNewAdminToken('');
    setReplaceAdminNewAdminOtpToken('');
    setReplaceAdminSuperOtp('');
    setReplaceAdminMaskedSuperEmail('');
    setReplaceAdminNewEmail('');
    setReplaceAdminNewPhone('');
    setReplaceAdminNewPassword('');
    setReplaceAdminConfirmPassword('');
    setReplaceAdminNewOtp('');
    setReplaceAdminError('');
    setReplaceAdminSelectedTeacher(null);
    setReplaceAdminTeacherSearch('');
    setReplaceAdminPickerOpen(false);
    setReplaceAdminExcludeEmails(new Set());
    setSuperOtpTimer(60); setSuperOtpExpired(false); setSuperOtpAttempts(0); setSuperOtpTimerKey(0);
    setNewOtpTimer(60); setNewOtpExpired(false); setNewOtpAttempts(0); setNewOtpTimerKey(0);
  };

  // Open replace admin modal — fetch admin type first
  const handleOpenReplaceAdminModal = async () => {
    setShowSettingsDropdown(false);
    resetReplaceAdminState();
    // Detect if the logged-in admin is primary or secondary
    try {
      const auth = getAuth();
      const cu = auth.currentUser;
      if (cu?.email) {
        const resp = await fetch(`${API_URL}/api/replace-admin/admin-info?email=${encodeURIComponent(cu.email)}`);
        if (resp.ok) {
          const data = await resp.json();
          setReplaceAdminIsPrimary(!data.isSecondaryAdmin);
          // Build exclusion set: all admin emails (primary + secondary) should not appear in teacher picker
          const excluded = new Set((data.allAdminEmails || []).map(e => e.toLowerCase()));
          // Always exclude current user's own email
          excluded.add(cu.email.toLowerCase());
          setReplaceAdminExcludeEmails(excluded);
        } else {
          setReplaceAdminIsPrimary(true);
          setReplaceAdminExcludeEmails(new Set([auth.currentUser?.email?.toLowerCase()].filter(Boolean)));
        }
      }
    } catch (e) {
      setReplaceAdminIsPrimary(true); // default to primary on error
    }
    setShowReplaceAdminModal(true);
  };

  // Step 1 → 2: Send OTP to super admin
  const handleReplaceAdminSendSuperOtp = async () => {
    setReplaceAdminLoading(true);
    setReplaceAdminError('');
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('You are not logged in. Please refresh and try again.');

      const resp = await fetch(`${API_URL}/api/replace-admin/send-super-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryEmail: currentUser.email }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to send OTP.');

      setReplaceAdminSuperOtpToken(data.superOtpToken);
      setReplaceAdminMaskedSuperEmail(data.maskedSuperEmail || '');
      setReplaceAdminStep(2);
    } catch (err) {
      setReplaceAdminError(err.message);
    } finally {
      setReplaceAdminLoading(false);
    }
  };

  // Step 2 → 3: Verify super admin OTP
  const handleReplaceAdminVerifySuperOtp = async () => {
    if (replaceAdminSuperOtp.length !== 6) return;
    if (superOtpExpired || superOtpAttempts >= 3) return;
    setReplaceAdminLoading(true);
    setReplaceAdminError('');
    try {
      const resp = await fetch(`${API_URL}/api/replace-admin/verify-super-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ superOtpToken: replaceAdminSuperOtpToken, otp: replaceAdminSuperOtp }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const newAttempts = superOtpAttempts + 1;
        setSuperOtpAttempts(newAttempts);
        throw new Error(data.error || 'OTP verification failed.');
      }
      setReplaceAdminNewAdminToken(data.newAdminToken);
      setReplaceAdminStep(3);
    } catch (err) {
      setReplaceAdminError(err.message);
    } finally {
      setReplaceAdminLoading(false);
    }
  };

  // Resend super admin OTP (resets timer + attempts)
  const handleReplaceAdminResendSuperOtp = async () => {
    setSuperOtpAttempts(0);
    setReplaceAdminSuperOtp('');
    setReplaceAdminError('');
    setReplaceAdminLoading(true);
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('You are not logged in. Please refresh and try again.');
      const resp = await fetch(`${API_URL}/api/replace-admin/send-super-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryEmail: currentUser.email }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to resend OTP.');
      setReplaceAdminSuperOtpToken(data.superOtpToken);
      setReplaceAdminMaskedSuperEmail(data.maskedSuperEmail || '');
      setSuperOtpTimerKey(k => k + 1); // restarts the 60s timer via useEffect
    } catch (err) {
      setReplaceAdminError(err.message);
    } finally {
      setReplaceAdminLoading(false);
    }
  };

  // Step 3 → 4: Send OTP to selected teacher's email
  const handleReplaceAdminSendNewOtp = async () => {
    if (!replaceAdminSelectedTeacher) return;
    if (replaceAdminIsPrimary && !replaceAdminNewPhone.trim()) return;
    setReplaceAdminLoading(true);
    setReplaceAdminError('');
    try {
      const resp = await fetch(`${API_URL}/api/replace-admin/send-new-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAdminToken: replaceAdminNewAdminToken, newEmail: replaceAdminSelectedTeacher.email }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to send OTP to teacher email.');
      setReplaceAdminNewAdminOtpToken(data.newAdminOtpToken);
      setReplaceAdminNewEmail(replaceAdminSelectedTeacher.email); // store for display in step 4
      setReplaceAdminStep(4);
    } catch (err) {
      setReplaceAdminError(err.message);
    } finally {
      setReplaceAdminLoading(false);
    }
  };

  // Resend OTP to selected teacher (resets timer + attempts)
  const handleReplaceAdminResendNewOtp = async () => {
    setNewOtpAttempts(0);
    setReplaceAdminNewOtp('');
    setReplaceAdminError('');
    setReplaceAdminLoading(true);
    try {
      const email = replaceAdminSelectedTeacher?.email || replaceAdminNewEmail;
      const resp = await fetch(`${API_URL}/api/replace-admin/send-new-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAdminToken: replaceAdminNewAdminToken, newEmail: email }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to resend OTP.');
      setReplaceAdminNewAdminOtpToken(data.newAdminOtpToken);
      setNewOtpTimerKey(k => k + 1);
    } catch (err) {
      setReplaceAdminError(err.message);
    } finally {
      setReplaceAdminLoading(false);
    }
  };

  // Step 4 → 5: Complete replacement
  const handleReplaceAdminComplete = async () => {
    if (replaceAdminNewOtp.length !== 6) return;
    if (newOtpExpired || newOtpAttempts >= 3) return;
    setReplaceAdminLoading(true);
    setReplaceAdminError('');
    try {
      const resp = await fetch(`${API_URL}/api/replace-admin/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAdminOtpToken: replaceAdminNewAdminOtpToken,
          otp: replaceAdminNewOtp,
          newPhone: replaceAdminNewPhone,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const newAttempts = newOtpAttempts + 1;
        setNewOtpAttempts(newAttempts);
        throw new Error(data.error || 'Failed to complete admin replacement.');
      }
      setReplaceAdminStep(5);
      setTimeout(async () => {
        try { const auth = getAuth(); await auth.signOut(); } catch (_) {}
        window.location.href = '/admin/login';
      }, 3000);
    } catch (err) {
      setReplaceAdminError(err.message);
    } finally {
      setReplaceAdminLoading(false);
    }
  };
  // ─── END REPLACE ADMIN HANDLERS ────────────────────────────────────────────


  const exportToCSV = (data) => {
    setExportLoading(true);
    try {
      const csvRows = [];
      csvRows.push(['Date', 'Session Code', 'Lab/Room', 'Roll No', 'Name', 'Status', 'Practical Marks', 'Viva Marks', 'Total Marks']);



      data.forEach((sub) => {
        const dateToUse = groupedSessions[sub.session_code]?.date_obj || sub.joined_at;

        csvRows.push([
          formatDate(dateToUse),
          sub.session_code || '',
          sub.lab_number || '-',
          sub.roll_no || '',
          sub.name || '',
          sub.status || '',
          sub.scores?.practical || 0,
          sub.scores?.viva || 0,
          sub.scores?.total || 0
        ]);
      });

      const csvContent = csvRows.map(row => row.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = globalThis.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pws-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (error) {
      alert('Error exporting CSV: ' + error.message);
    } finally {
      setExportLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'admin_users', currentUser.uid));
        const adminData = snap.exists() ? snap.data() : null;
        const hasConsented = adminData?.legalConsent?.acceptedAt;
        setConsentStatus(hasConsented ? 'done' : 'needed');
        setIsSecondaryAdmin(!!adminData?.isSecondaryAdmin);
      } catch (err) {
        console.warn('[AdminDashboard] Consent check failed (non-fatal):', err?.code);
        setConsentStatus('done');
      }
    })();
  }, [currentUser]);

  // --- HANDLE CONSENT ACCEPT ---
  const handleConsentAccept = async () => {
    if (!consentPrivacy || !consentTerms || !currentUser) return;
    setConsentSaving(true);
    try {
      await updateDoc(doc(db, 'admin_users', currentUser.uid), {
        'legalConsent.termsAccepted':         true,
        'legalConsent.privacyPolicyAccepted': true,
        'legalConsent.dpaAccepted':           true,
        'legalConsent.versionAccepted':       'v1.2',
        'legalConsent.acceptedAt':            serverTimestamp(),
        'legalConsent.userAgent':             navigator.userAgent,
      });
      setConsentStatus('done');
    } catch (err) {
      console.error('Consent save error:', err);
      alert('Failed to save consent. Please try again.');
    } finally {
      setConsentSaving(false);
    }
  };


  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <div className="min-h-screen bg-gray-50">
        {/* ==================== CONSENT MODAL GATE ==================== */}
        {consentStatus === 'needed' && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(8px)', background: 'rgba(15,23,42,0.6)' }}
          >
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center text-2xl">
                  🛡️
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-800">One-Time Consent</h1>
                  <p className="text-gray-500 text-sm">Required to access your Admin Dashboard</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-1 flex-shrink-0">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 transition-colors"
                      checked={consentPrivacy}
                      onChange={(e) => setConsentPrivacy(e.target.checked)}
                    />
                  </div>
                  <span className="text-sm text-gray-600 leading-relaxed select-none group-hover:text-gray-800 transition-colors">
                    I acknowledge that I have read and agree to the{' '}
                    <a href="/privacy-policy" target="_blank" className="text-indigo-600 hover:underline font-medium" onClick={e => e.stopPropagation()}>
                      Privacy Policy
                    </a>. I consent to secure, temporary storage of my personal information for platform administration.
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-1 flex-shrink-0">
                    <input
                      type="checkbox"
                      className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 transition-colors"
                      checked={consentTerms}
                      onChange={(e) => setConsentTerms(e.target.checked)}
                    />
                  </div>
                  <span className="text-sm text-gray-600 leading-relaxed select-none group-hover:text-gray-800 transition-colors">
                    I agree to the{' '}
                    <a href="/terms-conditions" target="_blank" className="text-indigo-600 hover:underline font-medium" onClick={e => e.stopPropagation()}>
                      Terms & Conditions
                    </a>{' '}
                    and the Data Processing Agreement (DPA). I understand my role as an authorized administrator.
                  </span>
                </label>
              </div>

              <button
                onClick={handleConsentAccept}
                disabled={consentSaving || !consentPrivacy || !consentTerms}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {consentSaving ? 'Saving...' : 'I Agree & Continue'}
              </button>
            </div>
          </div>
        )}
        <Navbar />

        {/* ===== OTP POP-UP NOTIFICATIONS ===== */}
        {pendingOtpRequests
          .filter(req => !dismissedOtpIds.has(req.id))
          .map((req, index) => (
            <div
              key={req.id}
              id={`otp-popup-${req.id}`}
              className="fixed z-[200] flex items-start gap-4"
              style={{
                bottom: `${24 + index * 180}px`,
                right: '24px',
                animation: 'otpPopIn 0.4s cubic-bezier(.16,1,.3,1)'
              }}
            >
              <div
                className="rounded-2xl shadow-2xl border border-blue-200 overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 60%, #2563eb 100%)',
                  minWidth: '300px',
                  maxWidth: '340px',
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🔐</span>
                    <div>
                      <p className="text-white font-bold text-sm">Password Change OTP</p>
                      <p className="text-blue-200 text-xs">Teacher Request</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDismissedOtpIds(prev => new Set([...prev, req.id]))}
                    className="text-blue-300 hover:text-white transition"
                    aria-label="Dismiss OTP"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Teacher Email */}
                <div className="px-4 pb-2">
                  <p className="text-blue-200 text-xs font-semibold uppercase tracking-wide mb-1">From Teacher</p>
                  <p className="text-white text-sm font-medium truncate" title={req.teacherEmail}>
                    {req.teacherEmail}
                  </p>
                </div>

                {/* OTP Display */}
                <div className="mx-4 mb-4 mt-2 bg-white bg-opacity-10 rounded-xl p-4 text-center border border-white border-opacity-20">
                  <p className="text-blue-200 text-xs font-semibold uppercase tracking-widest mb-2">One-Time Password</p>
                  <div className="flex justify-center gap-2">
                    {req.otp?.split('').map((digit, i) => (
                      <span
                        key={i}
                        className="w-12 h-14 flex items-center justify-center text-3xl font-black text-white rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.15)', letterSpacing: '0.05em' }}
                      >
                        {digit}
                      </span>
                    ))}
                  </div>
                  <p className="text-blue-300 text-xs mt-3">⏱ Expires in 5 minutes</p>
                </div>

                {/* Instruction */}
                <div className="px-4 pb-4">
                  <p className="text-blue-200 text-xs text-center">
                    Share this OTP with the teacher to allow password change.
                  </p>
                </div>
              </div>
            </div>
          ))}

        <style>{`
          @keyframes otpPopIn {
            from { opacity: 0; transform: translateX(60px) scale(0.9); }
            to   { opacity: 1; transform: translateX(0) scale(1); }
          }
        `}</style>
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8 flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
            <div className="flex gap-3 items-center">
              <button
                onClick={handleDownloadExcel}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Excel of Passwords
              </button>

              {/* ⚙️ Settings Button with Dropdown */}
              <div className="relative" ref={settingsDropdownRef}>
                <button
                  id="settings-btn"
                  onClick={() => setShowSettingsDropdown(v => !v)}
                  className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-2 rounded-lg transition flex items-center gap-2"
                  title="Settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform duration-300 ${showSettingsDropdown ? 'rotate-45' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm font-medium">Settings</span>
                </button>

                {showSettingsDropdown && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Admin Settings</p>
                    </div>
                    {/* TASK 1.3 FIX: Only the primary admin (role === 'admin') can manage the
                        Secondary Admin password. Secondary admins must not see this option. */}
                    {userRole === 'admin' && !isSecondaryAdmin && !hasSecondaryPasswordSetup && (
                      <button
                        id="settings-set-2nd-admin-btn"
                        onClick={() => {
                          setShowSettingsDropdown(false);
                          setSecondAdminStep(1);
                          setSecondAdminPrimaryPw('');
                          setSecondAdminOtp('');
                          setSecondAdminNewPw('');
                          setSecondAdminConfirmPw('');
                          setSecondAdminError('');
                          setSecondAdminFlowToken('');
                          setSecondAdminOtpSentToken('');
                          setSecondAdminSetPwToken('');
                          setShowSecondAdminModal(true);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition flex items-center gap-3 group"
                      >
                        <span className="text-xl">🔐</span>
                        <div>
                          <p className="text-sm font-semibold text-gray-700 group-hover:text-blue-700">Set up password for 2nd Admin</p>
                          <p className="text-xs text-gray-400">Secure 4-step verification flow</p>
                        </div>
                      </button>
                    )}
                    {/* Delete Account / Replace Admin — available to both admin roles */}
                    {userRole === 'admin' && (
                      <button
                        id="settings-replace-admin-btn"
                        onClick={handleOpenReplaceAdminModal}
                        className="w-full text-left px-4 py-3 hover:bg-red-50 transition flex items-center gap-3 group border-t border-gray-100"
                      >
                        <span className="text-xl">🗑️</span>
                        <div>
                          <p className="text-sm font-semibold text-red-600 group-hover:text-red-700">Delete Account / Replace Admin</p>
                          <p className="text-xs text-gray-400">Transfer admin rights to a new user</p>
                        </div>
                      </button>
                    )}
                    <button
                      id="settings-get-help-btn"
                      onClick={() => {
                        setShowSettingsDropdown(false);
                        setIsHelpModalOpen(true);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-center gap-3 group border-t border-gray-100"

                    >
                      <span className="text-xl">❓</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-700 group-hover:text-gray-900">Get Help</p>
                        <p className="text-xs text-gray-400">Contact system administrator</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PENDING FACULTY TAGS */}
          {facultyEmails.filter(email => !teachers.some(t => t.email === email)).length > 0 && (
            <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="text-sm font-bold text-yellow-800 uppercase tracking-wide mb-3">Pending Faculty Registrations</h3>
              <div className="flex flex-wrap gap-2">
                {facultyEmails.filter(email => !teachers.some(t => t.email === email)).map((email, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setNewTeacher({ ...newTeacher, email: email });
                      setPendingFacultyModal(email);
                    }}
                    className="bg-white border border-yellow-400 text-yellow-700 hover:bg-yellow-100 hover:border-yellow-500 font-medium px-3 py-1.5 rounded-full text-sm shadow-sm transition-all"
                  >
                    + Provision: {email}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PENDING FACULTY MODAL */}
          {pendingFacultyModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-800">Provision Faculty Account</h2>
                  <button onClick={() => setPendingFacultyModal(null)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>

                <form onSubmit={handleAddTeacher} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email ID (Locked)</label>
                    <input type="email" value={newTeacher.email} readOnly className="w-full border border-gray-200 bg-gray-100 rounded-lg px-4 py-2 text-gray-500 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Full Name</label>
                    <input type="text" value={newTeacher.name} onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })} className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" required placeholder="e.g. John Doe" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <input type="text" value={newTeacher.department} onChange={(e) => setNewTeacher({ ...newTeacher, department: e.target.value })} className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" required placeholder="e.g. Computer Science" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Set Password</label>
                    <input type="password" value={newTeacher.password} onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })} className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none" required placeholder="Minimum 6 characters" minLength="6" />
                  </div>
                  <div className="pt-4">
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition shadow-md hover:shadow-lg">
                      Save & Provision Account
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {showAddForm && (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-bold mb-4">Create Teacher Account</h2>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold">Single Teacher</h3>
                  <form onSubmit={handleAddTeacher} className="grid md:grid-cols-2 gap-4">
                    <input type="text" placeholder="Full Name" value={newTeacher.name} onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })} className="border rounded-lg px-4 py-2" required />
                    <input type="email" placeholder="Email" value={newTeacher.email} onChange={(e) => setNewTeacher({ ...newTeacher, email: e.target.value })} className="border rounded-lg px-4 py-2" required />
                    <input type="password" placeholder="Password" value={newTeacher.password} onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })} className="border rounded-lg px-4 py-2" required />
                    <input type="text" placeholder="Department" value={newTeacher.department} onChange={(e) => setNewTeacher({ ...newTeacher, department: e.target.value })} className="border rounded-lg px-4 py-2" required />
                    <button type="submit" className="md:col-span-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition">Create Account</button>
                  </form>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Bulk Upload</h3>
                    {/* Eye button for column info */}
                    <button
                      onClick={() => setShowBulkInfo(!showBulkInfo)}
                      className="text-gray-500 hover:text-blue-600 transition relative group"
                      title="View required columns"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  </div>

                  {/* Bulk Info Panel */}
                  {showBulkInfo && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                      <p className="font-semibold text-blue-800 mb-2">Required Excel Columns:</p>
                      <div className="grid grid-cols-2 gap-1">
                        <span className="bg-white px-2 py-1 rounded border text-blue-700 font-mono text-xs">Full Name</span>
                        <span className="bg-white px-2 py-1 rounded border text-blue-700 font-mono text-xs">Email ID</span>
                        <span className="bg-white px-2 py-1 rounded border text-blue-700 font-mono text-xs">Password</span>
                        <span className="bg-white px-2 py-1 rounded border text-blue-700 font-mono text-xs">Department</span>
                      </div>
                      <p className="text-gray-500 mt-2 text-xs">All 4 columns are mandatory. Rows with missing data will be skipped.</p>
                    </div>
                  )}

                  <input type="file" accept=".xlsx" onChange={handleBulkUpload} className="border rounded-lg px-4 py-2 w-full" />
                  <div className="flex gap-2">
                    <button onClick={handleBulkCreate} disabled={bulkLoading || bulkTeachers.length === 0} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50 flex-1">{bulkLoading ? 'Creating...' : 'Create Accounts from Excel'}</button>
                    <button
                      onClick={handleDownloadTemplate}
                      className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg transition flex items-center gap-1 whitespace-nowrap"
                      title="Download blank template Excel"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Template
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TEACHERS SECTION */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
              <h2 className="text-2xl font-bold">Teachers</h2>

              <div className="flex gap-2 w-full md:w-auto">
                <input
                  type="text"
                  placeholder="Search Name, Dept or Email..."
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  className="border rounded-lg px-4 py-2 w-full md:w-64"
                />
              </div>
            </div>

            {loading ? <div className="text-center py-8">Loading...</div> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Email</th>
                      <th className="text-left p-2">Department</th>
                      <th className="text-left p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTeachers.length === 0 ? (
                      <tr><td colSpan="4" className="p-4 text-center text-gray-500">No teachers found matching "{teacherSearch}"</td></tr>
                    ) : (
                      filteredTeachers.map((teacher) => (
                        <tr key={teacher.id} className="border-b hover:bg-gray-50">
                          <td className="p-2">{teacher.name}</td>
                          <td className="p-2">{teacher.email}</td>
                          <td className="p-2">{teacher.department}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleEditTeacher(teacher)} className="text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ===== ALL STUDENT SUBMISSIONS SECTION ===== */}
          <div className="bg-white rounded-xl shadow-md p-6">

            {/* Section Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">All Student Submissions</h2>
                <p className="text-sm text-gray-400 mt-0.5">View and export results by session</p>
              </div>

              {/* Controls — only visible in grid view */}
              {!selectedSessionKey && (
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                  {/* Exam Type Filter Dropdown */}
                  <div className="relative">
                    <select
                      id="exam-type-filter"
                      value={examTypeFilter}
                      onChange={(e) => setExamTypeFilter(e.target.value)}
                      className="appearance-none w-full sm:w-52 border border-gray-200 rounded-lg pl-4 pr-9 py-2 text-sm font-medium text-gray-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none cursor-pointer shadow-sm transition"
                    >
                      <option value="all">All Exams</option>
                      <option value="practical">Practical Exams</option>
                      <option value="internal">Internal Exams</option>
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </div>

                  {/* Session Search */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Search sessions..."
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                      className="w-full sm:w-56 pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition shadow-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── SESSION GRID VIEW ────────────────────────────────── */}
            {!selectedSessionKey ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredSessions.length === 0 ? (
                  <div className="col-span-4 py-16 text-center">
                    <div className="text-4xl mb-3">📭</div>
                    <p className="text-gray-500 font-medium">
                      {Object.keys(groupedSessions).length === 0
                        ? 'No submissions found yet.'
                        : 'No sessions match your current filter.'}
                    </p>
                  </div>
                ) : (
                  filteredSessions.map((session) => {
                    const isPractical = session.exam_type !== 'internal';
                    return (
                      <div
                        key={session.session_code}
                        onClick={() => {
                          setSelectedSessionKey(session.session_code);
                          setSubmissionSearch('');
                        }}
                        className="border rounded-xl p-5 cursor-pointer hover:shadow-lg transition-all bg-gray-50 hover:bg-white group relative"
                        style={{
                          borderColor: isPractical ? '#bfdbfe' : '#ddd6fe',
                        }}
                      >
                        {/* Card Header: Session ID + Delete */}
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Session ID</p>
                            <span className="font-mono text-base font-bold text-gray-800">{session.session_code}</span>
                          </div>
                          <button
                            onClick={(e) => confirmDeleteSession(e, session.session_code)}
                            className="text-gray-300 hover:text-red-500 p-1 rounded-full transition"
                            title="Delete Session History"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>

                        {/* Tag */}
                        <div className="mb-3">
                          <span
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              isPractical
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}
                          >
                            {isPractical ? '🔬 Practical' : '📝 Internal'}
                          </span>
                        </div>

                        {/* Card Metadata — ordered as per spec */}
                        <div className="space-y-1.5 text-sm text-gray-600">
                          {session.created_by && (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">👤</span>
                              <span className="truncate text-xs" title={session.created_by}>{session.created_by}</span>
                            </div>
                          )}
                          {session.subject_name && (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">📚</span>
                              <span className="truncate text-xs" title={session.subject_name}>{session.subject_name}</span>
                            </div>
                          )}
                          {session.student_department && (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">🏛️</span>
                              <span className="truncate text-xs" title={session.student_department}>{session.student_department}</span>
                            </div>
                          )}
                          {session.student_semester && (
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400">🎓</span>
                              <span className="text-xs">{formatSemester(session.student_semester)}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">👥</span>
                            <span><strong className="text-gray-700">{session.count}</strong> Students</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">📅</span>
                            <span>{formatDate(session.exam_date_obj || session.date_obj)}</span>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-gray-100 text-right">
                          <span className={`text-xs font-semibold group-hover:underline ${
                            isPractical ? 'text-blue-500' : 'text-purple-500'
                          }`}>
                            View Details →
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* ── SESSION DETAIL VIEW ────────────────────────────── */
              <div>
                {/* Back button + session title bar */}
                <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-100">
                  <button
                    onClick={() => {
                      setSelectedSessionKey(null);
                      setSubmissionSearch('');
                    }}
                    className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                  </button>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Session: {selectedSessionKey}</h3>
                    <p className="text-xs text-gray-400">
                      {groupedSessions[selectedSessionKey]?.exam_type === 'internal' ? 'Internal Exam' : 'Practical Exam'}
                    </p>
                  </div>
                </div>

                {/* Conditional Table Rendering */}
                {groupedSessions[selectedSessionKey]?.exam_type === 'internal' ? (
                  <InternalSessionTable
                    session={groupedSessions[selectedSessionKey]}
                    students={getFilteredStudentsForSession()}
                    search={submissionSearch}
                    onSearchChange={setSubmissionSearch}
                  />
                ) : (
                  <PracticalSessionTable
                    session={groupedSessions[selectedSessionKey]}
                    students={getFilteredStudentsForSession()}
                    search={submissionSearch}
                    onSearchChange={setSubmissionSearch}
                  />
                )}
              </div>
            )}
          </div>

          {/* SESSION DELETE MODAL */}
          {sessionToDelete && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Session History?</h3>
                <p className="text-sm text-gray-500 mb-6">
                  Are you sure you want to delete session <strong>{sessionToDelete}</strong>? <br />
                  This will remove all student records and exam data for this session.
                  <br /><br />
                  Please type <strong>{sessionToDelete}</strong> to confirm.
                </p>
                <input
                  type="text"
                  value={confirmDeleteText}
                  onChange={(e) => setConfirmDeleteText(e.target.value)}
                  placeholder="Type session name"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 mb-6 focus:ring-2 focus:ring-red-500 focus:outline-none"
                  autoFocus
                />
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => setSessionToDelete(null)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteSession}
                    disabled={isDeleting || confirmDeleteText !== sessionToDelete}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DOWNLOAD EXCEL KEY MODAL */}
          {showDownloadKeyModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
                <div className="text-center mb-4">
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-purple-100 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Admin Verification Required</h3>
                  <p className="text-sm text-gray-500">Enter your admin account password to download the password Excel sheet.</p>
                </div>

                {downloadKeyError && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4 text-sm">
                    {downloadKeyError}
                  </div>
                )}

                <input
                  type="password"
                  value={downloadKey}
                  onChange={(e) => { setDownloadKey(e.target.value); setDownloadKeyError(''); }}
                  placeholder="Enter Password"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleDownloadKeySubmit(); }}
                  disabled={exportLoading}
                />

                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowDownloadKeyModal(false); setDownloadKey(''); setDownloadKeyError(''); }}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                    disabled={exportLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDownloadKeySubmit}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium flex items-center justify-center gap-2"
                    disabled={exportLoading}
                  >
                    {exportLoading ? 'Verifying...' : 'Download'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* EDIT TEACHER MODAL */}
          {editingTeacher && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="text-center mb-4">
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Edit Teacher</h3>
                  <p className="text-sm text-gray-500">Update the teacher's name and department. Email cannot be changed.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      type="text"
                      value={editingTeacher.name}
                      onChange={(e) => setEditingTeacher({ ...editingTeacher, name: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="Full Name"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <input
                      type="text"
                      value={editingTeacher.department}
                      onChange={(e) => setEditingTeacher({ ...editingTeacher, department: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="Department"
                    />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setEditingTeacher(null)}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECONDARY ADMIN SETUP MODAL (4-Step Secure Flow)          */}
          {/* ========================================================= */}
          {showSecondAdminModal && (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[100]" style={{ backdropFilter: 'blur(4px)' }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

                {/* Modal Header */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-white bg-opacity-10 rounded-lg flex items-center justify-center text-lg">🔐</div>
                    <div>
                      <h3 className="text-white font-bold text-base">Set Up 2nd Admin Password</h3>
                      <div className="flex items-center gap-1 mt-0.5">
                        {[1, 2, 3, 4].map(s => (
                          <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${secondAdminStep > s ? 'w-6 bg-green-400' :
                              secondAdminStep === s ? 'w-6 bg-blue-400' :
                                'w-3 bg-white bg-opacity-20'
                            }`} />
                        ))}
                        <span className="text-white text-opacity-60 text-xs ml-1">Step {Math.min(secondAdminStep, 4)}/4</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowSecondAdminModal(false)}
                    className="text-white text-opacity-60 hover:text-opacity-100 transition"
                    disabled={secondAdminLoading}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="px-6 py-5">

                  {/* Error Banner */}
                  {secondAdminError && (
                    <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
                      <span className="mt-0.5">⚠</span>
                      <span>{secondAdminError}</span>
                    </div>
                  )}

                  {/* ── STEP 1: Primary Admin Password Verification ── */}
                  {secondAdminStep === 1 && (
                    <div>
                      <p className="text-gray-500 text-sm mb-5">
                        To begin, confirm your identity by entering your current admin password.
                      </p>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your Admin Password</label>
                      <input
                        id="second-admin-primary-pw"
                        type="password"
                        value={secondAdminPrimaryPw}
                        onChange={e => { setSecondAdminPrimaryPw(e.target.value); setSecondAdminError(''); }}
                        className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-slate-500 focus:outline-none text-sm"
                        placeholder="Enter your current password"
                        autoFocus
                        disabled={secondAdminLoading}
                        onKeyDown={e => { if (e.key === 'Enter') handleSecondAdminStep1(); }}
                      />
                      <div className="flex gap-3 mt-5">
                        <button onClick={() => setShowSecondAdminModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium" disabled={secondAdminLoading}>Cancel</button>
                        <button
                          id="second-admin-step1-btn"
                          onClick={handleSecondAdminStep1}
                          disabled={secondAdminLoading || !secondAdminPrimaryPw}
                          className="flex-1 px-4 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {secondAdminLoading ? <span className="animate-spin">⏳</span> : null}
                          {secondAdminLoading ? 'Verifying...' : 'Verify & Continue →'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 2: OTP Dispatched — Prompt to Send ── */}
                  {secondAdminStep === 2 && (
                    <div>
                      <div className="text-center py-3 mb-5">
                        <div className="text-4xl mb-3">✅</div>
                        <h4 className="font-bold text-gray-800 text-base">Identity Confirmed</h4>
                        <p className="text-gray-500 text-sm mt-2">
                          Click below to send a 60-second OTP to the Secondary Admin's registered email.
                          They must share it with you.
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => { setSecondAdminStep(1); setSecondAdminError(''); }} className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium" disabled={secondAdminLoading}>← Back</button>
                        <button
                          id="second-admin-send-otp-btn"
                          onClick={handleSecondAdminSendOtp}
                          disabled={secondAdminLoading}
                          className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {secondAdminLoading ? <span className="animate-spin">⏳</span> : '📧'}
                          {secondAdminLoading ? 'Sending OTP...' : 'Send OTP to 2nd Admin'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 3: OTP Input ── */}
                  {secondAdminStep === 3 && (
                    <div>
                      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5 text-sm">
                        <p className="font-semibold text-blue-700">📧 OTP sent to:</p>
                        <p className="text-blue-600 font-mono text-xs mt-0.5">{secondAdminMaskedEmail}</p>
                        <p className="text-blue-500 text-xs mt-1">Ask the 2nd Admin to share the code they received. It expires in 60 seconds.</p>
                      </div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">6-Digit OTP</label>
                      <input
                        id="second-admin-otp-input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={secondAdminOtp}
                        onChange={e => { setSecondAdminOtp(e.target.value.replace(/\D/g, '')); setSecondAdminError(''); }}
                        className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none text-center text-2xl font-bold tracking-[0.5em] text-gray-800"
                        placeholder="------"
                        autoFocus
                        disabled={secondAdminLoading}
                        onKeyDown={e => { if (e.key === 'Enter') handleSecondAdminVerifyOtp(); }}
                      />
                      <div className="flex gap-3 mt-5">
                        <button
                          onClick={handleSecondAdminSendOtp}
                          disabled={secondAdminLoading}
                          className="px-3 py-2.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition text-xs font-medium"
                          title="Resend OTP"
                        >🔁 Resend</button>
                        <button
                          id="second-admin-verify-otp-btn"
                          onClick={handleSecondAdminVerifyOtp}
                          disabled={secondAdminLoading || secondAdminOtp.length !== 6}
                          className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {secondAdminLoading ? <span className="animate-spin">⏳</span> : null}
                          {secondAdminLoading ? 'Verifying...' : 'Verify OTP →'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 4: Set New Password ── */}
                  {secondAdminStep === 4 && (
                    <div>
                      <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 mb-5 text-sm">
                        <p className="font-semibold text-green-700">✅ OTP verified. Set the new password for the 2nd Admin.</p>
                        <p className="text-green-600 text-xs mt-0.5 font-mono">{secondAdminMaskedEmail}</p>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">New Password</label>
                          <input
                            id="second-admin-new-pw"
                            type="password"
                            value={secondAdminNewPw}
                            onChange={e => { setSecondAdminNewPw(e.target.value); setSecondAdminError(''); }}
                            className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm"
                            placeholder="Minimum 8 characters"
                            autoFocus
                            disabled={secondAdminLoading}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Confirm Password</label>
                          <input
                            id="second-admin-confirm-pw"
                            type="password"
                            value={secondAdminConfirmPw}
                            onChange={e => { setSecondAdminConfirmPw(e.target.value); setSecondAdminError(''); }}
                            className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 focus:outline-none text-sm"
                            placeholder="Re-enter new password"
                            disabled={secondAdminLoading}
                            onKeyDown={e => { if (e.key === 'Enter') handleSecondAdminSetPassword(); }}
                          />
                        </div>
                        {secondAdminNewPw && secondAdminConfirmPw && secondAdminNewPw !== secondAdminConfirmPw && (
                          <p className="text-red-500 text-xs">⚠ Passwords do not match.</p>
                        )}
                      </div>
                      <div className="flex gap-3 mt-5">
                        <button onClick={() => setShowSecondAdminModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium" disabled={secondAdminLoading}>Cancel</button>
                        <button
                          id="second-admin-set-pw-btn"
                          onClick={handleSecondAdminSetPassword}
                          disabled={secondAdminLoading || !secondAdminNewPw || !secondAdminConfirmPw || secondAdminNewPw !== secondAdminConfirmPw}
                          className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {secondAdminLoading ? <span className="animate-spin">⏳</span> : '🔑'}
                          {secondAdminLoading ? 'Setting Password...' : 'Set Password'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 5: Success ── */}
                  {secondAdminStep === 5 && (
                    <div className="text-center py-4">
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✅</div>
                      <h4 className="font-bold text-gray-800 text-lg">Password Set Successfully!</h4>
                      <p className="text-gray-500 text-sm mt-2 mb-1">
                        The Secondary Admin can now log in at
                      </p>
                      <p className="font-mono text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 inline-block">/admin/login</p>
                      <p className="text-gray-400 text-xs mt-3">with their registered email and the new password.</p>
                      <button
                        onClick={() => setShowSecondAdminModal(false)}
                        className="mt-6 w-full px-4 py-2.5 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition text-sm font-semibold"
                      >
                        Done
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* REPLACE ADMIN MODAL (5-Step Secure Flow)                          */}
          {/* ================================================================= */}
          {showReplaceAdminModal && (

            <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[110]" style={{ backdropFilter: 'blur(6px)' }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

                {/* Modal Header */}
                <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 60%, #b91c1c 100%)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-white bg-opacity-15 rounded-lg flex items-center justify-center text-lg">🗑️</div>
                    <div>
                      <h3 className="text-white font-bold text-base">Delete Account / Replace Admin</h3>
                      {replaceAdminStep < 5 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {[1, 2, 3, 4].map(s => (
                            <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${replaceAdminStep > s ? 'w-6 bg-green-400' : replaceAdminStep === s ? 'w-6 bg-yellow-300' : 'w-3 bg-white bg-opacity-20'}`} />
                          ))}
                          <span className="text-white text-opacity-60 text-xs ml-1">Step {Math.min(replaceAdminStep, 4)}/4</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {replaceAdminStep < 5 && (
                    <button
                      onClick={() => { resetReplaceAdminState(); setShowReplaceAdminModal(false); }}
                      className="text-white text-opacity-60 hover:text-opacity-100 transition"
                      disabled={replaceAdminLoading}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="px-6 py-5">

                  {/* Error Banner */}
                  {replaceAdminError && (
                    <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
                      <span className="mt-0.5">⚠</span>
                      <span>{replaceAdminError}</span>
                    </div>
                  )}

                  {/* ── STEP 1: Introduction + Send OTP to Super Admin ── */}
                  {replaceAdminStep === 1 && (
                    <div>
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
                        <p className="text-red-800 text-sm font-semibold mb-1">⚠️ This action is irreversible</p>
                        <p className="text-red-700 text-xs leading-relaxed">
                          Replacing the admin will <strong>permanently delete your login credentials</strong> from the system.
                          All teachers, students, and exam data will remain intact under the new admin.
                        </p>
                      </div>
                      <p className="text-gray-600 text-sm mb-5">
                        To proceed, we'll send a One-Time Password to <strong>NextSolves</strong>.
                        They must approve this action by sharing the OTP with you.
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => { resetReplaceAdminState(); setShowReplaceAdminModal(false); }}
                          className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
                          disabled={replaceAdminLoading}
                        >
                          Cancel
                        </button>
                        <button
                          id="replace-admin-send-super-otp-btn"
                          onClick={handleReplaceAdminSendSuperOtp}
                          disabled={replaceAdminLoading}
                          className="flex-1 px-4 py-2.5 bg-red-700 text-white rounded-lg hover:bg-red-800 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {replaceAdminLoading ? <span className="animate-spin">⏳</span> : '📧'}
                          {replaceAdminLoading ? 'Sending...' : 'Send OTP to NextSolves'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 2: Enter Super Admin OTP ── */}
                  {replaceAdminStep === 2 && (
                    <div>
                      {/* Header + timer */}
                      <div className="text-center mb-4">
                        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-2 text-2xl">📬</div>
                        <p className="text-gray-700 text-sm font-medium">OTP sent to NextSolves</p>
                        {replaceAdminMaskedSuperEmail && (
                          <p className="text-gray-400 text-xs mt-0.5 font-mono">{replaceAdminMaskedSuperEmail}</p>
                        )}
                      </div>

                      {/* Timer + attempts row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                          superOtpExpired ? 'bg-red-100 text-red-700' :
                          superOtpTimer <= 10 ? 'bg-orange-100 text-orange-700 animate-pulse' :
                          'bg-green-100 text-green-700'
                        }`}>
                          <span>⏱</span>
                          {superOtpExpired ? 'Expired' : `${superOtpTimer}s`}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Attempts:</span>
                          {[1,2,3].map(i => (
                            <div key={i} className={`w-2.5 h-2.5 rounded-full border ${
                              superOtpAttempts >= i ? 'bg-red-500 border-red-500' : 'bg-gray-200 border-gray-300'
                            }`} />
                          ))}
                        </div>
                      </div>

                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">NextSolves OTP</label>
                      <input
                        id="replace-admin-super-otp-input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={replaceAdminSuperOtp}
                        onChange={e => { setReplaceAdminSuperOtp(e.target.value.replace(/\D/g, '')); setReplaceAdminError(''); }}
                        className={`w-full border rounded-lg px-4 py-3 text-center text-2xl font-bold tracking-widest mb-4 focus:outline-none transition ${
                          superOtpExpired || superOtpAttempts >= 3
                            ? 'border-red-200 bg-red-50 text-red-300 cursor-not-allowed'
                            : 'border-gray-300 focus:ring-2 focus:ring-red-500'
                        }`}
                        placeholder="000000"
                        disabled={replaceAdminLoading || superOtpExpired || superOtpAttempts >= 3}
                        onKeyDown={e => { if (e.key === 'Enter') handleReplaceAdminVerifySuperOtp(); }}
                        autoFocus
                      />

                      {/* Resend banner — shown when expired OR 3 wrong attempts */}
                      {(superOtpExpired || superOtpAttempts >= 3) && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-4 text-center">
                          <p className="text-orange-700 text-xs mb-2">
                            {superOtpAttempts >= 3 ? '❌ 3 incorrect attempts used.' : '⏰ OTP has expired.'}
                            {' '}Request a new OTP to continue.
                          </p>
                          <button
                            id="replace-admin-resend-super-otp-btn"
                            onClick={handleReplaceAdminResendSuperOtp}
                            disabled={replaceAdminLoading}
                            className="text-sm font-semibold text-orange-700 underline hover:text-orange-900 disabled:opacity-50"
                          >
                            {replaceAdminLoading ? '⏳ Sending...' : '🔄 Resend OTP to NextSolves'}
                          </button>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={() => { resetReplaceAdminState(); setShowReplaceAdminModal(false); }}
                          className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
                          disabled={replaceAdminLoading}
                        >
                          Cancel
                        </button>
                        <button
                          id="replace-admin-verify-super-otp-btn"
                          onClick={handleReplaceAdminVerifySuperOtp}
                          disabled={replaceAdminLoading || replaceAdminSuperOtp.length !== 6 || superOtpExpired || superOtpAttempts >= 3}
                          className="flex-1 px-4 py-2.5 bg-red-700 text-white rounded-lg hover:bg-red-800 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {replaceAdminLoading ? <span className="animate-spin">⏳</span> : null}
                          {replaceAdminLoading ? 'Verifying...' : 'Verify OTP →'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 3: Teacher Picker + Optional Phone ── */}
                  {replaceAdminStep === 3 && (
                    <div>
                      <p className="text-gray-500 text-sm mb-4">
                        ✅ NextSolves approved. Select a teacher from your college to become the new {replaceAdminIsPrimary ? 'Primary' : 'Secondary'} Admin.
                      </p>
                      <div className="space-y-4">

                        {/* Teacher Picker */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                            Select Teacher <span className="text-red-500">*</span>
                          </label>

                          {replaceAdminSelectedTeacher ? (
                            /* Selected teacher chip */
                            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-base font-bold text-red-700 shrink-0">
                                {replaceAdminSelectedTeacher.name?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800 truncate">{replaceAdminSelectedTeacher.name}</p>
                                <p className="text-xs text-gray-500 truncate">{replaceAdminSelectedTeacher.email}</p>
                                {replaceAdminSelectedTeacher.department && (
                                  <span className="inline-block text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full mt-0.5">{replaceAdminSelectedTeacher.department}</span>
                                )}
                              </div>
                              <button
                                onClick={() => { setReplaceAdminSelectedTeacher(null); setReplaceAdminTeacherSearch(''); setReplaceAdminError(''); }}
                                disabled={replaceAdminLoading}
                                className="text-gray-300 hover:text-red-500 transition text-lg leading-none"
                                title="Clear selection"
                              >✕</button>
                            </div>
                          ) : (
                            /* Search input + dropdown */
                            <div className="relative" ref={replaceAdminPickerRef}>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                                <input
                                  id="replace-admin-teacher-search"
                                  type="text"
                                  value={replaceAdminTeacherSearch}
                                  onChange={e => { setReplaceAdminTeacherSearch(e.target.value); setReplaceAdminPickerOpen(true); setReplaceAdminError(''); }}
                                  onFocus={() => setReplaceAdminPickerOpen(true)}
                                  placeholder="Type name, email or department..."
                                  className="w-full border border-gray-300 rounded-lg pl-9 pr-4 py-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none text-sm"
                                  disabled={replaceAdminLoading}
                                  autoFocus
                                />
                              </div>
                              {replaceAdminPickerOpen && (
                                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl z-20 max-h-52 overflow-y-auto mt-1">
                                  {(() => {
                                    const term = replaceAdminTeacherSearch.toLowerCase();
                                    const filtered = teachers.filter(t =>
                                      !replaceAdminExcludeEmails.has((t.email || '').toLowerCase()) &&
                                      (
                                        (t.name?.toLowerCase() || '').includes(term) ||
                                        (t.email?.toLowerCase() || '').includes(term) ||
                                        (t.department?.toLowerCase() || '').includes(term)
                                      )
                                    );
                                    if (filtered.length === 0) {
                                      return <div className="px-4 py-4 text-sm text-gray-400 text-center">No teachers found</div>;
                                    }
                                    return filtered.map(t => (
                                      <button
                                        key={t.id}
                                        onClick={() => { setReplaceAdminSelectedTeacher(t); setReplaceAdminPickerOpen(false); setReplaceAdminTeacherSearch(''); setReplaceAdminError(''); }}
                                        className="w-full text-left px-4 py-2.5 hover:bg-red-50 transition border-b border-gray-100 last:border-0 flex items-center gap-3"
                                      >
                                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                                          {t.name?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <p className="text-xs text-gray-500 truncate">{t.email}</p>
                                            {t.department && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">{t.department}</span>}
                                          </div>
                                        </div>
                                      </button>
                                    ));
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Phone number — required for primary admin only */}
                        {replaceAdminIsPrimary && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                              Phone Number <span className="text-red-500">*</span>
                            </label>
                            <input
                              id="replace-admin-new-phone"
                              type="tel"
                              inputMode="numeric"
                              maxLength={10}
                              value={replaceAdminNewPhone}
                              onChange={e => { setReplaceAdminNewPhone(sanitizePhone(e.target.value)); setReplaceAdminError(''); }}
                              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none text-sm"
                              placeholder="10-digit phone number"
                              disabled={replaceAdminLoading}
                            />
                            <p className="text-xs text-gray-400 mt-1">
                              {replaceAdminNewPhone.length > 0 && replaceAdminNewPhone.length < 10
                                ? <span className="text-red-500">Enter exactly 10 digits ({10 - replaceAdminNewPhone.length} more needed)</span>
                                : 'Required for primary admin contact details (exactly 10 digits).'}
                            </p>
                          </div>
                        )}

                      </div>

                      <div className="flex gap-3 mt-5">
                        <button
                          onClick={() => { resetReplaceAdminState(); setShowReplaceAdminModal(false); }}
                          className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
                          disabled={replaceAdminLoading}
                        >
                          Cancel
                        </button>
                        <button
                          id="replace-admin-send-new-otp-btn"
                          onClick={handleReplaceAdminSendNewOtp}
                          disabled={
                            replaceAdminLoading ||
                            !replaceAdminSelectedTeacher ||
                            (replaceAdminIsPrimary && replaceAdminNewPhone.length !== 10)
                          }
                          className="flex-1 px-4 py-2.5 bg-red-700 text-white rounded-lg hover:bg-red-800 transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {replaceAdminLoading ? <span className="animate-spin">⏳</span> : '📧'}
                          {replaceAdminLoading ? 'Sending OTP...' : 'Send OTP to Teacher →'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 4: Verify New Admin OTP ── */}
                  {replaceAdminStep === 4 && (
                    <div>
                      {/* Header */}
                      <div className="text-center mb-4">
                        <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2 text-2xl">📨</div>
                        <p className="text-gray-700 text-sm font-medium">OTP sent to new admin email</p>
                        <p className="text-gray-400 text-xs font-mono mt-0.5">{maskEmail(replaceAdminNewEmail)}</p>
                      </div>

                      {/* Timer + attempts row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                          newOtpExpired ? 'bg-red-100 text-red-700' :
                          newOtpTimer <= 10 ? 'bg-orange-100 text-orange-700 animate-pulse' :
                          'bg-green-100 text-green-700'
                        }`}>
                          <span>⏱</span>
                          {newOtpExpired ? 'Expired' : `${newOtpTimer}s`}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Attempts:</span>
                          {[1,2,3].map(i => (
                            <div key={i} className={`w-2.5 h-2.5 rounded-full border ${
                              newOtpAttempts >= i ? 'bg-red-500 border-red-500' : 'bg-gray-200 border-gray-300'
                            }`} />
                          ))}
                        </div>
                      </div>

                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">New Admin Email OTP</label>
                      <input
                        id="replace-admin-new-otp-input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={replaceAdminNewOtp}
                        onChange={e => { setReplaceAdminNewOtp(e.target.value.replace(/\D/g, '')); setReplaceAdminError(''); }}
                        className={`w-full border rounded-lg px-4 py-3 text-center text-2xl font-bold tracking-widest mb-4 focus:outline-none transition ${
                          newOtpExpired || newOtpAttempts >= 3
                            ? 'border-red-200 bg-red-50 text-red-300 cursor-not-allowed'
                            : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                        }`}
                        placeholder="000000"
                        disabled={replaceAdminLoading || newOtpExpired || newOtpAttempts >= 3}
                        onKeyDown={e => { if (e.key === 'Enter') handleReplaceAdminComplete(); }}
                        autoFocus
                      />

                      {/* Resend banner */}
                      {(newOtpExpired || newOtpAttempts >= 3) && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-4 text-center">
                          <p className="text-orange-700 text-xs mb-2">
                            {newOtpAttempts >= 3 ? '❌ 3 incorrect attempts used.' : '⏰ OTP has expired.'}
                            {' '}Request a new OTP to continue.
                          </p>
                          <button
                            id="replace-admin-resend-new-otp-btn"
                            onClick={handleReplaceAdminResendNewOtp}
                            disabled={replaceAdminLoading}
                            className="text-sm font-semibold text-orange-700 underline hover:text-orange-900 disabled:opacity-50"
                          >
                            {replaceAdminLoading ? '⏳ Sending...' : '🔄 Resend OTP to New Email'}
                          </button>
                        </div>
                      )}

                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
                        <p className="text-amber-800 text-xs font-semibold">⚠️ Final warning</p>
                        <p className="text-amber-700 text-xs mt-1">
                          Clicking <strong>"Complete Replacement"</strong> will immediately delete your account and sign you out. This cannot be undone.
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => { resetReplaceAdminState(); setShowReplaceAdminModal(false); }}
                          className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
                          disabled={replaceAdminLoading}
                        >
                          Cancel
                        </button>
                        <button
                          id="replace-admin-complete-btn"
                          onClick={handleReplaceAdminComplete}
                          disabled={replaceAdminLoading || replaceAdminNewOtp.length !== 6 || newOtpExpired || newOtpAttempts >= 3}
                          className="flex-1 px-4 py-2.5 text-white rounded-lg transition text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                          style={{ background: 'linear-gradient(135deg, #7f1d1d, #b91c1c)' }}
                        >
                          {replaceAdminLoading ? <span className="animate-spin">⏳</span> : '✅'}
                          {replaceAdminLoading ? 'Processing...' : 'Complete Replacement'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── STEP 5: Success ── */}
                  {replaceAdminStep === 5 && (
                    <div className="text-center py-4">
                      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl">✅</div>
                      <h4 className="font-bold text-gray-800 text-lg">Admin Changed Successfully!</h4>
                      <p className="text-gray-500 text-sm mt-2">
                        The admin account has been transferred to <strong>{replaceAdminNewEmail}</strong>.
                      </p>
                      <p className="text-gray-400 text-xs mt-3">
                        All teacher, student, and exam data remains intact. You will be signed out in a moment...
                      </p>
                      <div className="mt-5 flex justify-center">
                        <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                          <span className="animate-spin">⏳</span>
                          Signing out...
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

        </div>
        <GetHelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />

      </div>
    </ProtectedRoute>
  );
};

export default AdminDashboard;