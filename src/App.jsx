// import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
// import { AuthProvider } from './context/AuthContext';
// import app from './firebase';
// import FirebaseError from './components/FirebaseError';

// // Pages
// import Home from './pages/Home';
// import About from './pages/About';
// import AdminLogin from './pages/Admin/AdminLogin';
// import AdminDashboard from './pages/Admin/AdminDashboard';
// import TeacherLogin from './pages/Teacher/TeacherLogin';
// import TeacherDashboard from './pages/Teacher/Dashboard';
// import ExamWizard from './pages/Teacher/ExamWizard';
// import Monitor from './pages/Teacher/Monitor';
// import StudentLogin from './pages/Student/StudentLogin';
// import ExamInterface from './pages/Student/ExamInterface';

// // Simple Navigation Component
// const Navbar = () => (
//   <nav style={{ 
//     padding: '1rem 2rem', 
//     display: 'flex', 
//     justifyContent: 'space-between', 
//     alignItems: 'center',
//     background: '#fff',
//     boxShadow: '0 2px 4px rgba(0,0,0,0.1)' 
//   }}>
//     <Link to="/" style={{ fontWeight: 'bold', fontSize: '1.2rem', textDecoration: 'none', color: '#333' }}>
//       PWS
//     </Link>
//     <div style={{ display: 'flex', gap: '20px' }}>
//       <Link to="/" style={{ textDecoration: 'none', color: '#666' }}>Home</Link>
//       <Link to="/about" style={{ textDecoration: 'none', color: '#666' }}>About</Link>
//     </div>
//   </nav>
// );

// function App() {
//   // Check if Firebase is properly initialized
//   if (!app) {
//     return <FirebaseError />;
//   }

//   return (
//     <AuthProvider>
//       <Router>
//         {/* The Navbar stays visible across all routes */}
//         <Navbar />
        
//         <Routes>
//           <Route path="/" element={<Home />} />
//           <Route path="/about" element={<About />} />
          
//           {/* Admin Routes */}
//           <Route path="/admin/login" element={<AdminLogin />} />
//           <Route path="/admin/dashboard" element={<AdminDashboard />} />
          
//           {/* Teacher Routes */}
//           <Route path="/teacher/login" element={<TeacherLogin />} />
//           <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
//           <Route path="/teacher/exam-wizard" element={<ExamWizard />} />
//           <Route path="/teacher/monitor" element={<Monitor />} />
          
//           {/* Student Routes */}
//           <Route path="/student/login" element={<StudentLogin />} />
//           <Route path="/student/exam" element={<ExamInterface />} />
          
//           {/* Catch all */}
//           <Route path="*" element={<Navigate to="/" replace />} />
//         </Routes>
//       </Router>
//     </AuthProvider>
//   );
// }

// export default App;


import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';
import app from './firebase'; 
import FirebaseError from './components/FirebaseError';

// Pages
import Home from './pages/Home';
import About from './pages/About';
import AdminLogin from './pages/Admin/AdminLogin';
import AdminDashboard from './pages/Admin/AdminDashboard';
import AdminActivation from './pages/Admin/AdminActivation';
import ActivationSuccess from './pages/Admin/ActivationSuccess';
import TeacherLogin from './pages/Teacher/TeacherLogin';
import TeacherDashboard from './pages/Teacher/Dashboard';
import ExamWizard from './pages/Teacher/ExamWizard';
import InternalExamWizard from './pages/Teacher/InternalExamWizard';
import Monitor from './pages/Teacher/Monitor';
import StudentLogin from './pages/Student/StudentLogin';
import ExamInterface from './pages/Student/ExamInterface';
import SuperAdminLogin from './pages/SuperAdmin/SuperAdminLogin';
import SuperAdminKeyGenerator from './pages/SuperAdmin/KeyGenerator';
import SuperAdminDashboard from './pages/SuperAdmin/SuperAdminDashboard';
import NotFound from './pages/NotFound';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsAndConditions from './pages/TermsAndConditions';
// ── SECURITY FIX A-1: Route-level guard for all Super Admin pages ──
import SuperAdminRoute from './components/SuperAdminRoute';

function App() {
  if (!app) {
    return <FirebaseError />;
  }

  return (
    <AuthProvider>
      <TenantProvider>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* GLOBAL NAVBAR REMOVED HERE TO FIX DOUBLE NAVBAR ISSUE */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/activate" element={<AdminActivation />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          {/* Success page after key activation */}
          <Route path="/admin/activation-success" element={<ActivationSuccess />} />
          
          <Route path="/teacher/login" element={<TeacherLogin />} />
          <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
          <Route path="/teacher/exam-wizard" element={<ExamWizard />} />
          <Route path="/teacher/internal-exam-wizard" element={<InternalExamWizard />} />
          <Route path="/teacher/monitor" element={<Monitor />} />
          <Route path="/teacher/monitor/internal/:sessionCode" element={<Monitor />} />
          
          <Route path="/student/login" element={<StudentLogin />} />
          <Route path="/student/exam" element={<ExamInterface />} />
          
          {/* ─── Super Admin (Founders) Portal ─── */}
          {/* Login page is public (users need to reach it to authenticate) */}
          <Route path="/super_admin/LIO-73-23/2372/SYSTEM" element={<SuperAdminLogin />} />
          {/* Dashboard and keygen require verified Firebase Auth + super_admins doc */}
          <Route path="/super_admin/LIO-73-23/2372/SYSTEM/dashboard" element={
            <SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>
          } />
          <Route path="/super_admin/LIO-73-23/2372/SYSTEM/keygen" element={
            <SuperAdminRoute><SuperAdminKeyGenerator /></SuperAdminRoute>
          } />
          
          {/* Legal Pages */}
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-and-conditions" element={<TermsAndConditions />} />

          {/* 404 — show proper Not Found page instead of silent redirect */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
      </TenantProvider>
    </AuthProvider>
  );
}

export default App;