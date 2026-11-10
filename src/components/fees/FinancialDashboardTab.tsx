"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

export default function FinancialDashboardTab({
  academicYear,
  onAcademicYearChange,
}: {
  academicYear: string;
  onAcademicYearChange: (year: string) => void;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [classRows, setClassRows] = useState<any[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    if (!academicYear) return;
    setLoading(true);
    try {
      const summaryParams = new URLSearchParams({ academicYear });
      if (dateFrom) summaryParams.append("dateFrom", dateFrom);
      if (dateTo) summaryParams.append("dateTo", dateTo);

      const [summaryRes, classRes, monthlyRes] = await Promise.all([
        fetch(`/api/fees/financial-summary?${summaryParams.toString()}`),
        fetch(`/api/fees/reports?type=class-wise-collections&academicYear=${encodeURIComponent(academicYear)}`),
        fetch(`/api/fees/reports?type=monthly-collections&academicYear=${encodeURIComponent(academicYear)}`),
      ]);
      const summaryJson = await summaryRes.json();
      const classJson = await classRes.json();
      const monthlyJson = await monthlyRes.json();
      if (summaryJson.success) setSummary(summaryJson.summary);
      if (classJson.success) setClassRows(classJson.rows);
      if (monthlyJson.success) setMonthlyRows(monthlyJson.rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear, dateFrom, dateTo]);

  const cards = summary
    ? [
        { label: "Yearly Expected Fees", value: summary.yearlyExpectedFees, color: "text-on-surface", bg: "bg-surface-container" },
        { label: "Student Fee Collections", value: summary.totalStudentFeeCollections, color: "text-on-tertiary-container", bg: "bg-tertiary-container/10" },
        { label: "Other Collections", value: summary.otherCollectionsTotal, color: "text-on-tertiary-container", bg: "bg-tertiary-container/10" },
        { label: "Total Income", value: summary.totalIncome, color: "text-on-surface", bg: "bg-secondary/10" },
        { label: "Outstanding Student Dues", value: summary.outstandingStudentDues, color: "text-error", bg: "bg-error-container" },
        { label: "Advance / Unallocated Payments", value: summary.advancePaymentsTotal, color: "text-amber-800", bg: "bg-amber-100" },
        { label: "Total School Expenses", value: summary.otherExpensesTotal, color: "text-error", bg: "bg-error-container" },
        { label: "Net Remaining Balance", value: summary.netRemainingBalance, color: "text-on-tertiary-container", bg: "bg-tertiary-container/10" },
      ]
    : [];

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-xl font-bold text-on-surface">Financial Dashboard</h2>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            One consistent source of truth — every figure here is computed by the same centralized ledger the reports and exports read from.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Academic Year</label>
          <input type="text" value={academicYear} onChange={(e) => onAcademicYearChange(e.target.value)} className="h-9 w-28 px-3 rounded-lg bg-surface-container-low text-xs font-semibold border border-outline-variant/40" />
          <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
          <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-on-surface-variant">Loading dashboard...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cards.map((c) => (
              <div key={c.label} className={`p-4 rounded-xl shadow-sm border border-surface-container-high/40 ${c.bg}`}>
                <div className={`text-lg font-bold ${c.color}`}>{formatCurrency(c.value)}</div>
                <div className="text-[10px] text-on-surface-variant mt-1">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
              <div className="p-3 border-b border-surface-container-high/40">
                <h3 className="font-headline-md text-sm font-bold text-on-surface">Class-wise Collections</h3>
              </div>
              {classRows.length === 0 ? (
                <p className="text-xs text-on-surface-variant p-4">No voucher data yet for {academicYear}.</p>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant">
                      <th className="py-2 px-3">Class</th>
                      <th className="py-2 px-3">Students</th>
                      <th className="py-2 px-3">Expected</th>
                      <th className="py-2 px-3">Collected</th>
                      <th className="py-2 px-3">Outstanding</th>
                      <th className="py-2 px-3">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {classRows.map((r) => (
                      <tr key={r.classId}>
                        <td className="py-1.5 px-3 font-semibold">{r.className}</td>
                        <td className="py-1.5 px-3">{r.studentCount}</td>
                        <td className="py-1.5 px-3">{formatCurrency(r.expected)}</td>
                        <td className="py-1.5 px-3 text-on-tertiary-container">{formatCurrency(r.collected)}</td>
                        <td className="py-1.5 px-3 text-error">{formatCurrency(r.outstanding)}</td>
                        <td className="py-1.5 px-3">{r.collectionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
              <div className="p-3 border-b border-surface-container-high/40">
                <h3 className="font-headline-md text-sm font-bold text-on-surface">Monthly Fee Collections</h3>
              </div>
              {monthlyRows.length === 0 ? (
                <p className="text-xs text-on-surface-variant p-4">No payments received yet for {academicYear}.</p>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant">
                      <th className="py-2 px-3">Month Received</th>
                      <th className="py-2 px-3">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {monthlyRows.map((r) => (
                      <tr key={r.period}>
                        <td className="py-1.5 px-3 font-semibold">{r.period}</td>
                        <td className="py-1.5 px-3 text-on-tertiary-container font-bold">{formatCurrency(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
