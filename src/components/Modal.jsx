import { useState, useCallback, useRef, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Modal Component & Hook
// Provides a reusable, centered, styled modal to replace all native
// alert() and window.confirm() calls across the student portal.
// ─────────────────────────────────────────────────────────────────────────────

const VARIANT_STYLES = {
  info: {
    icon: 'ℹ️',
    headerBg: 'bg-blue-50',
    headerBorder: 'border-blue-200',
    iconBg: 'bg-blue-100',
    titleColor: 'text-blue-900',
    confirmBtn: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  },
  success: {
    icon: '✅',
    headerBg: 'bg-green-50',
    headerBorder: 'border-green-200',
    iconBg: 'bg-green-100',
    titleColor: 'text-green-900',
    confirmBtn: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
  },
  warning: {
    icon: '⚠️',
    headerBg: 'bg-yellow-50',
    headerBorder: 'border-yellow-200',
    iconBg: 'bg-yellow-100',
    titleColor: 'text-yellow-900',
    confirmBtn: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
  },
  error: {
    icon: '❌',
    headerBg: 'bg-red-50',
    headerBorder: 'border-red-200',
    iconBg: 'bg-red-100',
    titleColor: 'text-red-900',
    confirmBtn: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  },
};

/**
 * Modal display component — renders a centered, styled overlay.
 * This is a controlled component driven entirely by the useModal hook.
 */
const Modal = ({ isOpen, title, message, variant = 'info', showCancel = false, confirmText = 'OK', cancelText = 'Cancel', onConfirm, onCancel }) => {
  const modalRef = useRef(null);

  // Focus trap: auto-focus the confirm button when modal opens
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const btn = modalRef.current.querySelector('[data-modal-confirm]');
      if (btn) btn.focus();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (showCancel && onCancel) onCancel();
        else if (onConfirm) onConfirm();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, showCancel, onConfirm, onCancel]);

  if (!isOpen) return null;

  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.info;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-backdrop-in"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) { if (showCancel && onCancel) onCancel(); else if (onConfirm) onConfirm(); } }}
    >
      <div
        ref={modalRef}
        className="animate-modal-in bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className={`${style.headerBg} ${style.headerBorder} border-b px-6 py-5 flex items-center gap-4`}>
          <div className={`${style.iconBg} w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0`}>
            {style.icon}
          </div>
          <h3 id="modal-title" className={`${style.titleColor} text-lg font-bold leading-snug`}>
            {title}
          </h3>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-gray-700 text-[15px] leading-relaxed whitespace-pre-line">{message}</p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          {showCancel && (
            <button
              onClick={onCancel}
              className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            data-modal-confirm
            onClick={onConfirm}
            className={`px-5 py-2.5 text-sm font-semibold text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-1 transition-colors ${style.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * useModal hook — provides imperative showAlert / showConfirm functions
 * that return Promises, so calling code can await them cleanly.
 *
 * Usage:
 *   const { modalProps, showAlert, showConfirm } = useModal();
 *   // In JSX: <Modal {...modalProps} />
 *   // In handlers: await showAlert('Title', 'Message', 'success');
 *   //              const ok = await showConfirm('Title', 'Message');
 */
export const useModal = () => {
  const [modalState, setModalState] = useState({
    isOpen: false,
    title: '',
    message: '',
    variant: 'info',
    showCancel: false,
    confirmText: 'OK',
    cancelText: 'Cancel',
  });

  const resolveRef = useRef(null);

  const closeModal = useCallback((result) => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
  }, []);

  const showAlert = useCallback((title, message, variant = 'info') => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setModalState({
        isOpen: true,
        title,
        message,
        variant,
        showCancel: false,
        confirmText: 'OK',
        cancelText: 'Cancel',
      });
    });
  }, []);

  const showConfirm = useCallback((title, message, variant = 'warning', confirmText = 'Yes', cancelText = 'Cancel') => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setModalState({
        isOpen: true,
        title,
        message,
        variant,
        showCancel: true,
        confirmText,
        cancelText,
      });
    });
  }, []);

  const modalProps = {
    ...modalState,
    onConfirm: () => closeModal(true),
    onCancel: () => closeModal(false),
  };

  return { modalProps, showAlert, showConfirm };
};

export default Modal;
