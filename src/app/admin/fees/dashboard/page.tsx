"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

interface FinancialSummary {
  totalFeeAmount: { amount: number; challanCount: number };
  feeCollected: { amount: number; paymentCount: number };
  outstandingAmount: { amount: number };
  otherCollections: { amount: number };
  otherExpenses: { amount: number; count: number; dailyAmount: number; monthlyAmount: number };
  netCollection: { amount: number };
  vouchers: {
    totalCount: number; totalAmount: number;
    dailyCount: number; dailyAmount: number; dailyDate: string;
    monthlyCount: number; monthlyAmount: number; monthlyPeriod: string;
  };
}

const EMPTY_SUMMARY: FinancialSummary = {
  totalFeeAmount: { amount: 0, challanCount: 0 },
  feeCollected: { amount: 0, paymentCount: 0 },
  outstandingAmount: { amount: 0 },
  otherCollections: { amount: 0 },
  otherExpenses: { amount: 0, count: 0, dailyAmount: 0, monthlyAmount: 0 },
  netCollection: { amount: 0 },
  vouchers: { totalCount: 0, totalAmount: 0, dailyCount: 0, dailyAmount: 0, dailyDate: "", monthlyCount: 0, monthlyAmount: 0, monthlyPeriod: "" },
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
  voided?: boolean;
  voidReason?: string;
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

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addExpenseDate, setAddExpenseDate] = useState(todayStr());
  const [addExpenseDescription, setAddExpenseDescription] = useState("");
  const [addExpenseAmount, setAddExpenseAmount] = useState("");
  const [addExpenseError, setAddExpenseError] = useState("");
  const [addExpenseSaving, setAddExpenseSaving] = useState(false);

  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [editExpenseDate, setEditExpenseDate] = useState("");
  const [editExpenseDescription, setEditExpenseDescription] = useState("");
  const [editExpenseAmount, setEditExpenseAmount] = useState("");
  const [editExpenseError, setEditExpenseError] = useState("");
  const [editExpenseSaving, setEditExpenseSaving] = useState(false);
  const [voidingExpenseId, setVoidingExpenseId] = useState("");
  const [voidExpenseReason, setVoidExpenseReason] = useState("");
  const [voidExpenseError, setVoidExpenseError] = useState("");
  const [voidExpenseSaving, setVoidExpenseSaving] = useState(false);

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

  const submitAddExpense = async () => {
    setAddExpenseError("");
    const amount = Number(addExpenseAmount);
    if (!addExpenseDate) return setAddExpenseError("Date is required.");
    if (!addExpenseDescription.trim()) return setAddExpenseError("Description is required.");
    if (!Number.isFinite(amount) || amount <= 0) return setAddExpenseError("Amount must be a positive number.");
    setAddExpenseSaving(true);
    try {
      const res = await fetch("/api/fees/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: addExpenseDate, description: addExpenseDescription.trim(), amount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setAddExpenseError(json.error || "Could not save the expense.");
        return;
      }
      setAddExpenseOpen(false);
      setAddExpenseDescription("");
      setAddExpenseAmount("");
      await fetchDashboardData();
    } catch {
      setAddExpenseError("Could not save the expense. Check your connection and try again.");
    } finally {
      setAddExpenseSaving(false);
    }
  };

  const startEditExpense = (e: ExpenseItem) => {
    setEditingExpenseId(e.id);
    setEditExpenseDate(e.date);
    setEditExpenseDescription(e.description);
    setEditExpenseAmount(String(e.amount));
    setEditExpenseError("");
  };

  const saveEditExpense = async () => {
    setEditExpenseError("");
    const amount = Number(editExpenseAmount);
    if (!editExpenseDescription.trim()) return setEditExpenseError("Description is required.");
    if (!Number.isFinite(amount) || amount <= 0) return setEditExpenseError("Amount must be a positive number.");
    setEditExpenseSaving(true);
    try {
      const res = await fetch("/api/fees/expenses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingExpenseId, date: editExpenseDate, description: editExpenseDescription.trim(), amount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setEditExpenseError(json.error || "Could not save the correction.");
        return;
      }
      setEditingExpenseId("");
      await fetchDashboardData();
    } catch {
      setEditExpenseError("Could not save the correction. Check your connection and try again.");
    } finally {
      setEditExpenseSaving(false);
    }
  };

  const confirmVoidExpense = async (id: string) => {
    setVoidExpenseError("");
    if (!voidExpenseReason.trim()) return setVoidExpenseError("A reason is required.");
    setVoidExpenseSaving(true);
    try {
      const res = await fetch(`/api/fees/expenses?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidExpenseReason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setVoidExpenseError(json.error || "Could not void the expense.");
        return;
      }
      setVoidingExpenseId("");
      setVoidExpenseReason("");
      await fetchDashboardData();
    } catch {
      setVoidExpenseError("Could not void the expense. Check your connection and try again.");
    } finally {
      setVoidExpenseSaving(false);
    }
  };

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
            Total Fee Amount and Outstanding Amount are live snapshots; Fee Collected, Other Collections, Other Expenses and Net Collection are for the selected date range — six separate figures, never mixed.
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

      {/* The six main financial blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Block 1 — Total Fee Amount (snapshot, from real fee challans) */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Total Fee Amount</span>
            <span className="material-symbols-outlined text-[20px] text-primary">account_balance</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {summary.totalFeeAmount.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Billed across {summary.totalFeeAmount.challanCount} voucher{summary.totalFeeAmount.challanCount === 1 ? "" : "s"} for {academicYear}. A live snapshot — never changes when a payment is received.
          </p>
        </div>

        {/* Block 2 — Outstanding Amount (snapshot, from the same real fee challans) */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Outstanding Amount</span>
            <span className="material-symbols-outlined text-[20px] text-amber-600">hourglass_empty</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-amber-700 font-mono">Rs. {summary.outstandingAmount.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Total Fee Amount minus everything ever paid against these vouchers — a live snapshot, not limited to the selected date range.
          </p>
        </div>

        {/* Block 3 — Fee Collected (date-range, tuition share of active payments) */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Fee Collected</span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">payments</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-emerald-700 font-mono">Rs. {summary.feeCollected.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Tuition share of {summary.feeCollected.paymentCount} actual payment{summary.feeCollected.paymentCount === 1 ? "" : "s"} received, {from} to {to}.
          </p>
        </div>

        {/* Block 4 — Other Collections (date-range, non-tuition share of the same payments) */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Other Collections</span>
            <span className="material-symbols-outlined text-[20px] text-secondary">request_quote</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {summary.otherCollections.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            Annual/admission/exam/misc share of the same payments, {from} to {to} — never counted again in Fee Collected.
          </p>
        </div>

        {/* Block 5 — Other Expenses (date-range, ExpenseDoc only) */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Other Expenses</span>
            <span className="material-symbols-outlined text-[20px] text-rose-600">receipt</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-rose-600 font-mono">Rs. {summary.otherExpenses.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            {summary.otherExpenses.count} record{summary.otherExpenses.count === 1 ? "" : "s"} • Today: Rs. {summary.otherExpenses.dailyAmount.toLocaleString()} • This month: Rs. {summary.otherExpenses.monthlyAmount.toLocaleString()}. Never counted as a student fee collection.
          </p>
        </div>

        {/* Block 6 — Net Collection (date-range: real net cash position) */}
        <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-xs font-bold uppercase tracking-wider">Net Collection</span>
            <span className="material-symbols-outlined text-[20px] text-tertiary">account_balance_wallet</span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-on-surface font-mono">Rs. {summary.netCollection.amount.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1">
            (Fee Collected + Other Collections) − Other Expenses, {from} to {to} — the period&apos;s real net cash position.
          </p>
        </div>
      </div>

      {/* Vouchers — the same payments as Fee Collected + Other Collections, as counts */}
      <Link href="/admin/fees/vouchers" className="block p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm hover:border-primary/50 transition-colors">
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

      {/* Other Expenses — individual records (Block 5 detail access + manual entry/editing) */}
      <div className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-on-surface">Other Expenses — Records</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant">{expenses.length} records in this period</span>
            <button
              type="button"
              onClick={() => { setAddExpenseOpen(true); setAddExpenseDate(todayStr()); setAddExpenseError(""); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90"
            >
              <span className="material-symbols-outlined text-[14px]">add</span> Add Expense
            </button>
          </div>
        </div>

        {addExpenseOpen && (
          <div className="p-3 rounded-xl border border-outline-variant bg-surface-container-low space-y-2">
            {addExpenseError && <p className="text-[11px] text-error font-semibold">{addExpenseError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input type="date" value={addExpenseDate} max={todayStr()} onChange={(e) => setAddExpenseDate(e.target.value)} className="h-9 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs" />
              <input type="text" placeholder="Description" value={addExpenseDescription} onChange={(e) => setAddExpenseDescription(e.target.value)} className="h-9 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs sm:col-span-2" />
              <input type="number" min={0.01} step="any" placeholder="Amount" value={addExpenseAmount} onChange={(e) => setAddExpenseAmount(e.target.value)} className="h-9 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={submitAddExpense} disabled={addExpenseSaving} className="h-8 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
                {addExpenseSaving ? "Saving..." : "Save"}
              </button>
              <button type="button" onClick={() => setAddExpenseOpen(false)} className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant text-xs font-semibold">Cancel</button>
            </div>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto border border-outline-variant rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-container sticky top-0 border-b border-outline-variant">
              <tr>
                <th className="p-2.5 font-bold">Date</th>
                <th className="p-2.5 font-bold">Category</th>
                <th className="p-2.5 font-bold">Description</th>
                <th className="p-2.5 font-bold text-right">Amount</th>
                <th className="p-2.5 font-bold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {expenses.length === 0 ? (
                <tr><td colSpan={5} className="p-4 text-center text-on-surface-variant text-xs">No Other Expenses recorded in this period.</td></tr>
              ) : (
                expenses.map((e) =>
                  editingExpenseId === e.id ? (
                    <tr key={e.id} className="bg-secondary/5">
                      <td className="p-2" colSpan={5}>
                        {editExpenseError && <p className="text-[11px] text-error font-semibold mb-1">{editExpenseError}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <input type="date" value={editExpenseDate} max={todayStr()} onChange={(ev) => setEditExpenseDate(ev.target.value)} className="h-8 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs" />
                          <input type="text" value={editExpenseDescription} onChange={(ev) => setEditExpenseDescription(ev.target.value)} className="h-8 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs flex-1 min-w-[120px]" />
                          <input type="number" min={0.01} step="any" value={editExpenseAmount} onChange={(ev) => setEditExpenseAmount(ev.target.value)} className="h-8 w-28 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs" />
                          <button type="button" onClick={saveEditExpense} disabled={editExpenseSaving} className="h-8 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
                            {editExpenseSaving ? "Saving..." : "Save"}
                          </button>
                          <button type="button" onClick={() => setEditingExpenseId("")} className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant text-xs font-semibold">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ) : voidingExpenseId === e.id ? (
                    <tr key={e.id} className="bg-error-container/5">
                      <td className="p-2" colSpan={5}>
                        {voidExpenseError && <p className="text-[11px] text-error font-semibold mb-1">{voidExpenseError}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold text-on-surface">Void this expense (kept for history, excluded from totals). Reason:</span>
                          <input type="text" value={voidExpenseReason} onChange={(ev) => setVoidExpenseReason(ev.target.value)} placeholder="Reason" className="h-8 px-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs flex-1 min-w-[160px]" />
                          <button type="button" onClick={() => confirmVoidExpense(e.id)} disabled={voidExpenseSaving} className="h-8 px-3 rounded-lg bg-error text-on-error text-xs font-semibold hover:bg-error/90 disabled:opacity-50">
                            {voidExpenseSaving ? "Voiding..." : "Confirm Void"}
                          </button>
                          <button type="button" onClick={() => { setVoidingExpenseId(""); setVoidExpenseReason(""); setVoidExpenseError(""); }} className="h-8 px-3 rounded-lg bg-surface-container text-on-surface-variant text-xs font-semibold">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} className={`hover:bg-surface-container/30 ${e.voided ? "opacity-60" : ""}`}>
                      <td className="p-2.5 font-mono text-on-surface-variant">{e.date}</td>
                      <td className="p-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-700">{e.category}</span>
                        {e.voided && (
                          <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface-variant">VOIDED</span>
                        )}
                      </td>
                      <td className={`p-2.5 font-medium ${e.voided ? "line-through" : ""}`}>
                        {e.description}
                        {e.voided && e.voidReason && <span className="block text-[10px] text-on-surface-variant font-normal">Reason: {e.voidReason}</span>}
                      </td>
                      <td className={`p-2.5 text-right font-mono font-bold text-rose-700 ${e.voided ? "line-through" : ""}`}>Rs. {e.amount.toLocaleString()}</td>
                      <td className="p-2.5 text-right whitespace-nowrap">
                        {!e.voided && (
                          <>
                            <button type="button" onClick={() => startEditExpense(e)} className="text-secondary text-[11px] font-semibold hover:underline mr-2">Edit</button>
                            <button type="button" onClick={() => { setVoidingExpenseId(e.id); setVoidExpenseReason(""); setVoidExpenseError(""); }} className="text-error text-[11px] font-semibold hover:underline">Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                )
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
