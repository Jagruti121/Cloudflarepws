import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../../firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ─── Shared Styles ─────────────────────────────────────────────────────────
const LIGHT_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%,60%  { transform: translateX(-6px); }
    40%,80%  { transform: translateX(6px); }
  }

  .act-card {
    animation: fadeInUp 0.45s ease-out;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 44px 40px;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 20px 60px rgba(37, 99, 235, 0.10), 0 4px 16px rgba(0,0,0,0.06);
    position: relative;
    z-index: 1;
  }

  .act-input {
    width: 100%;
    box-sizing: border-box;
    background: #f9fafb;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    color: #1f2937;
    padding: 12px 16px;
    font-size: 14px;
    font-family: 'Inter', sans-serif;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  }
  .act-input:focus {
    border-color: #2563eb;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }
  .act-input::placeholder { color: #9ca3af; }

  .act-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 7px;
  }

  .act-btn {
    width: 100%;
    padding: 13px;
    background: linear-gradient(135deg, #2563eb, #4f46e5);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
    font-family: 'Inter', sans-serif;
    letter-spacing: 0.3px;
  }
  .act-btn:hover:not(:disabled) {
    box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45);
    transform: translateY(-1px);
  }
  .act-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }

  .act-btn-ghost {
    width: 100%;
    padding: 11px;
    background: transparent;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    color: #6b7280;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: 'Inter', sans-serif;
  }
  .act-btn-ghost:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
    color: #374151;
  }
  .act-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

  /* OTP boxes */
  .otp-box {
    width: 48px;
    height: 58px;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    font-family: 'Inter', monospace;
    background: #f9fafb;
    border: 1.5px solid #d1d5db;
    border-radius: 10px;
    color: #2563eb;
    outline: none;
    transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.1s;
    caret-color: transparent;
  }
  .otp-box:focus {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    transform: scale(1.04);
  }
  .otp-box.filled {
    border-color: #6366f1;
    background: #eef2ff;
  }

  /* Error banner */
  .act-error {
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    color: #dc2626;
    margin-bottom: 18px;
    animation: shake 0.35s ease;
    line-height: 1.5;
  }

  /* Step progress */
  .step-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    transition: all 0.3s;
  }

  /* Password strength */
  .pw-hint {
    font-size: 12px;
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
`;

// ─── OTP Countdown Ring ─────────────────────────────────────────────────────
const CountdownRing = ({ timeLeft, total = 300 }) => {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const progress = timeLeft / total;
  const offset = circumference * (1 - progress);
  const color = timeLeft > 20 ? '#2563eb' : timeLeft > 10 ? '#f59e0b' : '#ef4444';

  return (
    <svg width="52" height="52" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="26" cy="26" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="3" />
      <circle
        cx="26" cy="26" r={radius}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
      />
    </svg>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────
const AdminActivation = () => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [formData, setFormData] = useState({
    productKey: '',
    adminEmail: '',
    adminPhone: '',
    adminPassword: '',
  });
  const [pwTouched, setPwTouched] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);

  // Step 2
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpTimer, setOtpTimer] = useState(300);
  const [otpExpired, setOtpExpired] = useState(false);
  const [productKeyDoc, setProductKeyDoc] = useState(null);
  const otpRefs = useRef([]);
  const timerRef = useRef(null);

  const navigate = useNavigate();

  // ── OTP countdown timer ──────────────────────────────────────────────────
  const startTimer = () => {
    setOtpTimer(300);
    setOtpExpired(false);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setOtpTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setOtpExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── Input handler ────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // ── OTP box input handler ────────────────────────────────────────────────
  const handleOtpChange = (idx, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[idx] = digit;
    setOtpDigits(next);
    if (digit && idx < 5) {
      otpRefs.current[idx + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = [...otpDigits];
    pasted.split('').forEach((d, i) => { if (i < 6) next[i] = d; });
    setOtpDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  };

  const getOtpString = () => otpDigits.join('');

  // ── Step 1 Submit — batched validate + send OTP ──────────────────────────
  const handleStep1Submit = async (e) => {
    e.preventDefault();
    if (formData.adminPassword.length < 8) {
      setError('Minimum 8 character password compulsory.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/product-keys/validate-and-send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productKey: formData.productKey.trim(),
          adminEmail: formData.adminEmail.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        const raw = data.error || '';

        // ── SECURITY: Specific message for secondary email attempts ──
        if (raw === 'SECONDARY_EMAIL_BLOCKED') {
          throw new Error(
            'The secondary email ID cannot be used for key activation. Please use the primary email ID only.'
          );
        }
        if (raw.toLowerCase().includes('invalid key') || raw.includes('Invalid key')) {
          throw new Error('Invalid product key. Please check and try again.');
        }
        if (raw.toLowerCase().includes('email')) {
          throw new Error('Email does not match this key. Please check and try again.');
        }
        throw new Error(raw || 'Verification failed. Please try again.');
      }

      // Phone check (still client-side for speed)
      if (data.adminPhone && formData.adminPhone && data.adminPhone !== formData.adminPhone) {
        throw new Error('Mobile number does not match the registered record.');
      }

      setProductKeyDoc({ id: data.docId, data: () => data });
      startTimer();
      setStep(2);
    } catch (err) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Resend OTP ───────────────────────────────────────────────────────────
  const handleResendOtp = async () => {
    setOtpDigits(['', '', '', '', '', '']);
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/product-keys/validate-and-send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productKey: formData.productKey.trim(),
          adminEmail: formData.adminEmail.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to resend OTP');
      startTimer();
      otpRefs.current[0]?.focus();
    } catch (err) {
      setError(err.message || 'Could not resend OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 Submit — verify OTP + activate ───────────────────────────────
  const handleStep2Submit = async (e) => {
    e.preventDefault();
    const otpString = getOtpString();
    if (otpString.length < 6) {
      setError('Please enter all 6 digits.');
      return;
    }
    if (otpExpired) {
      setError('OTP has expired. Please request a new one.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // 1. Verify OTP
      const otpResponse = await fetch(`${API_URL}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.adminEmail.trim(), otp: otpString }),
      });
      const otpResult = await otpResponse.json();
      if (!otpResponse.ok) {
        const raw = otpResult.error || '';
        if (raw.toLowerCase().includes('expired')) {
          throw new Error('OTP has expired. Please request a new one.');
        }
        throw new Error(raw || 'Invalid OTP. Please try again.');
      }

      // 2. Create Firebase Auth account
      sessionStorage.setItem('portal', 'admin');
      sessionStorage.setItem('pms_activating', 'true');
      const userCredential = await createUserWithEmailAndPassword(auth, formData.adminEmail.trim(), formData.adminPassword);
      const user = userCredential.user;
      await updateProfile(user, { displayName: 'College Admin' });

      // 3. Activate key via backend transaction
      const keyData = productKeyDoc.data();
      const activateResponse = await fetch(`${API_URL}/api/product-keys/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId: productKeyDoc.id,
          uid: user.uid,
          email: formData.adminEmail.trim(),
          tenantId: keyData.tenantId,
          collegeName: keyData.collegeName,
          collegeCode: keyData.collegeCode,
          facultyLimit: keyData.facultyLimit,
          validUntil: keyData.validUntil,
          facultyEmails: keyData.facultyEmails || [],
        }),
      });
      const activateResult = await activateResponse.json();
      if (!activateResponse.ok) throw new Error(activateResult.error || 'Activation failed. Please try again.');

      // 4. Set session
      sessionStorage.setItem('adminAuthenticated', 'true');
      sessionStorage.setItem('adminEmail', formData.adminEmail.trim());
      sessionStorage.setItem('tenantId', keyData.tenantId);
      sessionStorage.removeItem('pms_activating');

      // 4b. Sync custom claims and refresh token so AuthContext recognizes the new admin role
      const token = await user.getIdToken();
      await fetch(`${API_URL}/api/auth/sync-claims`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await user.getIdToken(true);

      // 5. Send success email (fire-and-forget — non-blocking)
      fetch(`${API_URL}/api/send-activation-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.adminEmail.trim(),
          collegeName: keyData.collegeName,
          productKey: keyData.productKey || formData.productKey,
        }),
      }).catch(() => { /* Non-fatal */ });

      // 6. Redirect to success page
      navigate('/admin/activation-success', {
        state: {
          collegeName: keyData.collegeName,
          productKey: keyData.productKey || formData.productKey,
          email: formData.adminEmail.trim(),
        },
        replace: true,
      });

    } catch (err) {
      sessionStorage.removeItem('pms_activating');
      if (err.code === 'auth/email-already-in-use') {
        setError('This email is already registered. Please sign in instead.');
      } else if (err.message?.toLowerCase().includes('expired')) {
        setError('OTP has expired. Please request a new one.');
      } else {
        setError(err.message || 'Activation failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = () => {
    clearInterval(timerRef.current);
    setStep(1);
    setOtpDigits(['', '', '', '', '', '']);
    setOtpTimer(300);
    setOtpExpired(false);
    setError('');
  };

  const pwInvalid = pwTouched && formData.adminPassword.length > 0 && formData.adminPassword.length < 8;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: '24px 16px',
    }}>
      <style>{LIGHT_STYLES}</style>

      <div className="act-card">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '42px', marginBottom: '12px' }}>🛡️</div>
          <p style={{
            fontSize: '11px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#6366f1',
            fontWeight: '600',
            margin: '0 0 8px',
          }}>
            Practical Workflow System
          </p>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1f2937', margin: '0 0 6px' }}>
            {step === 1 ? 'Account Activation' : 'Verify Your Email'}
          </h1>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            {step === 1
              ? 'Enter your credentials to activate your account'
              : `A 6-digit code has been sent to ${formData.adminEmail}`}
          </p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <div className="step-dot" style={{ background: '#2563eb', boxShadow: '0 0 0 3px rgba(37,99,235,0.2)' }} />
          <div style={{ width: '36px', height: '2px', background: step === 2 ? '#2563eb' : '#e5e7eb', borderRadius: '1px', transition: 'background 0.3s' }} />
          <div className="step-dot" style={{
            background: step === 2 ? '#2563eb' : '#e5e7eb',
            boxShadow: step === 2 ? '0 0 0 3px rgba(37,99,235,0.2)' : 'none',
          }} />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="act-error" key={error}>
            ⚠️ {error}
          </div>
        )}

        {/* ─── STEP 1 ─── */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

              {/* Product Key */}
              <div>
                <label className="act-label">Product Key</label>
                <input
                  id="productKey"
                  name="productKey"
                  type="text"
                  className="act-input"
                  placeholder="PWS-XXXX-XXXX-XXXX"
                  value={formData.productKey}
                  onChange={handleInputChange}
                  required
                  autoComplete="off"
                  autoFocus
                />
              </div>

              {/* Admin Email */}
              <div>
                <label className="act-label">Primary Admin Email</label>
                <input
                  id="adminEmail"
                  name="adminEmail"
                  type="email"
                  className="act-input"
                  placeholder="admin@college.edu"
                  value={formData.adminEmail}
                  onChange={handleInputChange}
                  required
                />
              </div>

              {/* Admin Phone */}
              <div>
                <label className="act-label">Registered Phone Number</label>
                <input
                  id="adminPhone"
                  name="adminPhone"
                  type="tel"
                  className="act-input"
                  placeholder="+91 98765 43210"
                  value={formData.adminPhone}
                  onChange={handleInputChange}
                />
              </div>

              {/* Password */}
              <div>
                <label className="act-label">Set Account Password</label>
                <input
                  id="adminPassword"
                  name="adminPassword"
                  type="password"
                  className="act-input"
                  placeholder="Minimum 8 characters"
                  value={formData.adminPassword}
                  onChange={handleInputChange}
                  onBlur={() => setPwTouched(true)}
                  required
                  minLength="8"
                />
                {pwInvalid && (
                  <p className="pw-hint" style={{ color: '#ef4444' }}>
                    ⚠️ Password must be at least 8 characters.
                  </p>
                )}
                {formData.adminPassword.length >= 8 && (
                  <p className="pw-hint" style={{ color: '#16a34a' }}>
                    ✓ Password strength looks good
                  </p>
                )}
              </div>

              {/* Consent Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px', marginBottom: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#4b5563', lineHeight: '1.4', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={consentPrivacy} 
                    onChange={(e) => setConsentPrivacy(e.target.checked)} 
                    style={{ marginTop: '2px', cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                  <span>
                    I agree to the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>Privacy Policy</a>.
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#4b5563', lineHeight: '1.4', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={consentTerms} 
                    onChange={(e) => setConsentTerms(e.target.checked)} 
                    style={{ marginTop: '2px', cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
                  />
                  <span>
                    I accept the <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>Terms & Conditions</a>. I consent to the secure, temporary storage of my personal information (email id, name, phone no, department, and college information) and exam file for evaluation by my College. I understand this data is processed by NextSolves solely on the College's behalf and will not be used for advertising, as detailed in the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }}>Full Privacy Policy</a>.
                  </span>
                </label>
              </div>

              <button type="submit" className="act-btn" disabled={loading || pwInvalid || !consentPrivacy || !consentTerms}>
                {loading ? '⏳ Verifying...' : 'Verify & Send OTP →'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '4px' }}>
                <a href="/admin/login" style={{ fontSize: '13px', color: '#4f46e5', textDecoration: 'none', fontWeight: '500' }}>
                  Already activated? Sign in
                </a>
              </div>
            </div>
          </form>
        )}

        {/* ─── STEP 2 ─── */}
        {step === 2 && (
          <form onSubmit={handleStep2Submit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

              {/* Countdown + Label */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: '13px', color: '#374151', fontWeight: '500' }}>
                    Enter the 6-digit code
                  </p>
                  {otpExpired ? (
                    <p style={{ margin: 0, fontSize: '12px', color: '#ef4444', fontWeight: '600' }}>
                      OTP expired
                    </p>
                  ) : (
                    <p style={{ margin: 0, fontSize: '12px', color: otpTimer <= 10 ? '#ef4444' : '#9ca3af' }}>
                      Expires in {otpTimer}s
                    </p>
                  )}
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CountdownRing timeLeft={otpTimer} />
                  <span style={{
                    position: 'absolute',
                    fontSize: '11px',
                    fontWeight: '700',
                    fontFamily: 'monospace',
                    color: otpTimer <= 10 ? '#ef4444' : '#2563eb',
                  }}>
                    {otpTimer}
                  </span>
                </div>
              </div>

              {/* 6-box OTP input */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={el => { otpRefs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className={`otp-box${digit ? ' filled' : ''}`}
                    value={digit}
                    onChange={e => handleOtpChange(idx, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(idx, e)}
                    onPaste={idx === 0 ? handleOtpPaste : undefined}
                    disabled={otpExpired}
                    style={{ opacity: otpExpired ? 0.45 : 1 }}
                  />
                ))}
              </div>

              {/* Expired state */}
              {otpExpired && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  color: '#dc2626',
                  textAlign: 'center',
                }}>
                  OTP has expired. Click "Resend OTP" to get a new code.
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                className="act-btn"
                disabled={loading || otpExpired || getOtpString().length < 6}
              >
                {loading ? '⏳ Activating...' : 'Confirm OTP & Activate'}
              </button>

              {/* Resend OTP */}
              <button
                type="button"
                className="act-btn-ghost"
                onClick={handleResendOtp}
                disabled={loading || !otpExpired}
                style={{ opacity: otpExpired ? 1 : 0.4, cursor: otpExpired ? 'pointer' : 'default' }}
              >
                {loading ? '⏳ Resending...' : '🔄 Resend OTP'}
              </button>

              {/* Start over */}
              <button
                type="button"
                className="act-btn-ghost"
                onClick={handleStartOver}
                disabled={loading}
                style={{ fontSize: '13px' }}
              >
                ← Start Over
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default AdminActivation;
