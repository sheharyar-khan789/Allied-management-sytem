"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const thisYear = new Date().getFullYear();
const YEAR_OPTIONS = [thisYear - 1, thisYear, thisYear + 1].map((y) => `${y}-${y + 1}`);

interface ClassOption {
  id: string;
  name: string;
  section: string;
}

interface GenerationRow {
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  action: "GENERATED" | "SKIPPED_EXISTS" | "SKIPPED_NO_STRUCTURE" | "FAILED";
  reason?: string;
  totalExpected?: number;
  advanceApplied?: number;
}

interface Summary {
  totalStudents: number;
  generated: number;
  skippedExists: number;
  skippedNoStructure: number;
  failed: number;
}

interface Batch {
  id: string;
  month: string;
  year: number;
  scope: string;
  classId?: string;
  studentId?: string;
  totalStudents: number;
  generated: number;
  skippedExists: number;
  skippedNoStructure: number;
  failed: number;
  createdByName?: string;
  createdAt: string;
}

const ACTION_STYLES: Record<string, string> = {
  GENERATED: "bg-tertiary-container/10 text-on-tertiary-container",
  SKIPPED_EXISTS: "bg-surface-container-high text-on-surface-variant",
  SKIPPED_NO_STRUCTURE: "bg-amber-100 text-amber-800",
  FAILED: "bg-error-container text-on-error-container",
};

