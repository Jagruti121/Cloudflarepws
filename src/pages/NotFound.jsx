import React from 'react';
import { useNavigate } from 'react-router-dom';

const NotFound = () => {
  const navigate = useNavigate();

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
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }

        .nf-container { animation: fadeInUp 0.5s ease-out; text-align: center; }

        .nf-404 {
          font-size: clamp(100px, 20vw, 180px);
          font-weight: 800;
          font-family: 'Inter', sans-serif;
          background: linear-gradient(135deg, #2563eb, #6366f1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
          animation: float 4s ease-in-out infinite;
          user-select: none;
        }

        .nf-btn {
          padding: 14px 36px;
          background: linear-gradient(135deg, #2563eb, #4f46e5);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s;
          box-shadow: 0 4px 20px rgba(37, 99, 235, 0.3);
          font-family: 'Inter', sans-serif;
          letter-spacing: 0.3px;
        }
        .nf-btn:hover {
          box-shadow: 0 6px 28px rgba(37, 99, 235, 0.45);
          transform: translateY(-2px);
        }
        .nf-btn:active { transform: translateY(0); }
      `}</style>

      <div className="nf-container" style={{ position: 'relative', zIndex: 1 }}>
        {/* 404 Number */}
        <div className="nf-404">404</div>

        {/* Divider */}
        <div style={{
          width: '60px', height: '3px',
          background: 'linear-gradient(90deg, transparent, #6366f1, transparent)',
          margin: '0 auto 28px',
          borderRadius: '2px',
        }} />

        {/* Message */}
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1f2937', margin: '0 0 12px' }}>
          Page Not Found
        </h1>
        <p style={{
          fontSize: '14px',
          color: '#6b7280',
          maxWidth: '360px',
          lineHeight: '1.7',
          margin: '0 auto 36px',
        }}>
          The page you're looking for doesn't exist or has been moved.
          Head back to safety below.
        </p>

        {/* CTA */}
        <button className="nf-btn" onClick={() => navigate('/')}>
          ← Go Home
        </button>

        {/* Brand watermark */}
        <p style={{
          marginTop: '48px',
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

export default NotFound;
