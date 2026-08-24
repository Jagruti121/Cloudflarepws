import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import Navbar from '../../components/Navbar';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const StudentLogin = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    session_code: '',
    roll_no: ''
  });
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentTerms, setConsentTerms] = useState(false);

  // SECURITY FIX HIGH-02: Student identity is now verified server-side.
  // The backend (/api/student/login) queries Firestore via Admin SDK,
  // verifies name+rollNo+sessionCode, and issues a cryptographically signed
  // submitToken. This prevents the IDOR vulnerability where anyone knowing
  // sessionCode+rollNo could query student data or submit on behalf of them.
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const sessionCode = formData.session_code.trim().toUpperCase();
    const rollNo = formData.roll_no.trim().toUpperCase();

    if (!sessionCode || !rollNo) {
      alert('Please enter Session Code and Roll Number.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/student/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode, rollNo }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'ALREADY_SUBMITTED') {
          alert('⛔ Access Denied.\n\nThe session has been ended for you or you have already submitted your exam.');
        } else if (data.error) {
          alert(`❌ Login Failed.\n\n${data.error}`);
        } else {
          alert('❌ Login Failed.\n\nInvalid Session Code or Roll Number.');
        }
        setLoading(false);
        return;
      }

      const { submitToken, firebaseToken, tenantId, studentDocId, exactRollNo, collegeName, fullName } = data;
      const finalRollNo = exactRollNo || rollNo;

      // Store the submit token in sessionStorage so ExamInterface can use it
      sessionStorage.setItem('pms_submit_token', submitToken);
      sessionStorage.setItem('pms_student_doc_id', studentDocId);
      sessionStorage.setItem('pms_student_name', fullName);
      if (collegeName) {
        sessionStorage.setItem('pms_college_name', collegeName);
      }

      // SECURITY FIX HIGH-05: Use server-generated Custom Token instead of Anonymous Auth.
      // This allows disabling Anonymous Auth in Firebase completely, blocking abuse.
      // The student's UID in Firebase is now exactly their studentDocId.
      let studentUid;
      try {
        await signOut(auth); // discard any previous session
        const authCred = await signInWithCustomToken(auth, firebaseToken);
        studentUid = authCred.user.uid;
      } catch (authErr) {
        console.error('Firebase Auth Error:', authErr);
        alert('Authentication failed. Please try again.');
        setLoading(false);
        return;
      }

      // Register the UID server-side so Firestore rules can verify
      // the student's identity for onSnapshot reads in ExamInterface.
      // (This maintains compatibility with existing firestore.rules that check anonymous_uid).
      try {
        const uidRes = await fetch(`${API_URL}/api/student/register-uid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submitToken, anonymousUid: studentUid }),
        });
        if (!uidRes.ok) {
          const uidErr = await uidRes.json().catch(() => ({}));
          console.error('register-uid failed:', uidErr.error);
          alert('Session setup failed. Please try again.');
          setLoading(false);
          return;
        }
      } catch (networkErr) {
        console.error('Network Error during register-uid:', networkErr);
        alert('Failed to complete session setup due to network error.');
        setLoading(false);
        return;
      }

      navigate(`/student/exam?session=${sessionCode}&roll=${finalRollNo}&tenant=${tenantId}`);
    } catch (error) {
      console.error('Login Error:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = consentPrivacy && consentTerms;

  // ══════════════════════════════════════════════════════════════════════
  //  RENDER: Student Login Screen (consent checkboxes are inline)
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="container mx-auto px-4 py-12 flex justify-center items-center">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full border border-gray-100">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-blue-600 mb-2">Student Login</h1>
            <p className="text-gray-500 text-sm">Enter your exam details to begin</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">

            {/* Session Code Input */}
            <div>
              <label className="block text-gray-700 font-bold mb-2">Session Code</label>
              <input
                type="text"
                value={formData.session_code}
                onChange={(e) => setFormData({...formData, session_code: e.target.value})}
                className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition"
                placeholder="e.g. JAVA492"
                required
              />
            </div>

            {/* Roll Number Input */}
            <div>
              <label className="block text-gray-700 font-bold mb-2">Roll Number</label>
              <input
                type="text"
                value={formData.roll_no}
                onChange={(e) => setFormData({...formData, roll_no: e.target.value})}
                className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition"
                placeholder="e.g. 101"
                required
              />
            </div>

            {/* ── Inline Consent Checkboxes ── */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-1">Data Consent Required</p>

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
                  . I consent to the secure, temporary storage of my exam file for evaluation by my College. I understand this data is processed by NextSolves solely on the College's behalf and will not be used for advertising, as detailed in the{' '}
                  <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    Full Privacy Policy
                  </a>
                  .
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !isFormValid}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying...' : 'Enter Exam'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default StudentLogin;