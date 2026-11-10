"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Row = {
  studentId: string;
  admissionNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  action: "CREATED" | "SKIPPED_EXISTS" | "ERROR";
  errorReason?: string;
  challanId?: string;
  totalExpected?: number;
};

const ACTION_STYLES: Record<string, string> = {
  CREATED: "bg-tertiary-container/10 text-on-tertiary-container",
  SKIPPED_EXISTS: "bg-surface-container text-on-surface-variant",
  ERROR: "bg-error-container text-on-error-container",
};

export default function VoucherGenerationTab({
  academicYear,
  onAcademicYearChange,
}: {
  academicYear: string;
  onAcademicYearChange: (year: string) => void;
}) {
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [scope, setScope] = useState<"SCHOOL" | "CLASS" | "STUDENT">("SCHOOL");
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentMatches, setStudentMatches] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ summary: any; rows: Row[] } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ batchId: string; summary: any } | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((d) => setClasses(d?.classes || d || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scope !== "STUDENT" || studentSearch.trim().length < 2) {
      setStudentMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/students?search=${encodeURIComponent(studentSearch)}&limit=8`)
        .then((r) => r.json())
        .then((d) => setStudentMatches(d?.students || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [studentSearch, scope]);

  const resetResults = () => {
    setPreview(null);
    setPreviewError("");
    setCommitResult(null);
  };

  const buildBody = () => ({
    academicYear,
    month,
    year,
    scope,
    classId: scope === "CLASS" ? classId : undefined,
    studentId: scope === "STUDENT" ? selectedStudent?.id : undefined,
  });

  const canSubmit =
    !!academicYear &&
    !!month &&
    !!year &&
    (scope === "SCHOOL" || (scope === "CLASS" && !!classId) || (scope === "STUDENT" && !!selectedStudent));

  const handlePreview = async () => {
    if (!canSubmit) return;
    setPreviewing(true);
    resetResults();
    try {
      const res = await fetch("/api/fees/vouchers/generate/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setPreviewError(json.error || "Failed to preview voucher generation.");
        return;
      }
      setPreview({ summary: json.summary, rows: json.rows });
    } catch {
      setPreviewError("Failed to preview voucher generation.");
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    setPreviewError("");
    try {
      const res = await fetch("/api/fees/vouchers/generate/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setPreviewError(json.error || "Failed to generate vouchers.");
        return;
      }
      setCommitResult({ batchId: json.batchId, summary: json.summary });
      setPreview(null);
    } catch {
      setPreviewError("Failed to generate vouchers.");
    } finally {
      setCommitting(false);
    }
  };

  const loadHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/fees/vouchers/generate/history?academicYear=${encodeURIComponent(academicYear)}`);
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
          <h2 className="font-headline-lg text-xl font-bold text-on-surface">Monthly Voucher Generation</h2>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Generates vouchers from the Yearly Fee Structure. Already-generated months are skipped, never duplicated.
          </p>
        </div>
        <button onClick={loadHistory} className="h-9 px-3 rounded-lg bg-surface-container text-on-surface font-semibold text-xs self-start sm:self-auto">
          Generation History
        </button>
      </div>

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Academic Year</label>
            <input
              type="text"
              value={academicYear}
              onChange={(e) => { onAcademicYearChange(e.target.value); resetResults(); }}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Month</label>
            <select value={month} onChange={(e) => { setMonth(e.target.value); resetResults(); }} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40">
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => { setYear(Number(e.target.value)); resetResults(); }}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Scope</label>
            <select value={scope} onChange={(e) => { setScope(e.target.value as any); resetResults(); }} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40">
              <option value="SCHOOL">Entire School</option>
              <option value="CLASS">Single Class</option>
              <option value="STUDENT">Single Student</option>
            </select>
          </div>
        </div>

        {scope === "CLASS" && (
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Class</label>
            <select value={classId} onChange={(e) => { setClassId(e.target.value); resetResults(); }} className="w-full sm:w-64 h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40">
              <option value="">Select a class...</option>
              {classes.map((c: any) => (
                <option key={c.id} value={c.id}>{c.displayName || `${c.name}-${c.section}`}</option>
              ))}
            </select>
          </div>
        )}

        {scope === "STUDENT" && (
          <div className="relative">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Student (search by admission # or name)</label>
            <input
              type="text"
              value={selectedStudent ? `${selectedStudent.fullName} (${selectedStudent.admissionNumber})` : studentSearch}
              onChange={(e) => { setSelectedStudent(null); setStudentSearch(e.target.value); resetResults(); }}
              placeholder="e.g. STD-2024-001 or student name"
              className="w-full sm:w-80 h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40"
            />
            {!selectedStudent && studentMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full sm:w-80 bg-surface-container-lowest border border-surface-container-high rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {studentMatches.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedStudent(s); setStudentMatches([]); resetResults(); }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-surface-container-low"
                  >
                    <div className="font-semibold">{s.fullName}</div>
                    <div className="text-on-surface-variant font-mono text-[10px]">{s.admissionNumber}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handlePreview}
            disabled={!canSubmit || previewing}
            className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold text-xs disabled:opacity-50"
          >
            {previewing ? "Previewing..." : "Preview Generation"}
          </button>
        </div>

        {previewError && <p className="text-xs text-error font-semibold">{previewError}</p>}
        {commitResult && (
          <div className="p-3 rounded-lg bg-tertiary-container/10 text-xs text-on-tertiary-container font-semibold flex items-center justify-between">
            <span>
              Generated {commitResult.summary.createdCount} vouchers ({commitResult.summary.skippedCount} already existed, {commitResult.summary.errorCount} errors).
            </span>
            <a href={`/print/challan/batch/${commitResult.batchId}`} target="_blank" className="text-secondary underline">
              Print all generated vouchers
            </a>
          </div>
        )}

        {preview && (
          <div className="space-y-3 pt-2 border-t border-surface-container-low">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-tertiary-container/10">
                <div className="text-lg font-bold text-on-tertiary-container">{preview.summary.createdCount}</div>
                <div className="text-[10px] text-on-tertiary-container">Will Create</div>
              </div>
              <div className="p-2 rounded-lg bg-surface-container">
                <div className="text-lg font-bold text-on-surface">{preview.summary.skippedCount}</div>
                <div className="text-[10px] text-on-surface-variant">Already Exist</div>
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
                    <th className="py-2 px-3">Admission #</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Class</th>
                    <th className="py-2 px-3">Total Payable</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {preview.rows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="py-1.5 px-3 font-mono">{r.admissionNo || "—"}</td>
                      <td className="py-1.5 px-3">{r.studentName}</td>
                      <td className="py-1.5 px-3">{r.className || "—"}</td>
                      <td className="py-1.5 px-3">{r.totalExpected !== undefined ? formatCurrency(r.totalExpected) : "—"}</td>
                      <td className="py-1.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ACTION_STYLES[r.action]}`}>{r.action}</span>
                      </td>
                      <td className="py-1.5 px-3 text-on-surface-variant">{r.errorReason || ""}</td>
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
                disabled={committing || preview.summary.createdCount === 0}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
              >
                {committing ? "Generating..." : `Confirm & Generate ${preview.summary.createdCount} Vouchers`}
              </button>
            </div>
          </div>
        )}
      </div>

      {historyOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-3xl w-full p-5 shadow-2xl border border-surface-container-high space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Voucher Generation History — {academicYear}</h3>
              <button onClick={() => setHistoryOpen(false)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {historyLoading ? (
              <p className="text-xs text-on-surface-variant">Loading...</p>
            ) : history.length === 0 ? (
              <p className="text-xs text-on-surface-variant">No voucher generation runs recorded yet for this academic year.</p>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-on-surface-variant border-b border-surface-container-high/40">
                    <th className="py-2">Date</th>
                    <th className="py-2">Period</th>
                    <th className="py-2">Scope</th>
                    <th className="py-2">Created</th>
                    <th className="py-2">Skipped</th>
                    <th className="py-2">Errors</th>
                    <th className="py-2">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {history.map((b: any) => (
                    <tr key={b.id}>
                      <td className="py-2">{formatDate(b.createdAt)}</td>
                      <td className="py-2">{b.month} {b.year}</td>
                      <td className="py-2">{b.scope}</td>
                      <td className="py-2 text-on-tertiary-container font-semibold">{b.createdCount}</td>
                      <td className="py-2">{b.skippedCount}</td>
                      <td className="py-2 text-error font-semibold">{b.errorCount}</td>
                      <td className="py-2">
                        <a href={`/print/challan/batch/${b.id}`} target="_blank" className="text-secondary font-semibold underline">
                          Print
                        </a>
                      </td>
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
