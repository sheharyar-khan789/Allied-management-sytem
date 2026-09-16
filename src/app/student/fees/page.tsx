"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function StudentFeesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/me")
      .then((res) => res.json())
      .then((d) => {
        if (d?.success) setData(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading fee statements...</p>
      </div>
    );
  }

  const student = data?.student;
  const stats = data?.stats?.fees || { expected: 0, paid: 0, outstanding: 0 };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              Fee Challans & Receipts
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Account Ledger
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Download institutional bank challans, view verified payments, and check outstanding balances.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-xs transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          <span>Print Statement</span>
        </button>
      </div>

      {/* Fee summary pills */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Total Expected
          </span>
          <div className="text-2xl font-bold text-on-surface mt-1">{formatCurrency(stats.expected)}</div>
          <span className="text-[10px] text-on-surface-variant">Annual Billing</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Total Paid
          </span>
          <div className="text-2xl font-bold text-on-tertiary-container mt-1">{formatCurrency(stats.paid)}</div>
          <span className="text-[10px] text-on-tertiary-container font-semibold">Verified via Bank</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Outstanding Balance
          </span>
          <div className="text-2xl font-bold text-on-surface mt-1">
            {stats.outstanding > 0 ? (
              <span className="text-error">{formatCurrency(stats.outstanding)}</span>
            ) : (
              <span className="text-on-tertiary-container">Rs. 0 (Nil)</span>
            )}
          </div>
          <span className="text-[10px] text-on-surface-variant">
            {stats.outstanding > 0 ? "Pending payment" : "All payments settled"}
          </span>
        </div>
      </div>

      {/* Challans Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        <div className="p-4 border-b border-surface-container-low">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">Issued Challans & Bank Vouchers</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                <th className="py-3 px-4">Challan #</th>
                <th className="py-3 px-4">Billing Month</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4">Payable Amount</th>
                <th className="py-3 px-4">Paid Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Receipt Voucher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {(!student?.feeChallans || student.feeChallans.length === 0) && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-on-surface-variant italic">
                    No fee challans or payment receipts found.
                  </td>
                </tr>
              )}
              {student?.feeChallans?.map((ch: any) => (
                <tr key={ch.id} className="hover:bg-surface-container-low/40">
                  <td className="py-3 px-4 font-mono font-bold text-on-surface">{ch.challanNumber}</td>
                  <td className="py-3 px-4 font-semibold">{ch.month} {ch.year}</td>
                  <td className="py-3 px-4 text-on-surface-variant">{formatDate(ch.dueDate)}</td>
                  <td className="py-3 px-4 font-semibold">{formatCurrency(ch.totalExpected)}</td>
                  <td className="py-3 px-4 font-bold text-on-tertiary-container">{formatCurrency(ch.paidAmount)}</td>
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
                  <td className="py-3 px-4 text-right">
                    <a href={`/print/challan/${ch.id}`} className="text-secondary font-semibold">
                      Print challan
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
