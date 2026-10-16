"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/utils";
import { computeSubjectResult, validateObtainedMarks, type GradingScale } from "@/lib/exam-results";

/**
 * Marks entry for one exam schedule (one subject of one class), shared by the admin and teacher
 * gradebooks. A blank cell means "no mark recorded" — it is never saved as 0. Marks are checked
 * against the schedule's maximum before saving, the preview grades with the school's own scale
 * (the same function the server uses), and after a save the grid is reloaded from the database so
 * what is shown is what was stored.
 */

interface Row {
  studentId: string;
  name: string;
  rollNumber: string;
  admissionNumber: string;
  recorded: boolean;
  savedMarks: number | null;
  savedRemarks: string;
  input: string;
  remarks: string;
  cardUrl?: string;
}

const toRows = (schedule: any): Row[] =>
  (schedule?.results || []).map((r: any) => ({
    studentId: r.studentId,
    name: r.student?.fullName || `${r.student?.firstName || ""} ${r.student?.lastName || ""}`.trim(),
    rollNumber: r.student?.rollNumber || "",
    admissionNumber: r.student?.admissionNumber || "",
    recorded: Boolean(r.recorded),
    savedMarks: typeof r.marksObtained === "number" ? r.marksObtained : null,
    savedRemarks: r.remarks || "",
    input: typeof r.marksObtained === "number" ? String(r.marksObtained) : "",
    remarks: r.remarks || "",
    cardUrl: r.cardUrl,
  }));

export default function MarksEntryGrid({
  examTitle,
  schedule,
  gradingScale,
  onSaved,
}: {
  examTitle: string;
  schedule: any;
  gradingScale: GradingScale;
  /** Reload this schedule's roster and marks from the server. */
  onSaved: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(schedule));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(toRows(schedule));
  }, [schedule]);

  const maxMarks: number = schedule?.maxMarks || 0;
  const passingMarks: number = schedule?.passingMarks ?? 0;

  const parsed = useMemo(
    () =>
      rows.map((r) => {
        const value = r.input.trim() === "" ? null : Number(r.input);
        const problem = value === null ? null : validateObtainedMarks(value, maxMarks);
        const preview = value !== null && !problem ? computeSubjectResult(value, maxMarks, passingMarks, gradingScale) : null;
        const marksChanged = value !== r.savedMarks;
        const remarksChanged = value !== null && r.remarks.trim() !== r.savedRemarks.trim();
        return { row: r, value, problem, preview, dirty: marksChanged || remarksChanged };
      }),
    [rows, maxMarks, passingMarks, gradingScale]
  );

  const invalidCount = parsed.filter((p) => p.problem).length;
  const dirty = parsed.filter((p) => p.dirty);
  const clearing = dirty.filter((p) => p.value === null && p.row.recorded).length;
  const recordedCount = rows.filter((r) => r.recorded).length;

  const update = (studentId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)));
    setMessage("");
    setError("");
  };

  const handleSave = async () => {
    if (invalidCount > 0 || dirty.length === 0) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/exams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examScheduleId: schedule.id,
          studentMarks: dirty.map((p) => ({
            studentId: p.row.studentId,
            marksObtained: p.value,
            ...(p.value !== null ? { remarks: p.row.remarks.trim() } : {}),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || "Marks could not be saved. Nothing was changed.");
        return;
      }
      await onSaved();
      setMessage(json.message || "Marks saved.");
    } catch {
      setError("Marks could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!schedule) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
      <div className="p-4 border-b border-surface-container-high/40 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="space-y-0.5">
          <p className="font-bold text-on-surface text-sm">
            {examTitle} — {schedule.subject?.name} — {schedule.class?.name}
            {schedule.class?.section ? `-${schedule.class.section}` : ""}
          </p>
          <p className="text-on-surface-variant">
            Max marks <strong>{maxMarks}</strong> • Passing <strong>{passingMarks}</strong>
            {schedule.examDate ? ` • ${formatDate(schedule.examDate)}` : ""} • {recordedCount}/{rows.length} recorded
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || invalidCount > 0 || dirty.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 shadow-sm disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">save</span>
          <span>
            {saving
              ? "Saving..."
              : dirty.length === 0
              ? "No changes"
              : `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}${clearing ? ` (${clearing} cleared)` : ""}`}
          </span>
        </button>
      </div>

      {message && (
        <div className="m-4 p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold">
          {message}
        </div>
      )}
      {error && (
        <div className="m-4 p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>
      )}
      {invalidCount > 0 && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">
          {invalidCount} mark{invalidCount === 1 ? " is" : "s are"} invalid — fix the highlighted cells (0 to {maxMarks}) before saving.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-12 text-center text-xs text-on-surface-variant">No active students are enrolled in this class.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                <th className="py-3 px-4 font-bold">Roll #</th>
                <th className="py-3 px-4 font-bold">Student</th>
                <th className="py-3 px-4 font-bold">Admission #</th>
                <th className="py-3 px-4 font-bold">Marks (/{maxMarks})</th>
                <th className="py-3 px-4 font-bold">%</th>
                <th className="py-3 px-4 font-bold">Grade</th>
                <th className="py-3 px-4 font-bold">GPA</th>
                <th className="py-3 px-4 font-bold">Result</th>
                <th className="py-3 px-4 font-bold">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {parsed.map(({ row, problem, preview, dirty: isDirty }) => (
                <tr key={row.studentId} className={isDirty ? "bg-secondary/5" : "hover:bg-surface-container-low/40"}>
                  <td className="py-2 px-4 font-mono font-bold text-on-surface">{row.rollNumber}</td>
                  <td className="py-2 px-4 font-bold text-on-surface">
                    {row.name}
                    {row.cardUrl ? (
                      <a href={row.cardUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary text-[10px] hover:underline">
                        Card
                      </a>
                    ) : null}
                  </td>
                  <td className="py-2 px-4 font-mono text-on-surface-variant">{row.admissionNumber}</td>
                  <td className="py-2 px-4">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={maxMarks}
                      step="any"
                      value={row.input}
                      placeholder="Not recorded"
                      aria-label={`Marks for ${row.name}`}
                      aria-invalid={Boolean(problem)}
                      onChange={(e) => update(row.studentId, { input: e.target.value })}
                      className={`w-28 h-8 px-2.5 rounded bg-surface-container-low font-bold text-on-surface border focus:outline-none focus:ring-2 focus:ring-secondary/20 ${
                        problem ? "border-error" : "border-outline-variant/40"
                      }`}
                    />
                    {problem ? <p className="text-[10px] text-error mt-0.5">{problem}</p> : null}
                  </td>
                  <td className="py-2 px-4 font-semibold">{preview ? `${preview.percentage}%` : "—"}</td>
                  <td className="py-2 px-4 font-bold">{preview?.grade || "—"}</td>
                  <td className="py-2 px-4 font-bold text-secondary">{preview ? preview.gpa.toFixed(1) : "—"}</td>
                  <td className="py-2 px-4 font-semibold">{preview ? (preview.status === "PASS" ? "Pass" : "Fail") : "—"}</td>
                  <td className="py-2 px-4">
                    <input
                      type="text"
                      maxLength={500}
                      value={row.remarks}
                      disabled={row.input.trim() === ""}
                      aria-label={`Remarks for ${row.name}`}
                      onChange={(e) => update(row.studentId, { remarks: e.target.value })}
                      className="w-44 h-8 px-2.5 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 disabled:opacity-40"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
