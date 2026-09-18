"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

export default function PayrollManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState<string>(MONTHS[now.getMonth()]);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Quick mark-paid modal or date selector
  const [paidDateModal, setPaidDateModal] = useState<{
    teacherId: string;
    teacherName: string;
    amount: number;
    date: string;
  } | null>(null);

  const fetchPayroll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("month", selectedMonth);
      params.append("year", selectedYear.toString());
      if (search) params.append("search", search);

      const res = await fetch(`/api/payroll?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedYear, search]);

  useEffect(() => {
    fetchPayroll();
  }, [fetchPayroll]);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleToggleStatus = async (
    teacherId: string,
    currentStatus: "PAID" | "UNPAID",
    amount: number,
    paidDate?: string
  ) => {
    // If currently UNPAID, open date confirmation modal
    if (currentStatus === "UNPAID") {
      const teacher = data?.records?.find((r: any) => r.teacherId === teacherId);
      setPaidDateModal({
        teacherId,
        teacherName: teacher?.teacherName || "Teacher",
        amount: amount || teacher?.baseSalary || 0,
        date: new Date().toISOString().split("T")[0],
      });
      return;
    }

    // If currently PAID, revert to UNPAID
    setTogglingId(teacherId);
    try {
      const res = await fetch("/api/payroll", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          month: selectedMonth,
          year: selectedYear,
          status: "UNPAID",
          amount,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showNotification("success", `Salary for ${selectedMonth} marked as UNPAID.`);
        fetchPayroll();
      } else {
        throw new Error(json.error || "Failed to update payroll status.");
      }
    } catch (err: any) {
      showNotification("error", err.message || "Failed to update payroll.");
    } finally {
      setTogglingId(null);
    }
  };

  const confirmMarkAsPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paidDateModal) return;

    setTogglingId(paidDateModal.teacherId);
    try {
      const res = await fetch("/api/payroll", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId: paidDateModal.teacherId,
          month: selectedMonth,
          year: selectedYear,
          status: "PAID",
          paidDate: paidDateModal.date,
          amount: paidDateModal.amount,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showNotification(
          "success",
          `Salary of Rs. ${Number(paidDateModal.amount).toLocaleString()} for ${paidDateModal.teacherName} marked as PAID on ${paidDateModal.date}.`
        );
        setPaidDateModal(null);
        fetchPayroll();
      } else {
        throw new Error(json.error || "Failed to record payment.");
      }
    } catch (err: any) {
      showNotification("error", err.message || "Failed to record payment.");
    } finally {
      setTogglingId(null);
    }
  };

  const stats = data?.stats || {
    totalTeachers: 0,
    totalPaid: 0,
    totalUnpaid: 0,
    totalSalaryDue: 0,
    totalSalaryPaid: 0,
    totalSalaryPending: 0,
  };

  const records = data?.records || [];

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Faculty Payroll & Salaries
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold font-mono">
              {selectedMonth} {selectedYear}
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Manage teacher monthly salary disbursements, track disbursement dates, and oversee campus payroll obligations.
          </p>
        </div>

        {/* Month & Year Selectors */}
        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          role="status"
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${
            notification.type === "success"
              ? "bg-tertiary-container/15 border-tertiary/30 text-on-tertiary-container"
              : "bg-error-container/20 border-error/30 text-error"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {notification.type === "success" ? "check_circle" : "error"}
          </span>
          <span>{notification.message}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Faculty */}
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Faculty</span>
            <span className="material-symbols-outlined text-secondary text-[20px]">badge</span>
          </div>
          <div className="text-2xl font-black text-on-surface font-headline-lg">
            {stats.totalTeachers}
          </div>
          <p className="text-[11px] text-on-surface-variant">Teaching personnel on roster</p>
        </div>

        {/* Total Paid */}
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] font-bold uppercase tracking-wider">Salaries Paid</span>
            <span className="material-symbols-outlined text-tertiary text-[20px]">check_circle</span>
          </div>
          <div className="text-2xl font-black text-on-tertiary-container font-headline-lg">
            {stats.totalPaid}
          </div>
          <p className="text-[11px] text-on-tertiary-container font-semibold">
            {stats.totalTeachers > 0
              ? `${Math.round((stats.totalPaid / stats.totalTeachers) * 100)}% settled for ${selectedMonth}`
              : "No faculty"}
          </p>
        </div>

        {/* Total Pending */}
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] font-bold uppercase tracking-wider">Pending Payment</span>
            <span className="material-symbols-outlined text-amber-600 text-[20px]">pending</span>
          </div>
          <div className="text-2xl font-black text-amber-800 font-headline-lg">
            {stats.totalUnpaid}
          </div>
          <p className="text-[11px] text-amber-800 font-medium">Awaiting disbursement</p>
        </div>

        {/* Total Salary Due */}
        <div className="p-4 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Payroll Due</span>
            <span className="material-symbols-outlined text-secondary text-[20px]">account_balance_wallet</span>
          </div>
          <div className="text-2xl font-black text-on-surface font-headline-lg">
            {formatCurrency(stats.totalSalaryDue)}
          </div>
          <p className="text-[11px] text-on-surface-variant">
            Disbursed: <span className="font-bold text-on-tertiary-container">{formatCurrency(stats.totalSalaryPaid)}</span>
          </p>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 shadow-sm">
        <div className="relative w-full sm:w-80">
          <span className="material-symbols-outlined absolute left-3 top-2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search by teacher name, ID, or subject..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pl-9 pr-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-on-surface-variant">
          <span className="font-semibold">
            Showing {records.length} record{records.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading payroll records for {selectedMonth} {selectedYear}...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">payments</span>
            <p className="text-sm font-semibold text-on-surface">No faculty payroll records found</p>
            <p className="text-xs text-on-surface-variant">
              Make sure teachers are enrolled in the system under Faculty Management.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Faculty Member</th>
                  <th className="py-3 px-4 font-bold">Employee ID</th>
                  <th className="py-3 px-4 font-bold">Department / Role</th>
                  <th className="py-3 px-4 font-bold">Base Monthly Salary</th>
                  <th className="py-3 px-4 font-bold">Payment Status</th>
                  <th className="py-3 px-4 font-bold">Disbursed Date</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {records.map((r: any) => {
                  const isPaid = r.status === "PAID";
                  const isProcessing = togglingId === r.teacherId;

                  return (
                    <tr key={r.teacherId} className="hover:bg-surface-container-low/40 transition-colors">
                      {/* Name & Photo */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          {r.photoUrl ? (
                            <img
                              src={r.photoUrl}
                              alt={r.teacherName}
                              className="w-8 h-8 rounded-full object-cover border border-surface-container-high shrink-0"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                              {r.teacherName.charAt(0)}
                            </div>
                          )}
                          <div className="flex flex-col min-w-0">
                            <Link
                              href={`/admin/teachers/${r.teacherId}`}
                              className="font-bold text-on-surface hover:text-secondary truncate"
                              title="View Faculty Profile"
                            >
                              {r.teacherName}
                            </Link>
                            <span className="text-[10px] text-on-surface-variant">{r.designation}</span>
                          </div>
                        </div>
                      </td>

                      {/* Employee ID */}
                      <td className="py-3 px-4 font-mono font-semibold text-on-surface">
                        {r.employeeId}
                      </td>

                      {/* Department */}
                      <td className="py-3 px-4 text-on-surface-variant font-medium">
                        {r.department}
                      </td>

                      {/* Base Salary */}
                      <td className="py-3 px-4 font-bold text-on-surface">
                        {r.baseSalary > 0 ? (
                          formatCurrency(r.baseSalary)
                        ) : (
                          <span className="text-amber-800 text-[11px] font-normal">
                            Not set —{" "}
                            <Link
                              href={`/admin/teachers/${r.teacherId}`}
                              className="underline text-secondary font-semibold"
                            >
                              Configure
                            </Link>
                          </span>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isPaid
                              ? "bg-tertiary-container/15 text-on-tertiary-container"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {isPaid ? "PAID" : "UNPAID"}
                        </span>
                      </td>

                      {/* Disbursed Date */}
                      <td className="py-3 px-4 text-on-surface-variant font-mono text-[11px]">
                        {isPaid && r.paidDate ? formatDate(r.paidDate) : "—"}
                      </td>

                      {/* Action Button */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() =>
                            handleToggleStatus(r.teacherId, r.status, r.baseSalary, r.paidDate)
                          }
                          className={`px-3 py-1 rounded text-[11px] font-semibold transition-all disabled:opacity-50 shadow-sm ${
                            isPaid
                              ? "bg-surface-container text-on-surface hover:bg-surface-container-high"
                              : "bg-secondary text-on-secondary hover:bg-secondary/90"
                          }`}
                        >
                          {isProcessing
                            ? "Updating..."
                            : isPaid
                            ? "Mark Unpaid"
                            : "Mark as Paid"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mark As Paid Confirmation Modal */}
      {paidDateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-payroll-payment-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="confirm-payroll-payment-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Record Salary Payment
              </h3>
              <button
                onClick={() => setPaidDateModal(null)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={confirmMarkAsPaid} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-on-surface mb-1">Faculty Member</label>
                <input
                  type="text"
                  disabled
                  value={paidDateModal.teacherName}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface font-semibold"
                />
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">Billing Month & Year</label>
                <input
                  type="text"
                  disabled
                  value={`${selectedMonth} ${selectedYear}`}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">Disbursed Amount (PKR) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="500"
                  value={paidDateModal.amount}
                  onChange={(e) =>
                    setPaidDateModal({ ...paidDateModal, amount: Number(e.target.value) })
                  }
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={paidDateModal.date}
                  onChange={(e) =>
                    setPaidDateModal({ ...paidDateModal, date: e.target.value })
                  }
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setPaidDateModal(null)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={togglingId === paidDateModal.teacherId}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {togglingId === paidDateModal.teacherId ? "Recording..." : "Confirm Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