export default function VoucherGenerationPanel({ classes }: { classes: ClassOption[] }) {
  const [academicYear, setAcademicYear] = useState(YEAR_OPTIONS[1]);
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [scope, setScope] = useState<"SCHOOL" | "CLASS" | "STUDENT">("SCHOOL");
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [studentId, setStudentId] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<GenerationRow[]>([]);
  const [committed, setCommitted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    if (scope !== "STUDENT" || !classId) {
      setStudents([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/students?classId=${encodeURIComponent(classId)}&limit=250`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setStudents(j.success && Array.isArray(j.students) ? j.students : []); })
      .catch(() => { if (!cancelled) setStudents([]); });
    return () => { cancelled = true; };
  }, [scope, classId]);

  const run = async (commit: boolean) => {
    setBusy(true);
    setError("");
    try {
      const body: any = { academicYear, month, year, scope };
      if (scope === "CLASS") body.classId = classId;
      if (scope === "STUDENT") body.studentId = studentId;
      const res = await fetch(`/api/fees/vouchers/generate${commit ? "?commit=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Voucher generation failed.");
      setSummary(json.summary);
      setRows(json.rows || []);
      setCommitted(json.committed);
    } catch (err: any) {
      setError(err?.message || "Voucher generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    setHistoryOpen(true);
    try {
      const res = await fetch(`/api/fees/vouchers/generate?academicYear=${encodeURIComponent(academicYear)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setBatches(json.success ? json.batches || [] : []);
    } catch {
      setBatches([]);
    }
  };

  const canRun = scope === "SCHOOL" || (scope === "CLASS" && classId) || (scope === "STUDENT" && studentId);
  const selectClass = "h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40";

  return (
    <div className="flex flex-col gap-4">
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="vgen-year" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Academic Year</label>
          <select id="vgen-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={selectClass}>
            {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="vgen-month" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Month</label>
          <select id="vgen-month" value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
            {MONTHS.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="vgen-cyear" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Year</label>
          <select id="vgen-cyear" value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectClass}>
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="vgen-scope" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Scope</label>
          <select id="vgen-scope" value={scope} onChange={(e) => { setScope(e.target.value as any); setClassId(""); setStudentId(""); }} className={selectClass}>
            <option value="SCHOOL">Whole School</option>
            <option value="CLASS">One Class</option>
            <option value="STUDENT">One Student</option>
          </select>
        </div>
        {(scope === "CLASS" || scope === "STUDENT") && (
          <div>
            <label htmlFor="vgen-class" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Class</label>
            <select id="vgen-class" value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(""); }} className={selectClass}>
              <option value="">Select class</option>
              {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}-{c.section}</option>))}
            </select>
          </div>
        )}
        {scope === "STUDENT" && (
          <div className="min-w-[200px]">
            <label htmlFor="vgen-student" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Student</label>
            <select id="vgen-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={`${selectClass} w-full`} disabled={!classId}>
              <option value="">{classId ? "Select student" : "Select a class first"}</option>
              {students.map((s) => (<option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber})</option>))}
            </select>
          </div>
        )}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={loadHistory} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold">
            <span className="material-symbols-outlined text-[16px]">history</span>
            Generation History
          </button>
          <button type="button" onClick={() => run(false)} disabled={!canRun || busy} className="px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold disabled:opacity-50">
            {busy ? "Working..." : "Preview"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
          <div className="p-4 border-b border-surface-container-low flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">
              {committed ? "Generated" : "Preview"} — {month} {year} ({academicYear})
            </h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-tertiary-container/10 text-on-tertiary-container font-bold">Generated {summary.generated}</span>
              <span className="px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant font-bold">Already existed {summary.skippedExists}</span>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold">No structure {summary.skippedNoStructure}</span>
              {summary.failed > 0 && <span className="px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-bold">Failed {summary.failed}</span>}
            </div>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-container-low">
                <tr className="text-on-surface-variant uppercase text-[10px] font-bold">
                  <th className="py-2 px-3">Student</th>
                  <th className="py-2 px-3">Class</th>
                  <th className="py-2 px-3">Result</th>
                  <th className="py-2 px-3">Total</th>
                  <th className="py-2 px-3">Advance Applied</th>
                  <th className="py-2 px-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {rows.map((r) => (
                  <tr key={r.studentId}>
                    <td className="py-2 px-3 font-semibold text-on-surface">
                      {r.studentName}
                      <div className="text-[10px] text-on-surface-variant font-normal font-mono">{r.admissionNo}</div>
                    </td>
                    <td className="py-2 px-3 text-on-surface-variant">{r.className}</td>
                    <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded font-bold ${ACTION_STYLES[r.action]}`}>{r.action.replace(/_/g, " ")}</span></td>
                    <td className="py-2 px-3">{r.totalExpected !== undefined ? formatCurrency(r.totalExpected) : "—"}</td>
                    <td className="py-2 px-3">{r.advanceApplied ? formatCurrency(r.advanceApplied) : "—"}</td>
                    <td className="py-2 px-3 text-on-surface-variant">{r.reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!committed && summary.generated > 0 && (
            <div className="p-4 border-t border-surface-container-low flex justify-end">
              <button type="button" onClick={() => run(true)} disabled={busy} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
                {busy ? "Generating..." : `Confirm & Generate ${summary.generated} Voucher${summary.generated === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-surface-container-lowest rounded-xl max-w-3xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Generation History — {academicYear}</h3>
              <button type="button" onClick={() => setHistoryOpen(false)} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {batches.length === 0 ? (
              <p className="text-xs text-on-surface-variant p-4 text-center">No vouchers generated for this academic year yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] font-bold">
                      <th className="py-2 px-3">When</th>
                      <th className="py-2 px-3">Month</th>
                      <th className="py-2 px-3">Scope</th>
                      <th className="py-2 px-3">Generated</th>
                      <th className="py-2 px-3">Already Existed</th>
                      <th className="py-2 px-3">No Structure</th>
                      <th className="py-2 px-3">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2 px-3">{formatDate(b.createdAt)}</td>
                        <td className="py-2 px-3">{b.month} {b.year}</td>
                        <td className="py-2 px-3">{b.scope}</td>
                        <td className="py-2 px-3 font-semibold text-on-tertiary-container">{b.generated}</td>
                        <td className="py-2 px-3">{b.skippedExists}</td>
                        <td className="py-2 px-3">{b.skippedNoStructure}</td>
                        <td className="py-2 px-3 text-on-surface-variant">{b.createdByName || "—"}</td>
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
