"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

interface FinancialSummary {
  feeCollection: number;
  annualCollection: number;
  otherExpenses: number;
  netCollection: number;
  totalTransactions: number;
  otherCollections?: number;
  totalIncome?: number;
  netBalance?: number;
  yearlyExpectedFees?: number;
  totalCollectedOverall?: number;
  outstandingDues?: number;
  advancePayments?: number;
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState<FinancialSummary>({
    feeCollection: 0,
    annualCollection: 0,
    otherExpenses: 0,
    netCollection: 0,
    totalTransactions: 0,
  });
  const [dailyBreakdown, setDailyBreakdown] = useState<DailySummary[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [batches, setBatches] = useState<ImportBatchItem[]>([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (category !== "all") params.append("category", category);

      const res = await fetch(`/api/fees/dashboard?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load financial dashboard.");

      setSummary(data.summary || {});
      setDailyBreakdown(data.dailyBreakdown || []);
      setTransactions(data.transactions || []);
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
  }, [from, to, category]);

  return (
    <div className="flex flex-col w-full gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-on-surface">Financial Dashboard</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
              Collections & Expenses
            </span>
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Real-time financial summary tracking fee collections, annual amounts, and operating expenditures.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/fees"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">payments</span>
            <span>Fee Management</span>
          </Link>
          <Link
            href="/admin/fees/vouchers"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
            <span>Voucher Register</span>
          </Link>
        </div>
      </div>

      {/* Accounting Rule Callout */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 flex items-start gap-3">
        <span className="material-symbols-outlined text-[18px] text-amber-700 shrink-0 mt-0.5">info</span>
        <div>
          <span className="font-bold">Accounting Rule:</span> <b>Other Expenses</b> represents the school’s outgoing operational expenditures (bills, supplies, utilities). It is reported separately and is <b>never added</b> to student fee collections. <b>Net Collection</b> reflects total revenue received from Fees and Annual Subscriptions.
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-outline-variant/60 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={todayStr()}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs font-medium"
          >
            <option value="all">All Categories</option>
            <option value="Fees">Fees Only</option>
            <option value="Annual Amount">Annual Amount Only</option>
            <option value="Other Expenses">Other Expenses Only</option>
          </select>
        </div>
        <button
          type="button"
          onClick={fetchDashboardData}
          className="h-9 px-4 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-error-container text-on-error-container text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Fee Collection */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Fee Collection</span>
            <span className="material-symbols-outlined text-[20px] text-primary">payments</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">
              Rs. {summary.feeCollection.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Monthly student tuition fees</p>
        </div>

        {/* Annual Amount */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Annual Amount</span>
            <span className="material-symbols-outlined text-[20px] text-tertiary">card_membership</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-tertiary font-mono">
              Rs. {summary.annualCollection.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Annual subscription / charges</p>
        </div>

        {/* Other Expenses */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Other Expenses (Outgoing)</span>
            <span className="material-symbols-outlined text-[20px] text-rose-600">receipt</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-rose-600 font-mono">
              Rs. {summary.otherExpenses.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">School expenses (not income)</p>
        </div>

        {/* Net Collection */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm bg-gradient-to-br from-surface-container-lowest to-surface-container/30">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Net Collection</span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">account_balance</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-emerald-700 font-mono">
              Rs. {summary.netCollection.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Fees + Annual Collection</p>
        </div>
      </div>

      {/* Other income/expense (this period) and the overall academic-year standing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Other Collections</span>
            <span className="material-symbols-outlined text-[20px] text-tertiary">redeem</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {(summary.otherCollections || 0).toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Registration, certificates, fines, events (this period)</p>
        </div>
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Total Income</span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">trending_up</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-emerald-700 font-mono">Rs. {(summary.totalIncome || 0).toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Student fees + other collections (this period)</p>
        </div>
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Net Remaining Balance</span>
            <span className="material-symbols-outlined text-[20px] text-primary">savings</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {(summary.netBalance || 0).toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Total income − actual expenses (this period)</p>
        </div>
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Advance Payments</span>
            <span className="material-symbols-outlined text-[20px] text-tertiary">account_balance_wallet</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {(summary.advancePayments || 0).toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">Unapplied student credit, this academic year</p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-surface-container/40 border border-outline-variant/40">
        <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">
          Overall academic-year standing (not limited to the date range above)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div><span className="text-on-surface-variant">Yearly Expected Fees: </span><span className="font-bold text-on-surface">Rs. {(summary.yearlyExpectedFees || 0).toLocaleString()}</span></div>
          <div><span className="text-on-surface-variant">Collected So Far: </span><span className="font-bold text-on-surface">Rs. {(summary.totalCollectedOverall || 0).toLocaleString()}</span></div>
          <div><span className="text-on-surface-variant">Outstanding Student Dues: </span><span className="font-bold text-error">Rs. {(summary.outstandingDues || 0).toLocaleString()}</span></div>
        </div>
      </div>

      {/* Daily Breakdown and Recent Transactions */}
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
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-on-surface-variant text-xs">
                      No daily records found.
                    </td>
                  </tr>
                ) : (
                  dailyBreakdown.map((d) => (
                    <tr key={d.date} className="hover:bg-surface-container/30">
                      <td className="p-2 font-mono font-medium">{d.date}</td>
                      <td className="p-2 text-right font-mono text-primary font-semibold">
                        {d.fees > 0 ? d.fees.toLocaleString() : "-"}
                      </td>
                      <td className="p-2 text-right font-mono text-tertiary font-semibold">
                        {d.annual > 0 ? d.annual.toLocaleString() : "-"}
                      </td>
                      <td className="p-2 text-right font-mono text-rose-600 font-semibold">
                        {d.expenses > 0 ? d.expenses.toLocaleString() : "-"}
                      </td>
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
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-on-surface-variant text-xs">
                      No transactions recorded in this period.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-surface-container/30">
                      <td className="p-2.5 font-mono text-on-surface-variant">{tx.date}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            tx.category === "Fees"
                              ? "bg-primary/10 text-primary"
                              : tx.category === "Annual Amount"
                              ? "bg-tertiary/10 text-tertiary"
                              : "bg-rose-500/10 text-rose-700"
                          }`}
                        >
                          {tx.category}
                        </span>
                      </td>
                      <td className="p-2.5 font-medium">{tx.details}</td>
                      <td className="p-2.5 text-on-surface-variant">
                        {tx.studentName ? `${tx.studentName} (${tx.className || ""})` : "-"}
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold text-on-surface">
                        Rs. {tx.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container text-on-surface">
                        {b.status}
                      </span>
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
