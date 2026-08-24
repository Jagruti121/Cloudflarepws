import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../../firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import ExcelJS from 'exceljs';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ─── SHA-256 Hashing via the native Web Crypto API ───────────────────────────
const sha256 = async (text) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

// ─── Generate a random product key string ────────────────────────────────────
const generateRawKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segment = (n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `PWS-${segment(4)}-${segment(4)}-${segment(4)}`;
};

// ─── Field definitions ───────────────────────────────────────────────────────
const FIELDS = [
  { name: 'collegeName',              label: 'College Name',                 type: 'text',   required: true,  col: 2 },
  { name: 'registrationNumber',       label: 'Registration Number',          type: 'text',   required: true,  col: 1 },
  { name: 'facultyCount',             label: 'Faculty Count',                type: 'number', required: true,  col: 1 },
  { name: 'primaryAdminEmail',        label: 'Primary Admin Email',          type: 'email',  required: true,  col: 1 },
  { name: 'secondaryAdminEmail',      label: 'Secondary Admin Email',        type: 'email',  required: false, col: 1 },
  { name: 'adminPhone',               label: 'Admin Phone (with code)',      type: 'tel',    required: true,  col: 2, placeholder: '+919876543210' },
  { name: 'validUntil',               label: 'Valid Until',                  type: 'date',   required: true,  col: 1 },
  { name: 'paymentTxnId',             label: 'Payment Transaction ID',       type: 'text',   required: false, col: 1 },
];

