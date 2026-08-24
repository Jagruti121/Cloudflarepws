import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PORTAL = 'teacher';
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
const TeacherLogin = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Lockout state
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked]             = useState(false);

  // phase: 'login' | 'locked' | 'otp_sent' | 'otp_verified' | 'reset_pw'
  const [phase, setPhase]                   = useState('login');
  const [otpInput, setOtpInput]             = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError]             = useState('');
  const [otpLoading, setOtpLoading]         = useState(false);
  const [otpDestination, setOtpDestination] = useState('');
  const [otpSent, setOtpSent]               = useState(false);
  const [countdownActive, setCountdownActive] = useState(false);
  const { remaining, reset: resetOtpTimer } = useCountdown(OTP_SECONDS, countdownActive);
  const [otpAttempts, setOtpAttempts]       = useState(0);

  // Reset-password state
  const [newPw, setNewPw]             = useState('');
  const [confirmPw, setConfirmPw]     = useState('');
  const [resetOtpInput, setResetOtpInput] = useState(['', '', '', '', '', '']);
  const [resetOtpSent, setResetOtpSent]   = useState(false);
  const [resetCountdownActive, setResetCountdownActive] = useState(false);
  const { remaining: resetRemaining, reset: resetPwTimer } = useCountdown(OTP_SECONDS, resetCountdownActive);
  const [resetOtpAttempts, setResetOtpAttempts] = useState(0);
  const [resetError, setResetError]     = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [successPopup, setSuccessPopup] = useState(false);

  const otpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const resetOtpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  const { teacherLogin } = useAuth();
  const navigate = useNavigate();

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

  // ── Login handler ────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setError('');
    setLoading(true);

    const locked = await checkLockoutStatus(email.trim());
    if (locked) {
      setLoading(false);
      return;
    }

    try {
      await teacherLogin(email, password);
      navigate('/teacher/dashboard');
    } catch (err) {
      console.error('[TeacherLogin] Auth error:', err);
      try { await signOut(auth); } catch (_) {}

      const code = err?.code || '';
      let msg = '';
      if (
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential'
      ) {
        msg = 'Invalid email or password. Please check your credentials.';
      } else if (code === 'auth/too-many-requests') {
        msg = 'Too many failed attempts. Please wait before trying again.';
      } else if (code === 'pms/wrong-portal') {
        // Admin account attempting teacher portal — show clear redirect hint
        msg = 'This is an Admin account. Please sign in through the Admin portal instead.';
        setError(msg);
        setLoading(false);
        return; // Do NOT record a lockout failure for a wrong-portal attempt
      } else if (err?.message === 'Teacher account not found') {
        // Firebase Auth succeeded but no teacher_users doc exists.
        // This is a setup error — do NOT record a lockout failure for it.
        msg = 'No teacher account found for this email. Please contact your admin.';
        setError(msg);
        setLoading(false);
        return;
      } else {
        msg = 'Login failed. Please try again.';
      }

      // Record failure ONLY for credential errors (wrong password / unknown email)
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential'
      ) {
        try {
          const fRes = await fetch(`${API}/api/lockout/record-failure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), portal: PORTAL }),
          });
          const fData = await fRes.json();
          const newCount = fData.failedAttempts || 0;
          setFailedAttempts(newCount);

          if (fData.locked || newCount >= MAX_ATTEMPTS) {
            setIsLocked(true);
            setPhase('locked');
            setError('');
          } else {
            // Always show the error message with remaining attempt count
            const left = MAX_ATTEMPTS - newCount;
            setError(fData.unknown
              ? msg
              : `${msg} (${left} attempt${left === 1 ? '' : 's'} remaining)`);
          }
        } catch {
          const newCount = failedAttempts + 1;
          setFailedAttempts(newCount);
          if (newCount >= MAX_ATTEMPTS) {
            setIsLocked(true);
            setPhase('locked');
            setError('');
          } else {
            setError(msg);
          }
        }
      } else {
        setError(msg);
      }

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
    if (e.key === 'Backspace' && !values[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  };

  const handleSendOtp = async () => {
    setOtpAttempts(0);
    setOtpLoading(true);
    setOtpError('');
    try {
      const res = await fetch(`${API}/api/lockout/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), portal: PORTAL }),
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
        body: JSON.stringify({ email: email.trim(), otp, portal: PORTAL }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpAttempts(prev => prev + 1);
        throw new Error(data.error || 'Verification failed');
      }
      setCountdownActive(false);
      setIsLocked(false);
      setPhase('otp_verified');
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleUseOldPassword = () => {
    setPhase('login');
    setIsLocked(false);
    setFailedAttempts(0);
    setOtpInput(['', '', '', '', '', '']);
    setOtpSent(false);
    setError('');
  };

  const handleSendResetOtp = async () => {
    setResetOtpAttempts(0);
    setResetLoading(true);
    setResetError('');
    try {
      const res = await fetch(`${API}/api/lockout/send-reset-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), portal: PORTAL }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      setResetOtpSent(true);
      setResetOtpInput(['', '', '', '', '', '']);
      setResetCountdownActive(true);
      resetPwTimer();
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const otp = resetOtpInput.join('');
    if (otp.length < 6) { setResetError('Please enter the complete 6-digit OTP.'); return; }
    setResetLoading(true);
    setResetError('');
    try {
      const res = await fetch(`${API}/api/lockout/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp, newPassword: newPw, portal: PORTAL }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetOtpAttempts(prev => prev + 1);
        throw new Error(data.error || 'Reset failed');
      }
      setResetCountdownActive(false);
      setSuccessPopup(true);
      setTimeout(() => {
        setSuccessPopup(false);
        handleUseOldPassword();
      }, 3000);
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  const pwMatch   = newPw && confirmPw && newPw === confirmPw;
  const pwNoMatch = confirmPw && newPw !== confirmPw;
  const attemptsLeft = MAX_ATTEMPTS - failedAttempts;

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Success popup
  // ════════════════════════════════════════════════════════════════════════════
  if (successPopup) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-10 max-w-sm w-full text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Password Updated!</h2>
          <p className="text-gray-500 text-sm">Your new password is successfully set.<br />Redirecting to login…</p>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: OTP verified — choose recovery option
  // ════════════════════════════════════════════════════════════════════════════
  if (phase === 'otp_verified') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🔓</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Account Unlocked</h1>
            <p className="text-gray-500 text-sm">OTP verified successfully. How would you like to proceed?</p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleUseOldPassword}
              className="w-full border-2 border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold py-3 rounded-lg transition"
            >
              🔑 Use Old Password
            </button>
            <button
              onClick={() => setPhase('reset_pw')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
            >
              🔄 Reset Password
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Reset password flow
  // ════════════════════════════════════════════════════════════════════════════
  if (phase === 'reset_pw') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🔑</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Reset Password</h1>
            <p className="text-gray-400 text-sm">Enter and confirm your new password, then validate with OTP.</p>
          </div>

          {resetError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">{resetError}</div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Enter new password"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              />
              {confirmPw && (
                <p className={`text-xs mt-1 font-medium ${pwMatch ? 'text-green-600' : 'text-red-500'}`}>
                  {pwMatch ? '✅ Matched' : '❌ Does not match'}
                </p>
              )}
            </div>

            {!resetOtpSent ? (
              <button
                onClick={handleSendResetOtp}
                disabled={!pwMatch || resetLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resetLoading ? 'Sending…' : '📨 Send OTP'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center mb-4">
                  <p className="text-sm font-semibold text-blue-800">OTP sent to your email</p>
                </div>

                {/* Timer + attempts row */}
                <div className="flex items-center justify-between mb-3">
                  <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    resetRemaining === 0 ? 'bg-red-100 text-red-700' :
                    resetRemaining <= 10 ? 'bg-orange-100 text-orange-700 animate-pulse' :
                    'bg-green-100 text-green-700'
                  }`}>
                    <span>⏱</span>
                    {resetRemaining === 0 ? 'Expired' : `${resetRemaining}s`}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">Attempts:</span>
                    {[1,2,3].map(i => (
                      <div key={i} className={`w-2.5 h-2.5 rounded-full border ${
                        resetOtpAttempts >= i ? 'bg-red-500 border-red-500' : 'bg-gray-200 border-gray-300'
                      }`} />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 justify-center">
                  {resetOtpInput.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={resetOtpRefs[idx]}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpChange(resetOtpRefs, setResetOtpInput, idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(resetOtpRefs, resetOtpInput, idx, e)}
                      disabled={resetRemaining === 0 || resetOtpAttempts >= 3}
                      className={`w-10 h-12 border-2 rounded-lg text-center text-lg font-bold focus:outline-none transition ${
                        resetRemaining === 0 || resetOtpAttempts >= 3
                          ? 'border-red-200 bg-red-50 text-red-300 cursor-not-allowed'
                          : 'border-gray-300 focus:border-blue-500'
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={handleResetPassword}
                  disabled={resetOtpInput.join('').length < 6 || resetLoading}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {resetLoading ? 'Validating…' : '✅ Validate OTP & Set Password'}
                </button>
                {resetRemaining === 0 && (
                  <button
                    onClick={handleSendResetOtp}
                    disabled={resetLoading}
                    className="w-full text-blue-600 hover:underline text-sm"
                  >
                    Resend OTP
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Locked — Send OTP to Admin
  // ════════════════════════════════════════════════════════════════════════════
  if (phase === 'locked' || phase === 'otp_sent') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🔒</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Account Locked</h1>
            <p className="text-gray-500 text-sm">
              Too many failed login attempts for <strong>{email}</strong>.
              <br />Click the button below to send a recovery OTP to your Admin.
            </p>
          </div>

          {otpError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">{otpError}</div>
          )}

          {!otpSent ? (
            <div className="space-y-4">
              {/* Only this button is active */}
              <button
                onClick={handleSendOtp}
                disabled={otpLoading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {otpLoading ? 'Sending…' : '📨 Send OTP to Admin'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center mb-4">
                <p className="text-sm font-semibold text-amber-800">OTP sent to your Admin</p>
                {otpDestination && (
                  <p className="text-xs text-amber-600 mt-1">Sent to: <strong>{otpDestination}</strong></p>
                )}
              </div>

              {/* Timer + attempts row */}
              <div className="flex items-center justify-between mb-3">
                <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  remaining === 0 ? 'bg-red-100 text-red-700' :
                  remaining <= 10 ? 'bg-orange-100 text-orange-700 animate-pulse' :
                  'bg-green-100 text-green-700'
                }`}>
                  <span>⏱</span>
                  {remaining === 0 ? 'Expired' : `${remaining}s`}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">Attempts:</span>
                  {[1,2,3].map(i => (
                    <div key={i} className={`w-2.5 h-2.5 rounded-full border ${
                      otpAttempts >= i ? 'bg-red-500 border-red-500' : 'bg-gray-200 border-gray-300'
                    }`} />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 text-center">
                  Enter 6-Digit OTP (from your Admin)
                </label>
                <div className="flex gap-2 justify-center">
                  {otpInput.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={otpRefs[idx]}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpChange(otpRefs, setOtpInput, idx, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(otpRefs, otpInput, idx, e)}
                      disabled={remaining === 0 || otpAttempts >= 3}
                      className={`w-10 h-12 border-2 rounded-lg text-center text-lg font-bold focus:outline-none transition ${
                        remaining === 0 || otpAttempts >= 3
                          ? 'border-red-200 bg-red-50 text-red-300 cursor-not-allowed'
                          : 'border-gray-300 focus:border-blue-500'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Resend banner */}
              {(remaining === 0 || otpAttempts >= 3) && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-center">
                  <p className="text-orange-700 text-xs mb-2">
                    {otpAttempts >= 3 ? '❌ 3 incorrect attempts used.' : '⏰ OTP has expired.'}
                    {' '}Request a new OTP to continue.
                  </p>
                  <button
                    onClick={handleSendOtp}
                    disabled={otpLoading}
                    className="text-sm font-semibold text-orange-700 underline hover:text-orange-900 disabled:opacity-50"
                  >
                    {otpLoading ? '⏳ Sending...' : '🔄 Resend OTP to Admin'}
                  </button>
                </div>
              )}

              <button
                onClick={handleVerifyOtp}
                disabled={otpInput.join('').length < 6 || otpLoading || remaining === 0 || otpAttempts >= 3}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {otpLoading ? 'Verifying…' : '✅ Validate OTP'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Normal Teacher Login
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">👩‍🏫</div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Teacher Login</h1>
          <p className="text-gray-600">Sign in with your credentials</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Attempt warning */}
        {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 px-4 py-2 rounded mb-4 text-sm font-medium">
            ⚠ {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} remaining before account lockout.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              autoComplete="username"
              required
              disabled={isLocked}
            />
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              autoComplete="current-password"
              required
              disabled={isLocked}
            />
          </div>

          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <a href="/" className="text-blue-600 hover:text-blue-800 text-sm">
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
};

export default TeacherLogin;
