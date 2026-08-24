import React from 'react';

const GetHelpModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[100]">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition font-bold text-xl leading-none"
        >
          ×
        </button>
        
        <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-full bg-blue-100 mb-4 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-blue-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        
        <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">Get Help & Support</h3>
        <p className="text-sm text-gray-500 mb-6 text-center">If you need assistance, please contact the support team using the details below.</p>
        
        <div className="text-left bg-gray-50 p-4 rounded-lg border border-gray-100 space-y-4">
          <div>
            <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-2 flex items-center gap-2">
              <span>✉️</span> EMAIL SUPPORT
            </h4>
            <ul className="text-sm text-gray-600 space-y-1 pl-6 list-disc">
              <li><a href="mailto:nextsolves@gmail.com" className="text-blue-600 hover:underline">nextsolves@gmail.com</a></li>
              <li><a href="mailto:jagrutimorvekar@gmail.com" className="text-blue-600 hover:underline">jagrutimorvekar@gmail.com</a></li>
              <li><a href="mailto:ommurkar34@gmail.com" className="text-blue-600 hover:underline">ommurkar34@gmail.com</a></li>
            </ul>
          </div>
          
          <div className="border-t border-gray-200 pt-4">
            <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-2 flex items-center gap-2">
              <span>📞</span> PHONE SUPPORT
            </h4>
            <ul className="text-sm text-gray-600 space-y-1 pl-6 list-disc">
              <li><a href="tel:+919136234409" className="text-blue-600 hover:underline">9136234409</a> - <span className="text-gray-600">Om Murkar</span></li>
              <li><a href="tel:+919321362938" className="text-blue-600 hover:underline">9321362938</a> - <span className="text-gray-600">Jagruti Morvekar</span></li>
            </ul>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            onClick={onClose}
            className="w-full px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-bold shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default GetHelpModal;
