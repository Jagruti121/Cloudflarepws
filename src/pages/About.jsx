import React from 'react';
import Navbar from '../components/Navbar';
import { 
  ShieldCheck, 
  Leaf, 
  Zap, 
  IndianRupee, 
  Award, 
  Users, 
  Phone, 
  Mail 
} from 'lucide-react';

const About = () => {
  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <Navbar />

      {/* --- HERO SECTION --- */}
      <div className="bg-gradient-to-r from-blue-900 to-blue-700 text-white py-20 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-extrabold mb-6 tracking-tight">
            About PWS
          </h1>
          <p className="text-xl md:text-2xl font-light text-blue-100 mb-8">
            The Operating System for Modern Practical Exams.
          </p>
          <div className="inline-block bg-white text-blue-900 px-6 py-2 rounded-full font-bold shadow-lg uppercase tracking-wide text-sm">
            Powered by Nextsolves
          </div>
        </div>
      </div>

      {/* --- MISSION SECTION --- */}
      <div className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-6">Our Mission</h2>
          <h3 className="text-2xl text-blue-600 font-bold mb-6">To Replace Chaos with Control.</h3>
          <p className="text-gray-600 text-lg leading-relaxed mb-8">
            For decades, practical examinations have been synonymous with logistical nightmares: 
            loose attendance slips, manual mark entry, endless spreadsheets, and the constant risk of human error.
          </p>
          <div className="bg-blue-50 border-l-4 border-blue-600 p-6 rounded-r-lg text-left">
            <p className="text-gray-800 font-medium text-lg">
              We built the <span className="font-bold text-blue-700">Practical Workflow System (PWS)</span> to change that.
            </p>
            <p className="text-gray-600 mt-2">
              Powered by the innovation engine of Nextsolves, PWS is the first intelligent ERP designed exclusively 
              to automate, secure, and streamline University Practical Examinations. We don’t just digitize the process; 
              <span className="font-bold"> we eliminate the workload.</span>
            </p>
          </div>
        </div>
      </div>

      {/* --- WHAT IS PWS? --- */}
      <div className="py-16 px-4 bg-gray-100">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-800 mb-4">What is PWS?</h2>
            <p className="text-gray-600 max-w-3xl mx-auto text-lg">
              PWS is a comprehensive digital ecosystem that bridges the gap between traditional manual processes and modern efficiency. 
              It serves as a centralized command center for HODs and faculty, handling everything from batch allocation to final mark submission in real-time.
            </p>
          </div>

          {/* ADVANTAGES GRID */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Card 1 */}
            <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition duration-300 border-t-4 border-green-500">
              <div className="mb-4 text-green-500"><Leaf size={40} /></div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Zero Paperwork</h3>
              <p className="text-gray-600 text-sm">
                We transform campuses into eco-friendly zones by eliminating the need for physical answer sheets and question slips.
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition duration-300 border-t-4 border-blue-500">
              <div className="mb-4 text-blue-500"><ShieldCheck size={40} /></div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Absolute Security</h3>
              <p className="text-gray-600 text-sm">
                Our encrypted question bank technology ensures zero chance of paper leaks, protecting the integrity of every exam.
              </p>
            </div>

            {/* Card 3 */}
            <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition duration-300 border-t-4 border-yellow-500">
              <div className="mb-4 text-yellow-500"><Zap size={40} /></div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Instant Results</h3>
              <p className="text-gray-600 text-sm">
                What used to take weeks of manual checking is now generated in minutes.
              </p>
            </div>

            {/* Card 4 */}
            <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition duration-300 border-t-4 border-purple-500">
              <div className="mb-4 text-purple-500"><IndianRupee size={40} /></div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Cost Efficiency</h3>
              <p className="text-gray-600 text-sm">
                By removing printing and logistical waste, PWS saves institutions approximately <span className="font-bold">₹5,00,000</span> per year.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* --- PROVEN RELIABILITY (TESTIMONIAL) --- */}
      <div className="py-16 px-4 bg-blue-900 text-white">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="mb-6 flex justify-center"><Award size={48} className="text-yellow-400" /></div>
          <h2 className="text-3xl font-bold mb-8">Proven Reliability</h2>
          <p className="text-lg md:text-xl text-blue-100 mb-8 leading-relaxed">
            PWS is not just a concept; it is a battle-tested solution. The system has been successfully deployed and piloted at 
            <span className="font-bold text-white"> Thakur Shyamnarayan Degree College</span>, where it streamlined the practical exam workflows for the entire IT/CS department.
          </p>
          <blockquote className="bg-blue-800 p-8 rounded-xl border border-blue-700 relative">
            <span className="text-6xl text-blue-600 absolute top-2 left-4 opacity-50">"</span>
            <p className="text-xl italic font-serif mb-4 relative z-10">
              The system is perfectly stable and has replaced our manual logs completely.
            </p>
            <footer className="text-sm font-bold text-yellow-400 uppercase tracking-widest">
              — Mr. Vijay Rawool
              <span className="block text-blue-200 text-xs font-normal capitalize mt-1">IT HOD & IQAC Head, Thakur Shyamnarayan College</span>
            </footer>
          </blockquote>
        </div>
      </div>

      {/* --- TEAM SECTION --- */}
      <div className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-4">The Team Behind the Tech</h2>
          <p className="text-gray-600 mb-12">
            PWS is the flagship innovation of <span className="font-bold text-blue-600">Nextsolves</span>, 
            an EdTech automation company founded by visionaries driving a revolution in academic administration.
          </p>

          <div className="flex flex-col md:flex-row justify-center gap-8">
            {/* Founder 1 */}
            <div className="bg-gray-50 p-6 rounded-xl shadow border border-gray-100 flex-1">
              <div className="w-24 h-24 bg-gray-300 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-gray-500">OM</div>
              <h3 className="text-xl font-bold text-gray-900">Om Chandrashekhar Murkar</h3>
              <p className="text-blue-600 font-medium">Founder</p>
            </div>

            {/* Founder 2 */}
            <div className="bg-gray-50 p-6 rounded-xl shadow border border-gray-100 flex-1">
              <div className="w-24 h-24 bg-gray-300 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-gray-500">JM</div>
              <h3 className="text-xl font-bold text-gray-900">Jagruti Rajan Morvekar</h3>
              <p className="text-blue-600 font-medium">Co-Founder</p>
            </div>
          </div>
          
          <p className="mt-8 text-gray-500 italic">
            Together, they are proving that technology can make education more efficient and impactful.
          </p>
        </div>
      </div>

      {/* --- CONTACT / CTA --- */}
      <div className="bg-gray-900 text-gray-300 py-16 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to Upgrade Your Exam Cell?</h2>
          <p className="mb-8 text-lg">Join the institutions moving towards a paperless, error-free future.</p>
          
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg mb-12 transition">
            Request a Live Demo
          </button>

          <div className="grid md:grid-cols-2 gap-8 text-left max-w-2xl mx-auto border-t border-gray-800 pt-8">
            <div className="space-y-3">
              <h4 className="text-white font-bold text-lg mb-2">Om Murkar</h4>
              <div className="flex items-center gap-2">
                <Phone size={18} className="text-blue-500" />
                <span>+91 9136234409</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-blue-500" />
                <a href="mailto:ommurkar34@gmail.com" className="hover:text-white transition">ommurkar34@gmail.com</a>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-white font-bold text-lg mb-2">Jagruti Morvekar</h4>
              <div className="flex items-center gap-2">
                <Phone size={18} className="text-blue-500" />
                <span>+91 9321632938</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-blue-500" />
                <a href="mailto:jagrutimorvekar@gmail.com" className="hover:text-white transition">jagrutimorvekar@gmail.com</a>
              </div>
            </div>
          </div>

          <div className="mt-16 text-sm text-gray-600 border-t border-gray-800 pt-6">
            Copyright © 2026 Nextsolves. All Rights Reserved.
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;