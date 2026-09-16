"use client";

import React, { useEffect, useState } from "react";

export default function TeacherAttendanceRegisterPage() {
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
          setSelectedClassId(json.classes[0].id);
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

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              Classroom Roll Call Register
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Faculty Roll Call
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Quick one-tap attendance marking for authorized class cohorts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMarkAllPresent}
            className="px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            Mark All Present
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            <span>{saving ? "Saving Register..." : "Submit Roll Call"}</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>Classroom attendance submitted successfully.</span>
        </div>
      )}

      {/* Selector ribbon */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <label htmlFor="attendance-select-class-1" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
              Select Class
            </label>
            <select id="attendance-select-class-1"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="attendance-date-2" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
              Date
            </label>
            <input id="attendance-date-2"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40"
            />
          </div>
        </div>

        {/* Status Counts */}
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded bg-tertiary-container/10 text-on-tertiary-container text-xs font-bold">
            {presentCount} Present
          </span>
          <span className="px-2.5 py-1 rounded bg-error-container text-on-error-container text-xs font-bold">
            {absentCount} Absent
          </span>
          <span className="px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-xs font-bold">
            {lateCount} Late
          </span>
          <span className="px-2.5 py-1 rounded bg-secondary/10 text-secondary text-xs font-bold">
            {leaveCount} Leave
          </span>
        </div>
      </div>

      {/* Roster Cards List */}
      <div className="space-y-2">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading roster...</p>
          </div>
        ) : classes.length === 0 ? (
          <div className="p-12 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-on-surface-variant text-xs">
            No classes assigned or available to take attendance.
          </div>
        ) : roster.length === 0 ? (
          <div className="p-12 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-on-surface-variant text-xs">
            No students enrolled in this class cohort yet.
          </div>
        ) : (
          roster.map((st) => (
            <div
              key={st.studentId}
              className="p-3 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center font-mono font-bold text-xs text-on-surface">
                  {st.rollNumber}
                </span>
                <div>
                  <h4 className="font-bold text-xs text-on-surface">{st.name}</h4>
                  <span className="text-[10px] text-on-surface-variant font-mono">{st.admissionNumber}</span>
                </div>
              </div>

              {/* Status Selectors */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleStatusChange(st.studentId, "PRESENT")}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all ${
                    st.status === "PRESENT"
                      ? "bg-on-tertiary-container text-white shadow-sm"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  P
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange(st.studentId, "LATE")}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all ${
                    st.status === "LATE"
                      ? "bg-amber-600 text-white shadow-sm"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  L
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange(st.studentId, "ABSENT")}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all ${
                    st.status === "ABSENT"
                      ? "bg-error text-white shadow-sm"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  A
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange(st.studentId, "LEAVE")}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all ${
                    st.status === "LEAVE"
                      ? "bg-secondary text-white shadow-sm"
                      : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  LV
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
