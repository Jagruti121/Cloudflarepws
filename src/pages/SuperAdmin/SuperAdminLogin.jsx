import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PORTAL = 'super_admin';
const MAX_ATTEMPTS = 3;
const OTP_SECONDS = 60;

// ─── Countdown hook ───────────────────────────────────────────────────────────
const useCountdown = (seconds, active) => {
  const [remaining, setRemaining] = useState(seconds);
  const [trigger, setTrigger] = useState(0);
  const reset = () => {
    setRemaining(seconds);
    setTrigger(t => t + 1);
  };
  useEffect(() => {
    if (!active) { setRemaining(seconds); return; }
    setRemaining(seconds);
    const id = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [active, seconds, trigger]);
  return { remaining, reset };
};

// ─── Main Component ───────────────────────────────────────────────────────────
const SuperAdminLogin = () => {
  const [id, setId]           = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Lockout state
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked]             = useState(false);

  // phase: 'login' | 'locked' | 'otp_sent'
  const [phase, setPhase]                   = useState('login');
  const [otpInput, setOtpInput]             = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError]             = useState('');
  const [otpLoading, setOtpLoading]         = useState(false);
  const [otpDestination, setOtpDestination] = useState('');
  const [otpSent, setOtpSent]               = useState(false);
  const [countdownActive, setCountdownActive] = useState(false);
  const { remaining, reset: resetOtpTimer } = useCountdown(OTP_SECONDS, countdownActive);
  const [otpAttempts, setOtpAttempts]       = useState(0);

  const otpRefs  = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const navigate = useNavigate();

  // Clear any existing super-admin session on mount
  useEffect(() => {
    sessionStorage.removeItem('superAdminAuthenticated');
  }, []);

  // ── Check lockout on submit ──────────────────────────────────────────────
  const checkLockoutStatus = async (emailToCheck) => {
    if (!emailToCheck) return false;
    try {
      const res = await fetch(
        `${API}/api/lockout/check-status?email=${encodeURIComponent(emailToCheck)}&portal=${PORTAL}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return false;
      const data = await res.json();
      setFailedAttempts(data.failedAttempts || 0);
      if (data.locked) {
        setIsLocked(true);
        setPhase('locked');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // ── Main submit handler ──────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setError('');
    setLoading(true);

    const locked = await checkLockoutStatus(id.trim());
    if (locked) {
      setLoading(false);
      return;
    }

    try {
      const emailClean = id.trim().toLowerCase();

      // Authenticate first, then enforce role
      const userCredential = await signInWithEmailAndPassword(auth, emailClean, password);
      const user = userCredential.user;

      // ── PORTAL ISOLATION: enforce super admin role strictly ──
      const saDoc = await getDoc(doc(db, 'super_admins', user.uid));
      if (!saDoc.exists() || saDoc.data().role !== 'super_admin') {
        await auth.signOut();
        throw new Error('UNAUTHORIZED');
      }

      sessionStorage.setItem('superAdminAuthenticated', 'true');
      sessionStorage.setItem('superAdminEmail', user.email);

      navigate('/super_admin/LIO-73-23/2372/SYSTEM/dashboard');
    } catch (err) {
      console.error('Super Admin login error:', err);

      let msg = '';
      if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.message === 'UNAUTHORIZED'
      ) {
        msg = 'Invalid email id or password';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Too many failed attempts. Please wait before retrying.';
      } else if (err.code === 'auth/network-request-failed') {
        msg = 'Network error. Check your connection.';
      } else {
        msg = err.message || 'Login failed.';
      }

      // Record failure for password errors
      if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password' ||
        err.message === 'UNAUTHORIZED'
      ) {
        try {
          const fRes = await fetch(`${API}/api/lockout/record-failure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: id.trim(), portal: PORTAL }),
          });
          const fData = await fRes.json();
          const newCount = fData.failedAttempts || 0;
          setFailedAttempts(newCount);
          
          if (fData.unknown || newCount === 0) {
            setError('Invalid email id');
          } else {
            setError('');
          }
          
          if (fData.locked || newCount >= MAX_ATTEMPTS) {
            setIsLocked(true);
            setPhase('locked');
            setError('');
          }
        } catch {
          const newCount = failedAttempts + 1;
          setFailedAttempts(newCount);
          if (newCount >= MAX_ATTEMPTS) {
            setIsLocked(true);
            setPhase('locked');
            setError('');
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // ── OTP helpers ──────────────────────────────────────────────────────────
  const handleOtpChange = (refs, setter, idx, val) => {
    if (!/^\d?$/.test(val)) return;
    setter(prev => { const n = [...prev]; n[idx] = val; return n; });
    if (val && idx < 5) refs[idx + 1].current?.focus();
  };

  const handleOtpKeyDown = (refs, values, idx, e) => {
    if (e.key === 'Backspace' && !values[idx] && idx > 0) refs[idx - 1].current?.focus();
  };

  const handleSendOtp = async () => {
    setOtpAttempts(0);
    setOtpLoading(true);
    setOtpError('');
    try {
      const res = await fetch(`${API}/api/lockout/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: id.trim(), portal: PORTAL }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      setOtpDestination(data.destination || '');
      setOtpSent(true);
      setPhase('otp_sent');
      setOtpInput(['', '', '', '', '', '']);
      setCountdownActive(true);
      resetOtpTimer();
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otp = otpInput.join('');
    if (otp.length < 6) { setOtpError('Please enter the complete 6-digit OTP.'); return; }
    setOtpLoading(true);
    setOtpError('');
    try {
      const res = await fetch(`${API}/api/lockout/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: id.trim(), otp, portal: PORTAL }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpAttempts(prev => prev + 1);
        throw new Error(data.error || 'Verification failed');
      }
      setCountdownActive(false);
      setIsLocked(false);
      setFailedAttempts(0);
      setOtpInput(['', '', '', '', '', '']);
      setOtpSent(false);
      setOtpAttempts(0);
      setOtpError('');
      setError('');
      setPhase('login');
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };



  const attemptsLeft = MAX_ATTEMPTS - failedAttempts;

  // ─── Shared dark-theme CSS ────────────────────────────────────────────────
  const saStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 50%, #0a0f1a 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    padding: '1rem',
    position: 'relative',
    overflow: 'hidden',
  };
  const cardStyle = {
    background: 'rgba(10,10,20,0.8)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(180,0,60,0.3)',
    borderRadius: '16px',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '440px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
    animation: 'fadeIn 0.6s ease-out',
    position: 'relative',
    overflow: 'hidden',
  };
  const inputStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e0e0e0',
    borderRadius: '8px',
    padding: '14px 16px',
    width: '100%',
    fontSize: '14px',
    outline: 'none',
    fontFamily: "'Fira Code', monospace",
    boxSizing: 'border-box',
  };
  const labelStyle = {
    display: 'block',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    fontWeight: '600',
    marginBottom: '8px',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
  };
  const btnStyle = (disabled) => ({
    width: '100%',
    padding: '14px',
    background: disabled
      ? 'rgba(255,255,255,0.1)'
      : 'linear-gradient(135deg, #8b0000, #b0003a)',
    border: 'none',
    borderRadius: '8px',
    color: disabled ? 'rgba(255,255,255,0.3)' : 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing: '1px',
    textTransform: 'uppercase',
  });
  const errBox = (msg) => msg ? (
    <div style={{
      background: 'rgba(180,0,60,0.12)',
      border: '1px solid rgba(180,0,60,0.4)',
      borderRadius: '8px',
      padding: '12px 14px',
      marginBottom: '20px',
      color: '#ff6b8a',
      fontSize: '13px',
    }}>⚠ {msg}</div>
  ) : null;

  const globalCss = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');
    @keyframes pulse { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.1)} }
    @keyframes fadeIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    @keyframes scan { 0%{transform:translateY(-100%)} 100%{transform:translateY(400px)} }
  `;

  const otpBoxStyle = {
    width: '42px', height: '48px',
    background: 'rgba(255,255,255,0.06)',
    border: '1.5px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '20px',
    fontWeight: 'bold',
    textAlign: 'center',
    outline: 'none',
    fontFamily: 'Fira Code, monospace',
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Locked — OTP recovery
  // ════════════════════════════════════════════════════════════════════════════
  if (phase === 'locked' || phase === 'otp_sent') {
    return (
      <div style={saStyle}>
        <style>{globalCss}</style>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
            <h1 style={{ color: '#fff', fontSize: '20px', fontWeight: '700', margin: '0 0 6px' }}>Account Locked</h1>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px', margin: 0 }}>
              Too many failed attempts for <strong style={{ color: '#ff6b8a' }}>{id}</strong>.<br />
              An OTP will be sent to your registered email to unlock access.
            </p>
          </div>
          {errBox(otpError)}

          {!otpSent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <button onClick={handleSendOtp} disabled={otpLoading} style={btnStyle(otpLoading)}>
                {otpLoading ? '⏳ Sending…' : '📨 Send OTP to My Email'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.3)', borderRadius: '8px', padding: '12px', textAlign: 'center', marginBottom: '16px' }}>
                <p style={{ color: '#fcd34d', fontSize: '13px', margin: '0 0 4px' }}>OTP sent to your email</p>
                {otpDestination && (
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', margin: '0 0 4px' }}>Sent to: <strong>{otpDestination}</strong></p>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ 
                  display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '12px',
                  background: remaining === 0 ? 'rgba(255,100,100,0.1)' : remaining <= 10 ? 'rgba(255,160,0,0.1)' : 'rgba(100,255,100,0.1)',
                  color: remaining === 0 ? '#ff6b8a' : remaining <= 10 ? '#fcd34d' : '#86efac'
                }}>
                  <span>⏱</span>
                  {remaining === 0 ? 'Expired' : `${remaining}s`}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Attempts:</span>
                  {[1,2,3].map(i => (
                    <div key={i} style={{ 
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: otpAttempts >= i ? '#ff6b8a' : 'rgba(255,255,255,0.1)',
                      border: `1px solid ${otpAttempts >= i ? '#ff6b8a' : 'rgba(255,255,255,0.2)'}`
                    }} />
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                {otpInput.map((digit, idx) => (
                  <input key={idx} ref={otpRefs[idx]}
                    type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={e => handleOtpChange(otpRefs, setOtpInput, idx, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(otpRefs, otpInput, idx, e)}
                    disabled={remaining === 0 || otpAttempts >= 3}
                    style={{ ...otpBoxStyle, 
                      borderColor: (remaining === 0 || otpAttempts >= 3) ? 'rgba(255,100,100,0.3)' : 'rgba(255,255,255,0.2)',
                      background: (remaining === 0 || otpAttempts >= 3) ? 'rgba(255,100,100,0.05)' : 'rgba(255,255,255,0.04)',
                      opacity: (remaining === 0 || otpAttempts >= 3) ? 0.5 : 1
                    }}
                  />
                ))}
              </div>

              {(remaining === 0 || otpAttempts >= 3) && (
                <div style={{ background: 'rgba(255,100,100,0.05)', border: '1px solid rgba(255,100,100,0.2)', borderRadius: '8px', padding: '12px', textAlign: 'center', marginTop: '8px' }}>
                  <p style={{ color: '#ff6b8a', fontSize: '12px', margin: '0 0 8px' }}>
                    {otpAttempts >= 3 ? '❌ 3 incorrect attempts used.' : '⏰ OTP has expired.'} Request a new OTP.
                  </p>
                  <button onClick={handleSendOtp} disabled={otpLoading}
                    style={{ background: 'none', border: 'none', color: '#ff6b8a', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}>
                    {otpLoading ? '⏳ Sending...' : '🔄 Resend OTP'}
                  </button>
                </div>
              )}

              <button onClick={handleVerifyOtp}
                disabled={otpInput.join('').length < 6 || otpLoading || remaining === 0 || otpAttempts >= 3}
                style={btnStyle(otpInput.join('').length < 6 || otpLoading || remaining === 0 || otpAttempts >= 3)}>
                {otpLoading ? '⏳ Verifying…' : '✅ Validate OTP'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Normal Super Admin Login
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div style={saStyle}>
      {/* Animated background orbs */}
      <div style={{
        position: 'absolute', top: '15%', left: '10%', width: '300px', height: '300px',
        background: 'radial-gradient(circle, rgba(139,0,0,0.15) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', animation: 'pulse 4s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', bottom: '20%', right: '10%', width: '250px', height: '250px',
        background: 'radial-gradient(circle, rgba(75,0,130,0.15) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', animation: 'pulse 6s ease-in-out infinite',
      }} />

      <style>{globalCss + `
        .sa-input { background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.1) !important;
          color: #e0e0e0 !important; border-radius: 8px; padding: 14px 16px; width: 100%; font-size: 14px;
          transition: all 0.3s ease; outline: none; font-family: 'Fira Code', monospace; box-sizing: border-box; }
        .sa-input:focus { border-color: rgba(180,0,60,0.7) !important; background: rgba(180,0,60,0.06) !important;
          box-shadow: 0 0 0 3px rgba(180,0,60,0.15); }
        .sa-input::placeholder { color: rgba(255,255,255,0.25); }
        .sa-input:disabled { opacity: 0.35; cursor: not-allowed; }
        .sa-btn { width: 100%; padding: 14px; background: linear-gradient(135deg, #8b0000, #b0003a);
          border: none; border-radius: 8px; color: white; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.3s ease; letter-spacing: 1px; text-transform: uppercase; }
        .sa-btn:hover:not(:disabled) { background: linear-gradient(135deg, #a00000, #cc0044);
          box-shadow: 0 6px 24px rgba(180,0,60,0.4); transform: translateY(-1px); }
        .sa-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      `}</style>

      <div style={cardStyle}>
        {/* Scan line */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: 'linear-gradient(90deg, transparent, rgba(180,0,60,0.6), transparent)',
          animation: 'scan 3s linear infinite',
        }} />

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            width: '60px', height: '60px',
            background: 'linear-gradient(135deg, rgba(139,0,0,0.3), rgba(75,0,130,0.3))',
            border: '1px solid rgba(180,0,60,0.4)',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: '28px',
          }}>🔐</div>
          <h1 style={{ color: '#ffffff', fontSize: '22px', fontWeight: '700', margin: '0 0 6px', letterSpacing: '0.5px' }}>
            System Access
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px', margin: 0, fontFamily: 'Fira Code, monospace', letterSpacing: '1.5px' }}>
            FOUNDERS PORTAL · RESTRICTED
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(180,0,60,0.12)', border: '1px solid rgba(180,0,60,0.4)',
            borderRadius: '8px', padding: '12px 14px', marginBottom: '20px',
            color: '#ff6b8a', fontSize: '13px',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Attempt warning */}
        {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
          <div style={{
            background: 'rgba(255,160,0,0.1)', border: '1px solid rgba(255,160,0,0.3)',
            borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
            color: '#fcd34d', fontSize: '12px',
          }}>
            ⚠ {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} remaining before lockout.
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Admin ID (Email)</label>
            <input
              type="email"
              className="sa-input"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="founder@pws.system"
              required
              autoFocus
              disabled={isLocked}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              className="sa-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              disabled={isLocked}
            />
          </div>

          <div style={{ marginTop: '8px' }}>
            <button type="submit" className="sa-btn" disabled={loading || isLocked}>
              {loading ? '⏳ Authenticating…' : '⚡ Access Portal'}
            </button>
          </div>
        </form>

        <div style={{ marginTop: '28px', textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: '11px', margin: 0, fontFamily: 'Fira Code, monospace' }}>
            UNAUTHORIZED ACCESS IS A CRIMINAL OFFENCE
          </p>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminLogin;
