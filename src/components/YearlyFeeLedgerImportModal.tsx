"use client";

import React, { useMemo, useState } from "react";
import { YEARLY_LEDGER_IMPORT_TEMPLATE_HEADERS } from "@/lib/yearly-fee-ledger-import";

type RowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";
type RowAction = "NEW" | "UPDATE" | "UNCHANGED" | null;

interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  action: RowAction;
  errors: string[];
  warnings: string[];
  input: Record<string, string>;
  entry: {
    studentName: string;
    admissionNo: string;
    className: string;
    monthlyFee: number;
    annualFee: number;
    yearlyExpectedFee: number;
  } | null;
}

interface PreviewResponse {
  fileName: string;
  academicYear: string;
  ignoredColumns: string[];
  summary: {
    total: number; valid: number; warnings: number; invalid: number; duplicates: number;
    newCount: number; updateCount: number; unchangedCount: number;
    totalMonthlyExpected: number; totalYearlyExpected: number;
  };
  rows: PreviewRow[];
}

interface CommitResult {
  rowNumber: number;
  status: "CREATED" | "UPDATED" | "UNCHANGED" | "SKIPPED" | "FAILED";
  reason?: string;
  admissionNo?: string;
  studentName?: string;
}

const STATUS_STYLES: Record<RowStatus, string> = {
  VALID: "bg-tertiary-container/10 text-on-tertiary-container",
  WARNING: "bg-amber-100 text-amber-800",
  INVALID: "bg-error-container text-on-error-container",
  DUPLICATE: "bg-surface-container-high text-on-surface",
};
const ACTION_STYLES: Record<string, string> = {
  NEW: "bg-tertiary-container/10 text-on-tertiary-container",
  UPDATE: "bg-amber-100 text-amber-800",
  UNCHANGED: "bg-surface-container-high text-on-surface-variant",
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

export default function YearlyFeeLedgerImportModal({
  academicYear,
  onClose,
  onImported,
}: {
  academicYear: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<RowStatus | "ALL">("ALL");
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [result, setResult] = useState<{ summary: { created: number; updated: number; unchanged: number; skipped: number; failed: number }; results: CommitResult[] } | null>(null);

  const importable = (r: PreviewRow) => r.status === "VALID" || r.status === "WARNING";

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/fees/yearly-ledger-import?action=preview&academicYear=${encodeURIComponent(academicYear)}`, { method: "POST", body: fd });
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
      const res = await fetch("/api/fees/yearly-ledger-import?action=commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academicYear,
          allowUpdates,
          fileName: preview.fileName,
          rows: rows.map((r) => ({ rowNumber: r.rowNumber, input: r.input })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Import failed.");
      const notSent = preview.rows.length - rows.length;
      setResult({ summary: { ...json.summary, skipped: json.summary.skipped + notSent }, results: json.results });
      setStep("done");
      if (json.summary.created > 0 || json.summary.updated > 0) onImported();
    } catch (e: any) {
      setError(e.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const visibleRows = useMemo(() => (preview ? preview.rows.filter((r) => filter === "ALL" || r.status === filter) : []), [preview, filter]);
  const selectedCount = preview ? preview.rows.filter((r) => selected.has(r.rowNumber) && importable(r)).length : 0;
  const selectedUpdateCount = preview ? preview.rows.filter((r) => selected.has(r.rowNumber) && importable(r) && r.action === "UPDATE").length : 0;

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
      <div role="dialog" aria-modal="true" aria-labelledby="import-ledger-heading" className="bg-surface-container-lowest rounded-xl max-w-4xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 id="import-ledger-heading" className="font-headline-md text-sm font-bold text-on-surface">
            Import Yearly Fee Ledger — {academicYear}
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
              Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file with each student&apos;s monthly and annual fee for{" "}
              <strong>{academicYear}</strong>. Required columns: Admission No, Monthly Fee. Students are matched by Admission No
              only. This records what the student OWES — it never marks anything Paid, creates a payment, or generates a
              voucher. Re-uploading the same file is always safe (unchanged rows are reported, never duplicated); a row that
              would actually change an existing entry is skipped unless you tick &quot;Allow updates&quot; below.
            </p>
            <button
              type="button"
              onClick={() => downloadCsv("yearly-fee-ledger-template.csv", [YEARLY_LEDGER_IMPORT_TEMPLATE_HEADERS, ["ADM-0001", "Ali Khan", "5000", "6000"]])}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download CSV template
            </button>
            <div>
              <label htmlFor="ledger-import-file" className="block font-semibold text-on-surface mb-1">Yearly fee ledger file</label>
              <input
                id="ledger-import-file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setError(""); }}
                className="block w-full text-xs text-on-surface"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Cancel</button>
              <button type="button" onClick={handlePreview} disabled={!file || busy} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
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
                const count = f === "ALL" ? preview.summary.total : f === "VALID" ? preview.summary.valid : f === "WARNING" ? preview.summary.warnings : f === "DUPLICATE" ? preview.summary.duplicates : preview.summary.invalid;
                return (
                  <button key={f} type="button" onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full font-bold ${filter === f ? "ring-2 ring-secondary" : ""} ${f === "ALL" ? "bg-surface-container text-on-surface" : STATUS_STYLES[f]}`}>
                    {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()} {count}
                  </button>
                );
              })}
              <span className="ml-auto flex items-center gap-2 text-on-surface-variant">
                <span className="px-2 py-1 rounded-full bg-tertiary-container/10 text-on-tertiary-container font-bold">New {preview.summary.newCount}</span>
                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-bold">Update {preview.summary.updateCount}</span>
                <span className="px-2 py-1 rounded-full bg-surface-container-high font-bold">Unchanged {preview.summary.unchangedCount}</span>
              </span>
            </div>
            <p className="text-on-surface-variant">
              Total monthly expected: <strong className="text-on-surface">{preview.summary.totalMonthlyExpected.toLocaleString()}</strong> •
              Total yearly expected: <strong className="text-on-surface">{preview.summary.totalYearlyExpected.toLocaleString()}</strong>
            </p>
            {selectedUpdateCount > 0 && (
              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 text-amber-900 font-semibold cursor-pointer">
                <input type="checkbox" checked={allowUpdates} onChange={(e) => setAllowUpdates(e.target.checked)} className="w-4 h-4" />
                Allow updates — {selectedUpdateCount} selected row{selectedUpdateCount === 1 ? "" : "s"} will overwrite an existing ledger entry. Unchecked, those rows are skipped.
              </label>
            )}
            <div className="overflow-x-auto border border-surface-container-high/40 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] tracking-wider">
                    <th className="py-2 px-3">Import</th>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Monthly</th>
                    <th className="py-2 px-3">Annual</th>
                    <th className="py-2 px-3">Yearly Expected</th>
                    <th className="py-2 px-3">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {visibleRows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="py-2 px-3">
                        <input type="checkbox" aria-label={`Import row ${r.rowNumber}`} disabled={!importable(r)} checked={importable(r) && selected.has(r.rowNumber)} onChange={() => toggle(r.rowNumber)} />
                      </td>
                      <td className="py-2 px-3 font-mono">{r.rowNumber}</td>
                      <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded font-bold ${STATUS_STYLES[r.status]}`}>{r.status}</span></td>
                      <td className="py-2 px-3">{r.action && <span className={`px-2 py-0.5 rounded font-bold ${ACTION_STYLES[r.action]}`}>{r.action}</span>}</td>
                      <td className="py-2 px-3 font-semibold text-on-surface">
                        {r.entry?.studentName || r.input.studentName || r.input.admissionNo || "—"}
                        <div className="text-[10px] text-on-surface-variant font-normal">{r.entry?.admissionNo || r.input.admissionNo || ""}</div>
                      </td>
                      <td className="py-2 px-3">{r.entry ? r.entry.monthlyFee.toLocaleString() : "—"}</td>
                      <td className="py-2 px-3">{r.entry ? r.entry.annualFee.toLocaleString() : "—"}</td>
                      <td className="py-2 px-3">{r.entry ? r.entry.yearlyExpectedFee.toLocaleString() : "—"}</td>
                      <td className="py-2 px-3">
                        {r.errors.map((e, i) => (<div key={`e${i}`} className="text-error">{e}</div>))}
                        {r.warnings.map((w, i) => (<div key={`w${i}`} className="text-amber-800">{w}</div>))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-on-surface-variant">{selectedCount} of {preview.summary.total} rows selected. Invalid and duplicate rows are never imported.</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setStep("upload"); setPreview(null); }} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Choose another file</button>
                <button type="button" onClick={handleCommit} disabled={busy || selectedCount === 0} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
                  {busy ? "Importing..." : `Import ${selectedCount} Record${selectedCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 rounded-lg bg-tertiary-container/10 text-on-tertiary-container font-bold">Created: {result.summary.created}</span>
              <span className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 font-bold">Updated: {result.summary.updated}</span>
              <span className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-bold">Unchanged: {result.summary.unchanged}</span>
              <span className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-bold">Skipped: {result.summary.skipped}</span>
              <span className="px-3 py-1.5 rounded-lg bg-error-container text-on-error-container font-bold">Failed: {result.summary.failed}</span>
            </div>
            {result.results.some((r) => r.status !== "CREATED" || r.reason) && (
              <div className="border border-surface-container-high/40 rounded-lg p-3 space-y-1 max-h-60 overflow-y-auto">
                {result.results.filter((r) => r.status !== "CREATED" || r.reason).map((r) => (
                  <div key={r.rowNumber}>
                    <span className="font-mono font-bold">Row {r.rowNumber}</span> — {r.status}: {r.reason || `${r.studentName} (${r.admissionNo})`}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
