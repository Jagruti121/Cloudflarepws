import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../firebase';

/**
 * ONE-TIME SETUP PAGE — Bootstrap the Super Admin account.
 * Visit: http://localhost:5173/setup
 * 
 * This page creates:
 * 1. A Firebase Auth user for the Super Admin
 * 2. A document in /super_admins/{uid} granting full system access
 * 
 * After setup is complete, this page becomes useless (it will report the account already exists).
 * DELETE or disable this route in App.jsx after first use for security.
 */



const SetupPage = () => {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSetup = async () => {
    setLoading(true);
    setStatus('');
    setError('');

    try {
      let uid;

      // Step 1: Try to create Firebase Auth user
      setStatus('Step 1/3: Creating Firebase Auth account...');
      try {
        const cred = await createUserWithEmailAndPassword(auth, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
        uid = cred.user.uid;
        setStatus(`Step 1/3: ✅ Auth account created (uid: ${uid})`);
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          // Already exists — sign in to get uid
          setStatus('Step 1/3: Account exists, signing in...');
          const cred = await signInWithEmailAndPassword(auth, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
          uid = cred.user.uid;
          setStatus(`Step 1/3: ✅ Signed in to existing account (uid: ${uid})`);
        } else {
          throw authErr;
        }
      }

      // Step 2: Check if super_admins doc already exists
      setStatus('Step 2/3: Checking super_admins collection...');
      const superAdminRef = doc(db, 'super_admins', uid);
      const existing = await getDoc(superAdminRef);

      if (existing.exists()) {
        setStatus(`Step 2/3: ✅ super_admins doc already exists!`);
      } else {
        // Step 3: Create super_admins document
        setStatus('Step 3/3: Writing super_admins document...');
        await setDoc(superAdminRef, {
          email: SUPER_ADMIN_EMAIL,
          role: 'super_admin',
          createdAt: serverTimestamp(),
        });
        setStatus('Step 3/3: ✅ super_admins document created!');
      }

      setDone(true);
      setStatus('🎉 Setup complete! You can now login at /super_admin/LIO-73-23/2372/SYSTEM');

    } catch (err) {
      console.error('Setup error:', err);
      setError(`❌ Error: ${err.message} (code: ${err.code})`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a0a2e 50%, #0a0f1a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', sans-serif", padding: '2rem',
    }}>
      <div style={{
        background: 'rgba(10,10,20,0.9)', border: '1px solid rgba(180,0,60,0.4)',
        borderRadius: '16px', padding: '40px', maxWidth: '560px', width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <h1 style={{ color: '#fff', fontSize: '22px', marginBottom: '8px' }}>⚙️ PWS — One-Time Setup</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', marginBottom: '24px', lineHeight: '1.6' }}>
          This page bootstraps the Super Admin account in Firebase.<br/>
          It will create Firebase Auth user and <code style={{ color: '#fbbf24' }}>/super_admins/{'{uid}'}</code> document.
        </p>

        <div style={{
          background: 'rgba(255,200,0,0.08)', border: '1px solid rgba(255,200,0,0.2)',
          borderRadius: '8px', padding: '14px 16px', marginBottom: '24px', fontSize: '13px', color: '#fbbf24',
        }}>
          <strong>Super Admin Email:</strong> {SUPER_ADMIN_EMAIL}<br />
          <strong>Temp Password:</strong> PmsFounder@2025 <span style={{ opacity: 0.6 }}>(change after first login)</span>
        </div>

        {status && (
          <div style={{
            background: 'rgba(0,200,100,0.08)', border: '1px solid rgba(0,200,100,0.2)',
            borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
            color: '#4ade80', fontSize: '13px', whiteSpace: 'pre-line',
          }}>
            {status}
          </div>
        )}

        {error && (
          <div style={{
            background: 'rgba(180,0,60,0.1)', border: '1px solid rgba(180,0,60,0.4)',
            borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
            color: '#ff6b8a', fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {!done ? (
          <button
            onClick={handleSetup}
            disabled={loading}
            style={{
              width: '100%', padding: '14px',
              background: loading ? 'rgba(139,0,0,0.4)' : 'linear-gradient(135deg, #8b0000, #b0003a)',
              border: 'none', borderRadius: '8px', color: 'white',
              fontSize: '14px', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s', letterSpacing: '1px',
            }}
          >
            {loading ? '⏳ Setting up...' : '⚡ Run One-Time Setup'}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <a
              href="/super_admin/LIO-73-23/2372/SYSTEM"
              style={{
                display: 'block', width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #8b0000, #b0003a)',
                border: 'none', borderRadius: '8px', color: 'white',
                fontSize: '14px', fontWeight: '700', textAlign: 'center',
                textDecoration: 'none', letterSpacing: '1px', boxSizing: 'border-box',
              }}
            >
              🔐 Go to Super Admin Login →
            </a>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', textAlign: 'center', margin: 0 }}>
              After logging in, disable this /setup route in App.jsx for security.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupPage;
