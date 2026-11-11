"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

interface FinancialSummary {
  netCollection: { amount: number; studentCount: number };
  receivedAmount: { amount: number; paymentCount: number };
  vouchers: {
    totalCount: number; totalAmount: number;
    dailyCount: number; dailyAmount: number; dailyDate: string;
    monthlyCount: number; monthlyAmount: number; monthlyPeriod: string;
  };
  otherExpenses: { amount: number; count: number; dailyAmount: number; monthlyAmount: number };
}

const EMPTY_SUMMARY: FinancialSummary = {
  netCollection: { amount: 0, studentCount: 0 },
  receivedAmount: { amount: 0, paymentCount: 0 },
  vouchers: { totalCount: 0, totalAmount: 0, dailyCount: 0, dailyAmount: 0, dailyDate: "", monthlyCount: 0, monthlyAmount: 0, monthlyPeriod: "" },
  otherExpenses: { amount: 0, count: 0, dailyAmount: 0, monthlyAmount: 0 },
};

interface DailySummary {
  date: string;
  fees: number;
  annual: number;
  expenses: number;
}

interface TransactionItem {
  id: string;
  date: string;
  category: "Fees" | "Annual Amount" | "Other Expenses";
  details: string;
  studentName?: string;
  className?: string;
  amount: number;
  challanRef?: string;
  createdAt: string;
}

interface ExpenseItem {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
}

interface ImportBatchItem {
  id: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  successCount: number;
  failCount: number;
  status: string;
}

const todayStr = () => new Date().toISOString().split("T")[0];
const thirtyDaysAgoStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
};

