"use client";

import React, { useEffect, useState } from "react";
import TimetableGrid, { TimetableEntry } from "@/components/TimetableGrid";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function StudentTimetablePage() {
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [className, setClassName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const today = WEEKDAYS[new Date().getDay()];

  useEffect(() => {
    // The server derives the class from this student's own record; no class is sent from here.
    fetch("/api/timetable", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to load your timetable.");
        setEntries(Array.isArray(json.timetable) ? json.timetable : []);
        setClassName(json.student?.className || "");
      })
      .catch((err) => setError(err?.message || "Failed to load your timetable."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Class Timetable</h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Weekly periods for {className ? <span className="font-semibold text-on-surface">{className}</span> : "your class"}.
          </p>
        </div>
        {!loading && !error && (
          <span className="px-2.5 py-1 rounded-full bg-secondary/10 text-secondary text-xs font-bold self-start sm:self-auto">
            {entries.length} {entries.length === 1 ? "Period" : "Periods"} / week
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

      {!loading && !error && entries.length === 0 && (
        <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant">calendar_clock</span>
          <p className="font-semibold text-sm text-on-surface">No timetable published yet</p>
          <p className="text-xs text-on-surface-variant">The school has not scheduled any periods for your class yet.</p>
        </div>
      )}

      {!loading && !error && entries.length > 0 && <TimetableGrid entries={entries} rows="day" highlightDay={today} />}
    </div>
  );
}
