"use client";

import React, { useMemo, useState } from "react";
import { EXAM_CATEGORIES, EXAM_CATEGORY_LABELS } from "@/lib/exam-results";
import { EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS } from "@/lib/exam-schedule-import";

type RowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";

interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  input: Record<string, string>;
  schedule: {
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    examDate: string;
    startTime: string;
    endTime: string;
    totalMarks: number;
    passingMarks: number;
  } | null;
}

interface PreviewResponse {
  fileName: string;
  ignoredColumns: string[];
  summary: { total: number; valid: number; warnings: number; invalid: number; duplicates: number };
  rows: PreviewRow[];
}

const STATUS_STYLES: Record<RowStatus, string> = {
  VALID: "bg-tertiary-container/10 text-on-tertiary-container",
  WARNING: "bg-amber-100 text-amber-800",
  INVALID: "bg-error-container text-on-error-container",
  DUPLICATE: "bg-surface-container-high text-on-surface",
};

function csvEscape(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(name: string, lines: string[][]) {
  const blob = new Blob([lines.map((l) => l.map(csvEscape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls =
  "w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20";
const labelCls = "block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1";

export default function ExamScheduleImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (examId: string) => void;
}) {
  const [step, setStep] = useState<"details" | "upload" | "preview" | "done">("details");
  const [details, setDetails] = useState({ title: "", term: "", category: "", startDate: "", endDate: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<RowStatus | "ALL">("ALL");
  const [result, setResult] = useState<{ schedulesCreated: number; examId: string; examName: string } | null>(null);

  const importable = (r: PreviewRow) => r.status === "VALID" || r.status === "WARNING";

  const handleDetailsNext = () => {
    if (!details.title.trim() || !details.startDate || !details.endDate) {
      setError("Title, start date, and end date are required.");
      return;
    }
    if (details.endDate < details.startDate) {
      setError("End date cannot be before start date.");
      return;
    }
    setError("");
    setStep("upload");
  };

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("examStartDate", details.startDate);
      fd.append("examEndDate", details.endDate);
      const res = await fetch("/api/exams/schedule-import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not read the file.");
      setPreview(json);
      setSelected(new Set((json.rows as PreviewRow[]).filter(importable).map((r) => r.rowNumber)));
      setStep("preview");
    } catch (e: any) {
      setError(e.message || "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const rows = preview.rows.filter((r) => selected.has(r.rowNumber) && importable(r) && r.schedule);
    if (rows.length === 0) {
      setError("Select at least one valid row to import.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: details.title.trim(),
          term: details.term.trim() || undefined,
          category: details.category || undefined,
          startDate: details.startDate,
          endDate: details.endDate,
          schedules: rows.map((r) => ({
            classId: r.schedule!.classId,
            subjectId: r.schedule!.subjectId,
            examDate: r.schedule!.examDate,
            startTime: r.schedule!.startTime,
            endTime: r.schedule!.endTime,
            totalMarks: r.schedule!.totalMarks,
            passingMarks: r.schedule!.passingMarks,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Import failed.");
      setResult({ schedulesCreated: json.schedulesCreated ?? rows.length, examId: json.exam.id, examName: json.exam.name });
      setStep("done");
      onImported(json.exam.id);
    } catch (e: any) {
      setError(e.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const visibleRows = useMemo(
    () => (preview ? preview.rows.filter((r) => filter === "ALL" || r.status === filter) : []),
    [preview, filter]
  );
  const selectedCount = preview ? preview.rows.filter((r) => selected.has(r.rowNumber) && importable(r)).length : 0;

  const toggle = (rowNumber: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-exam-heading"
        className="bg-surface-container-lowest rounded-xl max-w-5xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
      >
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 id="import-exam-heading" className="font-headline-md text-sm font-bold text-on-surface">
            Bulk Import Exam Schedule
          </h3>
          <button type="button" onClick={onClose} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{error}</span>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-4 text-xs">
            <p className="text-on-surface-variant">
              Step 1 of 3 — the exam itself. Every schedule row in the file you upload next belongs to this one exam.
            </p>
            <div>
              <label className={labelCls} htmlFor="bi-title">Exam Title *</label>
              <input id="bi-title" className={inputCls} value={details.title} onChange={(e) => setDetails((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. First Term Examination 2026" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="bi-term">Term</label>
                <input id="bi-term" className={inputCls} value={details.term} onChange={(e) => setDetails((d) => ({ ...d, term: e.target.value }))} placeholder="e.g. First Term" />
              </div>
              <div>
                <label className={labelCls} htmlFor="bi-category">Category</label>
                <select id="bi-category" className={inputCls} value={details.category} onChange={(e) => setDetails((d) => ({ ...d, category: e.target.value }))}>
                  <option value="">—</option>
                  {EXAM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{EXAM_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="bi-start">Starting Date *</label>
                <input id="bi-start" type="date" className={inputCls} value={details.startDate} onChange={(e) => setDetails((d) => ({ ...d, startDate: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls} htmlFor="bi-end">Ending Date *</label>
                <input id="bi-end" type="date" className={inputCls} value={details.endDate} onChange={(e) => setDetails((d) => ({ ...d, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Cancel</button>
              <button type="button" onClick={handleDetailsNext} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90">Next: Upload Schedule</button>
            </div>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4 text-xs">
            <p className="text-on-surface-variant">
              Step 2 of 3 — upload a <strong>.csv</strong> or <strong>.xlsx</strong> file (max 2 MB, up to 1000 rows) with one row
              per class/subject. The first row must contain column headers. Required columns: Class, Subject Name, Exam Date,
              Total Marks, Passing Marks. Starting Time defaults to 09:00 and Ending Time to 11:00 when left blank — type a
              value (e.g. 11:30) to override either. Classes and subjects are matched by name; an unmatched or ambiguous name
              is reported, never guessed. Nothing is created until you confirm the preview.
            </p>
            <button
              type="button"
              onClick={() =>
                downloadCsv("exam-schedule-import-template.csv", [
                  EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS,
                  ["9-A", "Mathematics", "2026-12-01", "09:00", "11:00", "100", "33"],
                  ["9-A", "English", "2026-12-02", "", "", "100", "33"],
                ])
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download CSV template
            </button>
            <div>
              <label htmlFor="exam-import-file" className="block font-semibold text-on-surface mb-1">Schedule file</label>
              <input
                id="exam-import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setError("");
                }}
                className="block w-full text-xs text-on-surface"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStep("details")} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Back</button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={!file || busy}
                className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
              >
                {busy ? "Reading file..." : "Preview Import"}
              </button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-3 text-xs">
            <p className="text-on-surface-variant">Step 3 of 3 — review and confirm.</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-on-surface">{preview.fileName}</span>
              {(["ALL", "VALID", "WARNING", "DUPLICATE", "INVALID"] as const).map((f) => {
                const count =
                  f === "ALL" ? preview.summary.total
                  : f === "VALID" ? preview.summary.valid
                  : f === "WARNING" ? preview.summary.warnings
                  : f === "DUPLICATE" ? preview.summary.duplicates
                  : preview.summary.invalid;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-2.5 py-1 rounded-full font-bold ${filter === f ? "ring-2 ring-secondary" : ""} ${f === "ALL" ? "bg-surface-container text-on-surface" : STATUS_STYLES[f]}`}
                  >
                    {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()} {count}
                  </button>
                );
              })}
            </div>
            {preview.ignoredColumns.length > 0 && (
              <p className="text-on-surface-variant">Columns not imported (no matching field): {preview.ignoredColumns.join(", ")}</p>
            )}
            <div className="overflow-x-auto border border-surface-container-high/40 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] tracking-wider">
                    <th className="py-2 px-3">Import</th>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Class</th>
                    <th className="py-2 px-3">Subject</th>
                    <th className="py-2 px-3">Date / Time</th>
                    <th className="py-2 px-3">Marks</th>
                    <th className="py-2 px-3">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {visibleRows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          aria-label={`Import row ${r.rowNumber}`}
                          disabled={!importable(r)}
                          checked={importable(r) && selected.has(r.rowNumber)}
                          onChange={() => toggle(r.rowNumber)}
                        />
                      </td>
                      <td className="py-2 px-3 font-mono">{r.rowNumber}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded font-bold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-on-surface">{r.schedule?.className || r.input.className || "—"}</td>
                      <td className="py-2 px-3">{r.schedule?.subjectName || r.input.subjectName || "—"}</td>
                      <td className="py-2 px-3">
                        {r.schedule ? `${r.schedule.examDate} ${r.schedule.startTime}-${r.schedule.endTime}` : r.input.examDate || "—"}
                      </td>
                      <td className="py-2 px-3">{r.schedule ? `${r.schedule.passingMarks}/${r.schedule.totalMarks}` : "—"}</td>
                      <td className="py-2 px-3">
                        {r.errors.map((e, i) => (
                          <div key={`e${i}`} className="text-error">{e}</div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={`w${i}`} className="text-amber-800">{w}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-on-surface-variant">
                {selectedCount} of {preview.summary.total} rows selected. Invalid and duplicate rows are never imported.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setStep("upload"); setPreview(null); }}
                  className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold"
                >
                  Choose another file
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={busy || selectedCount === 0}
                  className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {busy ? "Creating..." : `Create Exam with ${selectedCount} Schedule${selectedCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container font-bold">
              Exam &quot;{result.examName}&quot; created with {result.schedulesCreated} subject schedule{result.schedulesCreated === 1 ? "" : "s"}.
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
