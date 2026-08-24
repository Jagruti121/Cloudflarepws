import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Navbar from '../../components/Navbar';
import ProtectedRoute from '../../components/ProtectedRoute';

const CreateExam = () => {
  const { currentUser } = useAuth();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    subject_name: '',
    session_code: '', // This will reflect the auto-generated code
    student_department: '',
    student_year: '',
    lab_number: '',
    practical_marks: '',
    viva_marks: '',
    journal_marks: '',
    duration_minutes: 60,
    upload_folder_name: 'C:/PMS_Uploads'
  });

  // --- AUTO-GENERATE SESSION CODE LOGIC ---
  const generateCode = (subject) => {
    if (!subject) return '';
    
    // 1. Clean Subject: Remove special chars, spaces, make uppercase
    const cleanSubject = subject.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    // 2. Prefix: Take first 6 chars
    const prefix = cleanSubject.substring(0, 6);
    
    // 3. Suffix: Generate 3 random digits
    const randomNum = Math.floor(Math.random() * 900) + 100;
    
    return `${prefix}${randomNum}`;
  };

  const handleSubjectChange = (e) => {
    const subject = e.target.value;
    
    // UPDATE BOTH: Subject Name AND Session Code Block
    setFormData(prev => ({
      ...prev,
      subject_name: subject,
      session_code: generateCode(subject) 
    }));
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.subject_name || !formData.session_code) {
      alert("Please enter a subject name.");
      return;
    }

    setLoading(true);

    try {
      const totalMarks = 
        (parseInt(formData.practical_marks) || 0) + 
        (parseInt(formData.viva_marks) || 0) + 
        (parseInt(formData.journal_marks) || 0);

      // Create Exam Document using Session Code as ID
      await setDoc(doc(db, 'colleges', tenantId, 'exams', formData.session_code), {
        ...formData,
        total_marks: totalMarks,
        teacher_email: currentUser.email,
        teacher_name: currentUser.displayName || 'Teacher',
        created_at: serverTimestamp(),
        is_active: true,
        started_at: serverTimestamp(),
      });

      // Create root-level exam_index for student login resolution
      await setDoc(doc(db, 'exam_index', formData.session_code), {
        tenantId: tenantId
      });

      alert(`Session Created Successfully!\nSession Code: ${formData.session_code}`);
      navigate('/teacher/dashboard');

    } catch (error) {
      console.error("Error creating exam:", error);
      alert("Failed to create exam: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={['teacher']}>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-md p-8">
            
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-blue-600">Create New Session</h1>
              <p className="text-gray-500">Configure exam details below</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* --- SESSION CONFIGURATION BLOCK --- */}
              <div className="grid md:grid-cols-2 gap-6 bg-blue-50 p-6 rounded-lg border border-blue-200">
                
                {/* 1. SUBJECT INPUT */}
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Subject Name</label>
                  <input
                    type="text"
                    name="subject_name"
                    value={formData.subject_name}
                    onChange={handleSubjectChange} // Updates Session Code automatically
                    placeholder="e.g. Python Programming"
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    required
                  />
                </div>

                {/* 2. SESSION CODE BLOCK (REFLECTS GENERATED CODE) */}
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Session Code</label>
                  <div className="flex">
                    <input
                      type="text"
                      name="session_code"
                      value={formData.session_code}
                      readOnly
                      className="w-full border-2 border-blue-300 rounded-l-lg px-4 py-2 bg-blue-100 text-blue-800 font-mono font-bold text-lg text-center cursor-not-allowed"
                      placeholder="AUTO-GENERATED"
                    />
                    <button 
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, session_code: generateCode(p.subject_name) }))}
                      className="bg-blue-600 text-white px-4 rounded-r-lg hover:bg-blue-700 font-bold"
                      title="Regenerate Random Numbers"
                    >
                      ↻
                    </button>
                  </div>
                  <p className="text-xs text-blue-600 mt-1 font-semibold">
                    * Auto-generated based on Subject Name
                  </p>
                </div>
              </div>

              {/* --- CLASS DETAILS --- */}
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Department</label>
                  <select name="student_department" onChange={handleChange} className="w-full border rounded-lg px-4 py-2" required>
                    <option value="">Select Dept</option>
                    <option value="CS">CS</option>
                    <option value="IT">IT</option>
                    <option value="DS">DS</option>
                    <option value="AIML">AIML</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Year</label>
                  <select name="student_year" onChange={handleChange} className="w-full border rounded-lg px-4 py-2" required>
                    <option value="">Select Year</option>
                    <option value="FY">FY</option>
                    <option value="SY">SY</option>
                    <option value="TY">TY</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Lab Number</label>
                  <input type="text" name="lab_number" onChange={handleChange} placeholder="e.g. Lab 3" className="w-full border rounded-lg px-4 py-2" required />
                </div>
              </div>

              {/* --- MARKING SCHEME --- */}
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Practical Marks</label>
                  <input type="number" name="practical_marks" onChange={handleChange} className="w-full border rounded-lg px-4 py-2" required />
                </div>
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Viva Marks</label>
                  <input type="number" name="viva_marks" onChange={handleChange} className="w-full border rounded-lg px-4 py-2" />
                </div>
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Journal Marks</label>
                  <input type="number" name="journal_marks" onChange={handleChange} className="w-full border rounded-lg px-4 py-2" />
                </div>
                <div>
                  <label className="block text-gray-700 font-bold mb-2">Duration (Mins)</label>
                  <input type="number" name="duration_minutes" value={formData.duration_minutes} onChange={handleChange} className="w-full border rounded-lg px-4 py-2" />
                </div>
              </div>

              {/* --- SERVER PATH --- */}
              <div>
                <label className="block text-gray-700 font-bold mb-2">Upload Folder Path (Server)</label>
                <input 
                  type="text" 
                  name="upload_folder_name" 
                  value={formData.upload_folder_name} 
                  onChange={handleChange}
                  className="w-full border rounded-lg px-4 py-2 font-mono text-sm bg-gray-50"
                />
              </div>

              <div className="flex justify-end gap-4 mt-8 pt-4 border-t">
                <button type="button" onClick={() => navigate('/teacher/dashboard')} className="px-6 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition">Cancel</button>
                <button type="submit" disabled={loading} className="px-8 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition transform active:scale-95 disabled:opacity-50">
                  {loading ? 'Creating...' : 'Create Session'}
                </button>
              </div>

            </form>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
};

export default CreateExam;