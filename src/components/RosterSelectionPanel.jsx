import { useState, useEffect, useMemo } from "react";

const RosterSelectionPanel = ({
  roster = [],
  loading = false,
  error = "",
  onRetry,
  onSelectionChange,
  initialSelection = [],
}) => {
  const [selected, setSelected] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    if (initialSelection && initialSelection.length > 0) {
      setSelected(new Set(initialSelection.map((s) => s.rollNumber)));
    }
  }, []);

  useEffect(() => {
    if (!roster.length) return;
    const selectedStudents = roster.filter((s) => selected.has(s.rollNumber));
    onSelectionChange(selectedStudents);
  }, [selected, roster]);

  const sortedRoster = useMemo(() => {
    // Parse roll numbers for alphanumeric-aware sorting (e.g. CS001, 2200A)
    const parseRoll = (rn) => {
      const match = String(rn || '').match(/^([a-zA-Z]*)([0-9]+)([a-zA-Z0-9]*)$/);
      if (match) return { prefix: match[1].toUpperCase(), num: parseInt(match[2], 10), suffix: match[3].toUpperCase() };
      return { prefix: String(rn || '').toUpperCase(), num: 0, suffix: '' };
    };
    return [...roster].sort((a, b) => {
      const ra = parseRoll(a.rollNumber);
      const rb = parseRoll(b.rollNumber);
      if (ra.prefix < rb.prefix) return -1;
      if (ra.prefix > rb.prefix) return 1;
      if (ra.num !== rb.num) return ra.num - rb.num;
      return ra.suffix.localeCompare(rb.suffix);
    });
  }, [roster]);


  const filteredRoster = useMemo(() => {
    const base = sortedRoster;
    if (!searchTerm.trim()) return base;
    const term = searchTerm.trim().toLowerCase();
    return base.filter(
      (s) =>
        s.rollNumber.toLowerCase().includes(term) ||
        s.fullName.toLowerCase().includes(term)
    );
  }, [sortedRoster, searchTerm]);

  const toggleStudent = (rollNumber) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rollNumber)) next.delete(rollNumber);
      else next.add(rollNumber);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredRoster.forEach((s) => next.add(s.rollNumber));
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredRoster.forEach((s) => next.delete(s.rollNumber));
      return next;
    });
  };

  const handleApplyRange = () => {
    const from = rangeFrom.trim().toUpperCase();
    const to = rangeTo.trim().toUpperCase();
    if (!from || !to) {
      alert("Please enter both From and To roll numbers for the range.");
      return;
    }
    const inRange = roster.filter((s) => {
      const r = s.rollNumber.toUpperCase();
      
      const isNumeric = (val) => !isNaN(val) && !isNaN(parseFloat(val));
      if (isNumeric(from) && isNumeric(to) && isNumeric(r)) {
        const numR = parseFloat(r);
        const numFrom = parseFloat(from);
        const numTo = parseFloat(to);
        return numR >= numFrom && numR <= numTo;
      }

      return r >= from && r <= to;
    });
    if (inRange.length === 0) {
      alert("No students found in the range " + from + " to " + to + ".");
      return;
    }
    // Replace the entire selection with the new range (as requested by user)
    setSelected(new Set(inRange.map((s) => s.rollNumber)));

    // Scroll to the first selected student in the range so it's immediately visible
    setTimeout(() => {
      const firstStudent = inRange[0];
      if (firstStudent) {
        const row = document.getElementById('row-' + firstStudent.rollNumber);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 100);
  };

  const handleClearRange = () => {
    setRangeFrom("");
    setRangeTo("");
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500 font-medium">Fetching your approved student roster...</p>
        <p className="text-gray-400 text-sm mt-1">This may take a moment for large rosters.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <div className="text-4xl mb-3">warning</div>
        <h3 className="font-bold text-red-800 mb-1">Failed to Load Roster</h3>
        <p className="text-red-600 text-sm mb-4">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold text-sm">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!loading && roster.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
        <h3 className="font-bold text-yellow-800 mb-1">No Roster Found</h3>
        <p className="text-yellow-700 text-sm">
          No students are registered for your college yet. Please contact your administrator to upload the master student roster.
        </p>
      </div>
    );
  }

  const allVisibleSelected =
    filteredRoster.length > 0 && filteredRoster.every((s) => selected.has(s.rollNumber));

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white bg-opacity-20 rounded-xl flex items-center justify-center text-xl">??</div>
          <div>
            <h3 className="font-bold text-lg">Student Roster Selection</h3>
            <p className="text-blue-100 text-xs">Select students permitted in this exam session</p>
          </div>
        </div>
        <div className="bg-white bg-opacity-20 rounded-full px-4 py-1.5 text-sm font-bold">
          {selected.size} / {roster.length} selected
        </div>
      </div>

      <div className="p-4 space-y-3 border-b border-gray-100">
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name or roll number..."
            className="w-full border border-gray-300 rounded-lg pl-4 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">
              x
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Roll Range:</span>
          <input
            type="text"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value.toUpperCase())}
            placeholder="From"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-blue-400 outline-none"
          />
          <span className="text-gray-400">to</span>
          <input
            type="text"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value.toUpperCase())}
            placeholder="To"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-blue-400 outline-none"
          />
          <button onClick={handleApplyRange} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-bold transition">
            Apply Range
          </button>
          {(rangeFrom || rangeTo) && (
            <button onClick={handleClearRange} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg transition">
              Clear
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            disabled={allVisibleSelected}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 text-sm rounded-lg font-bold transition disabled:opacity-40"
          >
            Select All{searchTerm ? " Visible" : ""}
          </button>
          <button
            onClick={handleDeselectAll}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-600 text-sm rounded-lg font-bold transition"
          >
            Deselect All{searchTerm ? " Visible" : ""}
          </button>
          {searchTerm && (
            <span className="text-xs text-gray-400 self-center">
              Showing {filteredRoster.length} of {roster.length}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "380px" }}>
        {filteredRoster.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p className="text-sm">No students match your search.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
              <tr>
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={allVisibleSelected ? handleDeselectAll : handleSelectAll}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold w-16">S.No</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold w-32">Roll Number</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold">Full Name</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoster.map((student, idx) => {
                const isSelected = selected.has(student.rollNumber);
                return (
                  <tr
                    key={student.rollNumber}
                    id={'row-' + student.rollNumber}
                    onClick={() => toggleStudent(student.rollNumber)}
                    className={"border-b border-gray-50 cursor-pointer transition " +
                      (isSelected
                        ? "bg-blue-50 hover:bg-blue-100"
                        : idx % 2 === 0
                        ? "bg-white hover:bg-gray-50"
                        : "bg-gray-50 hover:bg-gray-100")}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleStudent(student.rollNumber)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{student.serialNumber}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{student.rollNumber}</td>
                    <td className="px-4 py-2.5 text-gray-700">{student.fullName}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-t border-gray-100">
        <span className="text-sm text-gray-500">
          <strong className="text-gray-800">{selected.size}</strong> student
          {selected.size !== 1 ? "s" : ""} selected out of{" "}
          <strong className="text-gray-800">{roster.length}</strong> total
        </span>
        {selected.size > 0 && (
          <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-semibold">
            Ready to launch
          </span>
        )}
      </div>
    </div>
  );
};

export default RosterSelectionPanel;