const KeyGenerator = ({ asModal = false, onClose }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [result, setResult] = useState(null); // { productKey, tenantId (hashed) }
  const [copied, setCopied] = useState(false);
  const [rosterFile, setRosterFile] = useState(null);

  const [formData, setFormData] = useState({
    collegeName: '', registrationNumber: '', facultyCount: 2,
    primaryAdminEmail: '', secondaryAdminEmail: '', adminPhone: '',
    validUntil: '', paymentTxnId: '',
  });

  const [facultyEmails, setFacultyEmails] = useState(Array(2).fill(''));

  // Adjust facultyEmails array when facultyCount changes
  useEffect(() => {
    const count = parseInt(formData.facultyCount, 10) || 0;
    setFacultyEmails((prev) => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        return [...prev, ...Array(count - prev.length).fill('')];
      }
      return prev.slice(0, count);
    });
  }, [formData.facultyCount]);

  const handleFacultyEmailChange = (index, value) => {
    const newEmails = [...facultyEmails];
    newEmails[index] = value;
    setFacultyEmails(newEmails);
  };

  // Guard: only super admins can access this page
  useEffect(() => {
    if (!asModal && sessionStorage.getItem('superAdminAuthenticated') !== 'true') {
      navigate('/super_admin/LIO-73-23/2372/SYSTEM');
    }
  }, [navigate, asModal]);

  const handleChange = (e) =>
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) {
      setRosterFile(null);
      setFileError('');
      return;
    }

    setFileError('');
    setRosterFile(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);
      
      if (!worksheet) {
        setFileError('The Excel file is empty or invalid.');
        return;
      }

      const headerRow = worksheet.getRow(1);
      const getVal = (col) => {
        const val = headerRow.getCell(col).value;
        return val ? String(val).trim().toLowerCase() : '';
      };

      const col1 = getVal(1);
      const col2 = getVal(2);
      const col3 = getVal(3);

      if (col1 !== 'serial no' || col2 !== 'roll number' || col3 !== 'full name') {
        setFileError('Invalid columns. The Excel file must have exactly these columns in order: "Serial No | Roll Number | Full Name"');
        return;
      }

      setRosterFile(file);
    } catch (err) {
      console.error('Error parsing Excel:', err);
      setFileError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoadingText('Generating Key...');
    setError('');
    setResult(null);

    try {
      // 1. Generate raw product key
      const productKey = generateRawKey();

      // 2. Derive Tenant ID via SHA-256 hash of the product key
      const tenantId = await sha256(productKey);

      // 3. Build the key document
      const keyDocument = {
        productKey,
        tenantId,
        collegeName:    formData.collegeName,
        collegeCode:    formData.registrationNumber,
        facultyLimit:   parseInt(formData.facultyCount, 10),
        adminEmail:     formData.primaryAdminEmail,
        secondaryEmail: formData.secondaryAdminEmail || null,
        adminPhone:     formData.adminPhone,
        validUntil:     new Date(formData.validUntil).toISOString(),
        paymentTxnId:   formData.paymentTxnId || null,
        facultyEmails:  facultyEmails.filter(e => e.trim() !== ''),
        isActivated:    false,
      };

      // 4. Write via backend API (uses Firebase Admin SDK — bypasses all Firestore rules)
      // SECURITY FIX CRIT-01: Include Firebase ID token for super admin authentication
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch(`${API_URL}/api/product-keys/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(keyDocument),
      });

      const resultData = await response.json();
      if (!response.ok) throw new Error(resultData.error || 'Failed to save key.');

      // 4.5. Upload Master Roster if provided
      if (rosterFile) {
        setLoadingText('Uploading Master Roster...');
        const formDataObj = new FormData();
        // Use the Firestore document ID (docId) returned by /api/product-keys/create,
        // NOT the productKey string. The server looks up keys by doc ID.
        formDataObj.append('keyId', resultData.docId);
        formDataObj.append('file', rosterFile);

        const uploadRes = await fetch(`${API_URL}/api/product-keys/upload-roster`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${idToken}`,
          },
          body: formDataObj,
        });

        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadData.error || 'Failed to upload master roster.');
        }
      }

      // 5. Show the result
      setResult({ productKey, tenantId });


    } catch (err) {
      console.error('Key generation error:', err);
      setError(err.message || 'Failed to generate key or upload roster.');
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };


  const copyToClipboard = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const containerStyle = asModal ? {
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  } : {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 50%, #0a0f1a 100%)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    padding: '40px 20px',
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');
        @keyframes fadeIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .kg-input {
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
          color: #e0e0e0; border-radius: 8px; padding: 12px 14px; width: 100%;
          font-size: 14px; transition: all 0.3s ease; outline: none;
          box-sizing: border-box; font-family: 'Inter', sans-serif;
        }
        .kg-input:focus { border-color: rgba(180,0,60,0.6); background: rgba(180,0,60,0.06);
          box-shadow: 0 0 0 3px rgba(180,0,60,0.12); }
        .kg-input::placeholder { color: rgba(255,255,255,0.2); }
        .kg-label { display: block; color: rgba(255,255,255,0.45); font-size: 11px;
          font-weight: 600; margin-bottom: 7px; letter-spacing: 1.2px; text-transform: uppercase; }
        .kg-btn-primary { padding: 14px 28px; background: linear-gradient(135deg, #8b0000, #b0003a);
          border: none; border-radius: 8px; color: white; font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.3s; letter-spacing: 0.8px; }
        .kg-btn-primary:hover:not(:disabled) { box-shadow: 0 6px 24px rgba(180,0,60,0.5); transform: translateY(-1px); }
        .kg-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .kg-btn-secondary { padding: 10px 20px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px; color: rgba(255,255,255,0.7); font-size: 13px; cursor: pointer; transition: all 0.2s; }
        .kg-btn-secondary:hover { background: rgba(255,255,255,0.1); }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .col-span-2 { grid-column: span 2; }
      `}</style>

      <div style={{ maxWidth: '760px', margin: '0 auto', animation: 'fadeIn 0.5s ease-out' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div>
            <p style={{ color: 'rgba(180,0,60,0.7)', fontSize: '11px', margin: '0 0 4px', letterSpacing: '2px', textTransform: 'uppercase', fontFamily: 'Fira Code, monospace' }}>
              Super Admin → Practical Workflow System
            </p>
            <h1 style={{ color: '#ffffff', fontSize: '26px', fontWeight: '700', margin: 0 }}>
              🔑 Product Key Generator
            </h1>
          </div>
          {!asModal && (
            <button
              className="kg-btn-secondary"
              onClick={() => { sessionStorage.removeItem('superAdminAuthenticated'); navigate('/super_admin/LIO-73-23/2372/SYSTEM'); }}
            >
              🚪 Sign Out
            </button>
          )}
          {asModal && (
            <button className="kg-btn-secondary" onClick={onClose}>
              ✖ Close
            </button>
          )}
        </div>

        {/* Auth badge */}
        <div style={{
          background: 'rgba(0,200,100,0.08)', border: '1px solid rgba(0,200,100,0.2)',
          borderRadius: '8px', padding: '10px 16px', marginBottom: '28px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ color: '#4ade80', fontSize: '12px' }}>
            ● AUTHENTICATED · Key DB: Full R/W Access · Master Tenant DB: Provision-only
          </span>
        </div>

        {/* Result panel */}
        {result && (
          <div style={{
            background: 'rgba(0,200,100,0.06)', border: '1px solid rgba(0,200,100,0.3)',
            borderRadius: '12px', padding: '24px', marginBottom: '28px',
          }}>
            <p style={{ color: '#4ade80', fontSize: '13px', fontWeight: '700', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              ✅ Key Generated Successfully
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '16px' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', margin: '0 0 6px', letterSpacing: '1.5px' }}>PRODUCT KEY (Send to College Admin)</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <span style={{ color: '#fbbf24', fontFamily: 'Fira Code, monospace', fontSize: '22px', fontWeight: '700', letterSpacing: '2px' }}>
                    {result.productKey}
                  </span>
                  <button
                    className="kg-btn-secondary"
                    style={{ fontSize: '12px', padding: '7px 14px', flexShrink: 0 }}
                    onClick={() => copyToClipboard(result.productKey)}
                  >
                    {copied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                </div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px 16px' }}>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px', margin: '0 0 4px', letterSpacing: '1.5px' }}>TENANT ID (SHA-256 Hash — stored in Firestore)</p>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Fira Code, monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                  {result.tenantId}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(180,0,60,0.1)', border: '1px solid rgba(180,0,60,0.4)',
            borderRadius: '8px', padding: '12px 16px', marginBottom: '24px', color: '#ff6b8a', fontSize: '13px',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Form */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '32px',
        }}>
          <h2 style={{ color: '#ffffff', fontSize: '16px', fontWeight: '600', margin: '0 0 24px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            Create New Key — College Details
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="grid-2" style={{ marginBottom: '0' }}>
              {FIELDS.map((field) => (
                <div
                  key={field.name}
                  className={field.col === 2 ? 'col-span-2' : ''}
                  style={{ marginBottom: '16px' }}
                >
                  <label className="kg-label">
                    {field.label}{field.required && <span style={{ color: 'rgba(180,0,60,0.8)', marginLeft: '4px' }}>*</span>}
                  </label>
                  <input
                    className="kg-input"
                    type={field.type}
                    name={field.name}
                    value={formData[field.name]}
                    onChange={handleChange}
                    required={field.required}
                    placeholder={field.placeholder || ''}
                    min={field.type === 'number' ? 1 : undefined}
                  />
                </div>
              ))}
            </div>

            {/* Dynamic Faculty Email Inputs */}
            {facultyEmails.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <h3 style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '1px' }}>
                  Faculty Email Assignments (Optional)
                </h3>
                <div className="grid-2">
                  {facultyEmails.map((email, index) => (
                    <div key={index} style={{ marginBottom: '12px' }}>
                      <label className="kg-label">Faculty {index + 1} Email</label>
                      <input
                        className="kg-input"
                        type="email"
                        value={email}
                        onChange={(e) => handleFacultyEmailChange(index, e.target.value)}
                        placeholder={`faculty${index + 1}@college.edu`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STUDENT CAPCUT: Master Roster Upload */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <h3 style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '1px' }}>
                Master Student Roster (Excel) - REQUIRED FOR CAPCUT
              </h3>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', marginBottom: '16px' }}>
                Upload an .xlsx file with columns: <strong>Serial No | Roll Number | Full Name</strong>
              </p>
              <input
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                className="kg-input"
                style={{ padding: '8px' }}
                required
              />
              {fileError && (
                <div style={{ marginTop: '8px', color: '#ff6b8a', fontSize: '12px', fontWeight: '500' }}>
                  ⚠ {fileError}
                </div>
              )}
            </div>

            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="kg-btn-secondary"
                onClick={() => {
                  setFormData({ collegeName: '', registrationNumber: '', facultyCount: 2, primaryAdminEmail: '', secondaryAdminEmail: '', adminPhone: '', validUntil: '', paymentTxnId: '' });
                  setFacultyEmails(Array(2).fill(''));
                  setRosterFile(null);
                  setFileError('');
                }}
              >
                Reset
              </button>
              <button type="submit" className="kg-btn-primary" disabled={loading || !!fileError}>
                {loading ? `⏳ ${loadingText || 'Generating...'}` : '⚡ Generate Product Key'}
              </button>
            </div>
          </form>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.1)', fontSize: '11px', textAlign: 'center', marginTop: '24px', fontFamily: 'Fira Code, monospace' }}>
          Tenant ID is derived via SHA-256 hash of the Product Key · Key DB auto-disconnects post-activation
        </p>
      </div>
    </div>
  );
};

export default KeyGenerator;
