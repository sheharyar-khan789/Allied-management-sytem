"use client";

import React, { useMemo, useState } from "react";
import { IMPORT_TEMPLATE_HEADERS } from "@/lib/student-import";

type RowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";

interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  input: Record<string, string>;
  student: { fullName: string; fatherName: string; className: string; dob: string | null; admissionDate: string | null } | null;
}

interface PreviewResponse {
  fileName: string;
  ignoredColumns: string[];
  summary: { total: number; valid: number; warnings: number; invalid: number; duplicates: number };
  rows: PreviewRow[];
}

interface CommitResult {
  rowNumber: number;
  status: "IMPORTED" | "SKIPPED" | "FAILED";
  reason?: string;
  admissionNo?: string;
  fullName?: string;
  className?: string;
  loginEmail?: string;
  initialPassword?: string;
}

const STATUS_STYLES: Record<RowStatus, string> = {
  VALID: "bg-tertiary-container/10 text-on-tertiary-container",
  WARNING: "bg-amber-100 text-amber-800",
  INVALID: "bg-error-container text-on-error-container",
  DUPLICATE: "bg-surface-container-high text-on-surface",
};

function csvEscape(raw: string): string {
  // Spreadsheet formula injection: a cell starting with = + - @ (or tab/CR) is evaluated as a
  // formula by Excel/Sheets. Prefix an apostrophe so it is always shown as plain text.
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

export default function StudentImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<RowStatus | "ALL">("ALL");
  const [result, setResult] = useState<{ summary: { imported: number; skipped: number; failed: number }; results: CommitResult[]; note?: string } | null>(null);

  const importable = (r: PreviewRow) => r.status === "VALID" || r.status === "WARNING";

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/students/import", { method: "POST", body: fd });
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
    const rows = preview.rows.filter((r) => selected.has(r.rowNumber) && importable(r));
    if (rows.length === 0) {
      setError("Select at least one valid row to import.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: preview.fileName, rows: rows.map((r) => ({ rowNumber: r.rowNumber, input: r.input })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Import failed.");
      const notSent = preview.rows.length - rows.length;
      setResult({
        summary: { ...json.summary, skipped: json.summary.skipped + notSent },
        results: json.results,
        note: json.initialPasswordNote,
      });
      setStep("done");
      if (json.summary.imported > 0) onImported();
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
        aria-labelledby="import-students-heading"
        className="bg-surface-container-lowest rounded-xl max-w-5xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
      >
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 id="import-students-heading" className="font-headline-md text-sm font-bold text-on-surface">
            Import Students
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

        {step === "upload" && (
          <div className="space-y-4 text-xs">
            <p className="text-on-surface-variant">
              Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file (max 2 MB, up to 500 students). The first row must contain
              column headers. Required columns: Student Name, Father Name, Gender, Class, Guardian Phone. Classes and sections
              must already exist in the active session. Dates can be YYYY-MM-DD or DD/MM/YYYY. Nothing is saved until you
              confirm the preview. PDF files are not supported — export the list from Excel or Google Sheets instead.
            </p>
            <button
              type="button"
              onClick={() =>
                downloadCsv("student-import-template.csv", [
                  IMPORT_TEMPLATE_HEADERS,
                  ["Ali Khan", "Imran Khan", "Male", "2012-04-15", "2026-04-01", "Class 5", "A", "1", "", "03001234567", "03001234567", "", "", "House 1, Street 2", "B+", "", "3000"],
                ])
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download CSV template
            </button>
            <div>
              <label htmlFor="import-file" className="block font-semibold text-on-surface mb-1">Student list file</label>
              <input
                id="import-file"
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
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">
                Cancel
              </button>
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
              <p className="text-on-surface-variant">
                Columns not imported (no matching student field): {preview.ignoredColumns.join(", ")}
              </p>
            )}
            <div className="overflow-x-auto border border-surface-container-high/40 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] tracking-wider">
                    <th className="py-2 px-3">Import</th>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Class</th>
                    <th className="py-2 px-3">DOB</th>
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
                      <td className="py-2 px-3 font-semibold text-on-surface">
                        {r.student?.fullName || r.input.fullName || [r.input.firstName, r.input.lastName].filter(Boolean).join(" ") || "—"}
                        <div className="text-[10px] text-on-surface-variant font-normal">{r.student?.fatherName || r.input.fatherName || ""}</div>
                      </td>
                      <td className="py-2 px-3">{r.student?.className || [r.input.className, r.input.section].filter(Boolean).join(" ") || "—"}</td>
                      <td className="py-2 px-3">{r.student?.dob || r.input.dob || "—"}</td>
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
                  onClick={() => {
                    setStep("upload");
                    setPreview(null);
                  }}
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
                  {busy ? "Importing..." : `Import ${selectedCount} Student${selectedCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 rounded-lg bg-tertiary-container/10 text-on-tertiary-container font-bold">Imported: {result.summary.imported}</span>
              <span className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-bold">Skipped: {result.summary.skipped}</span>
              <span className="px-3 py-1.5 rounded-lg bg-error-container text-on-error-container font-bold">Failed: {result.summary.failed}</span>
            </div>
            {result.note && <p className="text-on-surface-variant">{result.note}</p>}
            {result.results.some((r) => r.status !== "IMPORTED") && (
              <div className="border border-surface-container-high/40 rounded-lg p-3 space-y-1">
                {result.results
                  .filter((r) => r.status !== "IMPORTED")
                  .map((r) => (
                    <div key={r.rowNumber}>
                      <span className="font-mono font-bold">Row {r.rowNumber}</span> — {r.status}: {r.reason}
                    </div>
                  ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              {result.summary.imported > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv("imported-students.csv", [
                      ["Row", "Admission No", "Student Name", "Class", "Login Email", "Initial Password"],
                      ...result.results
                        .filter((r) => r.status === "IMPORTED")
                        .map((r) => [String(r.rowNumber), r.admissionNo || "", r.fullName || "", r.className || "", r.loginEmail || "", r.initialPassword || ""]),
                    ])
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Download login list
                </button>
              )}
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
