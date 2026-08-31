import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, getDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../../firebase';
import KeyGenerator from './KeyGenerator';
import ExcelJS from 'exceljs';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const SuperAdminDashboard = () => {
  const navigate = useNavigate();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    collegeName: '',
    collegeCode: '',
    adminEmail: '',
    secondaryEmail: '',
    adminPhone: '',
    facultyLimit: 2,
    validUntil: '',
    paymentTxnId: '',
    facultyEmails: [],
  });
  const [savingKey, setSavingKey] = useState(false);
  // ── Delete state ──
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null); // key object to delete
  const [deletingKeyId, setDeletingKeyId] = useState(null);

  // ── Edit Roster Merge state ──
  const [editRosterFile, setEditRosterFile] = useState(null);
  const [editRosterFileError, setEditRosterFileError] = useState('');
  const [editRosterPreview, setEditRosterPreview] = useState(null);
  // { existingCount, newCount, skippedCount, totalAfter, sampleRolls }
  const [editRosterUploading, setEditRosterUploading] = useState(false);
  const [editRosterUploadProgress, setEditRosterUploadProgress] = useState('');
  const editRosterInputRef = useRef(null);

  // ── Roster download state (view mode) ──
  const [downloadingRoster, setDownloadingRoster] = useState(false);


  // Helper to calculate days left
  const calculateDaysLeft = (validUntilDate) => {
    const valid = new Date(validUntilDate);
    const now = new Date();
    return Math.ceil((valid - now) / (1000 * 60 * 60 * 24));
  };

  // Effect to handle automatic expiration reminders
  useEffect(() => {
    if (!keys || keys.length === 0) return;

    keys.forEach(async (k) => {
      if (k.validUntil) {
        const daysLeft = calculateDaysLeft(k.validUntil);
        // Trigger email if < 10 days, hasn't been sent, and key isn't already expired/deleted
        if (daysLeft > 0 && daysLeft < 10 && !k.reminderSent) {
          try {
            console.log(`Triggering reminder for ${k.collegeName}`);
            // Optimistically update to prevent multiple calls while fetch is pending
            const keyRef = doc(db, 'product_keys', k.id);
            await updateDoc(keyRef, { reminderSent: true });

            const response = await fetch(`${API_URL}/api/send-reminder`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: k.adminEmail, collegeName: k.collegeName, daysLeft })
            });

            if (!response.ok) {
              // Rollback if failed
              await updateDoc(keyRef, { reminderSent: false });
              console.error('Failed to send reminder via backend');
            }
          } catch (err) {
            console.error('Error auto-sending reminder:', err);
          }
        }
      }
    });
  }, [keys]);

  useEffect(() => {
    // ── SECURITY FIX A-2: Verify Firebase Auth session + super_admins Firestore doc ──
    // sessionStorage alone is client-controllable and NOT a security boundary.
    // We now perform a real server-side identity check on every dashboard load.
    let unsubscribeSnapshot = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // Not logged in — boot to login page
        navigate('/super_admin/LIO-73-23/2372/SYSTEM');
        return;
      }

      try {
        // Verify presence in the super_admins collection (server-enforced by Firestore rules)
        const saDoc = await getDoc(doc(db, 'super_admins', user.uid));
        if (!saDoc.exists()) {
          // Authenticated but NOT a super admin — sign out and redirect
          await auth.signOut();
          navigate('/super_admin/LIO-73-23/2372/SYSTEM');
          return;
        }
      } catch (err) {
        console.error('Super admin verification failed:', err);
        navigate('/super_admin/LIO-73-23/2372/SYSTEM');
        return;
      }

      // ✅ Verified super admin — attach real-time listener
      const q = query(collection(db, 'product_keys'), orderBy('createdAt', 'desc'));
      unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const keysData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setKeys(keysData);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching keys:", error);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, [navigate]);


  const totalKeys = keys.length;
  const activatedKeys = keys.filter(k => k.isActivated).length;
  const unactivatedKeys = totalKeys - activatedKeys;

  const handleSignOut = async () => {
    sessionStorage.removeItem('superAdminAuthenticated');
    try { await auth.signOut(); } catch (e) { /* ignore */ }
    navigate('/super_admin/LIO-73-23/2372/SYSTEM');
  };

  // ── Delete handler: removes from Firestore via backend Admin SDK (REQUIRES SUPER ADMIN AUTH) ──
  // SECURITY FIX CRIT-01: The backend DELETE endpoint now requires a Firebase ID token.
  // We get a fresh token via getIdToken() and send it in the Authorization header.
  const handleDeleteKey = async () => {
    if (!confirmDeleteKey) return;
    setDeletingKeyId(confirmDeleteKey.id);
    try {
      // Get fresh Firebase ID token for authentication
      const idToken = await auth.currentUser.getIdToken();
      // Delete via authenticated backend API (Admin SDK bypasses Firestore rules)
      const response = await fetch(`${API_URL}/api/product-keys/${confirmDeleteKey.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Delete failed with status ${response.status}`);
      }
      // Close modals (onSnapshot will auto-update the list)
      setConfirmDeleteKey(null);
      if (selectedKey?.id === confirmDeleteKey.id) setSelectedKey(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete key: ' + err.message);
    } finally {
      setDeletingKeyId(null);
    }
  };


  // ── Download roster as Excel (view mode) ──
  const handleDownloadRosterExcel = async (keyObj) => {
    if (!keyObj?.id) return;
    setDownloadingRoster(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const resp = await fetch(`${API_URL}/api/product-keys/${keyObj.id}/roster-download`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to fetch roster.');

      // Build Excel workbook using ExcelJS (same format as upload)
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Student Roster');

      sheet.columns = [
        { header: 'Serial No',   key: 'serialNumber', width: 12 },
        { header: 'Roll Number', key: 'rollNumber',   width: 18 },
        { header: 'Full Name',   key: 'fullName',     width: 36 },
      ];

      // Style header row
      sheet.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1F3A' } };
      });

      // Data rows
      data.students.forEach(s => sheet.addRow({
        serialNumber: s.serialNumber,
        rollNumber: s.rollNumber,
        fullName: s.fullName,
      }));

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(data.collegeName || keyObj.collegeName || 'college').replace(/[^a-zA-Z0-9]/g, '_')}_student_roster.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to download roster: ' + err.message);
    } finally {
      setDownloadingRoster(false);
    }
  };

  const handleEditClick = () => {

    const dateStr = selectedKey.validUntil
      ? new Date(selectedKey.validUntil).toISOString().split('T')[0]
      : '';
    const currentLimit = parseInt(selectedKey.facultyLimit, 10) || 2;
    // Build faculty emails array sized to current limit
    const existingEmails = Array.isArray(selectedKey.facultyEmails) ? selectedKey.facultyEmails : [];
    const paddedEmails = [...existingEmails];
    while (paddedEmails.length < currentLimit) paddedEmails.push('');

    setEditData({
      collegeName: selectedKey.collegeName || '',
      collegeCode: selectedKey.collegeCode || '',
      adminEmail: selectedKey.adminEmail || '',
      secondaryEmail: selectedKey.secondaryEmail || '',
      adminPhone: selectedKey.adminPhone || '',
      facultyLimit: currentLimit,
      validUntil: dateStr,
      paymentTxnId: selectedKey.paymentTxnId || '',
      facultyEmails: paddedEmails,
    });
    // Reset roster state when opening edit
    setEditRosterFile(null);
    setEditRosterFileError('');
    setEditRosterPreview(null);
    setEditRosterUploading(false);
    setEditRosterUploadProgress('');
    if (editRosterInputRef.current) editRosterInputRef.current.value = '';
    setIsEditing(true);
  };

  // ── Client-side validation for the roster file in edit mode (same rules as KeyGenerator) ──
  const handleEditRosterFileChange = async (e) => {
    const file = e.target.files[0];
    setEditRosterPreview(null);
    if (!file) {
      setEditRosterFile(null);
      setEditRosterFileError('');
      return;
    }
    setEditRosterFileError('');
    setEditRosterFile(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);
      if (!worksheet) {
        setEditRosterFileError('The Excel file is empty or invalid.');
        return;
      }
      const headerRow = worksheet.getRow(1);
      const getVal = (col) => {
        const val = headerRow.getCell(col).value;
        return val ? String(val).trim().toLowerCase() : '';
      };
      if (getVal(1) !== 'serial no' || getVal(2) !== 'roll number' || getVal(3) !== 'full name') {
        setEditRosterFileError('Invalid columns. File must have exactly: "Serial No | Roll Number | Full Name"');
        return;
      }
      setEditRosterFile(file);
    } catch (err) {
      console.error('Error parsing roster Excel:', err);
      setEditRosterFileError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    }
  };

  // ── Call preview endpoint — no DB writes ──
  const handleEditRosterPreview = async () => {
    if (!editRosterFile || !selectedKey?.id) return;
    setEditRosterUploading(true);
    setEditRosterUploadProgress('Analysing file against existing roster...');
    setEditRosterPreview(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const formDataObj = new FormData();
      formDataObj.append('keyId', selectedKey.id);
      formDataObj.append('file', editRosterFile);
      const resp = await fetch(`${API_URL}/api/product-keys/merge-roster?preview=true`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
        body: formDataObj,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Preview failed.');
      setEditRosterPreview(data);
    } catch (err) {
      setEditRosterFileError('Preview error: ' + err.message);
    } finally {
      setEditRosterUploading(false);
      setEditRosterUploadProgress('');
    }
  };

  // Sync faculty email slots when facultyLimit changes in edit mode
  const handleFacultyLimitChange = (newLimit) => {
    const limit = Math.max(1, parseInt(newLimit, 10) || 1);
    setEditData(prev => {
      const emails = [...prev.facultyEmails];
      while (emails.length < limit) emails.push('');
      return { ...prev, facultyLimit: limit, facultyEmails: emails.slice(0, limit) };
    });
  };

  const handleFacultyEmailChange = (index, value) => {
    setEditData(prev => {
      const emails = [...prev.facultyEmails];
      emails[index] = value;
      return { ...prev, facultyEmails: emails };
    });
  };

  const handleSaveEdit = async () => {
    if (!editData.validUntil) {
      alert('Please provide a valid until date.');
      return;
    }
    if (!editData.collegeName.trim()) {
      alert('College name cannot be empty.');
      return;
    }
    if (!editData.adminEmail.trim()) {
      alert('Admin email cannot be empty.');
      return;
    }
    // Block if a roster file is loaded but not previewed yet
    if (editRosterFile && !editRosterPreview) {
      alert('Please click "Preview Changes" to verify the roster diff before saving.');
      return;
    }
    setSavingKey(true);
    try {
      const validUntilISO = new Date(editData.validUntil).toISOString();
      const cleanedFacultyEmails = editData.facultyEmails.filter(e => e.trim() !== '');

      const updatePayload = {
        collegeName: editData.collegeName.trim(),
        collegeCode: editData.collegeCode.trim(),
        adminEmail: editData.adminEmail.trim(),
        secondaryEmail: editData.secondaryEmail.trim() || null,
        adminPhone: editData.adminPhone.trim(),
        facultyLimit: parseInt(editData.facultyLimit, 10),
        validUntil: validUntilISO,
        paymentTxnId: editData.paymentTxnId.trim() || null,
        facultyEmails: cleanedFacultyEmails,
      };

      await updateDoc(doc(db, 'product_keys', selectedKey.id), updatePayload);

      // If activated, sync ALL relevant fields to college config
      if (selectedKey.isActivated && selectedKey.tenantId) {
        try {
          await updateDoc(doc(db, 'colleges', selectedKey.tenantId, 'config', 'settings'), {
            validUntil: validUntilISO,
            subscriptionExpiry: Timestamp.fromDate(new Date(validUntilISO)),
            collegeName: editData.collegeName.trim(),
            collegeCode: editData.collegeCode.trim(),
            facultyLimit: parseInt(editData.facultyLimit, 10),
            facultyEmails: cleanedFacultyEmails,
          });
        } catch (e) {
          console.warn('Could not update college config, it might not exist yet.', e);
        }
      }

      // ── Roster merge commit (if a file was loaded and previewed) ──
      if (editRosterFile && editRosterPreview && editRosterPreview.newCount > 0) {
        setEditRosterUploadProgress(`Adding ${editRosterPreview.newCount} new students in the background...`);
        try {
          const idToken = await auth.currentUser.getIdToken();
          const formDataObj = new FormData();
          formDataObj.append('keyId', selectedKey.id);
          formDataObj.append('file', editRosterFile);
          const mergeResp = await fetch(`${API_URL}/api/product-keys/merge-roster`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}` },
            body: formDataObj,
          });
          const mergeData = await mergeResp.json();
          if (!mergeResp.ok) {
            throw new Error(mergeData.error || 'Roster merge failed.');
          }
          setEditRosterUploadProgress('');
        } catch (mergeErr) {
          setEditRosterUploadProgress('');
          // Field updates already saved — report roster error separately
          alert(`Key details saved successfully, but roster update failed:\n${mergeErr.message}\n\nPlease try uploading the roster again.`);
          setSavingKey(false);
          setSelectedKey({ ...selectedKey, ...updatePayload });
          setIsEditing(false);
          return;
        }
      }

      setSelectedKey({ ...selectedKey, ...updatePayload });
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to update key', e);
      alert('Failed to update key: ' + e.message);
    } finally {
      setSavingKey(false);
    }
  };

  // ─── Shared input style builder ────────────────────────────────────────────
  const inputStyle = {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: "'Inter', sans-serif",
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 50%, #0a0f1a 100%)',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: '40px 20px',
      color: '#e0e0e0',
      position: 'relative'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');
        @keyframes fadeIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        
        .dash-btn-primary { 
          padding: 12px 24px; background: linear-gradient(135deg, #8b0000, #b0003a);
          border: none; border-radius: 8px; color: white; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 15px rgba(180,0,60,0.3);
        }
        .dash-btn-primary:hover:not(:disabled) { box-shadow: 0 6px 20px rgba(180,0,60,0.5); transform: translateY(-1px); }
        .dash-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        
        .dash-btn-secondary { 
          padding: 10px 20px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px; color: rgba(255,255,255,0.7); font-size: 13px; cursor: pointer; transition: all 0.2s; 
        }
        .dash-btn-secondary:hover { background: rgba(255,255,255,0.1); }
        
        .stat-card {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px; padding: 24px; flex: 1; min-width: 200px;
          display: flex; flex-direction: column; gap: 8px;
        }
        
        .table-container {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px; overflow: hidden; margin-top: 24px;
        }
        
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { padding: 16px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.5); border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); }
        td { padding: 16px; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
        tr.key-row { cursor: pointer; transition: background 0.2s; }
        tr.key-row:hover { background: rgba(255,255,255,0.04); }
        
        .badge {
          padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;
        }
        .badge-active { background: rgba(0,200,100,0.15); color: #4ade80; border: 1px solid rgba(0,200,100,0.3); }
        .badge-inactive { background: rgba(255,165,0,0.15); color: #fbbf24; border: 1px solid rgba(255,165,0,0.3); }
        
        .badge-warning { background: rgba(255,69,0,0.15); color: #ff6347; border: 1px solid rgba(255,69,0,0.3); margin-left: 8px; }
        .badge-info { background: rgba(0,191,255,0.15); color: #00bfff; border: 1px solid rgba(0,191,255,0.3); margin-left: 8px; }

        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);
          display: flex; justify-content: center; align-items: center;
          z-index: 1000; padding: 20px;
          animation: fadeIn 0.3s ease-out;
        }
        .modal-content {
          background: #110b1a; border: 1px solid rgba(180,0,60,0.4);
          border-radius: 16px; width: 100%; max-width: 800px;
          max-height: 90vh; overflow-y: auto; padding: 32px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.8);
        }

        .edit-field-row {
          display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;
        }
        .edit-label {
          color: rgba(255,255,255,0.45); font-size: 11px; font-weight: 600;
          letter-spacing: 1.2px; text-transform: uppercase;
        }
        .sa-input {
          background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.2);
          color: white; padding: 8px 12px; border-radius: 6px; font-size: 14px;
          outline: none; width: 100%; box-sizing: border-box;
          font-family: 'Inter', sans-serif; transition: border-color 0.2s;
        }
        .sa-input:focus { border-color: rgba(180,0,60,0.6); background: rgba(180,0,60,0.06); }
        .sa-input::placeholder { color: rgba(255,255,255,0.2); }
        .sa-input:disabled { opacity: 0.5; cursor: not-allowed; }

        .locked-field {
          display: flex; align-items: center; gap: 10px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px; padding: 9px 12px;
        }

        .faculty-limit-control {
          display: flex; align-items: center; gap: 8px;
        }
        .limit-btn {
          width: 32px; height: 32px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.07); color: white; font-size: 18px; font-weight: 600;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; line-height: 1; flex-shrink: 0;
        }
        .limit-btn:hover { background: rgba(180,0,60,0.3); border-color: rgba(180,0,60,0.5); }

        .grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
      `}</style>

      <div style={{ maxWidth: '1200px', margin: '0 auto', animation: 'fadeIn 0.5s ease-out' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <p style={{ color: 'rgba(180,0,60,0.7)', fontSize: '11px', margin: '0 0 4px', letterSpacing: '2px', textTransform: 'uppercase', fontFamily: 'Fira Code, monospace' }}>
              Super Admin → Practical Workflow System
            </p>
            <h1 style={{ color: '#ffffff', fontSize: '28px', fontWeight: '700', margin: 0 }}>
              Master Key Dashboard
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <button className="dash-btn-primary" onClick={() => setShowGenerator(true)}>
              ⚡ Generate New Key
            </button>
            <button className="dash-btn-secondary" onClick={handleSignOut}>
              🚪 Sign Out
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div className="stat-card">
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Keys Generated</span>
            <span style={{ fontSize: '32px', fontWeight: '700', color: '#fff' }}>{totalKeys}</span>
          </div>
          <div className="stat-card" style={{ background: 'rgba(0,200,100,0.02)', borderColor: 'rgba(0,200,100,0.1)' }}>
            <span style={{ color: 'rgba(0,200,100,0.6)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Activated</span>
            <span style={{ fontSize: '32px', fontWeight: '700', color: '#4ade80' }}>{activatedKeys}</span>
          </div>
          <div className="stat-card" style={{ background: 'rgba(255,165,0,0.02)', borderColor: 'rgba(255,165,0,0.1)' }}>
            <span style={{ color: 'rgba(255,165,0,0.6)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Unactivated (Pending)</span>
            <span style={{ fontSize: '32px', fontWeight: '700', color: '#fbbf24' }}>{unactivatedKeys}</span>
          </div>
        </div>

        {/* Data Table */}
        <div className="table-container">
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>Loading keys...</div>
          ) : keys.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>No keys generated yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>

              <table>
                <thead>
                  <tr>
                    <th>Product Key</th>
                    <th>College Name</th>
                    <th>Reg. Number</th>
                    <th>Valid Until</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center', width: '60px' }}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((keyObj) => {
                    const daysLeft = calculateDaysLeft(keyObj.validUntil);
                    return (
                    <tr key={keyObj.id} className="key-row" onClick={() => setSelectedKey(keyObj)}>
                      <td style={{ fontFamily: 'Fira Code, monospace', color: '#fbbf24' }}>{keyObj.productKey}</td>
                      <td>
                        <div style={{ fontWeight: '500' }}>{keyObj.collegeName}</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>{keyObj.adminEmail}</div>
                      </td>
                      <td style={{ color: 'rgba(255,255,255,0.7)' }}>{keyObj.collegeCode}</td>
                      <td style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {new Date(keyObj.validUntil).toLocaleDateString()}
                      </td>
                      <td>
                        <span className={`badge ${keyObj.isActivated ? 'badge-active' : 'badge-inactive'}`}>
                          {keyObj.isActivated ? 'Activated' : 'Unactivated'}
                        </span>
                        {daysLeft > 0 && daysLeft < 10 && (
                          <span className="badge badge-warning">
                            {daysLeft} Days Left
                          </span>
                        )}
                        {daysLeft >= 10 && (
                          <span className="badge badge-info">
                            {daysLeft} Days Left
                          </span>
                        )}
                        {daysLeft <= 0 && (
                          <span className="badge badge-warning" style={{ borderColor: 'red', color: 'red' }}>
                            Expired
                          </span>
                        )}
                      </td>
                      {/* ─── Trash Delete Button ─── */}
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <button
                          title="Delete key"
                          disabled={deletingKeyId === keyObj.id}
                          onClick={() => setConfirmDeleteKey(keyObj)}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,69,0,0.25)',
                            borderRadius: '6px',
                            color: 'rgba(255,80,80,0.6)',
                            cursor: 'pointer',
                            padding: '6px 9px',
                            fontSize: '15px',
                            lineHeight: 1,
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255,50,50,0.12)';
                            e.currentTarget.style.color = '#ff5555';
                            e.currentTarget.style.borderColor = 'rgba(255,50,50,0.5)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'rgba(255,80,80,0.6)';
                            e.currentTarget.style.borderColor = 'rgba(255,69,0,0.25)';
                          }}
                        >
                          {deletingKeyId === keyObj.id ? '⏳' : '🗑️'}
                        </button>
                      </td>
                    </tr>
                  )})}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal for Key Generator */}
      {showGenerator && (
        <div className="modal-overlay" onClick={() => setShowGenerator(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <KeyGenerator asModal={true} onClose={() => setShowGenerator(false)} />
          </div>
        </div>
      )}

      {/* Modal for Details View */}
      {selectedKey && (
        <div className="modal-overlay" onClick={() => { if (!isEditing) setSelectedKey(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '660px' }}>

            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                  {isEditing ? '✏️ Edit & Renew Subscription' : 'Product Key Details'}
                </h2>
                {isEditing && (
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
                    All fields are editable · Product Key is locked
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!isEditing && (
                  <button className="dash-btn-primary" onClick={handleEditClick}>✏️ Edit & Renew</button>
                )}
                <button className="dash-btn-secondary" onClick={() => { setIsEditing(false); setSelectedKey(null); }}>✖</button>
              </div>
            </div>

            {/* ── PRODUCT KEY — always locked ── */}
            <div style={{ marginBottom: '20px', padding: '14px 16px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
                  🔒 Product Key (locked — cannot be changed)
                </div>
                <span style={{ fontFamily: 'Fira Code, monospace', color: '#fbbf24', fontSize: '18px', fontWeight: '700', letterSpacing: '2px' }}>
                  {selectedKey.productKey}
                </span>
              </div>
              <span style={{ fontSize: '20px', opacity: 0.5 }}>🔒</span>
            </div>

            {isEditing ? (
              /* ─── EDIT MODE ─────────────────────────────────────────── */
              <div>
                <div className="grid-2col">
                  {/* College Name */}
                  <div className="edit-field-row" style={{ gridColumn: 'span 2' }}>
                    <label className="edit-label">College Name *</label>
                    <input
                      className="sa-input"
                      type="text"
                      value={editData.collegeName}
                      onChange={e => setEditData({ ...editData, collegeName: e.target.value })}
                      placeholder="College / University Name"
                    />
                  </div>

                  {/* Registration Number */}
                  <div className="edit-field-row">
                    <label className="edit-label">Registration Number</label>
                    <input
                      className="sa-input"
                      type="text"
                      value={editData.collegeCode}
                      onChange={e => setEditData({ ...editData, collegeCode: e.target.value })}
                      placeholder="REG-12345"
                    />
                  </div>

                  {/* Admin Phone */}
                  <div className="edit-field-row">
                    <label className="edit-label">Admin Phone</label>
                    <input
                      className="sa-input"
                      type="tel"
                      value={editData.adminPhone}
                      onChange={e => setEditData({ ...editData, adminPhone: e.target.value })}
                      placeholder="+919876543210"
                    />
                  </div>

                  {/* Primary Admin Email */}
                  <div className="edit-field-row">
                    <label className="edit-label">Primary Admin Email *</label>
                    <input
                      className="sa-input"
                      type="email"
                      value={editData.adminEmail}
                      onChange={e => setEditData({ ...editData, adminEmail: e.target.value })}
                      placeholder="admin@college.edu"
                    />
                  </div>

                  {/* Secondary Admin Email */}
                  <div className="edit-field-row">
                    <label className="edit-label">Secondary Admin Email</label>
                    <input
                      className="sa-input"
                      type="email"
                      value={editData.secondaryEmail}
                      onChange={e => setEditData({ ...editData, secondaryEmail: e.target.value })}
                      placeholder="secondary@college.edu (optional)"
                    />
                  </div>

                  {/* Valid Until */}
                  <div className="edit-field-row">
                    <label className="edit-label">Valid Until *</label>
                    <input
                      className="sa-input"
                      type="date"
                      value={editData.validUntil}
                      onChange={e => setEditData({ ...editData, validUntil: e.target.value })}
                    />
                  </div>

                  {/* Payment TXN */}
                  <div className="edit-field-row">
                    <label className="edit-label">Payment Transaction ID</label>
                    <input
                      className="sa-input"
                      type="text"
                      value={editData.paymentTxnId}
                      onChange={e => setEditData({ ...editData, paymentTxnId: e.target.value })}
                      placeholder="TXN-XXXX"
                    />
                  </div>
                </div>

                {/* Faculty Limit — full-width with +/- control */}
                <div className="edit-field-row" style={{ marginTop: '4px' }}>
                  <label className="edit-label">Faculty Limit (Total Slots)</label>
                  <div className="faculty-limit-control">
                    <button
                      className="limit-btn"
                      type="button"
                      onClick={() => handleFacultyLimitChange(editData.facultyLimit - 1)}
                      disabled={editData.facultyLimit <= 1}
                    >−</button>
                    <input
                      className="sa-input"
                      type="number"
                      min="1"
                      value={editData.facultyLimit}
                      onChange={e => handleFacultyLimitChange(e.target.value)}
                      style={{ textAlign: 'center', maxWidth: '80px' }}
                    />
                    <button
                      className="limit-btn"
                      type="button"
                      onClick={() => handleFacultyLimitChange(editData.facultyLimit + 1)}
                    >+</button>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginLeft: '8px' }}>
                      slots · adjusting this will add/remove email fields below
                    </span>
                  </div>
                </div>

                {/* Faculty Email Slots */}
                {editData.facultyEmails.length > 0 && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', fontWeight: '600', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: '12px' }}>
                      Pre-assigned Faculty Emails
                    </p>
                    <div className="grid-2col">
                      {editData.facultyEmails.map((email, idx) => (
                        <div key={idx} className="edit-field-row">
                          <label className="edit-label">Faculty {idx + 1}</label>
                          <input
                            className="sa-input"
                            type="email"
                            value={email}
                            onChange={e => handleFacultyEmailChange(idx, e.target.value)}
                            placeholder={`faculty${idx + 1}@college.edu`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Roster Merge Upload Section ── */}
                <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11px', fontWeight: '600', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: '8px' }}>
                    📋 Update Student Roster (Optional)
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px', marginBottom: '14px', lineHeight: '1.6' }}>
                    Upload a new <strong style={{ color: 'rgba(255,255,255,0.6)' }}>.xlsx</strong> file to <strong style={{ color: 'rgba(255,255,255,0.6)' }}>add</strong> new students.
                    Existing roll numbers will not be duplicated.
                    Required columns: <span style={{ fontFamily: 'Fira Code, monospace', color: '#fbbf24', fontSize: '11px' }}>Serial No | Roll Number | Full Name</span>
                  </p>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <input
                        ref={editRosterInputRef}
                        type="file"
                        accept=".xlsx"
                        onChange={handleEditRosterFileChange}
                        className="sa-input"
                        style={{ padding: '8px', cursor: 'pointer' }}
                      />
                    </div>
                    {editRosterFile && !editRosterFileError && (
                      <button
                        type="button"
                        onClick={handleEditRosterPreview}
                        disabled={editRosterUploading}
                        style={{
                          padding: '9px 18px',
                          background: editRosterUploading ? 'rgba(255,255,255,0.05)' : 'rgba(0,191,255,0.15)',
                          border: '1px solid rgba(0,191,255,0.3)',
                          borderRadius: '6px',
                          color: '#00bfff',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: editRosterUploading ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          transition: 'all 0.2s',
                        }}
                      >
                        {editRosterUploading ? '⏳ Analysing...' : '🔍 Preview Changes'}
                      </button>
                    )}
                  </div>

                  {/* File validation error */}
                  {editRosterFileError && (
                    <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(180,0,60,0.1)', border: '1px solid rgba(180,0,60,0.3)', borderRadius: '6px', color: '#ff6b8a', fontSize: '12px' }}>
                      ⚠ {editRosterFileError}
                    </div>
                  )}

                  {/* Upload progress text */}
                  {editRosterUploadProgress && (
                    <div style={{ marginTop: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontStyle: 'italic' }}>
                      ⏳ {editRosterUploadProgress}
                    </div>
                  )}

                  {/* Preview result panel */}
                  {editRosterPreview && (
                    <div style={{
                      marginTop: '12px',
                      padding: '14px 16px',
                      background: editRosterPreview.newCount === 0
                        ? 'rgba(255,165,0,0.06)'
                        : 'rgba(0,200,100,0.06)',
                      border: `1px solid ${editRosterPreview.newCount === 0 ? 'rgba(255,165,0,0.2)' : 'rgba(0,200,100,0.2)'}`,
                      borderRadius: '8px',
                    }}>
                      <p style={{ margin: '0 0 10px', fontWeight: '700', fontSize: '13px', color: editRosterPreview.newCount === 0 ? '#fbbf24' : '#4ade80' }}>
                        {editRosterPreview.newCount === 0 ? '⚠ No New Students' : '✅ Preview Ready — Roster Diff'}
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: editRosterPreview.newCount > 0 ? '12px' : '0' }}>
                        <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                          <div style={{ fontSize: '20px', fontWeight: '700', color: '#e0e0e0' }}>{editRosterPreview.existingCount}</div>
                          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: '2px' }}>Existing</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                          <div style={{ fontSize: '20px', fontWeight: '700', color: editRosterPreview.newCount > 0 ? '#4ade80' : '#fbbf24' }}>+{editRosterPreview.newCount}</div>
                          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: '2px' }}>To Add</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px' }}>
                          <div style={{ fontSize: '20px', fontWeight: '700', color: '#60a5fa' }}>{editRosterPreview.totalAfter}</div>
                          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: '2px' }}>Total After</div>
                        </div>
                      </div>
                      {editRosterPreview.skippedCount > 0 && (
                        <p style={{ margin: '0 0 8px', fontSize: '11px', color: 'rgba(255,165,0,0.7)' }}>
                          ⤷ {editRosterPreview.skippedCount} roll number{editRosterPreview.skippedCount !== 1 ? 's' : ''} already exist and will be skipped.
                        </p>
                      )}
                      {editRosterPreview.newCount > 0 && editRosterPreview.sampleRolls?.length > 0 && (
                        <div>
                          <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Sample New Roll Numbers:</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {editRosterPreview.sampleRolls.map((r, i) => (
                              <span key={i} style={{ padding: '3px 8px', background: 'rgba(0,200,100,0.1)', border: '1px solid rgba(0,200,100,0.2)', borderRadius: '4px', fontSize: '11px', fontFamily: 'Fira Code, monospace', color: '#4ade80' }}>{r}</span>
                            ))}
                            {editRosterPreview.newCount > editRosterPreview.sampleRolls.length && (
                              <span style={{ padding: '3px 8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>+{editRosterPreview.newCount - editRosterPreview.sampleRolls.length} more</span>
                            )}
                          </div>
                        </div>
                      )}
                      {editRosterPreview.newCount === 0 && (
                        <p style={{ margin: '0', fontSize: '12px', color: 'rgba(255,165,0,0.7)' }}>
                          All roll numbers in this file already exist in the roster. No changes will be made.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Tenant ID (read-only info) */}
                <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>Tenant ID (read-only)</div>
                  <span style={{ fontFamily: 'Fira Code, monospace', fontSize: '11px', color: 'rgba(255,255,255,0.45)', wordBreak: 'break-all' }}>{selectedKey.tenantId}</span>
                </div>

                {/* Action Buttons */}
                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="dash-btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                  <button className="dash-btn-primary" onClick={handleSaveEdit} disabled={savingKey || editRosterUploading}>
                    {savingKey ? '⏳ Saving...' : '💾 Save Changes'}
                  </button>
                </div>
              </div>
            ) : (
              /* ─── VIEW MODE ─────────────────────────────────────────── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  { label: 'College Name', value: selectedKey.collegeName },
                  { label: 'Registration Number', value: selectedKey.collegeCode },
                  { label: 'Tenant ID', value: selectedKey.tenantId, mono: true, small: true },
                  { label: 'Admin Email', value: selectedKey.adminEmail },
                  { label: 'Secondary Email', value: selectedKey.secondaryEmail || 'N/A' },
                  { label: 'Admin Phone', value: selectedKey.adminPhone },
                  { label: 'Faculty Limit', value: selectedKey.facultyLimit },
                  { label: 'Valid Until', value: new Date(selectedKey.validUntil).toLocaleDateString() },
                  { label: 'Payment TXN', value: selectedKey.paymentTxnId || 'N/A' },
                ].map(({ label, value, mono, small }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', flexShrink: 0 }}>{label}:</span>
                    <span style={{ fontFamily: mono ? 'Fira Code, monospace' : undefined, fontSize: small ? '11px' : '14px', opacity: small ? 0.7 : 1, wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
                  </div>
                ))}

                {/* Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>Status:</span>
                  <span className={`badge ${selectedKey.isActivated ? 'badge-active' : 'badge-inactive'}`}>
                    {selectedKey.isActivated ? 'Activated' : 'Unactivated'}
                  </span>
                </div>

                {/* Student Roster Count + Download Excel */}
                <div style={{ marginTop: '4px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>Student Roster:</span>
                      <span style={{
                        marginLeft: '10px',
                        fontSize: '14px',
                        fontWeight: '700',
                        color: selectedKey.maxStudentCount ? '#4ade80' : 'rgba(255,255,255,0.35)',
                      }}>
                        {selectedKey.maxStudentCount
                          ? `${Number(selectedKey.maxStudentCount).toLocaleString()} students`
                          : 'No roster uploaded'}
                      </span>
                    </div>
                    {selectedKey.rosterUploaded && (
                      <button
                        onClick={() => handleDownloadRosterExcel(selectedKey)}
                        disabled={downloadingRoster}
                        style={{
                          padding: '7px 16px',
                          background: downloadingRoster ? 'rgba(255,255,255,0.05)' : 'rgba(0,200,100,0.12)',
                          border: '1px solid rgba(0,200,100,0.3)',
                          borderRadius: '6px',
                          color: '#4ade80',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: downloadingRoster ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.2s',
                          flexShrink: 0,
                        }}
                      >
                        {downloadingRoster ? '⏳ Downloading...' : '⬇️ Download Roster Excel'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Faculty Emails */}
                {selectedKey.facultyEmails && selectedKey.facultyEmails.length > 0 && (
                  <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', display: 'block', marginBottom: '8px' }}>Pre-assigned Faculty Emails:</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedKey.facultyEmails.map((email, idx) => (
                        <span key={idx} style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.8)' }}>
                          {email}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      )}
      {/* ─── Delete Confirmation Dialog ─── */}
      {confirmDeleteKey && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteKey(null)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '420px', textAlign: 'center' }}
          >
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🗑️</div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 10px', color: '#fff' }}>
              Delete Product Key?
            </h2>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.7', margin: '0 0 6px' }}>
              You are about to permanently delete the key for:
            </p>
            <div style={{
              background: 'rgba(255,69,0,0.07)',
              border: '1px solid rgba(255,69,0,0.2)',
              borderRadius: '8px',
              padding: '12px 16px',
              margin: '8px 0 24px',
            }}>
              <div style={{ fontWeight: '600', color: '#fff', marginBottom: '4px' }}>{confirmDeleteKey.collegeName}</div>
              <div style={{ fontFamily: 'Fira Code, monospace', fontSize: '12px', color: '#fbbf24', letterSpacing: '1px' }}>
                {confirmDeleteKey.productKey}
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'rgba(255,80,80,0.8)', marginBottom: '24px' }}>
              ⚠️ This action cannot be undone. The key will be removed from both the UI and Firebase.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                className="dash-btn-secondary"
                onClick={() => setConfirmDeleteKey(null)}
                disabled={!!deletingKeyId}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteKey}
                disabled={!!deletingKeyId}
                style={{
                  padding: '10px 24px',
                  background: 'linear-gradient(135deg, #8b0000, #cc0033)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: deletingKeyId ? 'not-allowed' : 'pointer',
                  opacity: deletingKeyId ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {deletingKeyId ? '⏳ Deleting...' : '🗑️ Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SuperAdminDashboard;
