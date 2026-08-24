import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import KeyExpiryPopup from './KeyExpiryPopup';
import LoadingPage from './LoadingPage';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { currentUser, userRole, loading: authLoading } = useAuth();
  const [isExpired, setIsExpired] = useState(false);
  const [loadingExpiry, setLoadingExpiry] = useState(true);

  // ── SECURITY FIX HIGH-06: Never trust sessionStorage for auth decisions ──
  // The previous code used sessionStorage.getItem('adminAuthenticated') as a
  // fast path, which ANY visitor could bypass via browser DevTools:
  //   sessionStorage.setItem('adminAuthenticated', 'true');
  // The only trustworthy source is Firebase Auth (currentUser + verified role
  // from Firestore), which AuthContext.jsx already handles on every page load.
  const actualRole = currentUser ? userRole : null;

  useEffect(() => {
    const checkExpiry = async () => {
      try {
        let q;
        if (actualRole === 'admin' && currentUser?.email) {
          q = query(
            collection(db, 'product_keys'),
            where('adminEmail', '==', currentUser.email)
          );
        } else if (actualRole === 'teacher' && currentUser?.email) {
          q = query(
            collection(db, 'product_keys'),
            where('facultyEmails', 'array-contains', currentUser.email)
          );
        }

        if (q) {
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const docs = snapshot.docs.map(d => d.data());
            docs.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

            const mostRecentKey = docs[0];
            if (mostRecentKey && mostRecentKey.validUntil) {
              const expiryDate = new Date(mostRecentKey.validUntil);
              expiryDate.setHours(23, 59, 59, 999);
              if (expiryDate < new Date()) {
                setIsExpired(true);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error checking expiry:', err);
      } finally {
        setLoadingExpiry(false);
      }
    };

    if ((actualRole === 'admin' && currentUser) || (actualRole === 'teacher' && currentUser)) {
      checkExpiry();
    } else {
      setLoadingExpiry(false);
    }
  }, [actualRole, currentUser]);

  // ── REFRESH FIX: Wait for Firebase Auth to resolve before making any routing decision ──
  if (authLoading) {
    return <LoadingPage message="Restoring your session..." />;
  }

  // ── SECURITY FIX HIGH-06: Only use Firebase Auth state, never sessionStorage flags ──
  // An attacker can run: sessionStorage.setItem('adminAuthenticated', 'true') in DevTools.
  // We ONLY trust currentUser (Firebase Auth) + userRole (from Firestore via AuthContext).
  if (allowedRoles && allowedRoles.includes('admin')) {
    const isAdmin = currentUser && userRole === 'admin';

    if (isAdmin) {
      if (loadingExpiry) return <LoadingPage message="Verifying subscription..." />;
      if (isExpired) return <KeyExpiryPopup role="admin" />;
      return children;
    }
  }

  if (!currentUser) {
    return <Navigate to="/" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(userRole)) {
    return <Navigate to="/" replace />;
  }

  if (loadingExpiry) return <LoadingPage message="Verifying subscription..." />;
  if (isExpired) return <KeyExpiryPopup role={actualRole} />;

  return children;
};

export default ProtectedRoute;
