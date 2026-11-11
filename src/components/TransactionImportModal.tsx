"use client";

import React, { useState } from "react";
import {
  TRANSACTION_IMPORT_HEADERS,
  TransactionImportSummary,
  TransactionRowStatus,
} from "@/lib/transaction-import";

const STATUS_BADGES: Record<TransactionRowStatus, string> = {
  VALID: "bg-emerald-100 text-emerald-800 border-emerald-300",
  WARNING: "bg-amber-100 text-amber-800 border-amber-300",
  INVALID: "bg-rose-100 text-rose-800 border-rose-300",
  AMBIGUOUS: "bg-orange-100 text-orange-800 border-orange-300",
  DUPLICATE: "bg-slate-100 text-slate-700 border-slate-300",
} as any;

export default function TransactionImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<TransactionImportSummary | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [commitResult, setCommitResult] = useState<{
    batchId: string;
    successCount: number;
    failCount: number;
    totalCount: number;
  } | null>(null);

  const handlePreview = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/fees/transaction-import?action=preview", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to preview file.");
      setSummary(data.summary);
      setStep("preview");
    } catch (err: any) {
      setError(err.message || "Failed to preview spreadsheet.");
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!summary) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/fees/transaction-import?action=commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file?.name || "import.xlsx",
          results: summary.results,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to commit transactions.");
      setCommitResult(data);
      setStep("done");
      onImported();
    } catch (err: any) {
      setError(err.message || "Failed to save transactions.");
    } finally {
      setBusy(false);
    }
  };

  const filteredResults = summary?.results.filter((r) => {
    if (filter === "ALL") return true;
    return r.status === filter;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-surface rounded-2xl border border-outline-variant shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-outline-variant flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-on-surface">Fee & Expense Import</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Day &amp; Date | Category | Details | Class | Amount, plus an optional 6th
              column, Admission No — when given, it is the authoritative student match and
              the Details/Class columns are never used to look the student up by name.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-4 rounded-xl bg-error-container text-on-error-container text-sm flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <p>{error}</p>
            </div>
          )}

          {step === "upload" && (
            <div className="space-y-6">
              <div className="p-5 rounded-xl bg-surface-container border border-outline-variant/60 flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-on-surface text-sm">Download Excel / CSV Template</h4>
                  <p className="text-xs text-on-surface-variant mt-1">
                    6 columns with valid sample rows (Fees, Annual Amount, Other Expenses). The
                    original 5-column file (no Admission No) still imports exactly as before.
                  </p>
                </div>
                <a
                  href="/api/fees/transaction-import/template"
                  download="transaction-import-template.csv"
                  className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-xs flex items-center gap-2 hover:bg-primary/90"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Download Template
                </a>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-on-surface">
                  Choose Spreadsheet File (.xlsx or .csv)
                </label>
                <div className="border-2 border-dashed border-outline-variant rounded-xl p-8 text-center bg-surface-container/30">
                  <span className="material-symbols-outlined text-[40px] text-on-surface-variant">
                    cloud_upload
                  </span>
                  <p className="text-sm font-semibold text-on-surface mt-2">
                    {file ? file.name : "Select your Excel or CSV file"}
                  </p>
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="mt-4 block mx-auto text-xs text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-on-primary hover:file:bg-primary/90"
                  />
                </div>
              </div>
            </div>
          )}

          {step === "preview" && summary && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-surface-container border border-outline-variant">
                  <span className="text-[11px] font-semibold text-on-surface-variant uppercase">Total Rows</span>
                  <p className="text-lg font-bold text-on-surface mt-1">{summary.totalRows}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <span className="text-[11px] font-semibold text-emerald-700 uppercase">Valid Rows</span>
                  <p className="text-lg font-bold text-emerald-700 mt-1">{summary.validRows}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <span className="text-[11px] font-semibold text-amber-700 uppercase">Ambiguous / Dupes</span>
                  <p className="text-lg font-bold text-amber-700 mt-1">
                    {summary.ambiguousRows + summary.duplicateRows}
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <span className="text-[11px] font-semibold text-rose-700 uppercase">Invalid Rows</span>
                  <p className="text-lg font-bold text-rose-700 mt-1">{summary.invalidRows}</p>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="p-4 rounded-xl bg-surface-container-high/50 border border-outline-variant flex flex-wrap items-center justify-between gap-4 text-xs font-semibold">
                <div>
                  <span className="text-on-surface-variant">Fees Total:</span>{" "}
                  <span className="text-primary font-bold">Rs. {summary.feesTotal.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-on-surface-variant">Annual Total:</span>{" "}
                  <span className="text-tertiary font-bold">Rs. {summary.annualAmountTotal.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-on-surface-variant">Other Expenses (Outgoing):</span>{" "}
                  <span className="text-rose-600 font-bold">Rs. {summary.otherExpensesTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 border-b border-outline-variant pb-2">
                {["ALL", "VALID", "INVALID", "AMBIGUOUS", "DUPLICATE"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilter(status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      filter === status
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container hover:bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="max-h-64 overflow-y-auto border border-outline-variant rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-surface-container sticky top-0 border-b border-outline-variant">
                    <tr>
                      <th className="p-2.5 font-bold">#</th>
                      <th className="p-2.5 font-bold">Status</th>
                      <th className="p-2.5 font-bold">Date</th>
                      <th className="p-2.5 font-bold">Category</th>
                      <th className="p-2.5 font-bold">Details</th>
                      <th className="p-2.5 font-bold">Class</th>
                      <th className="p-2.5 font-bold text-right">Amount</th>
                      <th className="p-2.5 font-bold">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {filteredResults?.map((res, i) => (
                      <tr key={i} className="hover:bg-surface-container/40">
                        <td className="p-2.5 text-on-surface-variant">{res.row.rowNumber}</td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                              (STATUS_BADGES as any)[res.status] || "bg-slate-100 text-slate-800"
                            }`}
                          >
                            {res.status}
                          </span>
                        </td>
                        <td className="p-2.5">{res.row.date || res.row.rawDate}</td>
                        <td className="p-2.5">{res.row.category || res.row.rawCategory}</td>
                        <td className="p-2.5 font-medium">{res.row.details}</td>
                        <td className="p-2.5">{res.row.className}</td>
                        <td className="p-2.5 text-right font-mono font-semibold">
                          Rs. {res.row.amount ? res.row.amount.toLocaleString() : res.row.rawAmount}
                        </td>
                        <td className="p-2.5 text-[11px] text-on-surface-variant">
                          {res.errors.length > 0 ? (
                            <span className="text-rose-600">{res.errors.join("; ")}</span>
                          ) : (
                            <span className="text-emerald-700">
                              {res.resolvedStudentName ? `Matched: ${res.resolvedStudentName}` : "Ready"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "done" && commitResult && (
            <div className="p-8 text-center space-y-4">
              <span className="material-symbols-outlined text-[54px] text-emerald-600">
                check_circle
              </span>
              <h3 className="text-xl font-bold text-on-surface">Transactions Imported Successfully</h3>
              <p className="text-sm text-on-surface-variant max-w-md mx-auto">
                Created {commitResult.successCount} transactions and associated fee vouchers.
                {commitResult.failCount > 0 && ` (${commitResult.failCount} failed)`}
              </p>
              <div className="pt-4">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-xs hover:bg-primary/90"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-outline-variant flex items-center justify-between bg-surface-container/20">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancel
          </button>

          {step === "upload" && (
            <button
              disabled={!file || busy}
              onClick={handlePreview}
              className="px-6 py-2 rounded-xl bg-primary text-on-primary font-semibold text-xs hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {busy ? "Parsing..." : "Preview Import"}
            </button>
          )}

          {step === "preview" && (
            <div className="flex gap-2">
              <button
                onClick={() => setStep("upload")}
                className="px-4 py-2 rounded-xl bg-surface-container text-on-surface font-semibold text-xs hover:bg-surface-container-high"
              >
                Back
              </button>
              <button
                disabled={busy || !summary || summary.validRows === 0}
                onClick={handleCommit}
                className="px-6 py-2 rounded-xl bg-primary text-on-primary font-semibold text-xs hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
              >
                {busy ? "Saving..." : `Confirm & Import (${summary?.validRows || 0} Rows)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
