"use client";

import React, { useEffect, useState } from "react";
import InlineAlert from "@/components/fees/InlineAlert";
import Pagination, { PAGE_SIZE } from "@/components/fees/Pagination";

const REPORT_TYPES = [
  { value: "net-summary", label: "Net Financial Summary" },
  { value: "monthly-collections", label: "Monthly Fee Collection Report" },
  { value: "class-wise-collections", label: "Class-wise Collection Report" },
  { value: "student-ledger", label: "Student Fee Ledger" },
  { value: "outstanding-dues", label: "Outstanding Dues Report" },
  { value: "advance-payments", label: "Advance Payment Report" },
  { value: "other-collections", label: "Other Collections Report" },
  { value: "other-expenses", label: "School Expenses Report" },
  { value: "import-history", label: "Import Batch History" },
];

const CLASS_FILTER_TYPES = new Set(["student-ledger", "outstanding-dues"]);
const DATE_RANGE_TYPES = new Set(["net-summary", "other-collections", "other-expenses"]);
const CATEGORY_FILTER_TYPES = new Set(["other-collections", "other-expenses"]);

function formatCell(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString("en-PK");
  return String(value);
}

export default function ReportsExportsTab({
  academicYear,
  onAcademicYearChange,
}: {
  academicYear: string;
  onAcademicYearChange: (year: string) => void;
}) {
  const [reportType, setReportType] = useState("net-summary");
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("ALL");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [runError, setRunError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((d) => setClasses(d?.classes || d || []))
      .catch(() => {});
  }, []);

  const buildParams = () => {
    const params = new URLSearchParams({ type: reportType, academicYear });
    if (CLASS_FILTER_TYPES.has(reportType) && classId !== "all") params.append("classId", classId);
    if (DATE_RANGE_TYPES.has(reportType)) {
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
    }
    if (CATEGORY_FILTER_TYPES.has(reportType) && category !== "ALL") params.append("category", category);
    return params;
  };

  const runReport = async () => {
    if (!academicYear) return;
    setLoading(true);
    setRan(true);
    setRunError("");
    setPage(1);
    try {
      const res = await fetch(`/api/fees/reports?${buildParams().toString()}`);
      const json = await res.json();
      if (json.success) {
        setRows(json.rows);
      } else {
        setRows([]);
        setRunError(json.error || "Failed to run report.");
      }
    } catch {
      setRows([]);
      setRunError("Failed to run report.");
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    window.open(`/api/fees/reports/export?${buildParams().toString()}`, "_blank");
  };

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h2 className="font-headline-lg text-xl font-bold text-on-surface">Reports & Exports</h2>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Every report reads live data from the same centralized ledger — totals always reconcile with the underlying records.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3 no-print">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Report</label>
          <select value={reportType} onChange={(e) => { setReportType(e.target.value); setRan(false); setRows([]); }} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40">
            {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Academic Year</label>
          <input type="text" value={academicYear} onChange={(e) => onAcademicYearChange(e.target.value)} className="h-9 w-28 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40" />
        </div>
        {CLASS_FILTER_TYPES.has(reportType) && (
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Class</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40">
              <option value="all">All Classes</option>
              {classes.map((c: any) => <option key={c.id} value={c.id}>{c.displayName || `${c.name}-${c.section}`}</option>)}
            </select>
          </div>
        )}
        {DATE_RANGE_TYPES.has(reportType) && (
          <>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
            </div>
          </>
        )}
        {CATEGORY_FILTER_TYPES.has(reportType) && (
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Category</label>
            <input type="text" value={category === "ALL" ? "" : category} onChange={(e) => setCategory(e.target.value || "ALL")} placeholder="ALL" className="h-9 w-28 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
          </div>
        )}
        <button onClick={runReport} disabled={!academicYear || loading} className="h-9 px-4 rounded-lg bg-secondary text-on-secondary font-semibold text-xs disabled:opacity-50">
          {loading ? "Running..." : "Run Report"}
        </button>
        {ran && rows.length > 0 && (
          <>
            <button onClick={exportExcel} className="h-9 px-4 rounded-lg bg-surface-container text-on-surface font-semibold text-xs inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">download</span>
              Export to Excel
            </button>
            <button onClick={() => window.print()} className="h-9 px-4 rounded-lg bg-surface-container text-on-surface font-semibold text-xs inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">print</span>
              Print
            </button>
          </>
        )}
      </div>

      <InlineAlert type="error" message={runError} />

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden print-sheet">
        {!ran ? (
          <p className="text-xs text-on-surface-variant p-8 text-center">Choose a report and click &quot;Run Report&quot;.</p>
        ) : loading ? (
          <p className="text-xs text-on-surface-variant p-8 text-center">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-on-surface-variant p-8 text-center">No data found for these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant uppercase">
                  {columns.map((c) => <th key={c} className="py-2 px-3 whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {pagedRows.map((row, idx) => (
                  <tr key={idx}>
                    {columns.map((c) => <td key={c} className="py-1.5 px-3 whitespace-nowrap">{formatCell(row[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalItems={rows.length} onPageChange={setPage} />
      </div>
    </div>
  );
}