export default function FinancialDashboardPage() {
  const [from, setFrom] = useState(thirtyDaysAgoStr());
  const [to, setTo] = useState(todayStr());
  const [category, setCategory] = useState("all");
  const [academicYearInput, setAcademicYearInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [academicYear, setAcademicYear] = useState("");
  const [timezone, setTimezone] = useState("");
  const [summary, setSummary] = useState<FinancialSummary>(EMPTY_SUMMARY);
  const [dailyBreakdown, setDailyBreakdown] = useState<DailySummary[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [batches, setBatches] = useState<ImportBatchItem[]>([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (category !== "all") params.append("category", category);
      if (academicYearInput.trim()) params.append("academicYear", academicYearInput.trim());

      const res = await fetch(`/api/fees/dashboard?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load financial dashboard.");

      setSummary(data.summary || EMPTY_SUMMARY);
      setAcademicYear(data.academicYear || "");
      setTimezone(data.timezone || "");
      setDailyBreakdown(data.dailyBreakdown || []);
      setTransactions(data.transactions || []);
      setExpenses(data.expenses || []);
      setBatches(data.importBatches || []);
    } catch (err: any) {
      setError(err.message || "Failed to load financial data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, category, academicYearInput]);

  return (
    <div className="flex flex-col w-full gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-on-surface">Financial Dashboard</h1>
            {academicYear && (
              <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold">{academicYear}</span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Net Collection (expected), Received Amount (actual), Vouchers, and Other Expenses — four separate figures, never mixed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/fees" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold">
            <span className="material-symbols-outlined text-[16px]">payments</span>
            <span>Fee Management</span>
          </Link>
          <Link href="/admin/fees/vouchers" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold">
            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
            <span>Voucher Register</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-outline-variant/60 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">From</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">To</label>
          <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} className="h-9 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Academic Year</label>
          <input
            type="text"
            value={academicYearInput}
            onChange={(e) => setAcademicYearInput(e.target.value)}
            placeholder={academicYear || "e.g. 2025-2026"}
            className="h-9 w-32 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Transaction Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs font-medium">
            <option value="all">All Categories</option>
            <option value="Fees">Fees Only</option>
            <option value="Annual Amount">Annual Amount Only</option>
            <option value="Other Expenses">Other Expenses Only</option>
          </select>
        </div>
        <button type="button" onClick={fetchDashboardData} className="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
        {timezone && <span className="text-[11px] text-on-surface-variant ml-auto">Daily/monthly figures use {timezone} time.</span>}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-error-container text-on-error-container text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* The four main financial blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Block 1 — Net Collection */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Net Collection</span>
            <span className="material-symbols-outlined text-[20px] text-primary">account_balance</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {summary.netCollection.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Expected yearly fee — {summary.netCollection.studentCount} student{summary.netCollection.studentCount === 1 ? "" : "s"} on the {academicYear} ledger. Never changes when a payment is received.
          </p>
        </div>

        {/* Block 2 — Received Amount */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Received Amount</span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">payments</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-emerald-700 font-mono">Rs. {summary.receivedAmount.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            {summary.receivedAmount.paymentCount} actual payment{summary.receivedAmount.paymentCount === 1 ? "" : "s"} received, {from} to {to}.
          </p>
        </div>

        {/* Block 3 — Vouchers */}
        <Link href="/admin/fees/vouchers" className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm hover:border-primary/50 transition-colors">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Vouchers</span>
            <span className="material-symbols-outlined text-[20px] text-tertiary">receipt_long</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">{summary.vouchers.totalCount}</span>
            <span className="text-xs text-on-surface-variant ml-2">Rs. {summary.vouchers.totalAmount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Today ({summary.vouchers.dailyDate}): {summary.vouchers.dailyCount} / Rs. {summary.vouchers.dailyAmount.toLocaleString()} •
            This month ({summary.vouchers.monthlyPeriod}): {summary.vouchers.monthlyCount} / Rs. {summary.vouchers.monthlyAmount.toLocaleString()}
          </p>
        </Link>

        {/* Block 4 — Other Expenses */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Other Expenses</span>
            <span className="material-symbols-outlined text-[20px] text-rose-600">receipt</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-rose-600 font-mono">Rs. {summary.otherExpenses.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            {summary.otherExpenses.count} record{summary.otherExpenses.count === 1 ? "" : "s"} • Today: Rs. {summary.otherExpenses.dailyAmount.toLocaleString()} • This month: Rs. {summary.otherExpenses.monthlyAmount.toLocaleString()}. Never added to Received Amount or Net Collection.
          </p>
        </div>
      </div>

      {/* Daily Breakdown, Recent Transactions, Other Expenses records */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Breakdown Table */}
        <div className="lg:col-span-1 p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-on-surface">Daily Collection Breakdown</h3>
            <span className="text-xs text-on-surface-variant">{dailyBreakdown.length} days</span>
          </div>
          <div className="max-h-96 overflow-y-auto border border-outline-variant rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-container sticky top-0 border-b border-outline-variant">
                <tr>
                  <th className="p-2 font-bold">Date</th>
                  <th className="p-2 font-bold text-right">Fees</th>
                  <th className="p-2 font-bold text-right">Annual</th>
                  <th className="p-2 font-bold text-right">Expenses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {dailyBreakdown.length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-center text-on-surface-variant text-xs">No daily records found.</td></tr>
                ) : (
                  dailyBreakdown.map((d) => (
                    <tr key={d.date} className="hover:bg-surface-container/30">
                      <td className="p-2 font-mono font-medium">{d.date}</td>
                      <td className="p-2 text-right font-mono text-primary font-semibold">{d.fees > 0 ? d.fees.toLocaleString() : "-"}</td>
                      <td className="p-2 text-right font-mono text-tertiary font-semibold">{d.annual > 0 ? d.annual.toLocaleString() : "-"}</td>
                      <td className="p-2 text-right font-mono text-rose-600 font-semibold">{d.expenses > 0 ? d.expenses.toLocaleString() : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-on-surface">Recorded Transactions</h3>
            <span className="text-xs text-on-surface-variant">{transactions.length} items</span>
          </div>
          <div className="max-h-96 overflow-y-auto border border-outline-variant rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-container sticky top-0 border-b border-outline-variant">
                <tr>
                  <th className="p-2.5 font-bold">Date</th>
                  <th className="p-2.5 font-bold">Category</th>
                  <th className="p-2.5 font-bold">Details</th>
                  <th className="p-2.5 font-bold">Student / Class</th>
                  <th className="p-2.5 font-bold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {transactions.length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-on-surface-variant text-xs">No transactions recorded in this period.</td></tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-surface-container/30">
                      <td className="p-2.5 font-mono text-on-surface-variant">{tx.date}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tx.category === "Fees" ? "bg-primary/10 text-primary" : tx.category === "Annual Amount" ? "bg-tertiary/10 text-tertiary" : "bg-rose-500/10 text-rose-700"}`}>
                          {tx.category}
                        </span>
                      </td>
                      <td className="p-2.5 font-medium">{tx.details}</td>
                      <td className="p-2.5 text-on-surface-variant">{tx.studentName ? `${tx.studentName} (${tx.className || ""})` : "-"}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-on-surface">Rs. {tx.amount.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Other Expenses — individual records (Block 4 detail access) */}
      <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-on-surface">Other Expenses — Records</h3>
          <span className="text-xs text-on-surface-variant">{expenses.length} records in this period</span>
        </div>
        <div className="max-h-72 overflow-y-auto border border-outline-variant rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-container sticky top-0 border-b border-outline-variant">
              <tr>
                <th className="p-2.5 font-bold">Date</th>
                <th className="p-2.5 font-bold">Category</th>
                <th className="p-2.5 font-bold">Description</th>
                <th className="p-2.5 font-bold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {expenses.length === 0 ? (
                <tr><td colSpan={4} className="p-4 text-center text-on-surface-variant text-xs">No Other Expenses recorded in this period.</td></tr>
              ) : (
                expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-container/30">
                    <td className="p-2.5 font-mono text-on-surface-variant">{e.date}</td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-700">{e.category}</span>
                    </td>
                    <td className="p-2.5 font-medium">{e.description}</td>
                    <td className="p-2.5 text-right font-mono font-bold text-rose-700">Rs. {e.amount.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Batch History */}
      {batches.length > 0 && (
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-on-surface">Import Batch History</h3>
          <div className="overflow-x-auto border border-outline-variant rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-container border-b border-outline-variant">
                <tr>
                  <th className="p-2.5 font-bold">Batch ID</th>
                  <th className="p-2.5 font-bold">File Name</th>
                  <th className="p-2.5 font-bold">Imported At</th>
                  <th className="p-2.5 font-bold text-center">Total Rows</th>
                  <th className="p-2.5 font-bold text-center">Success</th>
                  <th className="p-2.5 font-bold text-center">Failed</th>
                  <th className="p-2.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {batches.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-container/30">
                    <td className="p-2.5 font-mono text-on-surface-variant text-[11px]">{b.id}</td>
                    <td className="p-2.5 font-medium">{b.fileName}</td>
                    <td className="p-2.5 text-on-surface-variant">{formatDate(b.importedAt)}</td>
                    <td className="p-2.5 text-center font-mono">{b.rowCount}</td>
                    <td className="p-2.5 text-center font-mono text-emerald-700 font-semibold">{b.successCount}</td>
                    <td className="p-2.5 text-center font-mono text-rose-700 font-semibold">{b.failCount}</td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container text-on-surface">{b.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
