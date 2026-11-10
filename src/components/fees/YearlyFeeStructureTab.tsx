"use client";

import React, { useEffect, useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import InlineAlert from "@/components/fees/InlineAlert";
import Pagination, { PAGE_SIZE } from "@/components/fees/Pagination";

type ClassifiedRow = {
  rowNumber: number;
  admissionNo: string;
  studentId?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  section?: string;
  action: "CREATED" | "UPDATED" | "UNCHANGED" | "ERROR";
  errorReason?: string;
  nameMismatch?: boolean;
  structure?: {
    monthlyTuitionFee: number;
    annualFee: number;
    admissionFee: number;
    otherCharges: number;
    discount: number;
    notes?: string;
  };
  previousValues?: Record<string, number>;
};

type PreviewResult = {
  academicYear: string;
  fileName: string;
  summary: { totalRows: number; createdCount: number; updatedCount: number; unchangedCount: number; errorCount: number };
  rows: ClassifiedRow[];
};

const ACTION_STYLES: Record<string, string> = {
  CREATED: "bg-tertiary-container/10 text-on-tertiary-container",
  UPDATED: "bg-amber-100 text-amber-800",
  UNCHANGED: "bg-surface-container text-on-surface-variant",
  ERROR: "bg-error-container text-on-error-container",
};

export default function YearlyFeeStructureTab({
  academicYear,
  onAcademicYearChange,
}: {
  academicYear: string;
  onAcademicYearChange: (year: string) => void;
}) {
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("all");
  const [search, setSearch] = useState("");
  const [structures, setStructures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importDone, setImportDone] = useState<{ created: number; updated: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((d) => setClasses(d?.classes || d || []))
      .catch(() => {});
  }, []);

  const fetchStructures = async () => {
    if (!academicYear) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ academicYear });
      if (classId !== "all") params.append("classId", classId);
      if (search) params.append("search", search);
      const res = await fetch(`/api/fees/yearly-structure?${params.toString()}`);
      const json = await res.json();
      if (json.success) setStructures(json.structures || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStructures();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear, classId, search]);

  const downloadTemplate = () => {
    window.open("/api/fees/yearly-structure/template", "_blank");
  };

  const handlePreview = async () => {
    if (!file || !academicYear) return;
    setPreviewing(true);
    setImportError("");
    setImportDone(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("academicYear", academicYear);
      const res = await fetch("/api/fees/yearly-structure/import/preview", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setImportError(json.error || "Failed to preview file.");
        setPreview(null);
        return;
      }
      setPreview(json);
    } catch (err) {
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
      const res = await fetch("/api/fees/yearly-structure/import/commit", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setImportError(json.error || "Failed to commit import.");
        return;
      }
      setImportDone({ created: json.summary.createdCount, updated: json.summary.updatedCount });
      setPreview(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchStructures();
    } catch (err) {
      setImportError("Failed to commit import.");
    } finally {
      setCommitting(false);
    }
  };

  const loadHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/fees/yearly-structure/import/history?academicYear=${encodeURIComponent(academicYear)}`);
      const json = await res.json();
      if (json.success) setHistory(json.batches || []);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openEdit = (structure: any) => {
    setEditing(structure);
    setEditError("");
    setEditForm({
      monthlyTuitionFee: structure.monthlyTuitionFee,
      annualFee: structure.annualFee,
      admissionFee: structure.admissionFee,
      otherCharges: structure.otherCharges,
      discount: structure.discount,
      notes: structure.notes || "",
      reason: "",
      effectiveDate: new Date().toISOString().split("T")[0],
    });
  };

  const saveEdit = async () => {
    if (!editing || !editForm || !editForm.reason?.trim()) return;
    setSaving(true);
    setEditError("");
    try {
      const res = await fetch("/api/fees/yearly-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: editing.studentId,
          academicYear,
          ...editForm,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setEditing(null);
        fetchStructures();
      } else {
        setEditError(json.error || "Failed to save changes.");
      }
    } catch (err) {
      setEditError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const pagedStructures = structures.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-xl font-bold text-on-surface">Yearly Fee Structure</h2>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Upload the complete yearly fee structure once per academic year; monthly vouchers are generated from it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => onAcademicYearChange(e.target.value)}
            placeholder="2024-2025"
            className="h-9 w-32 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40"
          />
        </div>
      </div>

      {/* Import panel */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">Import Fee Structure</h3>
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-[11px] font-semibold transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download Template
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
              setImportError("");
              setImportDone(null);
            }}
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
            Import committed: {importDone.created} created, {importDone.updated} updated.
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
                <div className="text-lg font-bold text-on-tertiary-container">{preview.summary.createdCount}</div>
                <div className="text-[10px] text-on-tertiary-container">New</div>
              </div>
              <div className="p-2 rounded-lg bg-amber-100">
                <div className="text-lg font-bold text-amber-800">{preview.summary.updatedCount}</div>
                <div className="text-[10px] text-amber-800">Updated</div>
              </div>
              <div className="p-2 rounded-lg bg-error-container">
                <div className="text-lg font-bold text-on-error-container">{preview.summary.errorCount}</div>
                <div className="text-[10px] text-on-error-container">Errors</div>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border border-surface-container-high/40 rounded-lg">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-surface-container-low sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Admission #</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Monthly Fee</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="py-1.5 px-3">{r.rowNumber}</td>
                      <td className="py-1.5 px-3 font-mono">{r.admissionNo}</td>
                      <td className="py-1.5 px-3">{r.studentName || "—"}</td>
                      <td className="py-1.5 px-3">
                        {r.structure ? formatCurrency(r.structure.monthlyTuitionFee) : "—"}
                        {r.action === "UPDATED" && r.previousValues && (
                          <span className="text-on-surface-variant ml-1">
                            (was {formatCurrency(r.previousValues.monthlyTuitionFee)})
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ACTION_STYLES[r.action]}`}>
                          {r.action}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-on-surface-variant">
                        {r.errorReason || (r.nameMismatch ? "Name differs from student record" : "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPreview(null)}
                className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={committing || (preview.summary.createdCount === 0 && preview.summary.updatedCount === 0)}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
              >
                {committing
                  ? "Importing..."
                  : `Confirm & Import ${preview.summary.createdCount + preview.summary.updatedCount} Records`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing structures */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by admission # or name..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container-low text-xs text-on-surface border border-transparent focus:border-outline-variant/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40"
          >
            <option value="all">All Classes</option>
            {classes.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.displayName || `${c.name}-${c.section}`}
              </option>
            ))}
          </select>
          <button
            onClick={loadHistory}
            className="h-9 px-3 rounded-lg bg-surface-container text-on-surface font-semibold text-xs"
          >
            Import History
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading fee structure...</p>
          </div>
        ) : structures.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">table_rows</span>
            <p className="text-sm font-semibold text-on-surface">
              No yearly fee structure records for {academicYear || "this academic year"} yet
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Admission #</th>
                  <th className="py-3 px-4 font-bold">Student</th>
                  <th className="py-3 px-4 font-bold">Class</th>
                  <th className="py-3 px-4 font-bold">Monthly Tuition</th>
                  <th className="py-3 px-4 font-bold">Annual Fee</th>
                  <th className="py-3 px-4 font-bold">Admission Fee</th>
                  <th className="py-3 px-4 font-bold">Other</th>
                  <th className="py-3 px-4 font-bold">Discount</th>
                  <th className="py-3 px-4 font-bold">Source</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {pagedStructures.map((s: any) => (
                  <tr key={s.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-on-surface">{s.admissionNo}</td>
                    <td className="py-3 px-4 font-bold text-on-surface">{s.studentName}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-container font-semibold text-on-surface">
                        {s.className}{s.section ? `-${s.section}` : ""}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold">{formatCurrency(s.monthlyTuitionFee)}</td>
                    <td className="py-3 px-4">{formatCurrency(s.annualFee)}</td>
                    <td className="py-3 px-4">{formatCurrency(s.admissionFee)}</td>
                    <td className="py-3 px-4">{formatCurrency(s.otherCharges)}</td>
                    <td className="py-3 px-4">{formatCurrency(s.discount)}</td>
                    <td className="py-3 px-4 text-[10px] text-on-surface-variant">{s.source}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => openEdit(s)}
                        className="text-secondary font-semibold text-[11px]"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalItems={structures.length} onPageChange={setPage} />
      </div>

      {/* Import history modal */}
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
                    <th className="py-2">New</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Unchanged</th>
                    <th className="py-2">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {history.map((b: any) => (
                    <tr key={b.id}>
                      <td className="py-2">{formatDate(b.createdAt)}</td>
                      <td className="py-2 font-mono">{b.fileName}</td>
                      <td className="py-2 text-on-tertiary-container font-semibold">{b.createdCount}</td>
                      <td className="py-2 text-amber-700 font-semibold">{b.updatedCount}</td>
                      <td className="py-2">{b.unchangedCount}</td>
                      <td className="py-2 text-error font-semibold">{b.errorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">
                Edit Fee Structure — {editing.studentName}
              </h3>
              <button onClick={() => setEditing(null)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { key: "monthlyTuitionFee", label: "Monthly Tuition Fee" },
                { key: "annualFee", label: "Annual Fee" },
                { key: "admissionFee", label: "Admission Fee" },
                { key: "otherCharges", label: "Other Charges" },
                { key: "discount", label: "Discount / Concession" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="block font-semibold text-on-surface mb-1">{f.label}</label>
                  <input
                    type="number"
                    value={editForm[f.key]}
                    onChange={(e) => setEditForm({ ...editForm, [f.key]: Number(e.target.value) })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block font-semibold text-on-surface mb-1">Notes</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
              <div>
                <label className="block font-semibold text-on-surface mb-1">Effective Date *</label>
                <input
                  type="date"
                  value={editForm.effectiveDate}
                  onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-on-surface mb-1">Reason for change *</label>
                <input
                  type="text"
                  value={editForm.reason}
                  onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  placeholder="e.g. Sibling discount approved by principal"
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
            </div>
            <InlineAlert type="error" message={editError} />
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button onClick={() => { setEditing(null); setEditError(""); }} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving || !editForm.reason?.trim()}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
