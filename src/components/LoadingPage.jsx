import React from 'react';

const LoadingPage = ({ message = 'Loading...' }) => {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        @keyframes spin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes pulse-ring {
          0%   { transform: scale(0.9); opacity: 0.6; }
          50%  { transform: scale(1.07); opacity: 0.2; }
          100% { transform: scale(0.9); opacity: 0.6; }
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .loading-spinner {
          width: 52px;
          height: 52px;
          border: 3px solid rgba(37, 99, 235, 0.15);
          border-top-color: #2563eb;
          border-radius: 50%;
          animation: spin 0.85s linear infinite;
        }

        .loading-ring {
          position: absolute;
          width: 76px;
          height: 76px;
          border-radius: 50%;
          border: 1.5px solid rgba(99, 102, 241, 0.25);
          animation: pulse-ring 2s ease-in-out infinite;
        }

        .loading-container {
          animation: fadeInUp 0.4s ease-out;
        }
      `}</style>

      <div className="loading-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px' }}>
        {/* Spinner with pulsing ring */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '76px', height: '76px' }}>
          <div className="loading-ring" />
          <div className="loading-spinner" />
        </div>

        {/* Brand + message */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{
            fontSize: '11px',
            letterSpacing: '2.5px',
            textTransform: 'uppercase',
            color: '#6366f1',
            fontWeight: '600',
          }}>
            Practical Workflow System
          </span>
          <span style={{
            fontSize: '15px',
            color: '#6b7280',
            fontWeight: '400',
            letterSpacing: '0.3px',
          }}>
            {message}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LoadingPage;
