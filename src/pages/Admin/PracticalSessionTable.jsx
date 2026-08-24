import { useState } from 'react';
import * as XLSX from 'xlsx';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely computes Internal Marks = Viva + Journal.
 * Falls back to 0 for null / undefined / NaN values.
 */
const computeInternalMarks = (scores) => {
  const viva = parseFloat(scores?.viva) || 0;
  const journal = parseFloat(scores?.journal) || 0;
  return viva + journal;
};

const formatDate = (timestamp) => {
  if (!timestamp) return 'N/A';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return 'N/A';
  }
};

// Converts "6th Semester" → "Sem 6", "Sem VI" → "Sem 6"
const formatSemester = (raw) => {
  if (!raw) return 'N/A';
  const str = String(raw).trim();
  const digitMatch = str.match(/^(\d+)/);
  if (digitMatch) return `Sem ${digitMatch[1]}`;
  const romanMap = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8' };
  const romanMatch = str.match(/^Sem\s*([IVX]+)$/i);
  if (romanMatch) {
    const roman = romanMatch[1].toUpperCase();
    return romanMap[roman] ? `Sem ${romanMap[roman]}` : str;
  }
  return str;
};

// Status badge — always shows Present (green) or Absent (red)
const StatusBadge = ({ label }) => {
  const cls = label === 'Present'
    ? 'bg-green-100 text-green-800 border border-green-200'
    : 'bg-red-100 text-red-800 border border-red-200';
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * PracticalSessionTable
 *
 * Props:
 *   session  — the session object from groupedSessions (includes metadata)
 *   students — sorted, filtered array of student objects for this session
 *   search   — current search term (controlled by parent)
 *   onSearchChange — (value: string) => void
 */
const PracticalSessionTable = ({ session, students, search, onSearchChange }) => {
  const [exportLoading, setExportLoading] = useState(false);

  // ── Export to CSV ────────────────────────────────────────────────────────
  const handleDownloadResult = () => {
    setExportLoading(true);
    try {
      const rows = students.map((sub) => {
        const isAbsent = sub.status === 'absent' || sub.status === 'registered';
        return {
          'Roll Number': sub.roll_no || '',
          'Name': sub.name || '',
          'Status': isAbsent ? 'Absent' : 'Present',
          'Practical Marks': parseFloat(sub.scores?.practical) || 0,
          'Internal Marks (Viva + Journal)': computeInternalMarks(sub.scores),
          'Total': parseFloat(sub.scores?.total) || 0,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Practical Result');

      // Set column widths
      worksheet['!cols'] = [
        { wch: 16 }, // Roll Number
        { wch: 28 }, // Name
        { wch: 14 }, // Status
        { wch: 18 }, // Practical Marks
        { wch: 28 }, // Internal Marks
        { wch: 10 }, // Total
      ];

      // Strict file name as per spec
      XLSX.writeFile(workbook, 'result of practical exam.xlsx');
    } catch (err) {
      alert('Error exporting: ' + err.message);
    } finally {
      setExportLoading(false);
    }
  };

  // ── Metadata from session ───────────────────────────────────────────────
  const dateConducted = formatDate(session?.exam_date_obj || session?.date_obj);
  const department    = session?.student_department || 'N/A';
  const subjectName   = session?.subject_name || 'N/A';
  const semester      = session?.student_semester || 'N/A';
  const createdBy     = session?.created_by || 'N/A';

  return (
    <div>
      {/* ── Controls Bar ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center mb-5">
        <div className="relative w-full sm:w-72">
          <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search Roll No or Name..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none text-sm transition"
          />
        </div>

        <button
          onClick={handleDownloadResult}
          disabled={exportLoading || students.length === 0}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-semibold text-sm transition shadow-sm whitespace-nowrap"
        >
          {exportLoading ? (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          {exportLoading ? 'Exporting...' : 'Download Result'}
        </button>
      </div>

      {/* ── Blue Header Box (mirrors Internal Exam style) ────────────────── */}
      <div className="mb-6 p-5 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
            Practical Exam
          </span>
          <span className="text-sm text-blue-700 font-semibold">{session?.session_code}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Date Conducted</p>
            <p className="text-sm font-semibold text-gray-800">{dateConducted}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Department</p>
            <p className="text-sm font-semibold text-gray-800">{department}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Subject</p>
            <p className="text-sm font-semibold text-gray-800">{subjectName}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Semester</p>
            <p className="text-sm font-semibold text-gray-800">{formatSemester(semester)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Created By</p>
            <p className="text-sm font-semibold text-gray-800 truncate" title={createdBy}>{createdBy}</p>
          </div>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">#</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Roll Number</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Practical Marks</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">
                Internal Marks
                <span className="block text-xs font-normal text-gray-400">(Viva + Journal)</span>
              </th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  {search ? `No students match "${search}"` : 'No student records found.'}
                </td>
              </tr>
            ) : (
              students.map((sub, idx) => {
                const internalMarks = computeInternalMarks(sub.scores);
                return (
                  <tr key={sub.id || sub.roll_no} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-700">{sub.roll_no}</td>
                    <td className="px-4 py-3 text-gray-800">{sub.name}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const isAbsent = sub.status === 'absent' || sub.status === 'registered';
                        const statusLabel = isAbsent ? 'Absent' : 'Present';
                        return <StatusBadge label={statusLabel} />;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-gray-700">
                      {parseFloat(sub.scores?.practical) || 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-medium text-indigo-700">{internalMarks}</span>
                      <span className="text-xs text-gray-400 ml-1">
                        ({parseFloat(sub.scores?.viva) || 0} + {parseFloat(sub.scores?.journal) || 0})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-gray-900">{parseFloat(sub.scores?.total) || 0}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {students.length > 0 && (
        <p className="mt-3 text-xs text-gray-400 text-right">
          Showing {students.length} student{students.length !== 1 ? 's' : ''}
          {search && ` matching "${search}"`}
        </p>
      )}
    </div>
  );
};

export default PracticalSessionTable;
