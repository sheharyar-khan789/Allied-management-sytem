"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import FileUpload from "@/components/FileUpload";

export default function FeeManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedClass, setSelectedClass] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("all");

  // Payment modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedChallan, setSelectedChallan] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Bank Deposit");
  const [payReceiptUrl, setPayReceiptUrl] = useState("");
  const [payLoading, setPayLoading] = useState(false);

  const fetchFees = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (selectedClass !== "all") params.append("classId", selectedClass);
      if (selectedStatus !== "all") params.append("status", selectedStatus);
      if (selectedMonth !== "all") params.append("month", selectedMonth);

      const res = await fetch(`/api/fees?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, [search, selectedClass, selectedStatus, selectedMonth]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChallan || !payAmount) return;
    setPayLoading(true);

    try {
      const res = await fetch("/api/fees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challanId: selectedChallan.id,
          amount: Number(payAmount),
          paymentMethod: payMethod,
          receiptUrl: payReceiptUrl || undefined,
        }),
      });

      if (res.ok) {
        setPaymentModalOpen(false);
        setPayReceiptUrl("");
        fetchFees();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPayLoading(false);
    }
  };

  const stats = data?.stats || {
    totalExpected: 0,
    totalCollected: 0,
    totalOutstanding: 0,
    paidCount: 0,
    unpaidCount: 0,
    partialCount: 0,
    totalChallans: 0,
  };

  const challans = data?.challans || [];
  const classes = data?.classes || [];

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Fee Challans & Collection Ledger
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {stats.totalChallans} Records
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Process bank challans, record counter collections, and monitor class-wise receivables.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs font-semibold shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          <span>Print Fee Ledger</span>
        </button>
      </div>

      {/* 3 Metric Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Total Expected
            </span>
            <div className="text-xl sm:text-2xl font-bold text-on-surface mt-0.5">
              {formatCurrency(stats.totalExpected)}
            </div>
            <span className="text-[10px] text-on-surface-variant">Active Challans</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-surface-container text-secondary flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Total Collected
            </span>
            <div className="text-xl sm:text-2xl font-bold text-on-tertiary-container mt-0.5">
              {formatCurrency(stats.totalCollected)}
            </div>
            <span className="text-[10px] text-on-tertiary-container font-semibold">
              {stats.paidCount} Fully Paid • {stats.partialCount} Partial
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-tertiary-container/10 text-on-tertiary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">paid</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Outstanding Dues
            </span>
            <div className="text-xl sm:text-2xl font-bold text-error mt-0.5">
              {formatCurrency(stats.totalOutstanding)}
            </div>
            <span className="text-[10px] text-error font-semibold">{stats.unpaidCount} Pending Challans</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-error-container/40 text-error flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">pending_actions</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-3 no-print">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="search"
            aria-label="Search fee challans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student, admission #, challan #..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container-low font-body-md text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 transition-all border border-transparent focus:border-outline-variant/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40"
          >
            <option value="all">All Classes</option>
            {classes.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}-{c.section}
              </option>
            ))}
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40"
          >
            <option value="all">All Months</option>
            <option value="September">September</option>
            <option value="October">October</option>
            <option value="November">November</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40"
          >
            <option value="all">All Statuses</option>
            <option value="PAID">Paid</option>
            <option value="PARTIAL">Partial</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </div>
      </div>

      {/* Challans Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading fee ledger...</p>
          </div>
        ) : challans.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">receipt_long</span>
            <p className="text-sm font-semibold text-on-surface">No fee records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Challan #</th>
                  <th className="py-3 px-4 font-bold">Student</th>
                  <th className="py-3 px-4 font-bold">Class</th>
                  <th className="py-3 px-4 font-bold">Month / Term</th>
                  <th className="py-3 px-4 font-bold">Due Date</th>
                  <th className="py-3 px-4 font-bold">Expected</th>
                  <th className="py-3 px-4 font-bold">Paid</th>
                  <th className="py-3 px-4 font-bold">Balance</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold text-right no-print">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {challans.map((ch: any) => (
                  <tr key={ch.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-on-surface">{ch.challanNumber}</td>
                    <td className="py-3 px-4 font-bold text-on-surface">
                      <div>{ch.studentName}</div>
                      <span className="text-[10px] text-on-surface-variant font-mono font-normal">
                        {ch.admissionNumber}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-container font-semibold text-on-surface">
                        {ch.className}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium">{ch.month} {ch.year}</td>
                    <td className="py-3 px-4 text-on-surface-variant">{formatDate(ch.dueDate)}</td>
                    <td className="py-3 px-4 font-semibold">{formatCurrency(ch.totalExpected)}</td>
                    <td className="py-3 px-4 font-bold text-on-tertiary-container">{formatCurrency(ch.paidAmount)}</td>
                    <td className="py-3 px-4 font-bold text-error">
                      {ch.balance > 0 ? formatCurrency(ch.balance) : "—"}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ch.status === "PAID"
                            ? "bg-tertiary-container/10 text-on-tertiary-container"
                            : ch.status === "PARTIAL"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {ch.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right no-print whitespace-nowrap space-x-2">
                      {ch.receiptUrl && (
                        <a
                          href={ch.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary font-semibold text-[11px] inline-flex items-center gap-0.5 hover:underline mr-1"
                          title="View Uploaded Receipt / Slip"
                        >
                          <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                          Slip
                        </a>
                      )}
                      <a href={`/print/challan/${ch.id}`} className="text-secondary font-semibold text-[11px]">
                        Print
                      </a>
                      {ch.status !== "PAID" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedChallan(ch);
                            setPayAmount(ch.balance.toString());
                            setPayReceiptUrl(ch.receiptUrl || "");
                            setPaymentModalOpen(true);
                          }}
                          className="px-2.5 py-1 rounded bg-secondary text-on-secondary font-semibold text-[11px] hover:bg-secondary/90 shadow-sm transition-all"
                        >
                          Collect
                        </button>
                      ) : (
                        <span className="text-[10px] text-on-tertiary-container font-semibold">Settled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Recording Modal */}
      {paymentModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-fee-collection-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="record-fee-collection-heading" className="font-headline-md text-sm font-bold text-on-surface">Record Fee Collection</h3>
              <button
                onClick={() => setPaymentModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div>
                <label htmlFor="fees-student-1" className="block font-semibold text-on-surface mb-1">Student</label>
                <input id="fees-student-1"
                  type="text"
                  disabled
                  value={`${selectedChallan?.studentName} (${selectedChallan?.admissionNumber})`}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface font-semibold"
                />
              </div>

              <div>
                <label htmlFor="fees-challan-reference-2" className="block font-semibold text-on-surface mb-1">Challan Reference</label>
                <input id="fees-challan-reference-2"
                  type="text"
                  disabled
                  value={selectedChallan?.challanNumber}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface font-mono"
                />
              </div>

              <div>
                <label htmlFor="fees-amount-to-collect-pkr-3" className="block font-semibold text-on-surface mb-1">Amount to Collect (PKR) *</label>
                <input id="fees-amount-to-collect-pkr-3"
                  type="number"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-bold"
                />
              </div>

              <div>
                <label htmlFor="fees-payment-method-4" className="block font-semibold text-on-surface mb-1">Payment Method</label>
                <select id="fees-payment-method-4"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  <option value="Bank Deposit">Bank Deposit / ABL Challan</option>
                  <option value="Cash Counter">Cash Collection Counter</option>
                  <option value="Online Raast">Online / Raast Transfer</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">Payment Slip / Receipt (Optional)</label>
                <FileUpload
                  folder="fee-receipts"
                  value={payReceiptUrl}
                  onChange={(url) => setPayReceiptUrl(url)}
                  accept="image/*,application/pdf"
                  previewType="file"
                  helperText="Upload paid bank receipt, Raast screenshot, or slip (Max 10MB)"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={payLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {payLoading ? "Processing..." : "Confirm & Issue Receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
