import { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  signInWithPopup,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  // Primary role string (for route guards that expect a single role string)
  const [userRole, setUserRole] = useState(null);
  // Full roles array — supports multi-role users (e.g. ['admin', 'teacher'])
  const [userRoles, setUserRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  // Guard: true while we are mid-way through a claims-sync → token-refresh cycle.
  // Prevents AuthContext from ejecting the user before the fresh token arrives.
  const [isResolvingRole, setIsResolvingRole] = useState(false);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    
    // Set persistence to session storage so each tab has independent auth state
    setPersistence(auth, browserSessionPersistence).then(() => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          setCurrentUser(user);
          // ── PORTAL ISOLATION FIX ──────────────────────────────────────────
          // If the user authenticated through the Admin portal, AdminLogin.jsx
          // sets sessionStorage.portal = 'admin'. In that case we skip the
          // teacher_users lookup so a dual-role user is always treated as 'admin'
          // when they logged in via the Admin portal.
          try {
            let tokenResult = await user.getIdTokenResult();
            let claims = tokenResult.claims;

            // ── STUDENT AUTHENTICATION ──────────────────────────────────────────
            // Students sign in via custom tokens. The backend attaches { role: 'student' }.
            // They have no staff custom claims and must NOT go through the sync-claims flow.
            // Detect student tokens and skip claims sync entirely.
            if (claims.role === 'student') {
              setUserRole('student');
              setLoading(false);
              return; // nothing more to do — ExamInterface manages its own state
            }

            const isActivating = sessionStorage.getItem('pms_activating') === 'true';

            // ── CLAIMS SYNC ────────────────────────────────────────────────────
            // If the user has NO roles yet, or if we are mid-way through a
            // claims-refresh cycle (isResolvingRole), trigger a server-side sync
            // so both admin + teacher claims are set before we evaluate portals.
            if (!claims.super_admin && !claims.admin && !claims.teacher && !isActivating) {
              setIsResolvingRole(true);
              const token = await user.getIdToken();
              const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
              const res = await fetch(`${API_URL}/api/auth/sync-claims`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              
              if (res.ok) {
                // Force a token refresh to get the newly minted claims
                await user.getIdToken(true);
                tokenResult = await user.getIdTokenResult();
                claims = tokenResult.claims;
              }
              setIsResolvingRole(false);
            }

            const portal = sessionStorage.getItem('portal');

            // ── Build the full roles array for this user ─────────────────────
            const roles = [];
            if (claims.super_admin) roles.push('super_admin');
            if (claims.admin)       roles.push('admin');
            if (claims.teacher)     roles.push('teacher');

            // ── MULTI-ROLE AWARE PORTAL ISOLATION ───────────────────────────
            //
            // Rules (priority order):
            //   1. super_admin  → always allowed regardless of portal
            //   2. teacher portal → allowed if user has 'teacher' claim
            //      (a dual-role admin+teacher IS allowed here — we set role to
            //       'teacher' for this session so teacher-scoped Firestore rules fire)
            //   3. admin portal → allowed if user has 'admin' claim
            //   4. No portal flag → page-refresh: resolve by highest available claim
            //   5. True mismatch (no matching claim) → eject
            //
            // IMPORTANT: The teacher portal check MUST come before the
            // "admin on teacher portal → eject" check. Otherwise a stale token
            // (admin:true, teacher:false, mid-sync) would prematurely eject a
            // legitimate dual-role user before the refreshed token arrives.

            if (isActivating) {
              // Brand-new user during product key activation — no claims yet, allow briefly
              setUserRole(null);
              setUserRoles([]);

            } else if (claims.super_admin) {
              setUserRole('super_admin');
              setUserRoles(roles);

            } else if (portal === 'teacher' && claims.teacher) {
              // ✅ CORRECT: user has teacher claim → allow teacher portal
              // Works for pure-teacher AND dual-role admin+teacher users.
              setUserRole('teacher');
              setUserRoles(roles);
              if (claims.tenantId) sessionStorage.setItem('tenantId', claims.tenantId);

            } else if (portal === 'teacher' && !claims.teacher) {
              // ❌ MISMATCH: user has NO teacher claim → eject from teacher portal.
              // This only fires when claims are confirmed fresh (sync ran above).
              // A dual-role user mid-sync would have been caught by the sync block
              // above and claims.teacher would be true by this point.
              console.warn(`[Security] Account without teacher claim tried teacher portal for UID: ${user.uid} — signing out.`);
              setUserRole(null);
              setUserRoles([]);
              setCurrentUser(null);
              await signOut(auth);
              sessionStorage.clear();

            } else if (portal === 'admin' && claims.admin) {
              // ✅ CORRECT: admin logged in via admin portal
              setUserRole('admin');
              setUserRoles(roles);
              if (claims.tenantId) sessionStorage.setItem('tenantId', claims.tenantId);
              sessionStorage.setItem('adminAuthenticated', 'true');
              if (user.email) sessionStorage.setItem('adminEmail', user.email);

            } else if (portal === 'admin' && !claims.admin) {
              // ❌ MISMATCH: account without admin claim used admin portal → eject
              console.warn(`[Security] Account without admin claim tried admin portal for UID: ${user.uid} — signing out.`);
              setUserRole(null);
              setUserRoles([]);
              setCurrentUser(null);
              await signOut(auth);
              sessionStorage.clear();

            } else if (!portal && claims.admin) {
              // No portal flag → page-refresh on admin dashboard
              setUserRole('admin');
              setUserRoles(roles);
              if (claims.tenantId) sessionStorage.setItem('tenantId', claims.tenantId);
              sessionStorage.setItem('adminAuthenticated', 'true');
              if (user.email) sessionStorage.setItem('adminEmail', user.email);

            } else if (!portal && claims.teacher) {
              // No portal flag → page-refresh on teacher dashboard
              setUserRole('teacher');
              setUserRoles(roles);
              if (claims.tenantId) sessionStorage.setItem('tenantId', claims.tenantId);

            } else {
              console.warn(`[Security] No valid claims found for UID: ${user.uid} — signing out.`);
              setUserRole(null);
              setUserRoles([]);
              setCurrentUser(null);
              await signOut(auth);
              sessionStorage.clear();
            }
          } catch (error) {
            console.error('Error fetching user claims:', error);
            setUserRole(null);
            setUserRoles([]);
            setIsResolvingRole(false);
          }
        } else {
          setCurrentUser(null);
          setUserRole(null);
          setUserRoles([]);
        }
        setLoading(false);
      });

      return unsubscribe;
    }).catch((error) => {
      console.error('Error setting auth persistence:', error);
      setLoading(false);
    });
  }, []);


  // Teacher login with email/password
  const teacherLogin = async (email, password) => {
    sessionStorage.setItem('portal', 'teacher');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // ── PORTAL ISOLATION + DUAL-ROLE SUPPORT ────────────────────────────────
    // 1. Check teacher_users doc FIRST — this is the ground truth for whether
    //    someone is allowed into the teacher portal.
    // 2. If they have no teacher_users doc → reject (pure admin or unknown account).
    // 3. If they DO have a teacher_users doc but stale claims (admin:true, teacher:false),
    //    force a sync so they get teacher:true, then continue.
    const teacherUserDoc = await getDoc(doc(db, 'teacher_users', user.uid));
    if (!teacherUserDoc.exists()) {
      // No teacher profile → could be a pure admin or unknown account.
      // Check claims to give a precise error message.
      try {
        const tokenResult = await user.getIdTokenResult();
        if (tokenResult.claims.admin) {
          try { await signOut(auth); } catch (_) {}
          sessionStorage.removeItem('portal');
          const err = new Error('This is an Admin-only account. Please use the Admin portal to sign in.');
          err.code = 'pms/wrong-portal';
          throw err;
        }
      } catch (claimsErr) {
        if (claimsErr.code === 'pms/wrong-portal') throw claimsErr;
      }
      // Generic: no teacher profile found
      try { await signOut(auth); } catch (_) {}
      const err = new Error('Teacher account not found');
      err.code = 'pms/teacher-not-found';
      throw err;
    }

    // Teacher_users doc exists — check if we need a claims refresh.
    // A dual-role user who was previously synced with the OLD server.js (which
    // suppressed teacher:true for admins) may have stale claims.
    // Force a fresh sync so they pick up teacher:true alongside admin:true.
    try {
      const tokenResult = await user.getIdTokenResult();
      const c = tokenResult.claims;
      if (c.admin && !c.teacher) {
        // Stale claims: user is in teacher_users but teacher claim is missing.
        // Trigger re-sync so they get both claims.
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        const freshToken = await user.getIdToken();
        await fetch(`${API_URL}/api/auth/sync-claims`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${freshToken}` },
        });
        // Force token refresh to pick up newly granted teacher:true claim
        await user.getIdToken(true);
      }
    } catch (_) {
      // Non-fatal — onAuthStateChanged will handle the final role resolution
    }

    // Store tenantId for TenantContext
    const tid = teacherUserDoc.data().tenantId;
    if (tid) sessionStorage.setItem('tenantId', tid);
    return user;
  };

  // Admin login with Google OAuth
  const adminLogin = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    // Admin role is determined by admin_users document
    return result.user;
  };

  // Student login (whitelist - no Firebase Auth)
  const studentLogin = async (rollNo, name, sessionCode) => {
    // This will be handled differently - database lookup only
    // Return a mock user object for student
    return {
      uid: `${sessionCode}_${rollNo}`,
      rollNo,
      name,
      sessionCode,
      role: 'student'
    };
  };

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setUserRole(null);
    setUserRoles([]);
    // Clear tenant info and portal flag on logout
    sessionStorage.removeItem('tenantId');
    sessionStorage.removeItem('portal');
    sessionStorage.removeItem('adminAuthenticated');
    sessionStorage.removeItem('adminEmail');
  };

  // ── hasRole helper ────────────────────────────────────────────────────────
  // Use this in components instead of comparing userRole directly, so that
  // multi-role users are correctly evaluated.
  //   e.g.  const { hasRole } = useAuth();
  //         if (hasRole('teacher')) { ... }
  const hasRole = (role) => userRoles.includes(role);

  const value = {
    currentUser,
    userRole,
    userRoles,      // Full roles array — use for multi-role checks
    hasRole,        // hasRole('teacher') → true if user holds teacher role
    isResolvingRole, // true while mid-claims-sync; use to show loading spinner
    teacherLogin,
    adminLogin,
    studentLogin,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
