"use client";

import React, { useEffect, useState, useCallback } from "react";
import { formatDisplayDate } from "@/lib/date-utils";

interface DayResult {
  date: string;
  status: "PRESENT" | "ABSENT" | "LEAVE";
  recorded: boolean;
  weeklyLeaveCapApplied?: boolean;
  record?: { source: string; checkInTime?: string; remarks?: string };
}

const STATUS_STYLES: Record<string, string> = {
  PRESENT: "bg-tertiary-container/10 text-on-tertiary-container",
  ABSENT: "bg-error-container/20 text-error",
  LEAVE: "bg-secondary/10 text-secondary",
};

const now = new Date();

export default function TeacherAttendancePage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);
  const [roster, setRoster] = useState<any[]>([]);

  const [correctingDate, setCorrectingDate] = useState("");
  const [correctionStatus, setCorrectionStatus] = useState<"PRESENT" | "ABSENT" | "LEAVE">("PRESENT");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState("");

  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState("");
  const [holidaysSaving, setHolidaysSaving] = useState(false);

  useEffect(() => {
    fetch("/api/teachers")
      .then((res) => res.json())
      .then((json) => { if (json.success) setTeachers(json.teachers); })
      .catch(console.error);
    fetch("/api/settings")
      .then((res) => res.json())
      .then((json) => { if (json.success) setHolidays(json.settings.holidays || []); })
      .catch(console.error);
  }, []);

  const loadDetail = useCallback(() => {
    if (!selectedTeacherId) return;
    setLoading(true);
    setError("");
    fetch(`/api/teacher-attendance?teacherId=${encodeURIComponent(selectedTeacherId)}&year=${year}&month=${month}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Could not load attendance.");
        return json;
      })
      .then((json) => setData(json))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedTeacherId, year, month]);

  const loadRoster = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/teacher-attendance?year=${year}&month=${month}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Could not load attendance.");
        return json;
      })
      .then((json) => setRoster(json.teachers || []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => {
    if (selectedTeacherId) { setData(null); loadDetail(); }
    else { setRoster([]); loadRoster(); }
  }, [selectedTeacherId, loadDetail, loadRoster]);

  const openCorrection = (date: string, currentStatus: string) => {
    setCorrectingDate(date);
    setCorrectionStatus(currentStatus as any);
    setCorrectionReason("");
    setCorrectionError("");
  };

  const saveCorrection = async () => {
    if (!correctingDate || !selectedTeacherId) return;
    setCorrectionSaving(true);
    setCorrectionError("");
    try {
      const res = await fetch("/api/teacher-attendance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: selectedTeacherId, date: correctingDate, status: correctionStatus, reason: correctionReason || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Could not save the correction.");
      setCorrectingDate("");
      loadDetail();
    } catch (e: any) {
      setCorrectionError(e.message || "Could not save the correction.");
    } finally {
      setCorrectionSaving(false);
    }
  };

  const saveHolidays = async (next: string[]) => {
    setHolidaysSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holidays: next }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setHolidays(next);
        if (selectedTeacherId) loadDetail(); else loadRoster();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setHolidaysSaving(false);
    }
  };

  const selectedTeacher = teachers.find((t) => t.id === selectedTeacherId);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Teacher Attendance</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Separate from student attendance. Working days exclude Sundays and configured holidays; one allowed
          leave day per week — a second leave day in the same week counts as absent. A real biometric check-in
          always counts as present. All times are in the school&apos;s configured timezone (Asia/Karachi by default).
        </p>
      </div>

      {error && <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>}

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Teacher</label>
          <select
            value={selectedTeacherId}
            onChange={(e) => setSelectedTeacherId(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40"
          >
            <option value="">All teachers (summary)</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName} ({t.employeeId})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Month</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 w-24 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40" />
        </div>
      </div>

      {/* Holidays */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-2">
        <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-[18px]">event_busy</span>
          School Holidays (excluded from working days)
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {holidays.length === 0 && <span className="text-xs text-on-surface-variant italic">None set — only Sundays are excluded.</span>}
          {holidays.map((h) => (
            <span key={h} className="px-2 py-1 rounded bg-surface-container text-xs font-mono flex items-center gap-1">
              {h}
              <button type="button" onClick={() => saveHolidays(holidays.filter((x) => x !== h))} disabled={holidaysSaving} className="text-on-surface-variant hover:text-error">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} className="h-8 px-2 rounded bg-surface-container-low text-xs border border-outline-variant/40" />
          <button
            type="button"
            onClick={() => { if (newHoliday && !holidays.includes(newHoliday)) { saveHolidays([...holidays, newHoliday]); setNewHoliday(""); } }}
            disabled={!newHoliday || holidaysSaving}
            className="px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold disabled:opacity-50"
          >
            Add Holiday
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : selectedTeacherId && data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Working Days", value: data.summary.workingDays, cls: "" },
              { label: "Present", value: data.summary.present, cls: "text-tertiary" },
              { label: "Leave", value: data.summary.leave, cls: "text-secondary" },
              { label: "Absent", value: data.summary.absent, cls: "text-error" },
            ].map((s) => (
              <div key={s.label} className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
                <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">{s.label}</div>
                <div className={`text-2xl font-bold mt-1 ${s.cls || "text-on-surface"}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                    <th className="py-2 px-4 font-bold">Date</th>
                    <th className="py-2 px-4 font-bold">Status</th>
                    <th className="py-2 px-4 font-bold">Source</th>
                    <th className="py-2 px-4 font-bold">Check-in</th>
                    <th className="py-2 px-4 font-bold">Note</th>
                    <th className="py-2 px-4 font-bold text-right">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {data.days.map((d: DayResult) => (
                    <tr key={d.date}>
                      <td className="py-2 px-4 font-mono">{formatDisplayDate(d.date)}</td>
                      <td className="py-2 px-4">
                        <span className={`px-2 py-0.5 rounded font-bold ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                        {d.weeklyLeaveCapApplied && <span className="ml-1 text-[10px] text-on-surface-variant">(2nd leave this week)</span>}
                      </td>
                      <td className="py-2 px-4 text-on-surface-variant">{d.record?.source || (d.recorded ? "" : "not recorded")}</td>
                      <td className="py-2 px-4 font-mono">{d.record?.checkInTime || "—"}</td>
                      <td className="py-2 px-4 text-on-surface-variant">{d.record?.remarks || ""}</td>
                      <td className="py-2 px-4 text-right">
                        <button type="button" onClick={() => openCorrection(d.date, d.status)} className="text-secondary hover:underline font-semibold">
                          Correct
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : !selectedTeacherId ? (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                <th className="py-2 px-4 font-bold">Teacher</th>
                <th className="py-2 px-4 font-bold">Working Days</th>
                <th className="py-2 px-4 font-bold">Present</th>
                <th className="py-2 px-4 font-bold">Leave</th>
                <th className="py-2 px-4 font-bold">Absent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {roster.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-surface-container-low/40" onClick={() => setSelectedTeacherId(t.id)}>
                  <td className="py-2 px-4 font-semibold text-on-surface">{t.fullName} <span className="text-on-surface-variant font-mono text-[10px]">({t.employeeId})</span></td>
                  <td className="py-2 px-4">{t.summary.workingDays}</td>
                  <td className="py-2 px-4 text-tertiary font-bold">{t.summary.present}</td>
                  <td className="py-2 px-4 text-secondary font-bold">{t.summary.leave}</td>
                  <td className="py-2 px-4 text-error font-bold">{t.summary.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {correctingDate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" className="bg-surface-container-lowest rounded-xl max-w-sm w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">
              Correct {selectedTeacher?.fullName} — {formatDisplayDate(correctingDate)}
            </h3>
            {correctionError && <div className="p-2 rounded bg-error-container text-on-error-container text-xs">{correctionError}</div>}
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Status</label>
              <select value={correctionStatus} onChange={(e) => setCorrectionStatus(e.target.value as any)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40">
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="LEAVE">Leave</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Reason (recorded in audit log)</label>
              <input type="text" value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" placeholder="e.g. Approved sick leave" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCorrectingDate("")} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-semibold">Cancel</button>
              <button type="button" onClick={saveCorrection} disabled={correctionSaving} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold disabled:opacity-50">
                {correctionSaving ? "Saving..." : "Save Correction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
