import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const KeyExpiryPopup = ({ role }) => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  useEffect(() => {
    // Prevent back button by pushing a dummy state and trapping popstate
    window.history.pushState(null, '', window.location.href);
    
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const handleLogout = async () => {
    try {
      // Clear admin session
      sessionStorage.removeItem('adminAuthenticated');
      sessionStorage.removeItem('adminEmail');
      sessionStorage.removeItem('tenantId');
      
      // Clear Firebase Auth using context
      if (logout) {
        await logout();
      }
      
      // Redirect based on role
      if (role === 'admin') {
        navigate('/admin/login');
      } else if (role === 'teacher') {
        navigate('/teacher/login');
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error('Logout error:', err);
      navigate('/');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999, // Ensure it's above everything
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '16px',
        maxWidth: '500px',
        textAlign: 'center',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937', marginBottom: '16px', fontFamily: 'sans-serif' }}>
          Plan Expired
        </h2>
        <p style={{ fontSize: '16px', color: '#4b5563', marginBottom: '24px', lineHeight: '1.5', fontFamily: 'sans-serif' }}>
          {role === 'admin' 
            ? 'Your Product Key has expired. Please renew your plan to continue using the system.'
            : 'The Product Key for your institution has expired. Please ask your administrator to renew the plan to continue.'}
        </p>
        
        <button 
          onClick={handleLogout}
          style={{
            backgroundColor: '#ef4444',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '16px',
            transition: 'background-color 0.2s'
          }}
          onMouseOver={(e) => e.target.style.backgroundColor = '#dc2626'}
          onMouseOut={(e) => e.target.style.backgroundColor = '#ef4444'}
        >
          Log Out
        </button>

        <div style={{ fontSize: '14px', color: '#9ca3af', fontFamily: 'sans-serif' }}>
          You must log out and wait for plan renewal.
        </div>
      </div>
    </div>
  );
};

export default KeyExpiryPopup;
