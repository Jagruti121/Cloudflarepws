import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const Navbar = ({ onChangePassword, onDeleteAccount, hasActiveSessions, changePwLockedUntil }) => {
  const { currentUser, userRole, logout } = useAuth();
  const { tenantId, collegeName } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [pendingSessions, setPendingSessions] = useState([]);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  // Listen for pending shared sessions
  useEffect(() => {
    if (userRole !== 'teacher' || !currentUser || !tenantId) return;

    const q = query(
      collection(db, 'colleges', tenantId, 'shared_sessions'),
      where('recipient_email', '==', currentUser.email),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pending = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPendingSessions(pending);
    });

    return () => unsubscribe();
  }, [currentUser, userRole, tenantId]);

  // SECURITY FIX HIGH-06: Derive admin session strictly from AuthContext (claims).
  // Removed vulnerable sessionStorage check.
  const isAdminRole = userRole === 'admin' || userRole === 'super_admin';
  const adminEmail = (isAdminRole && currentUser) ? currentUser.email : null;

  const handleLogout = async () => {
    try {
      if (currentUser) {
        await logout();
      }
      setShowLogoutConfirm(false);
      setMenuOpen(false);
      navigate('/');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  // --- STUDENT RESTRICTION ---
  if (location.pathname.startsWith('/student')) {
    return null;
  }

  const isOnAdminRoute = location.pathname.startsWith('/admin/dashboard');
  const effectiveAdminSession = currentUser && isAdminRole && isOnAdminRoute;

  return (
    <>
      <nav className="bg-blue-600 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            {/* Logo */}
            <Link to="/" className="text-xl font-bold hover:text-blue-100 transition flex items-center gap-2">
              <span className="bg-white text-blue-600 px-2 py-0.5 rounded shadow-sm text-sm tracking-wider uppercase font-extrabold border border-blue-200">
                {tenantId && collegeName ? collegeName : 'PWS'}
              </span>
              <span>{tenantId && collegeName ? 'Portal' : 'Practical Workflow System'}</span>
            </Link>

            <div className="flex items-center gap-6">
              <Link to="/" className="hover:text-blue-200 font-medium">Home</Link>
              <Link to="/about" className="hover:text-blue-200 font-medium">About</Link>

              {currentUser && isAdminRole && (
                <Link to="/admin/dashboard" className="hover:text-blue-200 font-medium">
                  Admin Dashboard
                </Link>
              )}

              {currentUser && userRole === 'teacher' && (
                <Link to="/teacher/dashboard" className="hover:text-blue-200 font-medium">
                  Dashboard
                </Link>
              )}

              {/* ===== TEACHER: Three-dot ⋮ Menu ===== */}
              {currentUser && userRole === 'teacher' && !effectiveAdminSession && (
                <div ref={menuRef} className="relative">
                  <div className="flex items-center gap-2 bg-blue-700 px-3 py-1.5 rounded-lg">
                    <span className="text-sm border-r border-blue-500 pr-3 truncate max-w-[180px]" title={currentUser.email}>
                      {currentUser.email}
                    </span>
                    {/* Three-dot button */}
                    <button
                      id="teacher-menu-btn"
                      onClick={() => setMenuOpen(o => !o)}
                      className="flex flex-col gap-[5px] items-center justify-center w-8 h-8 rounded-lg hover:bg-blue-500 transition"
                      title="Menu"
                      aria-label="Open teacher menu"
                      aria-expanded={menuOpen}
                    >
                      <span className="block w-[5px] h-[5px] bg-white rounded-full"></span>
                      <span className="block w-[5px] h-[5px] bg-white rounded-full"></span>
                      <span className="block w-[5px] h-[5px] bg-white rounded-full"></span>
                    </button>
                  </div>

                  {/* Dropdown Menu */}
                  {menuOpen && (
                    <div
                      id="teacher-dropdown-menu"
                      className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
                      style={{ animation: 'navMenuIn 0.18s cubic-bezier(.16,1,.3,1)' }}
                    >
                      {/* Header */}
                      <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-100">
                        <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Account</p>
                        <p className="text-sm font-bold text-gray-800 truncate mt-0.5" title={currentUser.email}>
                          {currentUser.email}
                        </p>
                      </div>

                      {/* Change Password */}
                      {(() => {
                        const cpLocked = changePwLockedUntil && Date.now() < changePwLockedUntil;
                        const cpMinLeft = cpLocked ? Math.ceil((changePwLockedUntil - Date.now()) / 60000) : 0;
                        return (
                          <button
                            id="menu-change-password"
                            onClick={() => {
                              if (cpLocked) return;
                              setMenuOpen(false);
                              if (onChangePassword) onChangePassword();
                            }}
                            disabled={cpLocked}
                            title={cpLocked ? `Locked for ${cpMinLeft} more minute${cpMinLeft !== 1 ? 's' : ''}` : ''}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition group ${
                              cpLocked ? 'opacity-50 cursor-not-allowed text-gray-500' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                            }`}
                          >
                            <span className={`w-8 h-8 flex items-center justify-center rounded-lg transition flex-shrink-0 ${
                              cpLocked ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 group-hover:bg-blue-200'
                            }`}>
                              {cpLocked ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                </svg>
                              )}
                            </span>
                            <div>
                              <p className={`text-sm font-semibold leading-tight ${cpLocked ? 'text-gray-500' : ''}`}>Change Password</p>
                              <p className="text-xs text-gray-400">
                                {cpLocked ? `🔒 Locked — ${cpMinLeft}m remaining` : 'Update your login password'}
                              </p>
                            </div>
                          </button>
                        );
                      })()}

                      {/* Delete Account (Teacher Only) */}
                      {userRole === 'teacher' && (
                        <button
                          id="menu-delete-account"
                          onClick={() => {
                            if (hasActiveSessions) return;
                            setMenuOpen(false);
                            if (onDeleteAccount) onDeleteAccount();
                          }}
                          disabled={hasActiveSessions}
                          title={hasActiveSessions ? "Cannot delete account while sessions are active" : ""}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition group ${hasActiveSessions ? 'opacity-50 cursor-not-allowed text-gray-500' : 'text-gray-700 hover:bg-red-50 hover:text-red-700'}`}
                        >
                          <span className={`w-8 h-8 flex items-center justify-center rounded-lg transition flex-shrink-0 ${hasActiveSessions ? 'bg-gray-100 text-gray-400' : 'bg-red-100 group-hover:bg-red-200 text-red-600'}`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </span>
                          <div>
                            <p className={`text-sm font-semibold leading-tight ${hasActiveSessions ? 'text-gray-500' : 'text-red-600'}`}>Delete Account</p>
                            <p className={`text-xs ${hasActiveSessions ? 'text-gray-400' : 'text-red-400'}`}>
                              {hasActiveSessions ? 'End active sessions first' : 'Migrate data and remove account'}
                            </p>
                          </div>
                        </button>
                      )}

                      {/* Get Help */}
                      <button
                        id="menu-get-help"
                        onClick={() => {
                          setMenuOpen(false);
                          setShowHelpModal(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-green-50 hover:text-green-700 transition group"
                      >
                        <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-100 group-hover:bg-green-200 transition flex-shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                        <div>
                          <p className="text-sm font-semibold leading-tight">Get Help</p>
                          <p className="text-xs text-gray-400">Contact support</p>
                        </div>
                      </button>

                      <div className="border-t border-gray-100 mx-2" />

                      {/* Log Out */}
                      <button
                        id="menu-logout"
                        onClick={() => {
                          setMenuOpen(false);
                          setShowLogoutConfirm(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-red-50 hover:text-red-700 transition group"
                      >
                        <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-100 group-hover:bg-red-200 transition flex-shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                        </span>
                        <div>
                          <p className="text-sm font-semibold leading-tight">Log Out</p>
                          <p className="text-xs text-gray-400">Sign out of your account</p>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Show user info + Logout for non-teacher Firebase auth users (e.g. admin role via Firebase) */}
              {currentUser && !effectiveAdminSession && userRole !== 'teacher' && (
                <div className="flex items-center gap-3 bg-blue-700 px-3 py-1.5 rounded-lg">
                  <span className="text-sm border-r border-blue-500 pr-3">
                    {currentUser.email || currentUser.name || 'User'}
                  </span>
                  <button
                    onClick={() => setShowLogoutConfirm(true)}
                    className="text-sm font-bold hover:text-red-200 transition"
                  >
                    Logout
                  </button>
                </div>
              )}

              {/* Show Logout for admin session users */}
              {effectiveAdminSession && (
                <div className="flex items-center gap-3 bg-blue-700 px-3 py-1.5 rounded-lg">
                  <span className="text-sm border-r border-blue-500 pr-3">
                    {adminEmail || 'Admin'}
                  </span>
                  <button
                    onClick={() => setShowLogoutConfirm(true)}
                    className="text-sm font-bold hover:text-red-200 transition"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* HELP MODAL */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-center border-t-4 border-blue-500 relative">
            <button 
              onClick={() => setShowHelpModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition font-bold text-xl leading-none"
            >
              ×
            </button>
            <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-blue-100 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Get Help & Support</h3>
            <p className="text-sm text-gray-500 mb-6">If you need assistance, please contact the support team using the details below.</p>
            
            <div className="text-left bg-gray-50 p-4 rounded-lg border border-gray-100 space-y-4">
              <div>
                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-2 flex items-center gap-2">
                  <span>✉️</span> Email Support
                </h4>
                <ul className="text-sm text-gray-600 space-y-1 pl-6 list-disc">
                  <li><a href="mailto:nextsolves@gmail.com" className="text-blue-600 hover:underline">nextsolves@gmail.com</a></li>
                  <li><a href="mailto:jagrutimorvekar@gmail.com" className="text-blue-600 hover:underline">jagrutimorvekar@gmail.com</a></li>
                  <li><a href="mailto:ommurkar34@gmail.com" className="text-blue-600 hover:underline">ommurkar34@gmail.com</a></li>
                </ul>
              </div>
              
              <div className="border-t border-gray-200 pt-4">
                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-2 flex items-center gap-2">
                  <span>📞</span> Phone Support
                </h4>
                <ul className="text-sm text-gray-600 space-y-1 pl-6 list-disc">
                  <li><a href="tel:+919136234409" className="text-blue-600 hover:underline">9136234409</a> - Om Murkar</li>
                  <li><a href="tel:+919321362938" className="text-blue-600 hover:underline">9321362938</a> - Jagruti Morvekar</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-8 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOGOUT CONFIRMATION MODAL */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center">
            <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-orange-100 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Logout</h3>
            <p className="text-sm text-gray-500 mb-6">Do you want to logout?</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
              >
                No
              </button>
              <button
                onClick={handleLogout}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium"
              >
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARE SESSION NOTIFICATIONS (Bottom Right) */}
      {pendingSessions.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-4 max-w-sm w-full">
          {pendingSessions.map(session => (
            <div 
              key={session.id} 
              className="bg-white rounded-xl shadow-2xl border-l-4 border-blue-500 p-4 transform transition-all duration-300"
              style={{ animation: 'navMenuIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 text-blue-600 font-bold">
                  <span>📡</span>
                  <span className="uppercase text-xs tracking-wider">Live Session Invite</span>
                </div>
                <button 
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'colleges', tenantId, 'shared_sessions', session.id), { status: 'declined' });
                    } catch (e) { console.error('Error declining session:', e); }
                  }}
                  className="text-gray-400 hover:text-red-500 transition"
                  title="Decline"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-gray-700 mb-3 leading-relaxed">
                <strong className="text-gray-900">{session.sender_name || session.sender_email}</strong> has invited you to monitor 
                Live Session <strong className="font-mono text-blue-600">{session.session_code}</strong>.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'colleges', tenantId, 'shared_sessions', session.id), { status: 'accepted' });
                      // If they accept, and we are on dashboard, dashboard will automatically show it.
                      // If we want to navigate them, we could: navigate('/teacher/dashboard');
                    } catch (e) { console.error('Error accepting session:', e); }
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition"
                >
                  Accept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dropdown animation */}
      <style>{`
        @keyframes navMenuIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
};

export default Navbar;