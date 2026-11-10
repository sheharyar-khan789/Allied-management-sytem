"use client";

import React, { useEffect, useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

type AllocationLine = { challanId: string; challanLabel: string; amountApplied: number };
type ClassifiedRow = {
  rowNumber: number;
  admissionNo: string;
  studentName?: string;
  className?: string;
  amount?: number;
  paymentDate?: string;
  action: "ALLOCATED" | "DUPLICATE_IN_FILE" | "DUPLICATE_EXISTS" | "ERROR";
  errorReason?: string;
  nameMismatch?: boolean;
  allocation?: { lines: AllocationLine[]; advanceAmount: number };
};

type PreviewResult = {
  academicYear: string;
  fileName: string;
  summary: { totalRows: number; allocatedCount: number; duplicateCount: number; errorCount: number; totalAmount: number };
  rows: ClassifiedRow[];
};

const ACTION_STYLES: Record<string, string> = {
  ALLOCATED: "bg-tertiary-container/10 text-on-tertiary-container",
  DUPLICATE_IN_FILE: "bg-amber-100 text-amber-800",
  DUPLICATE_EXISTS: "bg-amber-100 text-amber-800",
  ERROR: "bg-error-container text-on-error-container",
};

function allocationSummary(row: ClassifiedRow): string {
  if (!row.allocation) return "";
  const parts = row.allocation.lines.map((l) => `${l.challanLabel}: ${formatCurrency(l.amountApplied)}`);
  if (row.allocation.advanceAmount > 0) parts.push(`Advance: ${formatCurrency(row.allocation.advanceAmount)}`);
  return parts.join(" + ") || "No outstanding dues";
}

export default function DailyTransactionsTab({
  academicYear,
  onAcademicYearChange,
}: {
  academicYear: string;
  onAcademicYearChange: (year: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importDone, setImportDone] = useState<{ allocated: number; amount: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const downloadTemplate = () => window.open("/api/fees/transactions/template", "_blank");

  const resetResults = () => {
    setPreview(null);
    setImportError("");
    setImportDone(null);
  };

  const handlePreview = async () => {
    if (!file || !academicYear) return;
    setPreviewing(true);
    resetResults();
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("academicYear", academicYear);
      const res = await fetch("/api/fees/transactions/import/preview", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setImportError(json.error || "Failed to preview file.");
        return;
      }
      setPreview(json);
    } catch {
      setImportError("Failed to preview file.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    if (!file || !academicYear || !preview) return;
    setCommitting(true);
    setImportError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("academicYear", academicYear);
      const res = await fetch("/api/fees/transactions/import/commit", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setImportError(json.error || "Failed to commit import.");
        return;
      }
      setImportDone({ allocated: json.summary.allocatedCount, amount: json.summary.totalAmount });
      setPreview(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setImportError("Failed to commit import.");
    } finally {
      setCommitting(false);
    }
  };

  const loadHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/fees/transactions/import/history?academicYear=${encodeURIComponent(academicYear)}`);
      const json = await res.json();
      if (json.success) setHistory(json.batches || []);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-xl font-bold text-on-surface">Daily Fee Transactions</h2>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Import payments received. Each payment is applied to the oldest outstanding voucher first; any leftover becomes an advance credit automatically used on the student&apos;s next voucher.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => { onAcademicYearChange(e.target.value); resetResults(); }}
            placeholder="2024-2025"
            className="h-9 w-32 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40"
          />
        </div>
      </div>

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">Import Transactions</h3>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-[11px] font-semibold transition-all">
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download Template
            </button>
            <button onClick={loadHistory} className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-semibold text-[11px]">
              Import History
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => { setFile(e.target.files?.[0] || null); resetResults(); }}
            className="flex-1 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-secondary file:text-on-secondary file:text-[11px] file:font-semibold"
          />
          <button
            onClick={handlePreview}
            disabled={!file || !academicYear || previewing}
            className="px-4 py-1.5 rounded-lg bg-surface-container text-on-surface font-semibold text-xs disabled:opacity-50"
          >
            {previewing ? "Previewing..." : "Preview Import"}
          </button>
        </div>

        {importError && <p className="text-xs text-error font-semibold">{importError}</p>}
        {importDone && (
          <p className="text-xs text-on-tertiary-container font-semibold">
            Import committed: {importDone.allocated} payments allocated, totalling {formatCurrency(importDone.amount)}.
          </p>
        )}

        {preview && (
          <div className="space-y-3 pt-2 border-t border-surface-container-low">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="p-2 rounded-lg bg-surface-container">
                <div className="text-lg font-bold text-on-surface">{preview.summary.totalRows}</div>
                <div className="text-[10px] text-on-surface-variant">Total Rows</div>
              </div>
              <div className="p-2 rounded-lg bg-tertiary-container/10">
                <div className="text-lg font-bold text-on-tertiary-container">{formatCurrency(preview.summary.totalAmount)}</div>
                <div className="text-[10px] text-on-tertiary-container">Will Allocate</div>
              </div>
              <div className="p-2 rounded-lg bg-amber-100">
                <div className="text-lg font-bold text-amber-800">{preview.summary.duplicateCount}</div>
                <div className="text-[10px] text-amber-800">Duplicates</div>
              </div>
              <div className="p-2 rounded-lg bg-error-container">
                <div className="text-lg font-bold text-on-error-container">{preview.summary.errorCount}</div>
                <div className="text-[10px] text-on-error-container">Errors</div>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto border border-surface-container-high/40 rounded-lg">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-surface-container-low sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Admission #</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Amount</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 px-3">Allocation / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="py-1.5 px-3">{r.rowNumber}</td>
                      <td className="py-1.5 px-3 font-mono">{r.admissionNo}</td>
                      <td className="py-1.5 px-3">{r.studentName || "—"}</td>
                      <td className="py-1.5 px-3">{r.paymentDate ? formatDate(r.paymentDate) : "—"}</td>
                      <td className="py-1.5 px-3">{r.amount !== undefined ? formatCurrency(r.amount) : "—"}</td>
                      <td className="py-1.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ACTION_STYLES[r.action]}`}>{r.action}</span>
                      </td>
                      <td className="py-1.5 px-3 text-on-surface-variant">
                        {r.action === "ALLOCATED" ? allocationSummary(r) : r.errorReason || (r.nameMismatch ? "Name differs from student record" : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={resetResults} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={committing || preview.summary.allocatedCount === 0}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
              >
                {committing ? "Importing..." : `Confirm & Import ${preview.summary.allocatedCount} Payments`}
              </button>
            </div>
          </div>
        )}
      </div>

      {historyOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-5 shadow-2xl border border-surface-container-high space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Import History — {academicYear}</h3>
              <button onClick={() => setHistoryOpen(false)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {historyLoading ? (
              <p className="text-xs text-on-surface-variant">Loading...</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-on-surface-variant">No imports recorded yet for this academic year.</p>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-on-surface-variant border-b border-surface-container-high/40">
                    <th className="py-2">Date</th>
                    <th className="py-2">File</th>
                    <th className="py-2">Allocated</th>
                    <th className="py-2">Skipped / Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {history.map((b: any) => (
                    <tr key={b.id}>
                      <td className="py-2">{formatDate(b.createdAt)}</td>
                      <td className="py-2 font-mono">{b.fileName}</td>
                      <td className="py-2 text-on-tertiary-container font-semibold">{b.createdCount}</td>
                      <td className="py-2 text-error font-semibold">{b.errorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
