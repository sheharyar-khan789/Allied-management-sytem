"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import YearlyFeeLedgerImportModal from "@/components/YearlyFeeLedgerImportModal";

interface ClassOption {
  id: string;
  name: string;
  section: string;
}

interface LedgerEntry {
  id: string;
  admissionNo: string;
  studentId: string;
  studentName?: string;
  classId: string;
  className?: string;
  monthlyFee: number;
  annualFee: number;
  yearlyExpectedFee: number;
  updatedAt: string;
}

interface Batch {
  id: string;
  academicYear: string;
  fileName?: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  createdAt: string;
}

const thisYear = new Date().getFullYear();
const YEAR_OPTIONS = [thisYear - 1, thisYear, thisYear + 1].map((y) => `${y}-${y + 1}`);

const EMPTY_EDIT = { admissionNo: "", studentName: "", monthlyFee: "", annualFee: "" };

export default function YearlyFeeLedgerManager({ classes }: { classes: ClassOption[] }) {
  const [academicYear, setAcademicYear] = useState(YEAR_OPTIONS[1]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [editRow, setEditRow] = useState<LedgerEntry | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/fees/yearly-ledger-import?academicYear=${encodeURIComponent(academicYear)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load the yearly fee ledger.");
      setEntries(json.entries || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load the yearly fee ledger.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear]);

  const loadHistory = async () => {
    setHistoryOpen(true);
    try {
      const res = await fetch(`/api/fees/yearly-ledger-import?academicYear=${encodeURIComponent(academicYear)}&history=true`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setBatches(json.success ? json.batches || [] : []);
    } catch {
      setBatches([]);
    }
  };

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (classFilter !== "all" && e.classId !== classFilter) return false;
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return e.admissionNo.toLowerCase().includes(q) || (e.studentName || "").toLowerCase().includes(q);
      }),
    [entries, classFilter, search]
  );

  const openEdit = (e: LedgerEntry) => {
    setEditRow(e);
    setEditForm({ admissionNo: e.admissionNo, studentName: e.studentName || "", monthlyFee: String(e.monthlyFee), annualFee: String(e.annualFee) });
    setSaveError("");
  };

  const saveEdit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/fees/yearly-ledger-import?action=commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academicYear, allowUpdates: true, rows: [{ rowNumber: 2, input: editForm }] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save.");
      const outcome = json.results?.[0];
      if (outcome?.status === "FAILED" || outcome?.status === "SKIPPED") throw new Error(outcome.reason || "Failed to save.");
      setEditRow(null);
      await load();
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full h-9 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 text-xs";
  const selectClass = "h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40";

  return (
    <div className="flex flex-col gap-4">
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="yfl-year" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Academic Year</label>
          <select id="yfl-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={selectClass}>
            {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="yfl-class" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Class</label>
          <select id="yfl-class" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={selectClass}>
            <option value="all">All classes</option>
            {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}-{c.section}</option>))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label htmlFor="yfl-search" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Search (Admission No / Name)</label>
          <input id="yfl-search" type="text" value={search} onChange={(e) => setSearch(e.target.value)} className={`${selectClass} w-full`} placeholder="ADM-0001 or student name" />
        </div>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={loadHistory} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold">
            <span className="material-symbols-outlined text-[16px]">history</span>
            Import History
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90">
            <span className="material-symbols-outlined text-[16px]">upload_file</span>
            Import Ledger
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        <div className="p-4 border-b border-surface-container-low flex items-center justify-between">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">Yearly Fee Ledger — {academicYear} (Expected Fee Only)</h3>
          <span className="text-xs text-on-surface-variant">{filtered.length} of {entries.length} students</span>
        </div>
        {loading ? (
          <p className="p-10 text-center text-xs text-on-surface-variant">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-center text-xs text-on-surface-variant">
            No ledger entries for {academicYear}{search || classFilter !== "all" ? " matching this filter" : ""}. Use &quot;Import Ledger&quot; to upload one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Class</th>
                  <th className="py-2.5 px-4">Monthly Fee</th>
                  <th className="py-2.5 px-4">Annual Fee</th>
                  <th className="py-2.5 px-4">Yearly Expected Fee</th>
                  <th className="py-2.5 px-4">Last Updated</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2.5 px-4 font-semibold text-on-surface">
                      {e.studentName}
                      <div className="text-[10px] text-on-surface-variant font-normal font-mono">{e.admissionNo}</div>
                    </td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{e.className}</td>
                    <td className="py-2.5 px-4 font-semibold">{formatCurrency(e.monthlyFee)}</td>
                    <td className="py-2.5 px-4">{formatCurrency(e.annualFee)}</td>
                    <td className="py-2.5 px-4 font-bold text-on-tertiary-container">{formatCurrency(e.yearlyExpectedFee)}</td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{formatDate(e.updatedAt)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button type="button" onClick={() => openEdit(e)} className="text-secondary font-semibold" aria-label={`Edit ${e.studentName}`}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importOpen && (
        <YearlyFeeLedgerImportModal academicYear={academicYear} onClose={() => setImportOpen(false)} onImported={load} />
      )}

      {editRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Edit Fee — {editRow.studentName}</h3>
              <button type="button" onClick={() => setEditRow(null)} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {saveError && <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs">{saveError}</div>}
            <form onSubmit={saveEdit} className="space-y-3 text-xs">
              <p className="text-on-surface-variant font-mono">{editRow.admissionNo} • {academicYear}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="yfl-edit-monthly" className="block font-semibold text-on-surface mb-1">Monthly Fee *</label>
                  <input id="yfl-edit-monthly" type="number" required min={0} step="any" value={editForm.monthlyFee} onChange={(e) => setEditForm({ ...editForm, monthlyFee: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="yfl-edit-annual" className="block font-semibold text-on-surface mb-1">Annual Fee</label>
                  <input id="yfl-edit-annual" type="number" min={0} step="any" value={editForm.annualFee} onChange={(e) => setEditForm({ ...editForm, annualFee: e.target.value })} className={inputClass} />
                </div>
              </div>
              <p className="text-on-surface-variant">
                This updates only {academicYear}&apos;s ledger entry. It never marks anything Paid, creates a payment, or generates a voucher.
              </p>
              <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button type="button" onClick={() => setEditRow(null)} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Import History — {academicYear}</h3>
              <button type="button" onClick={() => setHistoryOpen(false)} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {batches.length === 0 ? (
              <p className="text-xs text-on-surface-variant p-4 text-center">No imports recorded for this academic year yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] font-bold">
                      <th className="py-2 px-3">When</th>
                      <th className="py-2 px-3">File</th>
                      <th className="py-2 px-3">Created</th>
                      <th className="py-2 px-3">Updated</th>
                      <th className="py-2 px-3">Unchanged</th>
                      <th className="py-2 px-3">Skipped</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2 px-3">{formatDate(b.createdAt)}</td>
                        <td className="py-2 px-3">{b.fileName || "—"}</td>
                        <td className="py-2 px-3 font-semibold text-on-tertiary-container">{b.created}</td>
                        <td className="py-2 px-3 font-semibold text-amber-800">{b.updated}</td>
                        <td className="py-2 px-3">{b.unchanged}</td>
                        <td className="py-2 px-3">{b.skipped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
