"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface AllocatedClass {
  id: string;
  displayName: string;
  roomNumber?: string;
  isIncharge?: boolean;
  studentCount?: number;
  subjects: { id: string; name: string; code: string }[];
}

export default function TeacherDashboardPage() {
  const [classes, setClasses] = useState<AllocatedClass[]>([]);
  const [timetable, setTimetable] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const today = WEEKDAYS[new Date().getDay()];

  useEffect(() => {
    // Both lists are scoped server-side to this teacher's own allocation.
    const load = async () => {
      try {
        const [clsRes, ttRes] = await Promise.all([
          fetch("/api/classes"),
          fetch(`/api/timetable?dayOfWeek=${encodeURIComponent(today)}`),
        ]);
        const [clsJson, ttJson] = await Promise.all([
          clsRes.json().catch(() => ({})),
          ttRes.json().catch(() => ({})),
        ]);
        if (!clsRes.ok || !clsJson.success) {
          throw new Error(clsJson.error || "Failed to load your allocated subjects.");
        }
        setClasses(Array.isArray(clsJson.classes) ? clsJson.classes : []);
        if (ttRes.ok && ttJson.success && Array.isArray(ttJson.timetable)) {
          setTimetable(ttJson.timetable);
        } else if (!ttRes.ok) {
          throw new Error(ttJson.error || "Failed to load today's timetable.");
        }
      } catch (err: any) {
        setError(err?.message || "Failed to load your teaching allocation.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [today]);

  const subjectCount = classes.reduce((n, c) => n + c.subjects.length, 0);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Banner */}
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              My Subjects & Today&apos;s Schedule
            </h1>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Subjects and classes allocated to you by the school administration, and your periods for {today}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/teacher/timetable"
            className="px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            <span>Full Timetable</span>
          </Link>
          <Link
            href="/teacher/attendance"
            className="px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
            <span>Roll Call Register</span>
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading your allocation...</p>
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Allocated Subjects */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-sm font-bold text-on-surface">Allocated Subjects</h2>
              <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-secondary">
                {subjectCount} {subjectCount === 1 ? "Subject" : "Subjects"}
              </span>
            </div>

            {classes.length === 0 ? (
              <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant">menu_book</span>
                <p className="font-semibold text-sm text-on-surface">No subjects allocated yet</p>
                <p className="text-xs text-on-surface-variant">
                  The administration has not assigned any subjects or classes to you. Please contact the school admin.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {classes.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-primary">
                          {c.displayName}
                        </span>
                        {c.isIncharge && (
                          <span className="px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px] font-bold">
                            Class Incharge
                          </span>
                        )}
                      </div>
                      {typeof c.studentCount === "number" && (
                        <span className="text-[11px] text-on-surface-variant">{c.studentCount} students</span>
                      )}
                    </div>
                    {c.subjects.length > 0 ? (
                      <ul className="space-y-1.5">
                        {c.subjects.map((s) => (
                          <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-1.5 font-semibold text-on-surface">
                              <span className="material-symbols-outlined text-[16px] text-secondary">menu_book</span>
                              {s.name}
                            </span>
                            <span className="font-mono text-[11px] text-on-surface-variant">{s.code}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-on-surface-variant">
                        {c.isIncharge ? "Daily register only — no subject allocated in this class." : "Class access only — no subject allocated in this class."}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Today's Periods */}
          <section className="space-y-3">
            <h2 className="font-headline-md text-sm font-bold text-on-surface">Today&apos;s Periods ({today})</h2>

            {timetable.length === 0 && (
              <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant">calendar_clock</span>
                <p className="font-semibold text-sm text-on-surface">No periods scheduled today</p>
                <p className="text-xs text-on-surface-variant">
                  No timetable periods have been assigned to you for {today}.
                </p>
              </div>
            )}

            {timetable.map((t, idx) => {
              const periodDisplay = t.periodName || `P${idx + 1}`;
              const timeDisplay = t.startTime && t.endTime ? `${t.startTime} - ${t.endTime}` : "Scheduled";

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm text-on-surface">{t.subjectName || "Subject"}</h3>
                        <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-primary">
                          {t.className || "Class"}
                        </span>
                        {t.roomNo && t.roomNo !== "-" && (
                          <span className="text-[11px] text-on-surface-variant font-mono">({t.roomNo})</span>
                        )}
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
                      href={`/teacher/attendance?classId=${encodeURIComponent(t.classId)}${t.subjectId ? `&subjectId=${encodeURIComponent(t.subjectId)}` : ""}`}
                      className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-xs flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                      <span>Roll Call</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
