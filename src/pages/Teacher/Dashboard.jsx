import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, query, where, onSnapshot, doc, deleteDoc, addDoc, getDocs,
  serverTimestamp, getDoc, updateDoc, Timestamp
} from 'firebase/firestore';
import {
  reauthenticateWithCredential, EmailAuthProvider
} from 'firebase/auth';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Navbar from '../../components/Navbar';
import ProtectedRoute from '../../components/ProtectedRoute';

// =============================================
// CHANGE PASSWORD MODAL — 3-step OTP flow
// =============================================
const ChangePasswordModal = ({ onClose, currentUser, tenantId, externalLockedUntil, onLockout }) => {
  const [step, setStep] = useState(1); // 1=verify old pw, 2=enter OTP, 3=set new pw
  const [oldPassword, setOldPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [otpDocId, setOtpDocId] = useState(null);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const otpRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  // Rate-limiting state — old password (3 attempts max → 60 min lockout)
  const [oldPwAttempts, setOldPwAttempts] = useState(0);
  const [oldPwLockedUntil, setOldPwLockedUntil] = useState(externalLockedUntil || null);

  // Rate-limiting state — OTP (3 attempts max → 60 min lockout)
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [otpLockedUntil, setOtpLockedUntil] = useState(null);

  const LOCKOUT_MS = 60 * 60 * 1000; // 60 minutes
  const MAX_ATTEMPTS = 3;

  const oldPwLocked = oldPwLockedUntil && Date.now() < oldPwLockedUntil;
  const otpLocked = otpLockedUntil && Date.now() < otpLockedUntil;

  const formatLockRemaining = (lockedUntil) => {
    const ms = lockedUntil - Date.now();
    if (ms <= 0) return '';
    const min = Math.ceil(ms / 60000);
    return `${min} minute${min !== 1 ? 's' : ''}`;
  };

  const handleOtpChange = (idx, val) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...otp];
    next[idx] = val;
    setOtp(next);
    if (val && idx < 3) otpRefs[idx + 1].current?.focus();
  };

  const handleOtpKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs[idx - 1].current?.focus();
    }
  };

  // Step 1 — Reauthenticate, generate OTP, write to Firestore
  const handleRequestOTP = async () => {
    if (oldPwLocked) {
      setError(`Too many incorrect attempts. Please try again in ${formatLockRemaining(oldPwLockedUntil)}.`);
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Reauthenticate with old password
      const credential = EmailAuthProvider.credential(currentUser.email, oldPassword);
      await reauthenticateWithCredential(currentUser, credential);

      // Reset old-password attempt counter on success
      setOldPwAttempts(0);
      setOldPwLockedUntil(null);

      // Generate 4-digit OTP
      const generatedOtp = String(Math.floor(1000 + Math.random() * 9000));

      // Write OTP request to Firestore
      const expiresAt = Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000)); // 5 min
      const docRef = await addDoc(collection(db, 'colleges', tenantId, 'otp_requests'), {
        teacherEmail: currentUser.email,
        otp: generatedOtp,
        status: 'pending',
        createdAt: serverTimestamp(),
        expiresAt,
      });

      setOtpDocId(docRef.id);
      // Reset OTP attempts for the new OTP session
      setOtpAttempts(0);
      setOtpLockedUntil(null);
      setStep(2);
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        const newAttempts = oldPwAttempts + 1;
        setOldPwAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          const lockUntil = Date.now() + LOCKOUT_MS;
          setOldPwLockedUntil(lockUntil);
          if (onLockout) onLockout(lockUntil);
          setError(`Too many incorrect attempts (${MAX_ATTEMPTS}/${MAX_ATTEMPTS}). Password change is locked for 60 minutes.`);
        } else {
          setError(`Incorrect old password. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts !== 1 ? 's' : ''} remaining before lockout.`);
        }
      } else {
        setError('Error: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — Verify OTP against Firestore
  const handleVerifyOTP = async () => {
    if (otpLocked) {
      setError(`Too many incorrect OTP attempts. Please try again in ${formatLockRemaining(otpLockedUntil)}.`);
      return;
    }
    setError('');
    const enteredOtp = otp.join('');
    if (enteredOtp.length !== 4) {
      setError('Please enter the complete 4-digit OTP.');
      return;
    }
    setLoading(true);
    try {
      const otpDoc = await getDoc(doc(db, 'colleges', tenantId, 'otp_requests', otpDocId));
      if (!otpDoc.exists()) { setError('OTP request not found. Please start over.'); return; }

      const data = otpDoc.data();
      const now = new Date();
      const expiresAt = data.expiresAt?.toDate?.() || new Date(0);

      if (data.status === 'used') { setError('This OTP has already been used.'); return; }
      if (now > expiresAt) { setError('OTP has expired. Please request a new one.'); return; }
      if (data.otp !== enteredOtp) {
        const newOtpAttempts = otpAttempts + 1;
        setOtpAttempts(newOtpAttempts);
        if (newOtpAttempts >= MAX_ATTEMPTS) {
          const lockUntil = Date.now() + LOCKOUT_MS;
          setOtpLockedUntil(lockUntil);
          setError(`Too many incorrect OTP attempts (${MAX_ATTEMPTS}/${MAX_ATTEMPTS}). Password change is locked for 60 minutes.`);
        } else {
          setError(`Incorrect OTP. ${MAX_ATTEMPTS - newOtpAttempts} attempt${MAX_ATTEMPTS - newOtpAttempts !== 1 ? 's' : ''} remaining before lockout.`);
        }
        return;
      }

      // Reset OTP attempts on success
      setOtpAttempts(0);
      setOtpLockedUntil(null);
      setStep(3);

      // Immediately set status to 'verified' so it disappears from the Admin Dashboard
      await updateDoc(doc(db, 'colleges', tenantId, 'otp_requests', otpDocId), {
        status: 'verified'
      });
    } catch (err) {
      setError('Verification failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 3 — Update password via server-side endpoint (atomically syncs Auth + Firestore)
  const handleChangePassword = async () => {
    setError('');
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

      // Get the Firebase ID token for server-side authentication
      const idToken = await currentUser.getIdToken();

      // Call server endpoint that atomically updates BOTH Firebase Auth password
      // AND the Firestore password field (for admin Excel export sync)
      const resp = await fetch(`${API_URL}/api/teacher/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to change password.');

      // Mark OTP as used
      await updateDoc(doc(db, 'colleges', tenantId, 'otp_requests', otpDocId), {
        status: 'used'
      });

      setSuccess('✅ Password changed successfully! You can now log in with your new password.');
    } catch (err) {
      setError('Failed to change password: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = ['Verify Identity', 'Enter OTP', 'Set New Password'];
  const stepIcons = ['🔐', '📟', '🔑'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(10px)', background: 'rgba(15,23,42,0.55)' }}
      id="change-password-overlay"
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        style={{ animation: 'cpModalIn 0.3s cubic-bezier(.16,1,.3,1)' }}
        id="change-password-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4"
          style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)' }}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-blue-200 hover:text-white transition"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-2xl">
              🔒
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Change Password</h2>
              <p className="text-blue-200 text-sm">{stepTitles[step - 1]}</p>
            </div>
          </div>
          {/* Step indicators */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={`flex items-center gap-1 flex-1`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${s < step ? 'bg-green-400 text-white' :
                    s === step ? 'bg-white text-blue-700' :
                      'bg-blue-500 bg-opacity-50 text-blue-200'
                  }`}>
                  {s < step ? '✓' : s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-0.5 rounded ${s < step ? 'bg-green-400' : 'bg-blue-500 bg-opacity-40'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* ===== STEP 1: Verify old password ===== */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Email read-only */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Email ID</label>
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-gray-600 text-sm font-medium">{currentUser?.email}</span>
                  <span className="ml-auto text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Read-only</span>
                </div>
              </div>

              {/* Old Password */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Old Password</label>
                <div className="relative">
                  <input
                    id="old-password-input"
                    type={showOld ? 'text' : 'password'}
                    value={oldPassword}
                    onChange={e => { setOldPassword(e.target.value); setError(''); }}
                    placeholder="Enter your current password"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 pr-12 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm"
                    onKeyDown={e => { if (e.key === 'Enter' && oldPassword) handleRequestOTP(); }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowOld(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showOld
                      ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    }
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <span className="text-red-500 flex-shrink-0">⚠️</span> {error}
                </div>
              )}

              {oldPwLocked && (
                <div className="bg-orange-50 border border-orange-300 text-orange-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <span>🔒</span>
                  <span>Password change locked for <strong>60 minutes</strong> due to too many incorrect attempts. Please try again in {formatLockRemaining(oldPwLockedUntil)}.</span>
                </div>
              )}
              <button
                id="request-otp-btn"
                onClick={handleRequestOTP}
                disabled={!oldPassword || loading || !!oldPwLocked}
                className="w-full py-3 rounded-xl font-bold text-white transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: !oldPassword || loading || oldPwLocked
                    ? '#9ca3af'
                    : 'linear-gradient(135deg, #1e40af, #3b82f6)'
                }}
              >
                {loading ? (
                  <><svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Verifying...</>
                ) : oldPwLocked ? (
                  '🔒 Locked'
                ) : (
                  <><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg> Request OTP from Admin</>
                )}
              </button>
            </div>
          )}

          {/* ===== STEP 2: Enter OTP ===== */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                <div className="text-3xl mb-2">📟</div>
                <p className="text-sm font-semibold text-blue-800">OTP Sent to Admin's Screen</p>
                <p className="text-xs text-blue-600 mt-1">
                  An OTP has been sent to your Admin's dashboard.<br />
                  Please contact your Admin to get the 4-digit code.
                </p>
                <p className="text-xs text-gray-500 mt-2">⏱ OTP expires in 5 minutes</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 text-center">
                  Enter 4-Digit OTP
                </label>
                <div className="flex gap-3 justify-center">
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={otpRefs[idx]}
                      id={`otp-digit-${idx}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpChange(idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(idx, e)}
                      className="w-14 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
                      autoFocus={idx === 0}
                    />
                  ))}
                </div>
              </div>

              {otpLocked && (
                <div className="bg-orange-50 border border-orange-300 text-orange-800 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <span>🔒</span>
                  <span>OTP verification locked for <strong>60 minutes</strong>. Please try again in {formatLockRemaining(otpLockedUntil)}.</span>
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <span>⚠️</span> {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep(1); setOtp(['', '', '', '']); setError(''); }}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition"
                >
                  ← Back
                </button>
                <button
                  id="verify-otp-btn"
                  onClick={handleVerifyOTP}
                  disabled={otp.join('').length !== 4 || loading || !!otpLocked}
                  className="flex-1 py-3 rounded-xl font-bold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: otpLocked ? '#9ca3af' : 'linear-gradient(135deg, #1e40af, #3b82f6)' }}
                >
                  {loading ? 'Verifying...' : otpLocked ? `🔒 Locked (${formatLockRemaining(otpLockedUntil)})` : 'Verify OTP'}
                </button>
              </div>
            </div>
          )}

          {/* ===== STEP 3: Set New Password ===== */}
          {step === 3 && (
            <div className="space-y-4">
              {success ? (
                <div className="text-center py-4">
                  <div className="text-5xl mb-4">🎉</div>
                  <p className="text-green-700 font-semibold text-sm">{success}</p>
                  <button
                    onClick={onClose}
                    className="mt-6 w-full py-3 rounded-xl font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <p className="text-green-800 text-sm font-semibold">✅ OTP Verified Successfully!</p>
                    <p className="text-green-600 text-xs mt-0.5">Now set your new password below.</p>
                  </div>

                  {/* New Password */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">New Password</label>
                    <div className="relative">
                      <input
                        id="new-password-input"
                        type={showNew ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => { setNewPassword(e.target.value); setError(''); }}
                        placeholder="Minimum 6 characters"
                        className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 pr-12 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm"
                        autoFocus
                      />
                      <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showNew
                          ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                          : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        }
                      </button>
                    </div>
                    {/* Strength indicator */}
                    {newPassword && (
                      <div className="mt-1.5 flex gap-1">
                        {[6, 10, 14].map((threshold, i) => (
                          <div key={i} className={`flex-1 h-1 rounded-full transition-all ${newPassword.length >= threshold
                              ? i === 0 ? 'bg-red-400' : i === 1 ? 'bg-yellow-400' : 'bg-green-500'
                              : 'bg-gray-200'
                            }`} />
                        ))}
                        <span className="text-xs text-gray-400 ml-1">
                          {newPassword.length < 6 ? 'Too short' : newPassword.length < 10 ? 'Weak' : newPassword.length < 14 ? 'Good' : 'Strong'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Confirm New Password</label>
                    <div className="relative">
                      <input
                        id="confirm-password-input"
                        type={showConfirm ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                        placeholder="Re-enter new password"
                        className={`w-full border-2 rounded-xl px-4 py-3 pr-12 focus:ring-2 outline-none transition text-sm ${confirmPassword && newPassword !== confirmPassword
                            ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                            : confirmPassword && newPassword === confirmPassword
                              ? 'border-green-400 focus:border-green-500 focus:ring-green-100'
                              : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'
                          }`}
                        onKeyDown={e => { if (e.key === 'Enter') handleChangePassword(); }}
                      />
                      <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showConfirm
                          ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                          : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        }
                      </button>
                    </div>
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                    )}
                    {confirmPassword && newPassword === confirmPassword && (
                      <p className="text-xs text-green-600 mt-1">✓ Passwords match</p>
                    )}
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                      <span>⚠️</span> {error}
                    </div>
                  )}

                  <button
                    id="change-password-submit-btn"
                    onClick={handleChangePassword}
                    disabled={!newPassword || !confirmPassword || loading}
                    className="w-full py-3 rounded-xl font-bold text-white transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: !newPassword || !confirmPassword || loading
                        ? '#9ca3af'
                        : 'linear-gradient(135deg, #059669, #10b981)'
                    }}
                  >
                    {loading ? (
                      <><svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Changing Password...</>
                    ) : (
                      '🔑 Change Password'
                    )}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes cpModalIn {
          from { opacity: 0; transform: scale(0.94) translateY(20px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};

// =============================================
// MAIN DASHBOARD
// =============================================
// =============================================
// REPLACE TEACHER MODAL - 4-step OTP flow
// =============================================
const ReplaceTeacherModal = ({ onClose, currentUser, tenantId, allTeachers }) => {
  const [step, setStep] = useState(1);
  const [adminOtp, setAdminOtp] = useState(['', '', '', '', '', '']);
  const [newOtp, setNewOtp] = useState(['', '', '', '', '', '']);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [adminOtpToken, setAdminOtpToken] = useState('');
  const [newTeacherToken, setNewTeacherToken] = useState('');
  const [newTeacherOtpToken, setNewTeacherOtpToken] = useState('');

  const [maskedAdminEmail, setMaskedAdminEmail] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');

  const [otpTimer, setOtpTimer] = useState(60);

  const adminOtpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const newOtpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const dropdownRef = useRef(null);

  const { logout } = useAuth();
  const navigate = useNavigate();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    let interval;
    if ((step === 2 || step === 4) && otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, otpTimer]);

  // Auto-open the teachers dropdown when arriving at step 3
  useEffect(() => {
    if (step === 3) {
      setShowDropdown(true);
    }
  }, [step]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleOtpChange = (idx, val, isNew = false) => {
    if (!/^\d?$/.test(val)) return;
    const arr = isNew ? [...newOtp] : [...adminOtp];
    arr[idx] = val;
    if (isNew) setNewOtp(arr); else setAdminOtp(arr);

    const refs = isNew ? newOtpRefs : adminOtpRefs;
    if (val && idx < 5) refs[idx + 1].current?.focus();
  };

  const handleOtpKeyDown = (idx, e, isNew = false) => {
    const arr = isNew ? newOtp : adminOtp;
    const refs = isNew ? newOtpRefs : adminOtpRefs;
    if (e.key === 'Backspace' && !arr[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  };

  const handleRequestAdminOTP = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/replace-teacher/send-admin-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherEmail: currentUser.email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP to Admin');
      setAdminOtpToken(data.adminOtpToken);
      setMaskedAdminEmail(data.maskedAdminEmail);
      setOtpTimer(60);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAdminOTP = async () => {
    const otpStr = adminOtp.join('');
    if (otpStr.length < 6) return setError('Please enter the full 6-digit code.');
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/replace-teacher/verify-admin-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminOtpToken, otp: otpStr })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid OTP');
      setNewTeacherToken(data.newTeacherToken);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendNewOTP = async (e) => {
    e.preventDefault();
    if (!selectedTeacherId) return setError('Please select a teacher.');
    const selectedTeacher = allTeachers.find(t => t.id === selectedTeacherId);
    if (!selectedTeacher) return setError('Invalid teacher selected.');

    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/replace-teacher/send-new-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTeacherToken, newEmail: selectedTeacher.email, existing: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP to new teacher');
      setNewTeacherOtpToken(data.newTeacherOtpToken);
      setNewTeacherEmail(selectedTeacher.email);
      setOtpTimer(60);
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    const otpStr = newOtp.join('');
    if (otpStr.length < 6) return setError('Please enter the full 6-digit code.');
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/replace-teacher/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newTeacherOtpToken,
          otp: otpStr,
          existing: true,
          newEmail: newTeacherEmail
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to replace teacher');
      setSuccess('Teacher account successfully replaced and data migrated.');
      setStep(5);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    await logout();
    navigate('/');
  };

  const filteredTeachers = (allTeachers || []).filter(t => {
    // Exclude the current teacher's own account from the selection list
    if (t.email?.toLowerCase() === currentUser?.email?.toLowerCase()) return false;
    if (!searchTerm) return true;
    return (
      t.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.department?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const selectedTeacherData = allTeachers?.find(t => t.id === selectedTeacherId);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-visible relative">
        <button onClick={onClose} disabled={loading || step === 5} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <div className="p-6 overflow-visible">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center text-red-600 shadow-inner">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Delete Account & Migrate</h2>
              <p className="text-sm text-gray-500">
                {step === 1 && 'Request Admin Approval'}
                {step === 2 && 'Admin OTP Verification'}
                {step === 3 && 'Select Destination Teacher'}
                {step === 4 && 'Destination Teacher OTP'}
                {step === 5 && 'Success'}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-gray-600 text-sm">
                Deleting your account will <strong>permanently destroy</strong> your login credentials.
                Before deleting, all your exams, students, and templates will be migrated to another teacher.
              </p>
              <p className="text-gray-600 text-sm">
                This action requires approval from the <strong>Primary Admin</strong> of your institution.
              </p>
              <button
                onClick={handleRequestAdminOTP}
                disabled={loading}
                className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Sending Request...' : 'Send Request to Admin'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 text-center">
              <p className="text-sm text-gray-600">
                An OTP has been sent to the primary admin (<strong>{maskedAdminEmail}</strong>). Please ask them for the code and enter it below.
              </p>
              <div className="flex justify-center gap-3">
                {adminOtp.map((digit, i) => (
                  <input
                    key={i}
                    ref={adminOtpRefs[i]}
                    type="text"
                    maxLength="1"
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value, false)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e, false)}
                    className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl focus:border-red-500 focus:ring-4 focus:ring-red-100 transition-all bg-gray-50 outline-none text-gray-800"
                    placeholder="•"
                  />
                ))}
              </div>
              <p className="text-sm text-red-600 font-semibold text-center">
                {otpTimer > 0 ? `Time remaining: ${otpTimer}s` : 'OTP expired. Please request a new one.'}
              </p>
              <button
                onClick={handleVerifyAdminOTP}
                disabled={loading || otpTimer === 0 || adminOtp.join('').length < 6}
                className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify Admin OTP'}
              </button>
            </div>
          )}

          {step === 3 && (
            <form onSubmit={handleSendNewOTP} className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">
                Select an existing teacher from your college. All your sessions and saved templates will be migrated to them.
              </p>
              <div className="relative" ref={dropdownRef}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search & Select Teacher</label>
                <div
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl cursor-text focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white flex items-center"
                  onClick={() => setShowDropdown(true)}
                >
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setShowDropdown(true);
                      if (selectedTeacherId) setSelectedTeacherId('');
                    }}
                    placeholder="Search by name, initials or email..."
                    className="w-full bg-transparent outline-none text-sm text-gray-800"
                  />
                </div>

                {showDropdown && (
                  <div className="absolute z-[70] w-full mt-2 bg-white border border-gray-100 shadow-2xl rounded-xl max-h-60 overflow-y-auto left-0">
                    {filteredTeachers.length > 0 ? (
                      filteredTeachers.map(t => (
                        <div
                          key={t.id}
                          className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0"
                          onClick={() => {
                            setSelectedTeacherId(t.id);
                            setSearchTerm(t.name);
                            setShowDropdown(false);
                          }}
                        >
                          <div className="font-semibold text-gray-800">{t.name}</div>
                          <div className="text-xs text-gray-500">{t.email} • {t.department}</div>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-gray-500 text-sm">No teachers found.</div>
                    )}
                  </div>
                )}
              </div>

              {selectedTeacherData && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 mt-2">
                  <h4 className="text-sm font-semibold text-blue-800 mb-1">Selected Destination</h4>
                  <div className="text-sm text-blue-900">{selectedTeacherData.name}</div>
                  <div className="text-xs text-blue-700">{selectedTeacherData.email}</div>
                  <div className="text-xs text-blue-700">{selectedTeacherData.department}</div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !selectedTeacherId}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors mt-6"
              >
                {loading ? 'Sending...' : 'Send OTP to Selected Teacher'}
              </button>
            </form>
          )}

          {step === 4 && (
            <div className="space-y-6 text-center">
              <p className="text-sm text-gray-600">
                A verification code has been sent to <strong>{newTeacherEmail}</strong>.
              </p>
              <div className="flex justify-center gap-3">
                {newOtp.map((digit, i) => (
                  <input
                    key={i}
                    ref={newOtpRefs[i]}
                    type="text"
                    maxLength="1"
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value, true)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e, true)}
                    className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all bg-gray-50 outline-none text-gray-800"
                    placeholder="•"
                  />
                ))}
              </div>
              <p className="text-sm text-red-600 font-semibold text-center">
                {otpTimer > 0 ? `Time remaining: ${otpTimer}s` : 'OTP expired. Please request a new one.'}
              </p>
              <button
                onClick={handleExecute}
                disabled={loading || otpTimer === 0 || newOtp.join('').length < 6}
                className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Migrating Data...' : 'Confirm & Migrate'}
              </button>
            </div>
          )}

          {step === 5 && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Migration Complete!</h3>
              <p className="text-gray-600 mb-8 max-w-sm mx-auto">
                {success} You will now be logged out.
              </p>
              <button
                onClick={handleFinish}
                className="w-full py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-black transition-colors"
              >
                Return to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { currentUser } = useAuth();
  const { tenantId, tenantLoading } = useTenant();
  const navigate = useNavigate();

  // --- STATE ---
  const [exams, setExams] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sharedTemplates, setSharedTemplates] = useState([]);
  const [sharedLiveSessions, setSharedLiveSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showReplaceTeacher, setShowReplaceTeacher] = useState(false);
  // Persistent lockout for Change Password (survives modal open/close)
  const [changePwLockedUntil, setChangePwLockedUntil] = useState(null);

  // --- CONSENT GATE STATE ---
  // 'checking' while we read Firestore; 'needed' shows the modal; 'done' allows dashboard access
  const [consentStatus, setConsentStatus] = useState('checking');
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);

  // --- EXAM TYPE GATEWAY STATE ---
  const [showExamTypeModal, setShowExamTypeModal] = useState(false);

  // --- TEMPLATE VIEWER MODAL STATE ---
  const [templateViewerModal, setTemplateViewerModal] = useState(null); // { template, tab: 'students'|'questions' }

  // --- SHARE MODAL STATE ---
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareTemplate, setShareTemplate] = useState(null);
  const [shareEmail, setShareEmail] = useState('');
  const [shareEmailTags, setShareEmailTags] = useState([]);
  const [shareSearchResults, setShareSearchResults] = useState([]);
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState({ type: '', text: '' });
  const [allTeachers, setAllTeachers] = useState([]);
  const dropdownRef = useRef(null);

  // --- CONSENT CHECK ON MOUNT ---
  // Reads teacher_users/{uid}.legalConsent.acceptedAt — if missing, shows the consent modal.
  // The modal blocks all dashboard interaction until the teacher accepts.
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'teacher_users', currentUser.uid));
        const hasConsented = snap.exists() && snap.data()?.legalConsent?.acceptedAt;
        setConsentStatus(hasConsented ? 'done' : 'needed');
      } catch (err) {
        console.warn('[Dashboard] Consent check failed (non-fatal):', err?.code);
        // On error allow access — consent write will be retried next login
        setConsentStatus('done');
      }
    })();
  }, [currentUser]);

  // --- HANDLE CONSENT ACCEPT ---
  const handleConsentAccept = async () => {
    if (!consentPrivacy || !consentTerms || !currentUser) return;
    setConsentSaving(true);
    try {
      // Use setDoc with merge: true to avoid any "document not found" edge cases 
      // if the teacher_users document was somehow incomplete.
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'teacher_users', currentUser.uid), {
        legalConsent: {
          termsAccepted: true,
          privacyPolicyAccepted: true,
          dpaAccepted: true,
          versionAccepted: 'v1.2',
          acceptedAt: serverTimestamp(),
          userAgent: navigator.userAgent,
        }
      }, { merge: true });

      setConsentStatus('done');
    } catch (err) {
      console.error('[Dashboard] Consent save failed:', err);
    } finally {
      setConsentSaving(false);
    }
  };

  // --- DATA FETCHING ---
  useEffect(() => {
    if (!currentUser || !tenantId) return;

    const qExams = query(collection(db, 'colleges', tenantId, 'exams'), where('teacher_email', '==', currentUser.email));
    const unsubExams = onSnapshot(qExams, (snapshot) => {
      const examList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setExams(examList.sort((a, b) => b.created_at - a.created_at));
      setLoading(false);
    });

    const qTemplates = query(collection(db, 'colleges', tenantId, 'exam_templates'), where('teacher_email', '==', currentUser.email));
    const unsubTemplates = onSnapshot(qTemplates, (snapshot) => {
      const tempList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTemplates(tempList.sort((a, b) => b.created_at - a.created_at));
    });

    const qShared = query(collection(db, 'colleges', tenantId, 'shared_templates'), where('recipient_email', '==', currentUser.email));
    const unsubShared = onSnapshot(qShared, (snapshot) => {
      const sharedList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSharedTemplates(sharedList.sort((a, b) => b.shared_at - a.shared_at));
    });

    const qSharedSessions = query(
      collection(db, 'colleges', tenantId, 'shared_sessions'),
      where('recipient_email', '==', currentUser.email),
      where('status', '==', 'accepted')
    );
    const unsubSharedSessions = onSnapshot(qSharedSessions, (snapshot) => {
      const sharedSessList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSharedLiveSessions(sharedSessList.sort((a, b) => b.shared_at - a.shared_at));
    });

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

    return () => {
      unsubExams();
      unsubTemplates();
      unsubShared();
      unsubSharedSessions();
    };
  }, [currentUser, tenantId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShareDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter teachers as user types in share email
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

  // --- ACTIONS ---

  const handleUseTemplate = (template) => {
    const route = template.template_type === 'internal'
      ? '/teacher/internal-exam-wizard'
      : '/teacher/exam-wizard';
    navigate(route, { state: { template } });
  };

  const handleDeleteTemplate = async (templateId) => {
    if (!window.confirm("Are you sure you want to delete this template?")) return;
    try {
      await deleteDoc(doc(db, 'colleges', tenantId, 'exam_templates', templateId));
    } catch (e) {
      alert("Error deleting template: " + e.message);
    }
  };

  const handleDeleteSharedTemplate = async (sharedTemplateId) => {
    if (!window.confirm("Remove this shared template from your dashboard?")) return;
    try {
      await deleteDoc(doc(db, 'colleges', tenantId, 'shared_templates', sharedTemplateId));
    } catch (e) {
      alert("Error removing shared template: " + e.message);
    }
  };

  const handleOpenShareModal = (template) => {
    setShareTemplate(template);
    setShareEmail('');
    setShareEmailTags([]);
    setShareMessage({ type: '', text: '' });
    setShareDropdownOpen(false);
    setShareModalOpen(true);
  };

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

  const handleShareTemplate = async () => {
    let finalTags = [...shareEmailTags];

    if (finalTags.length === 0) {
      setShareMessage({ type: 'error', text: 'Please add at least one recipient email.' });
      return;
    }

    const selfEmail = currentUser.email.toLowerCase();
    if (finalTags.includes(selfEmail)) {
      setShareMessage({ type: 'error', text: 'You cannot share a template with yourself.' });
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

      const originalSenderName = shareTemplate.original_sender_name || shareTemplate.sender_name || null;
      const originalSenderEmail = shareTemplate.original_sender_email || shareTemplate.sender_email || null;

      const results = { success: [], notFound: [], alreadyShared: [] };

      for (const recipientEmail of finalTags) {
        const teachersQuery = query(collection(db, 'colleges', tenantId, 'teachers'), where('email', '==', recipientEmail));
        const teachersSnap = await getDocs(teachersQuery);

        if (teachersSnap.empty) {
          results.notFound.push(recipientEmail);
          continue;
        }

        const recipientData = teachersSnap.docs[0].data();

        const sourceId = shareTemplate.template_id || shareTemplate.id;
        const existingQuery = query(
          collection(db, 'colleges', tenantId, 'shared_templates'),
          where('template_id', '==', sourceId),
          where('recipient_email', '==', recipientEmail)
        );
        const existingSnap = await getDocs(existingQuery);

        if (!existingSnap.empty) {
          results.alreadyShared.push(recipientEmail);
          continue;
        }

        await addDoc(collection(db, 'colleges', tenantId, 'shared_templates'), {
          template_id: sourceId,
          template_name: shareTemplate.template_name,
          template_type: shareTemplate.template_type || 'practical',
          sender_email: currentUser.email,
          sender_name: senderName,
          original_sender_name: shareTemplate._source === 'shared' ? (originalSenderName || senderName) : senderName,
          original_sender_email: shareTemplate._source === 'shared' ? (originalSenderEmail || currentUser.email) : currentUser.email,
          recipient_email: recipientEmail,
          recipient_name: recipientData.name || '',
          shared_at: serverTimestamp(),
          subjectName: shareTemplate.subjectName || '',
          labNumber: shareTemplate.labNumber || '',
          studentDepartment: shareTemplate.studentDepartment || '',
          studentYear: shareTemplate.studentYear || '',
          studentSemester: shareTemplate.studentSemester || '',
          durationHours: shareTemplate.durationHours || '0',
          durationMinutes: shareTemplate.durationMinutes || '0',
          practicalMarks: shareTemplate.practicalMarks || '',
          vivaMarks: shareTemplate.vivaMarks || '',
          journalMarks: shareTemplate.journalMarks || '',
          internalMarks: shareTemplate.internalMarks || '',
          students: shareTemplate.students || [],
          questions: shareTemplate.questions || [],
          subjectCount: shareTemplate.subjectCount || 1,
          subjectTags: shareTemplate.subjectTags || [],
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
          setShareModalOpen(false);
          setShareTemplate(null);
        }, 2000);
      }

    } catch (error) {
      console.error('Error sharing template:', error);
      setShareMessage({ type: 'error', text: 'Failed to share template: ' + error.message });
    } finally {
      setShareLoading(false);
    }
  };

  const handleUseSharedTemplate = (sharedTemplate) => {
    const template = {
      template_name: sharedTemplate.template_name,
      template_type: sharedTemplate.template_type,
      subjectName: sharedTemplate.subjectName,
      labNumber: sharedTemplate.labNumber,
      studentDepartment: sharedTemplate.studentDepartment,
      studentYear: sharedTemplate.studentYear,
      studentSemester: sharedTemplate.studentSemester,
      durationHours: sharedTemplate.durationHours,
      durationMinutes: sharedTemplate.durationMinutes,
      practicalMarks: sharedTemplate.practicalMarks,
      vivaMarks: sharedTemplate.vivaMarks,
      journalMarks: sharedTemplate.journalMarks,
      internalMarks: sharedTemplate.internalMarks,
      students: sharedTemplate.students,
      questions: sharedTemplate.questions,
      subjectCount: sharedTemplate.subjectCount,
      subjectTags: sharedTemplate.subjectTags,
    };
    const route = template.template_type === 'internal'
      ? '/teacher/internal-exam-wizard'
      : '/teacher/exam-wizard';
    navigate(route, { state: { template } });
  };

  const allDisplayTemplates = [
    ...templates.map(t => ({ ...t, _source: 'owned' })),
    ...sharedTemplates.map(t => ({ ...t, _source: 'shared' })),
  ];

  const allDisplayExams = [
    ...exams.map(e => ({ ...e, _source: 'owned' })),
    ...sharedLiveSessions.map(s => ({ ...s, id: s.session_code, is_active: true, created_at: s.shared_at, _source: 'shared' }))
  ];

  const getAttribution = (t) => {
    if (t._source !== 'shared') return null;
    const sharedBy = t.sender_name || t.sender_email;
    const originalBy = t.original_sender_name || t.original_sender_email;
    if (originalBy && originalBy !== sharedBy) {
      return `Shared by: ${sharedBy} (Original: ${originalBy})`;
    }
    return `Shared by: ${sharedBy}`;
  };

  return (
    <ProtectedRoute allowedRoles={['teacher']}>
      <div className="min-h-screen bg-gray-50">

        {/* ── CONSENT GATE: shown on first login until teacher accepts ── */}
        {consentStatus === 'checking' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
            <div className="text-center text-gray-500">
              <svg className="animate-spin h-10 w-10 mx-auto mb-3 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p className="text-sm">Loading dashboard…</p>
            </div>
          </div>
        )}

        {consentStatus === 'needed' && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(8px)', background: 'rgba(15,23,42,0.6)' }}
          >
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">📋</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">One-Time Consent Required</h2>
                <p className="text-gray-500 text-sm">
                  Before using the Teacher Portal, please review and accept the following.
                  <br />
                  <span className="text-green-600 font-medium">You will not be asked again.</span>
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-4 mb-6">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentPrivacy}
                    onChange={(e) => setConsentPrivacy(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
                  />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    I agree to the{' '}
                    <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentTerms}
                    onChange={(e) => setConsentTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
                  />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    I accept the{' '}
                    <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Terms &amp; Conditions
                    </a>
                    . I consent to the secure storage of my personal information (email, name, department) for examination administration by my College. This data is processed by NextSolves solely on the College's behalf and will not be used for advertising, as detailed in the{' '}
                    <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Full Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              </div>

              <button
                onClick={handleConsentAccept}
                disabled={consentSaving || !consentPrivacy || !consentTerms}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {consentSaving ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Saving…
                  </>
                ) : (
                  '✅ Accept & Enter Dashboard'
                )}
              </button>
            </div>
          </div>
        )}
        {/* ── END CONSENT GATE ── */}

        {/* Pass triggers to Navbar */}
        <Navbar
          onChangePassword={() => setShowChangePassword(true)}
          onDeleteAccount={() => setShowReplaceTeacher(true)}
          hasActiveSessions={allDisplayExams.some(exam => exam.is_active)}
          changePwLockedUntil={changePwLockedUntil}
        />

        <div className="container mx-auto px-4 py-8">


          {/* HEADER */}
          <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <h1 className="text-3xl font-bold text-gray-800">Teacher Dashboard</h1>
            <button
              onClick={() => setShowExamTypeModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold shadow-md transition transform hover:scale-105"
            >
              + Create New Session (From Scratch)
            </button>
          </div>

          {/* --- SECTION 1: ALL SAVE TEMPLATES (Owned + Shared) --- */}
          {allDisplayTemplates.length > 0 && (
            <div className="mb-12 animate-fade-in">
              <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2">
                <span>📂</span> Save Templates
              </h2>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {allDisplayTemplates.map((t) => (
                  <div key={t.id} className="bg-white rounded-xl shadow-sm border-l-4 p-5 hover:shadow-md transition relative group"
                    style={{ borderLeftColor: t._source === 'shared' ? '#10b981' : '#8b5cf6' }}
                  >

                    {/* Shared/Transferred Badge with Attribution */}
                    {(t._source === 'shared' || t.original_teacher_email) && (
                      <div className="absolute top-0 left-0 right-0">
                        <div
                          className="text-xs font-semibold px-3 py-1 rounded-br-lg rounded-tl-xl inline-block max-w-full truncate"
                          style={
                            t._source === 'shared'
                              ? { background: 'linear-gradient(135deg, #d1fae5, #a7f3d0)', color: '#065f46' }
                              : { background: 'linear-gradient(135deg, #fef3c7, #fde68a)', color: '#92400e' }
                          }
                          title={t._source === 'shared' ? getAttribution(t) : `Transferred from: ${t.original_teacher_email}`}
                        >
                          {t._source === 'shared' ? `📤 ${getAttribution(t)}` : `🔄 Transferred from ${t.original_teacher_email}`}
                        </div>
                      </div>
                    )}

                    {/* Header */}
                    <div className={`flex justify-between items-start mb-2 ${(t._source === 'shared' || t.original_teacher_email) ? 'mt-6' : ''}`}>
                      <h3 className="font-bold text-lg text-gray-800 truncate pr-8" title={t.template_name}>
                        {t.template_name}
                      </h3>
                      <div className="flex items-center gap-1">
                        {/* 👁 Eye / Preview Icon */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setTemplateViewerModal({ template: t, tab: 'students' }); }}
                          className="text-gray-300 hover:text-indigo-500 transition p-0.5"
                          title="Preview Students & Questions"
                          id={`view-template-${t.id}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        {/* Share Icon */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenShareModal(t); }}
                          className="text-gray-300 hover:text-blue-500 transition p-0.5"
                          title={t._source === 'shared' ? 'Re-share Template' : 'Share Template'}
                          id={`share-template-${t.id}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                        {/* Delete Icon */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            t._source === 'shared' ? handleDeleteSharedTemplate(t.id) : handleDeleteTemplate(t.id);
                          }}
                          className="text-gray-300 hover:text-red-500 transition p-0.5"
                          title={t._source === 'shared' ? 'Remove Shared Template' : 'Delete Template'}
                          id={`delete-template-${t.id}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="text-sm text-gray-600 space-y-1 mb-4">
                      {/* Exam type badge */}
                      <p className="flex justify-between items-center">
                        <span>Type:</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${t.template_type === 'internal'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                          }`}>
                          {t.template_type === 'internal' ? 'Internal' : 'Practical'}
                        </span>
                      </p>
                      <p className="flex justify-between"><span>Subject:</span> <span className="font-medium">{t.subjectName}</span></p>
                      <p className="flex justify-between"><span>Students:</span> <span className="font-medium">{t.students?.length || 0}</span></p>
                      <p className="flex justify-between"><span>Questions:</span> <span className="font-medium">{t.questions?.length || 0}</span></p>
                    </div>

                    {/* Action Button */}
                    <button
                      onClick={() => t._source === 'shared' ? handleUseSharedTemplate(t) : handleUseTemplate(t)}
                      className="w-full bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-600 hover:text-white font-bold py-2 rounded-lg transition flex items-center justify-center gap-2"
                      style={t._source === 'shared' ? {
                        background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0'
                      } : {}}
                      onMouseEnter={(e) => {
                        if (t._source === 'shared') {
                          e.target.style.background = '#059669';
                          e.target.style.color = '#fff';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (t._source === 'shared') {
                          e.target.style.background = '#ecfdf5';
                          e.target.style.color = '#047857';
                        }
                      }}
                    >
                      <span>⚡</span> Use This Template
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* --- SECTION 2: EXAM SESSIONS --- */}
          <h2 className="text-xl font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2">
            <span>📡</span> Recent Sessions
          </h2>

          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading exams...</div>
          ) : allDisplayExams.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
              <p className="text-gray-500 mb-2">No exam sessions found.</p>
              <p className="text-sm text-gray-400">Click "Create New Session" to get started.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {allDisplayExams.map((exam) => (
                <div
                  key={exam.id + (exam._source === 'shared' ? '_shared' : '')}
                  onClick={() => navigate(`/teacher/monitor?session=${exam.id}`)}
                  className="bg-white rounded-xl shadow-md p-6 cursor-pointer hover:shadow-xl hover:-translate-y-1 transition border-l-4 group relative overflow-hidden"
                  style={{ borderLeftColor: exam._source === 'shared' ? '#3b82f6' : '#e5e7eb', borderTop: '1px solid #f3f4f6', borderRight: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}
                >
                  {/* Shared/Transferred Badge */}
                  {(exam._source === 'shared' || exam.original_teacher_email) && (
                    <div className="absolute top-0 right-0">
                      <div
                        className="text-xs font-semibold px-3 py-1 rounded-bl-xl inline-block max-w-[200px] truncate"
                        style={
                          exam._source === 'shared'
                            ? { background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', color: '#1e40af' }
                            : { background: 'linear-gradient(135deg, #fef3c7, #fde68a)', color: '#92400e' }
                        }
                        title={exam._source === 'shared' ? `Shared by: ${exam.sender_name || exam.sender_email}` : `Transferred from: ${exam.original_teacher_email}`}
                      >
                        {exam._source === 'shared' ? `📡 Shared by ${exam.sender_name || exam.sender_email}` : `🔄 Transferred from ${exam.original_teacher_email}`}
                      </div>
                    </div>
                  )}

                  <div className={`flex justify-between items-start mb-4 ${(exam._source === 'shared' || exam.original_teacher_email) ? 'mt-4' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-1 ${exam.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {exam.is_active && <span className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></span>}
                        {exam.is_active ? 'Live' : 'Ended'}
                      </span>
                      {/* TASK 2.1 FIX: Show exam type badge so Internal/Practical is visible at a glance */}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${exam.exam_type === 'internal'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                        }`}>
                        {exam.exam_type === 'internal' ? 'Internal' : 'Practical'}
                      </span>
                    </div>
                    <span className="text-gray-400 text-xs font-mono">
                      {exam.created_at?.seconds ? new Date(exam.created_at.seconds * 1000).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 mb-1 font-mono group-hover:text-blue-600 transition">
                    {exam.id}
                  </h3>
                  <p className="text-gray-600 font-medium truncate" title={exam.subject_name}>
                    {exam.subject_name}
                  </p>
                  <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-sm text-gray-500">
                    <div>
                      <span className="block text-xs uppercase text-gray-400 font-semibold">Class</span>
                      {exam.student_year} ({exam.student_department})
                    </div>
                    <div className="text-right">
                      <span className="block text-xs uppercase text-gray-400 font-semibold">Lab</span>
                      {exam.lab_number}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* ==================== SHARE TEMPLATE MODAL ==================== */}
        {shareModalOpen && shareTemplate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.5)' }}
            onClick={() => setShareModalOpen(false)}
            id="share-modal-overlay"
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              style={{ animation: 'shareModalIn 0.3s ease-out' }}
              id="share-modal"
            >
              {/* Modal Header */}
              <div className="px-6 pt-6 pb-4 border-b border-gray-100">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">Share Template</h3>
                      <p className="text-sm text-gray-500">
                        {shareTemplate._source === 'shared' ? 'Re-share with colleagues' : 'Share with colleagues'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShareModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 transition p-1 hover:bg-gray-100 rounded-lg"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="px-6 py-5 space-y-5">
                {/* Template Info Card */}
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-purple-500 uppercase tracking-wide mb-1">Template</p>
                  <p className="font-bold text-gray-800 text-lg">{shareTemplate.template_name}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>📚 {shareTemplate.subjectName}</span>
                    <span>👥 {shareTemplate.students?.length || 0} students</span>
                    <span>❓ {shareTemplate.questions?.length || 0} questions</span>
                  </div>
                </div>

                {/* Multi-Recipient Tag Input */}
                <div ref={dropdownRef} className="relative">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Recipients
                  </label>

                  <div
                    className="flex flex-wrap gap-2 p-2 border-2 border-gray-200 rounded-xl focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100 transition min-h-[48px] items-center cursor-text"
                    onClick={() => document.getElementById('share-email-input')?.focus()}
                  >
                    {shareEmailTags.map((email) => {
                      const teacher = allTeachers.find(t => t.email?.toLowerCase() === email.toLowerCase());
                      return (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                          style={{
                            background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
                            color: '#5b21b6'
                          }}
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
                            className="ml-0.5 hover:text-red-600 transition text-purple-400 flex-shrink-0"
                            title="Remove"
                          >
                            ✕
                          </button>
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
                      placeholder={shareEmailTags.length === 0 ? "Search by name, email, or department..." : "Add more..."}
                      className="flex-1 min-w-[120px] outline-none text-sm py-1 bg-transparent"
                      id="share-email-input"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">Click a user from the list to add. Click ✕ to remove.</p>

                  {shareDropdownOpen && shareSearchResults.length > 0 && (
                    <div
                      className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                      style={{ maxHeight: '220px', overflowY: 'auto' }}
                    >
                      {shareSearchResults.map((teacher) => (
                        <button
                          key={teacher.id}
                          onClick={() => handleSelectTeacher(teacher)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-purple-50 transition text-left border-b border-gray-50 last:border-b-0"
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
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">
                            {teacher.department || 'N/A'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {shareDropdownOpen && shareSearchResults.length === 0 && shareEmail.trim() && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-4 text-center text-sm text-gray-500">
                      <p>No teachers found matching "<strong>{shareEmail}</strong>"</p>
                      <p className="text-xs mt-1 text-gray-400">Press Enter to add manually</p>
                    </div>
                  )}
                </div>

                {shareMessage.text && (
                  <div className={`p-3 rounded-xl text-sm font-medium ${shareMessage.type === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : shareMessage.type === 'warning'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-green-50 text-green-700 border border-green-200'
                    }`}
                    style={{ animation: 'shareModalIn 0.3s ease-out' }}
                  >
                    {shareMessage.text}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={() => setShareModalOpen(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-semibold hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleShareTemplate}
                  disabled={shareLoading || (shareEmailTags.length === 0 && !shareEmail.trim())}
                  className="flex-1 py-3 rounded-xl font-semibold text-white transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: shareLoading || (shareEmailTags.length === 0 && !shareEmail.trim())
                      ? '#9ca3af'
                      : 'linear-gradient(135deg, #8b5cf6, #6d28d9)'
                  }}
                  id="share-submit-btn"
                >
                  {shareLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sharing...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Share ({shareEmailTags.length + (shareEmail.trim() ? 1 : 0)})
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TEMPLATE VIEWER MODAL ==================== */}
        {templateViewerModal && (() => {
          const t = templateViewerModal.template;
          const tab = templateViewerModal.tab;
          const students = t.students || [];
          const questions = t.questions || [];
          return (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center p-4"
              style={{ backdropFilter: 'blur(12px)', background: 'rgba(15,23,42,0.65)' }}
              onClick={() => setTemplateViewerModal(null)}
              id="template-viewer-overlay"
            >
              <div
                className="bg-white rounded-3xl shadow-2xl w-full flex flex-col"
                style={{ maxWidth: '900px', maxHeight: '90vh', animation: 'viewerModalIn 0.28s cubic-bezier(.16,1,.3,1)' }}
                onClick={e => e.stopPropagation()}
                id="template-viewer-modal"
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-6 py-4 rounded-t-3xl flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center text-2xl">📂</div>
                    <div>
                      <h3 className="text-xl font-bold text-white truncate max-w-[500px]" title={t.template_name}>
                        {t.template_name}
                      </h3>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-purple-200 text-xs">📚 {t.subjectName}</span>
                        {t._source === 'shared' && (
                          <span className="bg-white bg-opacity-20 text-white text-xs px-2 py-0.5 rounded-full">Shared Template</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setTemplateViewerModal(null)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-white bg-opacity-20 hover:bg-opacity-30 text-white transition"
                    aria-label="Close preview"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 flex-shrink-0 bg-white">
                  <button
                    id="tab-students"
                    onClick={() => setTemplateViewerModal({ ...templateViewerModal, tab: 'students' })}
                    className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-2 transition ${tab === 'students'
                        ? 'border-blue-600 text-blue-700 bg-blue-50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Students
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${tab === 'students' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                      {students.length}
                    </span>
                  </button>
                  <button
                    id="tab-questions"
                    onClick={() => setTemplateViewerModal({ ...templateViewerModal, tab: 'questions' })}
                    className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-2 transition ${tab === 'questions'
                        ? 'border-amber-600 text-amber-700 bg-amber-50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Question Bank
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${tab === 'questions' ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                      {questions.length}
                    </span>
                  </button>

                  {/* Quick stats */}
                  <div className="ml-auto flex items-center gap-4 px-6 text-xs text-gray-400">
                    {tab === 'students' ? (
                      <>
                        <span>📸 {students.filter(s => s.image).length} photos</span>
                        <span>⬜ {students.filter(s => !s.image).length} no photo</span>
                      </>
                    ) : (
                      <>
                        <span>🖼 {questions.filter(q => q.image).length} diagrams</span>
                        <span>🎯 {questions.reduce((s, q) => s + (q.marks || 0), 0)} total marks</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Table content */}
                <div className="overflow-auto flex-1">
                  {tab === 'students' ? (
                    students.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                        <div className="text-5xl mb-3">👥</div>
                        <p className="font-semibold">No students in this template</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-blue-600 text-white">
                          <tr>
                            <th className="text-left px-5 py-3 font-semibold w-12">#</th>
                            <th className="text-left px-4 py-3 font-semibold w-20">Photo</th>
                            <th className="text-left px-4 py-3 font-semibold">Roll No</th>
                            <th className="text-left px-4 py-3 font-semibold">Full Name</th>
                            <th className="text-center px-4 py-3 font-semibold w-28">Photo Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((s, idx) => (
                            <tr key={idx} className={`border-b border-gray-100 hover:bg-blue-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                              <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">{idx + 1}</td>
                              <td className="px-4 py-3">
                                {s.image ? (
                                  <img
                                    src={s.image}
                                    alt={s.name}
                                    className="w-12 h-12 rounded-xl object-cover border-2 border-blue-100 shadow-sm"
                                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                  />
                                ) : null}
                                <div
                                  className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center text-blue-700 font-bold text-lg"
                                  style={{ display: s.image ? 'none' : 'flex' }}
                                >
                                  {(s.name || '?')[0].toUpperCase()}
                                </div>
                              </td>
                              <td className="px-4 py-3.5 font-mono font-bold text-gray-800">{s.roll_no}</td>
                              <td className="px-4 py-3.5 font-medium text-gray-800">{s.name}</td>
                              <td className="px-4 py-3.5 text-center">
                                {s.image ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>Photo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-semibold">
                                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>None
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : (
                    questions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                        <div className="text-5xl mb-3">📋</div>
                        <p className="font-semibold">No questions in this template</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-amber-600 text-white">
                          <tr>
                            <th className="text-left px-5 py-3 font-semibold w-12">#</th>
                            <th className="text-left px-4 py-3 font-semibold w-16">ID</th>
                            <th className="text-left px-4 py-3 font-semibold">Topic / Question</th>
                            <th className="text-left px-4 py-3 font-semibold w-32">Diagram</th>
                            <th className="text-right px-4 py-3 font-semibold w-24">Marks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {questions.map((q, idx) => (
                            <tr key={idx} className={`border-b border-gray-100 hover:bg-amber-50 transition ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                              <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">{idx + 1}</td>
                              <td className="px-4 py-3.5">
                                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-amber-100 text-amber-700 font-bold text-xs">
                                  Q{q.question_id}
                                </span>
                              </td>
                              <td className="px-4 py-3.5 text-gray-800 font-medium leading-snug max-w-xs">{q.topic}</td>
                              <td className="px-4 py-3.5">
                                {q.image ? (
                                  <a href={q.image} target="_blank" rel="noopener noreferrer">
                                    <img
                                      src={q.image}
                                      alt="diagram"
                                      className="w-16 h-11 rounded-lg object-cover border border-amber-200 hover:border-amber-400 transition shadow-sm"
                                      onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'inline'; }}
                                    />
                                    <span className="text-amber-600 text-xs underline" style={{ display: 'none' }}>View</span>
                                  </a>
                                ) : (
                                  <span className="text-gray-300 text-lg">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3.5 text-right">
                                <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                                  {q.marks} pts
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-t border-gray-100 rounded-b-3xl flex-shrink-0">
                  <p className="text-xs text-gray-400">
                    {tab === 'students'
                      ? `${students.length} students · ${students.filter(s => s.image).length} with photo`
                      : `${questions.length} questions · ${questions.reduce((s, q) => s + (q.marks || 0), 0)} total marks`
                    }
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate('/teacher/exam-wizard', { state: { template: t } })}
                      className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition"
                      style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
                    >
                      ⚡ Use Template
                    </button>
                    <button
                      onClick={() => setTemplateViewerModal(null)}
                      className="px-5 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-900 transition"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ==================== CHANGE PASSWORD MODAL ==================== */}
        {showChangePassword && (
          <ChangePasswordModal
            onClose={() => setShowChangePassword(false)}
            currentUser={currentUser}
            tenantId={tenantId}
            externalLockedUntil={changePwLockedUntil}
            onLockout={(lockedUntil) => setChangePwLockedUntil(lockedUntil)}
          />
        )}

        {/* ==================== REPLACE TEACHER MODAL ==================== */}
        {showReplaceTeacher && (
          <ReplaceTeacherModal
            onClose={() => setShowReplaceTeacher(false)}
            currentUser={currentUser}
            tenantId={tenantId}
            allTeachers={allTeachers}
          />
        )}

        {/* ==================== EXAM TYPE GATEWAY MODAL ==================== */}
        {showExamTypeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8" style={{ animation: 'viewerModalIn 0.25s ease-out' }}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Select Exam Type</h3>
                  <p className="text-gray-500 mt-1">Choose the type of exam you want to create.</p>
                </div>
                <button onClick={() => setShowExamTypeModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">&times;</button>
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-8">
                {/* Practical Exam Card */}
                <label className="relative flex flex-col p-6 rounded-xl border-2 border-gray-200 hover:border-blue-400 cursor-pointer transition group bg-white hover:bg-blue-50">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-2xl">
                      💻
                    </div>
                  </div>
                  <h4 className="text-lg font-bold text-gray-800 mb-2">Practical Exam</h4>
                  <p className="text-sm text-gray-500 flex-1">
                    Coding-based practical exams with live slip assignment, code monitoring, and automatic output download.
                  </p>
                  <button
                    onClick={() => { setShowExamTypeModal(false); navigate('/teacher/exam-wizard'); }}
                    className="mt-6 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition shadow-sm"
                  >
                    Select Practical →
                  </button>
                </label>

                {/* Internal Exam Card */}
                <label className="relative flex flex-col p-6 rounded-xl border-2 border-gray-200 hover:border-purple-400 cursor-pointer transition group bg-white hover:bg-purple-50">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center text-2xl">
                      📝
                    </div>
                  </div>
                  <h4 className="text-lg font-bold text-gray-800 mb-2">Internal Exam</h4>
                  <p className="text-sm text-gray-500 flex-1">
                    Multiple Choice Questions (MCQ) based exams with automated validation, marking, and randomized options.
                  </p>
                  <button
                    onClick={() => { setShowExamTypeModal(false); navigate('/teacher/internal-exam-wizard'); }}
                    className="mt-6 w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition shadow-sm"
                  >
                    Select Internal →
                  </button>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* --- INLINE CSS FOR ANIMATIONS --- */}
        <style>{`
          @keyframes shareModalIn {
            from { opacity: 0; transform: translateY(20px) scale(0.97); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes viewerModalIn {
            from { opacity: 0; transform: scale(0.94) translateY(18px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

      </div>
    </ProtectedRoute>
  );
};

export default Dashboard;