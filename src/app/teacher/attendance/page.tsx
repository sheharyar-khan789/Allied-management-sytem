"use client";

import React, { useEffect, useState } from "react";
import { todayLocalISO } from "@/lib/date-utils";

const DAILY_REGISTER = "__daily__";

/**
 * The registers this teacher may open for a class (the server enforces the same rule): only a
 * class they are incharge of — its daily register, plus their own subjects' registers there.
 * Teaching a subject in a class they are not incharge of gives no attendance access.
 */
function registersFor(cls: any): { value: string; label: string }[] {
  if (!cls?.isIncharge) return [];
  return [
    { value: DAILY_REGISTER, label: "Daily Register (Class Incharge)" },
    ...(cls.subjects || []).map((s: any) => ({ value: s.id, label: `${s.name} (${s.code})` })),
  ];
}

export default function TeacherAttendanceRegisterPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [classesLoaded, setClassesLoaded] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedRegister, setSelectedRegister] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayLocalISO());
  const [roster, setRoster] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Load failures (403 not-your-class, 401 expired session, 500) used to be swallowed, leaving
  // an empty "No students enrolled" roster that looked like real data.
  const [loadError, setLoadError] = useState("");
  // How many roster rows have a stored record for this date. Unmarked rows display the default
  // "Present", so without this an unsaved register looked identical to a saved one.
  const [savedCount, setSavedCount] = useState(0);
  // Server-computed 24h lock state (enforced again by /api/attendance on save).
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    // Only this teacher's allocated classes (with only their own subjects) come back.
    fetch("/api/classes")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          setLoadError(json.error || "Failed to load your allocated classes.");
          return;
        }
        const list = (json.classes || []).filter((c: any) => registersFor(c).length > 0);
        setClasses(list);
        if (list.length === 0) return;
        // Preselect a class/subject when arriving from a timetable period's "Roll Call" link.
        const params = new URLSearchParams(window.location.search);
        const wanted = list.find((c: any) => c.id === params.get("classId")) || list[0];
        const registers = registersFor(wanted);
        const wantedRegister = registers.find((r) => r.value === params.get("subjectId")) || registers[0];
        setSelectedClassId(wanted.id);
        setSelectedRegister(wantedRegister.value);
      })
      .catch((err) => {
        console.error(err);
        setLoadError("Failed to load your allocated classes. Please check your connection.");
      })
      .finally(() => {
        setClassesLoaded(true);
        setLoading(false);
      });
  }, []);

  const selectedClass = classes.find((c) => c.id === selectedClassId);
  const registerOptions = registersFor(selectedClass);
  const subjectQuery = selectedRegister && selectedRegister !== DAILY_REGISTER ? selectedRegister : "";

  const handleClassChange = (classId: string) => {
    setSelectedClassId(classId);
    const first = registersFor(classes.find((c) => c.id === classId))[0];
    setSelectedRegister(first ? first.value : "");
  };

  const fetchAttendance = async (keepMessages = false) => {
    if (!selectedClassId || !selectedRegister) return;
    setLoading(true);
    if (!keepMessages) {
      setSaveSuccess(false);
      setSaveError("");
    }
    setLoadError("");

    try {
      const res = await fetch(
        `/api/attendance?classId=${encodeURIComponent(selectedClassId)}&date=${selectedDate}` +
          (subjectQuery ? `&subjectId=${encodeURIComponent(subjectQuery)}` : "")
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setRoster(json.roster);
        setSavedCount(Number(json.savedCount) || 0);
        setLocked(Boolean(json.locked));
      } else {
        setRoster([]);
        setSavedCount(0);
        setLoadError(json.error || "Failed to load the attendance register.");
      }
    } catch (err) {
      console.error(err);
      setRoster([]);
      setLoadError("Failed to load the attendance register. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedClassId && selectedRegister) {
      fetchAttendance();
    }
  }, [selectedClassId, selectedRegister, selectedDate]);

  const handleStatusChange = (studentId: string, status: string) => {
    setRoster((prev) =>
      prev.map((item) => (item.studentId === studentId && item.editable ? { ...item, status } : item))
    );
    setSaveSuccess(false);
  };

  const handleMarkAllPresent = () => {
    setRoster((prev) => prev.map((item) => (item.editable ? { ...item, status: "PRESENT" } : item)));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: selectedClassId,
          ...(subjectQuery ? { subjectId: subjectQuery } : {}),
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
        await fetchAttendance(true);
      } else {
        const json = await res.json().catch(() => ({}));
        setSaveError(json.error || "Failed to save attendance.");
        if (json.locked) fetchAttendance();
      }
    } catch (err) {
      console.error(err);
      setSaveError("Failed to save attendance.");
    } finally {
      setSaving(false);
    }
  };

  const presentCount = roster.filter((r) => r.status === "PRESENT").length;
  const absentCount = roster.filter((r) => r.status === "ABSENT").length;
  const lateCount = roster.filter((r) => r.status === "LATE").length;
  const leaveCount = roster.filter((r) => r.status === "LEAVE").length;
  const someRowsLocked = !locked && roster.some((r) => !r.editable);

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
            disabled={locked}
            className="px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold disabled:opacity-50"
          >
            Mark All Present
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || locked}
            className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">{locked ? "lock" : "save"}</span>
            <span>{locked ? "Locked" : saving ? "Saving Register..." : "Submit Roll Call"}</span>
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>Classroom attendance submitted successfully.</span>
        </div>
      )}

      {loadError && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {!loading && !loadError && roster.length > 0 && savedCount < roster.length && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">pending_actions</span>
          <span>
            {savedCount === 0
              ? "Attendance for this date has not been saved yet. The statuses below are defaults until you save."
              : `${savedCount} of ${roster.length} students have saved attendance for this date. Save to record the rest.`}
          </span>
        </div>
      )}

      {!loading && !loadError && roster.length > 0 && savedCount === roster.length && (
        <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface text-xs font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">cloud_done</span>
          <span>Attendance for this date is saved.</span>
        </div>
      )}

      {saveError && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{saveError}</span>
        </div>
      )}

      {!loading && (locked || someRowsLocked) && (
        <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/40 text-on-surface text-xs font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">lock</span>
          <span>
            {locked
              ? "This register is locked and read-only. Attendance can only be marked or changed within 24 hours of being recorded; contact an administrator for corrections."
              : "Some records were marked more than 24 hours ago and are locked (read-only). Only an administrator can change them."}
          </span>
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
              onChange={(e) => handleClassChange(e.target.value)}
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
            <label htmlFor="attendance-select-register" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
              Subject / Register
            </label>
            <select id="attendance-select-register"
              value={selectedRegister}
              onChange={(e) => setSelectedRegister(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40"
            >
              {registerOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
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
        ) : classesLoaded && classes.length === 0 ? (
          <div className="p-12 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-on-surface-variant text-xs">
            Attendance is managed by class incharges. You are not the class incharge of any class.
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
                  <h4 className="font-bold text-xs text-on-surface flex items-center gap-1">
                    {st.name}
                    {!st.editable && (
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant" title="Locked: marked more than 24 hours ago" aria-label="Locked">
                        lock
                      </span>
                    )}
                  </h4>
                  <span className="text-[10px] text-on-surface-variant font-mono">{st.admissionNumber}</span>
                </div>
              </div>

              {/* Status Selectors */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleStatusChange(st.studentId, "PRESENT")}
                  disabled={!st.editable}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all disabled:cursor-not-allowed ${
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
                  disabled={!st.editable}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all disabled:cursor-not-allowed ${
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
                  disabled={!st.editable}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all disabled:cursor-not-allowed ${
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
                  disabled={!st.editable}
                  className={`w-9 h-8 rounded text-xs font-bold transition-all disabled:cursor-not-allowed ${
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
