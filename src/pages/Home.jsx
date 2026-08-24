// import { Link } from 'react-router-dom';
// import { useAuth } from '../context/AuthContext';
// import { useEffect } from 'react';
// import { useNavigate } from 'react-router-dom';

// const Home = () => {
//   const { currentUser, userRole } = useAuth();
//   const navigate = useNavigate();

//   useEffect(() => {
//     if (currentUser) {
//       if (userRole === 'admin') {
//         navigate('/admin/dashboard');
//       } else if (userRole === 'teacher') {
//         navigate('/teacher/dashboard');
//       }
//     }
//   }, [currentUser, userRole, navigate]);

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
//       <div className="max-w-4xl w-full">
//         <div className="text-center mb-12">
//           <h1 className="text-5xl font-bold text-gray-800 mb-4">
//             Practical Workflow System
//           </h1>
//           <p className="text-xl text-gray-600">
//             Automate and streamline university practical examinations
//           </p>
//         </div>

//         <div className="grid md:grid-cols-3 gap-6">
//           {/* Admin Portal */}
//           <Link
//             to="/admin/login"
//             className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition transform hover:-translate-y-1"
//           >
//             <div className="text-center">
//               <div className="text-4xl mb-4">🛡️</div>
//               <h2 className="text-2xl font-bold text-gray-800 mb-2">Admin Portal</h2>
//               <p className="text-gray-600 mb-4">
//                 Manage teachers, oversee system, export results
//               </p>
//               <div className="text-sm text-blue-600 font-semibold">
//                 Google OAuth Login →
//               </div>
//             </div>
//           </Link>

//           {/* Teacher Portal */}
//           <Link
//             to="/teacher/login"
//             className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition transform hover:-translate-y-1"
//           >
//             <div className="text-center">
//               <div className="text-4xl mb-4">👩‍🏫</div>
//               <h2 className="text-2xl font-bold text-gray-800 mb-2">Teacher Portal</h2>
//               <p className="text-gray-600 mb-4">
//                 Create exams, monitor students, approve submissions
//               </p>
//               <div className="text-sm text-blue-600 font-semibold">
//                 Email & Password Login →
//               </div>
//             </div>
//           </Link>

//           {/* Student Portal */}
//           <Link
//             to="/student/login"
//             className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition transform hover:-translate-y-1"
//           >
//             <div className="text-center">
//               <div className="text-4xl mb-4">🧑‍🎓</div>
//               <h2 className="text-2xl font-bold text-gray-800 mb-2">Student Portal</h2>
//               <p className="text-gray-600 mb-4">
//                 Access exam interface, submit answers
//               </p>
//               <div className="text-sm text-blue-600 font-semibold">
//                 Whitelist Login →
//               </div>
//             </div>
//           </Link>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default Home;



import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';

const Home = () => {
  const { currentUser, userRole } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) {
      if (userRole === 'admin') {
        navigate('/admin/dashboard');
      } else if (userRole === 'teacher') {
        navigate('/teacher/dashboard');
      }
    }
  }, [currentUser, userRole, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      <Navbar />
      
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-800 mb-4">
              Practical Workflow System
            </h1>
            <p className="text-xl text-gray-600">
              Automate and streamline university practical examinations
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Admin Portal */}
            <Link
              to="/admin/login"
              className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition transform hover:-translate-y-1"
            >
              <div className="text-center">
                <div className="text-4xl mb-4">🛡️</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Admin Portal</h2>
                <p className="text-gray-600 mb-4">
                  Manage teachers, oversee system, export results
                </p>
                <div className="text-sm text-blue-600 font-semibold">
                  Admin Key Login →
                </div>
              </div>
            </Link>

            {/* Teacher Portal */}
            <Link
              to="/teacher/login"
              className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition transform hover:-translate-y-1"
            >
              <div className="text-center">
                <div className="text-4xl mb-4">👩‍🏫</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Teacher Portal</h2>
                <p className="text-gray-600 mb-4">
                  Create exams, monitor students, approve submissions
                </p>
                <div className="text-sm text-blue-600 font-semibold">
                  Email & Password Login →
                </div>
              </div>
            </Link>

            {/* Student Portal */}
            <Link
              to="/student/login"
              className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition transform hover:-translate-y-1"
            >
              <div className="text-center">
                <div className="text-4xl mb-4">🧑‍🎓</div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Student Portal</h2>
                <p className="text-gray-600 mb-4">
                  Access exam interface, submit answers
                </p>
                <div className="text-sm text-blue-600 font-semibold">
                  Whitelist Login →
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;