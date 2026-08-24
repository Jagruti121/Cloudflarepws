import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const ActivationSuccess = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Data passed from AdminActivation after successful activation
  const { collegeName = 'Your College', productKey = '', email = '' } = location.state || {};

  // Guard: if someone navigates directly without state, redirect to login
  useEffect(() => {
    if (!location.state) {
      navigate('/admin/login', { replace: true });
    }
  }, [location.state, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: '20px',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes checkPop {
          0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
          60%  { transform: scale(1.15) rotate(4deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes ringExpand {
          0%   { transform: translate(-50%,-50%) scale(0.7); opacity: 0.7; }
          100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; }
        }

        .success-card {
          animation: fadeInUp 0.5s ease-out;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          padding: 48px 40px;
          max-width: 480px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(37, 99, 235, 0.10), 0 4px 16px rgba(0,0,0,0.06);
          position: relative;
          z-index: 1;
        }

        .check-icon {
          font-size: 64px;
          animation: checkPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both;
          display: block;
          line-height: 1;
        }

        .ring {
          position: absolute;
          width: 120px; height: 120px;
          border-radius: 50%;
          border: 2px solid rgba(37, 99, 235, 0.35);
          top: 50%; left: 50%;
          animation: ringExpand 1.2s ease-out 0.4s forwards;
          opacity: 0;
        }

        .key-badge {
          background: #eff6ff;
          border: 1.5px solid #bfdbfe;
          border-radius: 10px;
          padding: 14px 16px;
          margin: 20px 0;
          font-family: 'Inter', monospace;
          color: #1d4ed8;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 2px;
          word-break: break-all;
        }

        .success-title {
          font-size: 22px;
          font-weight: 700;
          color: #1f2937;
          margin: 20px 0 8px;
        }

        .success-sub {
          font-size: 14px;
          color: #6b7280;
          line-height: 1.7;
          margin: 0 0 28px;
        }

        .btn-dashboard {
          padding: 14px 32px;
          background: linear-gradient(135deg, #2563eb, #4f46e5);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.30);
          font-family: 'Inter', sans-serif;
          width: 100%;
        }
        .btn-dashboard:hover {
          box-shadow: 0 6px 22px rgba(37, 99, 235, 0.45);
          transform: translateY(-2px);
        }
        .btn-dashboard:active { transform: translateY(0); }

        .email-notice {
          margin-top: 20px;
          font-size: 12px;
          color: #9ca3af;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex-wrap: wrap;
        }
      `}</style>

      <div className="success-card">
        {/* Animated check */}
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: '4px' }}>
          <div className="ring" />
          <span className="check-icon">✅</span>
        </div>

        <h1 className="success-title">Your key has been activated!</h1>

        <p className="success-sub">
          Welcome, <strong style={{ color: '#1f2937' }}>{collegeName}</strong>!<br />
          Your Practical Workflow System account is now ready to use.
        </p>

        {/* Key display */}
        {productKey && (
          <div>
            <p style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px', fontWeight: '600' }}>
              Your Validation Key
            </p>
            <div className="key-badge">{productKey}</div>
          </div>
        )}

        {/* Divider */}
        <div style={{ width: '100%', height: '1px', background: '#f3f4f6', margin: '8px 0 24px' }} />

        <button className="btn-dashboard" onClick={() => navigate('/admin/login')}>
          Proceed to Sign In →
        </button>

        {/* Email notice */}
        {email && (
          <p className="email-notice">
            <span>📧</span>
            A confirmation email has been sent to <strong style={{ color: '#374151' }}>{email}</strong>
          </p>
        )}

        {/* Watermark */}
        <p style={{
          marginTop: '32px',
          fontSize: '11px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: '#a5b4fc',
          fontWeight: '600',
        }}>
          Practical Workflow System
        </p>
      </div>
    </div>
  );
};

export default ActivationSuccess;
