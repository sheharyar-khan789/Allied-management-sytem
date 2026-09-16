"use client";

import React, { useEffect, useState } from "react";

export default function AttendanceManagementPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [roster, setRoster] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.classes.length > 0) {
          setClasses(json.classes);
          // Default to Class 5-A if available
          const class5A = json.classes.find((c: any) => c.displayName === "Class 5-A");
          setSelectedClassId(class5A ? class5A.id : json.classes[0].id);
        }
      })
      .catch(console.error);
  }, []);

  const fetchAttendance = async () => {
    if (!selectedClassId) return;
    setLoading(true);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/attendance?classId=${selectedClassId}&date=${selectedDate}`);
      const json = await res.json();
      if (json.success) {
        setRoster(json.roster);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      fetchAttendance();
    }
  }, [selectedClassId, selectedDate]);

  const handleStatusChange = (studentId: string, status: string) => {
    setRoster((prev) =>
      prev.map((item) => (item.studentId === studentId ? { ...item, status } : item))
    );
    setSaveSuccess(false);
  };

  const handleRemarksChange = (studentId: string, remarks: string) => {
    setRoster((prev) =>
      prev.map((item) => (item.studentId === studentId ? { ...item, remarks } : item))
    );
  };

  const handleMarkAllPresent = () => {
    setRoster((prev) => prev.map((item) => ({ ...item, status: "PRESENT" })));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClassId,
          date: selectedDate,
          records: roster.map((r) => ({
            studentId: r.studentId,
            status: r.status,
            remarks: r.remarks,
          })),
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const presentCount = roster.filter((r) => r.status === "PRESENT").length;
  const absentCount = roster.filter((r) => r.status === "ABSENT").length;
  const lateCount = roster.filter((r) => r.status === "LATE").length;
  const leaveCount = roster.filter((r) => r.status === "LEAVE").length;
  const totalCount = roster.length;
  const percentage = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 100;

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Daily Attendance Register
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Class Roster Register
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Mark, verify, and persist daily attendance status for student cohorts with automatic database synchronization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMarkAllPresent}
            className="px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold transition-all"
          >
            Mark All Present
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            <span>{saving ? "Saving Register..." : "Save Attendance"}</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>Attendance register saved and locked into database successfully.</span>
        </div>
      )}

      {/* Control Bar: Class selector + Date picker */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="attendance-select-class-cohort-1" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              Select Class Cohort
            </label>
            <select id="attendance-select-class-cohort-1"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} ({c.studentCount} students)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="attendance-attendance-date-2" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              Attendance Date
            </label>
            <input id="attendance-attendance-date-2"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
            </input>
          </div>
        </div>

        {/* Live Attendance Pills */}
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-tertiary-container/10 text-on-tertiary-container text-xs font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-on-tertiary-container"></span>
            <span>{presentCount} Present</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-error"></span>
            <span>{absentCount} Absent</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-xs font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-600"></span>
            <span>{lateCount} Late</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-secondary/10 text-secondary text-xs font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-secondary"></span>
            <span>{leaveCount} Leave</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-xs font-bold">
            Rate: {percentage}%
          </div>
        </div>
      </div>

      {/* Student Roll Call Register Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading class roster...</p>
          </div>
        ) : roster.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">how_to_reg</span>
            <p className="text-sm font-semibold text-on-surface">No students enrolled in this cohort</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Roll #</th>
                  <th className="py-3 px-4 font-bold">Student Name</th>
                  <th className="py-3 px-4 font-bold">Admission #</th>
                  <th className="py-3 px-4 font-bold text-center">Status Selection</th>
                  <th className="py-3 px-4 font-bold">Remarks / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {roster.map((item) => (
                  <tr key={item.studentId} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-on-surface">{item.rollNumber}</td>
                    <td className="py-3 px-4 font-bold text-on-surface">{item.name}</td>
                    <td className="py-3 px-4 font-mono text-on-surface-variant">{item.admissionNumber}</td>

                    {/* Interactive Status Buttons */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStatusChange(item.studentId, "PRESENT")}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            item.status === "PRESENT"
                              ? "bg-on-tertiary-container text-white shadow-sm"
                              : "bg-surface-container hover:bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          P
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(item.studentId, "LATE")}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            item.status === "LATE"
                              ? "bg-amber-600 text-white shadow-sm"
                              : "bg-surface-container hover:bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          L
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(item.studentId, "ABSENT")}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            item.status === "ABSENT"
                              ? "bg-error text-white shadow-sm"
                              : "bg-surface-container hover:bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          A
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(item.studentId, "LEAVE")}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            item.status === "LEAVE"
                              ? "bg-secondary text-white shadow-sm"
                              : "bg-surface-container hover:bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          LV
                        </button>
                      </div>
                    </td>

                    {/* Remarks input */}
                    <td className="py-3 px-4">
                      <input
                        type="text"
                        value={item.remarks}
                        onChange={(e) => handleRemarksChange(item.studentId, e.target.value)}
                        placeholder="Add remark..."
                        className="w-full h-8 px-2.5 rounded bg-surface-container-low text-xs text-on-surface border border-outline-variant/30 focus:outline-none focus:border-secondary"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
