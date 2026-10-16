"use client";

import React, { useEffect, useMemo, useState } from "react";

interface Option { id: string; name: string; classId?: string; teacherId?: string | null }
interface SummaryRow {
  classId: string; className: string; subjectId: string; subjectName: string;
  teacherId: string; teacherName: string; planId: string | null; status: string; submittedAt: string | null;
}
interface DayEntry { date: string; dayOfWeek: string; content: string; isNonTeachingDay?: boolean }
interface PlanDetail {
  id: string; classId: string; className?: string; subjectId: string; subjectName?: string;
  teacherId: string; teacherName?: string; weekId: string; days: DayEntry[]; submitted: boolean;
  submittedAt: string | null; submissionDeadline: string; status: string; hasAdminCorrections: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-secondary/10 text-secondary",
  SUBMITTED: "bg-primary/10 text-primary",
  LOCKED: "bg-surface-container-high text-on-surface-variant",
  LATE: "bg-error-container text-error",
  MISSING: "bg-error-container text-error",
};

function fmt(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminLessonPlansPage() {
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [weeks, setWeeks] = useState<{ weekId: string }[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");

  const [weekId, setWeekId] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");

  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState("");

  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch("/api/lesson-plans/options")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          setOptionsError(json.error || "Failed to load filters.");
          return;
        }
        setTimezone(json.timezone);
        setWeeks(json.weeks || []);
        setClasses(json.classes || []);
        setSubjects(json.subjects || []);
        setTeachers(json.teachers || []);
        setWeekId(json.defaultWeekId);
      })
      .catch(() => setOptionsError("Failed to load filters."))
      .finally(() => setOptionsLoading(false));
  }, []);

  const filteredSubjects = useMemo(
    () => (classId ? subjects.filter((s) => s.classId === classId) : subjects),
    [subjects, classId]
  );

  useEffect(() => {
    if (!weekId) return;
    setLoadingRows(true);
    setRowsError("");
    const params = new URLSearchParams({ weekId });
    if (classId) params.set("classId", classId);
    if (subjectId) params.set("subjectId", subjectId);
    if (teacherId) params.set("teacherId", teacherId);
    fetch(`/api/lesson-plans/summary?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          setRowsError(json.error || "Failed to load submissions for this week.");
          return;
        }
        setRows(json.rows || []);
        setCounts(json.counts || {});
      })
      .catch(() => setRowsError("Failed to load submissions for this week."))
      .finally(() => setLoadingRows(false));
  }, [weekId, classId, subjectId, teacherId]);

  const openDetail = (planId: string | null) => {
    if (!planId) return;
    setDetailLoading(true);
    setDetail(null);
    fetch(`/api/lesson-plans/${planId}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setDetail(json.plan);
      })
      .finally(() => setDetailLoading(false));
  };

  if (optionsLoading) return <div className="p-6 text-sm text-on-surface-variant">Loading…</div>;
  if (optionsError) return <div className="p-6 text-sm text-error">{optionsError}</div>;

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">ASD Lesson Plans — Review</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Weekly submission status for every class/subject that has a teacher allocated. School timezone: {timezone}.
        </p>
      </div>

      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-on-surface mb-1">Week</label>
            <select value={weekId} onChange={(e) => setWeekId(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono">
              {weeks.map((w) => (
                <option key={w.weekId} value={w.weekId}>Week of {w.weekId}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-on-surface mb-1">Class</label>
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId(""); }} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40">
              <option value="">All classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-on-surface mb-1">Subject</label>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40">
              <option value="">All subjects</option>
              {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-on-surface mb-1">Teacher</label>
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40">
              <option value="">All teachers</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-surface-container-low pt-3">
          {Object.entries(counts).map(([status, n]) => (
            <span key={status} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${STATUS_STYLE[status] || "bg-surface-container-high"}`}>
              {status}: {n}
            </span>
          ))}
        </div>
      </div>

      {rowsError && <div className="p-3 rounded-lg bg-error-container text-error text-xs font-semibold">{rowsError}</div>}

      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
        {loadingRows ? (
          <p className="text-xs text-on-surface-variant">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No subjects with an allocated teacher match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-on-surface-variant border-b border-surface-container-low">
                  <th className="py-2 pr-3">Class</th>
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Teacher</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.classId}:${r.subjectId}`} className="border-b border-surface-container-low/60">
                    <td className="py-2 pr-3">{r.className}</td>
                    <td className="py-2 pr-3">{r.subjectName}</td>
                    <td className="py-2 pr-3">{r.teacherName}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[r.status] || ""}`}>{r.status}</span>
                    </td>
                    <td className="py-2 pr-3">{fmt(r.submittedAt, timezone)}</td>
                    <td className="py-2">
                      {r.planId ? (
                        <button type="button" className="text-primary font-semibold" onClick={() => openDetail(r.planId)}>View</button>
                      ) : (
                        <span className="text-on-surface-variant">Not started</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(detailLoading || detail) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-surface-container-lowest rounded-xl shadow-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            {detailLoading || !detail ? (
              <p className="text-xs text-on-surface-variant">Loading…</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-headline-md text-sm font-bold text-on-surface">
                      {detail.className} — {detail.subjectName}
                    </h2>
                    <p className="text-[11px] text-on-surface-variant">
                      Week of {detail.weekId} • {detail.teacherName} •{" "}
                      <span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[detail.status] || ""}`}>{detail.status}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/print/lesson-plan/${detail.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-semibold text-primary"
                    >
                      Print / Export
                    </a>
                    <button type="button" onClick={() => setDetail(null)} className="text-on-surface-variant" aria-label="Close">✕</button>
                  </div>
                </div>
                {detail.hasAdminCorrections && (
                  <p className="text-[11px] font-semibold text-secondary mb-2">This plan has admin corrections on record (original content preserved in the audit log).</p>
                )}
                <div className="space-y-2">
                  {detail.days.map((d) => (
                    <div key={d.date} className="border border-surface-container-high/40 rounded-lg p-2.5">
                      <p className="font-label-sm text-[11px] font-bold text-on-surface mb-1">{d.dayOfWeek} — {d.date}</p>
                      <p className="text-xs text-on-surface-variant whitespace-pre-wrap">
                        {d.isNonTeachingDay ? "No class / holiday" : d.content || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
