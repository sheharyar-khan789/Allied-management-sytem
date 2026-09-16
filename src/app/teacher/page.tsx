"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

export default function TeacherSchedulePage() {
  const [timetable, setTimetable] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/timetable")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.timetable)) {
          setTimetable(data.timetable);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Banner */}
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              Daily Class Schedule & Timetable
            </h1>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            View allocated periods, designated classrooms, lesson topics, and quick action registers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/teacher/attendance"
            className="px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
            <span>Roll Call Register</span>
          </Link>
          <Link
            href="/teacher/gradebook"
            className="px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">edit_note</span>
            <span>Rapid Gradebook</span>
          </Link>
        </div>
      </div>

      {/* Timetable Cards */}
      <div className="space-y-3">
        {loading && (
          <div className="flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading schedule...</p>
          </div>
        )}

        {!loading && timetable.length === 0 && (
          <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant">calendar_clock</span>
            <p className="font-semibold text-sm text-on-surface">No timetable configured</p>
            <p className="text-xs text-on-surface-variant">
              No periods or classroom allocations have been assigned to your faculty schedule yet.
            </p>
          </div>
        )}

        {!loading && timetable.map((t, idx) => {
          const periodDisplay = t.periodName || t.period || `P${idx + 1}`;
          const subjectDisplay = t.subjectName || t.subject || "Subject";
          const classDisplay = t.className || t.class || "Class";
          const roomDisplay = t.roomNo || t.room || "-";
          const timeDisplay = t.startTime && t.endTime ? `${t.startTime} - ${t.endTime}` : (t.time || "Scheduled");

          return (
            <div
              key={t.id || idx}
              className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center font-bold shrink-0 bg-surface-container text-secondary">
                  <span className="text-xs font-mono">{periodDisplay.replace(/[^0-9]/g, "") || String(idx + 1)}</span>
                  <span className="text-[9px] uppercase font-semibold">Period</span>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-on-surface">{subjectDisplay}</h3>
                    <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-primary">
                      {classDisplay}
                    </span>
                    <span className="text-[11px] text-on-surface-variant font-mono">({roomDisplay})</span>
                  </div>
                  {t.topic && (
                    <p className="text-xs text-on-surface-variant mt-0.5 font-medium">
                      Topic: <span className="text-on-surface font-semibold">{t.topic}</span>
                    </p>
                  )}
                  <span className="text-[10px] text-on-surface-variant font-mono block sm:inline mt-1 sm:mt-0">
                    {timeDisplay}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Link
                  href="/teacher/attendance"
                  className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-xs flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                  <span>Roll Call</span>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
