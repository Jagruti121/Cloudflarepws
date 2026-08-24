import { createContext, useContext, useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { collection } from 'firebase/firestore';

const TenantContext = createContext();

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
};

export const TenantProvider = ({ children }) => {
  const { currentUser, userRole } = useAuth();
  const [tenantId, setTenantId] = useState(null);
  const [collegeName, setCollegeName] = useState('');
  const [tenantLoading, setTenantLoading] = useState(true);

  useEffect(() => {
    const resolveTenant = async () => {
      setTenantLoading(true);

      // ── SECURITY FIX C-1 ──
      // Always resolve tenantId from Firestore (server-authoritative).
      // sessionStorage is an INSECURE source — any user can overwrite it via DevTools.
      // It is retained below ONLY as a write-through cache populated after a DB read.
      if (!currentUser) {
        // No authenticated user — clear any stale tenant state
        setTenantId(null);
        sessionStorage.removeItem('tenantId');
        setTenantLoading(false);
        return;
      }

      try {
        if (userRole === 'teacher') {
          const teacherUserDoc = await getDoc(doc(db, 'teacher_users', currentUser.uid));
          if (teacherUserDoc.exists()) {
            const tid = teacherUserDoc.data().tenantId;
            setTenantId(tid);
            sessionStorage.setItem('tenantId', tid); // cache only — never read as source
          } else {
            setTenantId(null);
            sessionStorage.removeItem('tenantId');
          }
        } else if (userRole === 'admin') {
          const adminDoc = await getDoc(doc(db, 'admin_users', currentUser.uid));
          if (adminDoc.exists()) {
            const tid = adminDoc.data().tenantId;
            setTenantId(tid);
            sessionStorage.setItem('tenantId', tid); // cache only — never read as source
          } else {
            setTenantId(null);
            sessionStorage.removeItem('tenantId');
          }
        } else {
          setTenantId(null);
          sessionStorage.removeItem('tenantId');
        }
      } catch (err) {
        console.error('Error resolving tenant:', err);
        setTenantId(null);
        sessionStorage.removeItem('tenantId');
      }

      setTenantLoading(false);
    };

    resolveTenant();
  }, [currentUser, userRole]);


  useEffect(() => {
    const fetchCollegeName = async () => {
      if (!tenantId) {
        setCollegeName('');
        return;
      }
      try {
        const settingsDoc = await getDoc(doc(db, 'colleges', tenantId, 'config', 'settings'));
        if (settingsDoc.exists() && settingsDoc.data().collegeName) {
          setCollegeName(settingsDoc.data().collegeName);
        }
      } catch (err) {
        // Silently ignore permission denied errors for non-admins/non-teachers (like students)
        if (err.code !== 'permission-denied' && !err.message?.includes('Missing or insufficient permissions')) {
          console.error('Error fetching college name:', err);
        }
      }
    };
    fetchCollegeName();
  }, [tenantId]);

  // Helper: get a collection reference scoped to the tenant
  const getColRef = (...subPath) => {
    if (!tenantId) throw new Error('TenantId not resolved yet');
    return collection(db, 'colleges', tenantId, ...subPath);
  };

  // Helper: get a document reference scoped to the tenant
  const getDocRef = (...subPath) => {
    if (!tenantId) throw new Error('TenantId not resolved yet');
    return doc(db, 'colleges', tenantId, ...subPath);
  };

  const value = {
    tenantId,
    setTenantId,
    collegeName,
    tenantLoading,
    getColRef,
    getDocRef,
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};
