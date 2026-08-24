/**
 * SuperAdminRoute.jsx
 *
 * SECURITY FIX A-1: Route-level guard for Super Admin pages.
 *
 * Problem: The Super Admin URL is discoverable in the client bundle.
 * Even if the URL were completely hidden, we must not rely on "security through
 * obscurity". This component performs a real Firebase Auth + Firestore
 * super_admins document check before rendering any protected child.
 *
 * Users who are:
 *   - Not authenticated at all          → redirected to SA login
 *   - Authenticated but not super_admin → signed out + redirected
 *   - Verified super_admin              → children rendered
 */

import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const SA_LOGIN_PATH = '/super_admin/LIO-73-23/2372/SYSTEM';

const SuperAdminRoute = ({ children }) => {
  const [status, setStatus] = useState('checking'); // 'checking' | 'authorized' | 'denied'

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus('denied');
        return;
      }
      try {
        const saDoc = await getDoc(doc(db, 'super_admins', user.uid));
        if (saDoc.exists()) {
          setStatus('authorized');
        } else {
          // Authenticated user but NOT in super_admins — boot them out
          await auth.signOut();
          setStatus('denied');
        }
      } catch (err) {
        console.error('[SuperAdminRoute] Verification error:', err);
        setStatus('denied');
      }
    });
    return unsubscribe;
  }, []);

  if (status === 'checking') {
    // Show a minimal, non-branded loading state to avoid UI flash
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0a0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.3)',
        fontFamily: 'Fira Code, monospace',
        fontSize: '12px',
        letterSpacing: '2px',
      }}>
        VERIFYING...
      </div>
    );
  }

  if (status === 'denied') {
    return <Navigate to={SA_LOGIN_PATH} replace />;
  }

  return children;
};

export default SuperAdminRoute;
