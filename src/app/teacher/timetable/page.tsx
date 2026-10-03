"use client";

import React, { useEffect, useState } from "react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function TeacherTimetablePage() {
  const [timetable, setTimetable] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const today = ["Sunday", ...DAYS.slice(0, 6)][new Date().getDay()];

  useEffect(() => {
    // The server returns only this teacher's own slots (resolved from the session).
    fetch("/api/timetable")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to load your timetable.");
        setTimetable(Array.isArray(json.timetable) ? json.timetable : []);
      })
      .catch((err) => setError(err?.message || "Failed to load your timetable."))
      .finally(() => setLoading(false));
  }, []);

  const days = DAYS.map((day) => ({ day, slots: timetable.filter((t) => t.dayOfWeek === day) })).filter(
    (d) => d.slots.length > 0
  );

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">My Weekly Timetable</h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Every period assigned to you by the administration, by day.
          </p>
        </div>
        {!loading && !error && (
          <span className="px-2.5 py-1 rounded-full bg-secondary/10 text-secondary text-xs font-bold self-start sm:self-auto">
            {timetable.length} {timetable.length === 1 ? "Period" : "Periods"} / week
          </span>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading timetable...</p>
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && days.length === 0 && (
        <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant">calendar_clock</span>
          <p className="font-semibold text-sm text-on-surface">No timetable configured</p>
          <p className="text-xs text-on-surface-variant">
            No periods have been assigned to your schedule yet. Please contact the school admin.
          </p>
        </div>
      )}

      {!loading && !error && days.map(({ day, slots }) => (
        <section
          key={day}
          className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden"
        >
          <div className="px-4 py-2.5 bg-surface-container-low border-b border-surface-container-high/40 flex items-center gap-2">
            <h2 className="font-headline-md text-sm font-bold text-on-surface">{day}</h2>
            {day === today && (
              <span className="px-2 py-0.5 rounded-full bg-secondary text-on-secondary text-[10px] font-bold">Today</span>
            )}
            <span className="ml-auto text-[11px] text-on-surface-variant">{slots.length} {slots.length === 1 ? "period" : "periods"}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-2.5 px-4 font-bold">Period</th>
                  <th className="py-2.5 px-4 font-bold">Time</th>
                  <th className="py-2.5 px-4 font-bold">Class</th>
                  <th className="py-2.5 px-4 font-bold">Subject</th>
                  <th className="py-2.5 px-4 font-bold">Room</th>
                  <th className="py-2.5 px-4 font-bold">Topic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {slots.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-container-low/40">
                    <td className="py-2.5 px-4 font-semibold text-on-surface">{t.periodName}</td>
                    <td className="py-2.5 px-4 font-mono text-on-surface">{t.startTime} – {t.endTime}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-primary">{t.className}</span>
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-on-surface">{t.subjectName}</td>
                    <td className="py-2.5 px-4 font-mono text-on-surface-variant">{t.roomNo && t.roomNo !== "-" ? t.roomNo : "—"}</td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{t.topic || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
