import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../firebase';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PORTAL = 'admin';
const MAX_ATTEMPTS = 3;
const OTP_SECONDS = 60;

// Mask an email for display: keeps first 3 chars + domain visible, hides the rest
// e.g. john.doe@example.com → joh****@example.com
const maskEmail = (email) => {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const visible = Math.min(3, local.length);
  return local.slice(0, visible) + '****@' + domain;
};

// ─── Utility: OTP Countdown Hook ─────────────────────────────────────────────
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
const AdminLogin = () => {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentTerms, setConsentTerms]     = useState(false);
  const [consentStatus, setConsentStatus]   = useState('idle'); // idle|checking|needed|done
  const [pendingUser, setPendingUser]       = useState(null);

  // Lockout state
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked]             = useState(false);
  const [lockoutChecked, setLockoutChecked] = useState(false); // true after initial status check

  // OTP-recovery state
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

  // Reset-password sub-phase
  const [newPw, setNewPw]             = useState('');
  const [confirmPw, setConfirmPw]     = useState('');
  const [resetOtpInput, setResetOtpInput] = useState(['', '', '', '', '', '']);
  const [resetOtpSent, setResetOtpSent]   = useState(false);
  const [resetCountdownActive, setResetCountdownActive] = useState(false);
  const { remaining: resetRemaining, reset: resetPwTimer } = useCountdown(OTP_SECONDS, resetCountdownActive);
  const [resetOtpAttempts, setResetOtpAttempts] = useState(0);
  const [successPopup, setSuccessPopup]   = useState(false);
  const [resetError, setResetError]       = useState('');
  const [resetLoading, setResetLoading]   = useState(false);

  const otpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const resetOtpRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const navigate = useNavigate();

  // ── Clear any stale session when landing on login page ──────────────────
  useEffect(() => {
    sessionStorage.removeItem('adminAuthenticated');
    sessionStorage.removeItem('adminEmail');
    sessionStorage.removeItem('portal');
  }, []);

  // ── Check lockout status from Firestore ───────────────────────────────
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
    } finally {
      setLockoutChecked(true);
    }
  };

  // ── Step 1: Firebase Auth + Admin role check ─────────────────────────────
  const handleLoginSubmit = async (e) => {
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
      sessionStorage.setItem('portal', 'admin');
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // ── PORTAL ISOLATION: enforce admin role strictly ──
      const adminDoc = await getDoc(doc(db, 'admin_users', user.uid));
      if (!adminDoc.exists() || adminDoc.data().role !== 'admin') {
        await auth.signOut();
        throw new Error('UNAUTHORIZED');
      }

      // ── Force sync custom claims (handles teacher→admin promotion) ──
      // Ensures the admin:true claim is written and the REFRESHED token has
      // it before we navigate. Without this guarantee, AuthContext's
      // onAuthStateChanged fires with a stale token (admin:false) and the
      // ProtectedRoute ejects the user immediately.
      try {
        const idToken = await user.getIdToken();
        await fetch(`${API}/api/auth/sync-claims`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${idToken}` },
        });
        // Force a token refresh to pick up the newly synced claims
        await user.getIdToken(true);
        // Verify the refreshed token actually carries admin:true.
        // If not (edge case: claim propagation lag), do one more refresh.
        const freshResult = await user.getIdTokenResult();
        if (!freshResult.claims.admin) {
          await new Promise(r => setTimeout(r, 500)); // brief propagation wait
          await user.getIdToken(true);
        }
      } catch (syncErr) {
        console.warn('[AdminLogin] Claims sync failed (non-fatal):', syncErr);
      }

      // Successful login — reset any failure counter
      if (failedAttempts > 0) {
        fetch(`${API}/api/lockout/record-failure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // We won't record success here; backend resets on OTP verify only.
        }).catch(() => {});
      }

      sessionStorage.setItem('adminAuthenticated', 'true');
      sessionStorage.setItem('adminEmail', email.trim());
      sessionStorage.setItem('tenantId', adminDoc.data().tenantId || '');
      sessionStorage.setItem('portal', 'admin');

      setPendingUser(user);
      setConsentStatus('checking');
    } catch (err) {
      const code = err.code || '';
      let msg = '';

      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = 'Incorrect password.';
      } else if (code === 'auth/user-not-found') {
        msg = 'No account found with this email.';
      } else if (code === 'auth/too-many-requests') {
        msg = 'Too many attempts. Please try again later.';
      } else if (code === 'auth/network-request-failed') {
        msg = 'Network error. Check your connection.';
      } else if (err.message === 'UNAUTHORIZED') {
        msg = 'Unauthorized. You do not have Admin privileges.';
      } else {
        msg = err.message || 'Login failed. Please try again.';
      }

      // Record failure if it's a password/credential error
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        err.message === 'UNAUTHORIZED'
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
          
          if (fData.unknown || newCount === 0) {
            setError(msg);
          } else {
            setError('');
          }
          
          if (fData.locked || newCount >= MAX_ATTEMPTS) {
            // Instantly transition to locked — no page refresh needed
            setIsLocked(true);
            setPhase('locked');
            setError('');
          }
        } catch {
          // Non-fatal
          const newCount = failedAttempts + 1;
          setFailedAttempts(newCount);
          if (newCount >= MAX_ATTEMPTS) {
            setIsLocked(true);
            setPhase('locked');
            setError('');
          }
        }
      }

      setLoading(false);
    }
  };

  // ── Step 2: Check consent ────────────────────────────────────────────────
  useEffect(() => {
    if (consentStatus !== 'checking' || !pendingUser) return;
    (async () => {
      try {
        const adminRef = doc(db, 'admin_users', pendingUser.uid);
        const snap = await getDoc(adminRef);
        const hasConsented = snap.exists() && snap.data()?.legalConsent?.acceptedAt;
        if (hasConsented) {
          navigate('/admin/dashboard');
        } else {
          setConsentStatus('needed');
          setLoading(false);
        }
      } catch (err) {
        console.error('Consent check error:', err);
        // Non-fatal: allow access
        navigate('/admin/dashboard');
      }
    })();
  }, [consentStatus, pendingUser, navigate]);

  // ── Step 3: Consent submit ───────────────────────────────────────────────
  const handleConsentSubmit = async (e) => {
    e.preventDefault();
    if (!consentPrivacy || !consentTerms || !pendingUser) return;
    setLoading(true);
    setError('');
    try {
      await updateDoc(doc(db, 'admin_users', pendingUser.uid), {
        'legalConsent.termsAccepted':         true,
        'legalConsent.privacyPolicyAccepted': true,
        'legalConsent.dpaAccepted':           true,
        'legalConsent.versionAccepted':       'v1.2',
        'legalConsent.acceptedAt':            serverTimestamp(),
        'legalConsent.userAgent':             navigator.userAgent,
      });
      navigate('/admin/dashboard');
    } catch (err) {
      console.error('Consent save error:', err);
      setError('Failed to save consent. Please try again.');
      setLoading(false);
    }
  };

  // ── OTP helpers ──────────────────────────────────────────────────────────
  const handleOtpChange = (refs, setter, idx, val) => {
    if (!/^\d?$/.test(val)) return;
    setter(prev => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
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

  const pwMatch = newPw && confirmPw && newPw === confirmPw;
  const pwNoMatch = confirmPw && newPw !== confirmPw;

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Consent screen
  // ════════════════════════════════════════════════════════════════════════════
  if (consentStatus === 'needed') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">📋</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">One-Time Consent</h1>
            <p className="text-gray-500 text-sm">
              Please review and accept the following before using the Admin Portal.
              <br />
              <span className="text-green-600 font-medium">You will not be asked again.</span>
            </p>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleConsentSubmit} className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-4">
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
                  </a>.
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
                  </a>. I consent to secure, temporary storage of my personal information for platform administration. I understand this data is processed by NextSolves solely on the College's behalf, as detailed in the{' '}
                  <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    Full Privacy Policy
                  </a>.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !consentPrivacy || !consentTerms}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? 'Saving…' : '✅ Accept & Continue to Admin Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Success popup (password reset)
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
  //  RENDER: Post-OTP verified — choose recovery option
  // ════════════════════════════════════════════════════════════════════════════
  if (phase === 'otp_verified') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🔓</div>
            <h1 className="text-2xl font-bold text-gray-800 mb-1">Account Unlocked</h1>
            <p className="text-gray-500 text-sm">OTP verified successfully. Choose how to proceed:</p>
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
            {/* New password */}
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
            {/* Confirm password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
              />
              {/* Real-time match label */}
              {confirmPw && (
                <p className={`text-xs mt-1 font-medium ${pwMatch ? 'text-green-600' : 'text-red-500'}`}>
                  {pwMatch ? '✅ Matched' : '❌ Does not match'}
                </p>
              )}
            </div>

            {/* Send OTP button — enabled only when passwords match */}
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
                {/* OTP input boxes */}
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
                {/* Resend banner */}
                {(resetRemaining === 0 || resetOtpAttempts >= 3) && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-4 text-center">
                    <p className="text-orange-700 text-xs mb-2">
                      {resetOtpAttempts >= 3 ? '❌ 3 incorrect attempts used.' : '⏰ OTP has expired.'}
                      {' '}Request a new OTP to continue.
                    </p>
                    <button
                      onClick={handleSendResetOtp}
                      disabled={resetLoading}
                      className="text-sm font-semibold text-orange-700 underline hover:text-orange-900 disabled:opacity-50"
                    >
                      {resetLoading ? '⏳ Sending...' : '🔄 Resend OTP'}
                    </button>
                  </div>
                )}

                <button
                  onClick={handleResetPassword}
                  disabled={resetOtpInput.join('').length < 6 || resetLoading || resetRemaining === 0 || resetOtpAttempts >= 3}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {resetLoading ? 'Validating…' : '✅ Validate OTP & Set Password'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER: Locked — OTP recovery screen
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
              <br />An OTP will be sent to NextSolves to unlock your account.
            </p>
          </div>

          {otpError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">{otpError}</div>
          )}

          {!otpSent ? (
            <div className="space-y-4">
              <button
                onClick={handleSendOtp}
                disabled={otpLoading}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {otpLoading ? 'Sending…' : '📨 Send OTP to NextSolves'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center mb-4">
                <p className="text-sm font-semibold text-amber-800">OTP sent to NextSolves</p>
                {otpDestination && (
                  <p className="text-xs text-amber-600 mt-1">Destination: <strong>{maskEmail(otpDestination)}</strong></p>
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

              {/* OTP input */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 text-center">
                  Enter 6-Digit OTP
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
                    {otpLoading ? '⏳ Sending...' : '🔄 Resend OTP to NextSolves'}
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
  //  RENDER: Normal Admin Login Screen
  // ════════════════════════════════════════════════════════════════════════════
  const attemptsLeft = MAX_ATTEMPTS - failedAttempts;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🛡️</div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Admin Login</h1>
          <p className="text-gray-600">Enter your credentials to access the portal</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        {/* Attempt warning banner */}
        {failedAttempts > 0 && failedAttempts < MAX_ATTEMPTS && (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 px-4 py-2 rounded mb-4 text-sm font-medium">
            ⚠ {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} remaining before account lockout.
          </div>
        )}

        <form onSubmit={handleLoginSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Admin Email ID</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your Email ID"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              autoComplete="username"
              required
              autoFocus
              disabled={isLocked}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
              autoComplete="current-password"
              required
              disabled={isLocked}
            />
          </div>

          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? 'Signing in…' : '✅ Login as Admin'}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          <Link to="/admin/activate" className="text-indigo-600 hover:text-indigo-800 font-medium">
            First time? Activate your account
          </Link>
          <a href="/" className="text-gray-500 hover:text-gray-700 mt-2">
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
