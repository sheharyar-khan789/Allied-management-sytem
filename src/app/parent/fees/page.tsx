"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ChildSelector, useParentChild } from "@/components/parent/use-parent-child";

function ParentFeesInner() {
  const { children, selectedId, payload, loading, error, selectChild } = useParentChild();
  const stats = payload?.fees?.stats || { expected: 0, paid: 0, outstanding: 0 };
  const challans = payload?.fees?.challans || [];
  const payments = payload?.fees?.payments || [];

  if (loading && !payload) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading fees...</p>
      </div>
    );
  }

  if (!selectedId && children.length > 1) {
    return (
      <div className="p-8 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 text-center">
        <p className="text-sm font-semibold mb-3">Select a linked child to view fees.</p>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Fee challans</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            View-only ledger for {payload?.student?.fullName || "the selected child"}. Online payment is not available in this phase.
          </p>
        </div>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>

      {error && !payload ? (
        <div className="p-6 rounded-xl bg-error-container/20 text-error text-sm">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Total amount</span>
              <div className="text-2xl font-bold mt-1">{formatCurrency(stats.expected)}</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Paid</span>
              <div className="text-2xl font-bold text-on-tertiary-container mt-1">{formatCurrency(stats.paid)}</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Outstanding</span>
              <div className="text-2xl font-bold text-error mt-1">{formatCurrency(stats.outstanding)}</div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="p-4 border-b border-surface-container-low">
              <h3 className="font-headline-md text-sm font-bold">Issued challans</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-surface-container-low uppercase text-[11px] font-bold text-on-surface-variant">
                    <th className="py-3 px-4">Challan</th>
                    <th className="py-3 px-4">Period</th>
                    <th className="py-3 px-4">Due</th>
                    <th className="py-3 px-4">Total</th>
                    <th className="py-3 px-4">Paid</th>
                    <th className="py-3 px-4">Outstanding</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {challans.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-on-surface-variant italic">
                        No fee challans have been issued for this child.
                      </td>
                    </tr>
                  )}
                  {challans.map((ch: any) => (
                    <tr key={ch.id}>
                      <td className="py-3 px-4 font-mono font-bold">{ch.challanNo}</td>
                      <td className="py-3 px-4">{ch.month} {ch.year}</td>
                      <td className="py-3 px-4">{formatDate(ch.dueDate)}</td>
                      <td className="py-3 px-4">{formatCurrency(ch.totalExpected)}</td>
                      <td className="py-3 px-4">{formatCurrency(ch.paidAmount)}</td>
                      <td className="py-3 px-4">{formatCurrency(ch.outstanding)}</td>
                      <td className="py-3 px-4">{ch.status}</td>
                      <td className="py-3 px-4 text-right">
                        <Link href={`/print/challan/${ch.id}`} className="text-secondary font-semibold">
                          Print
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="p-4 border-b border-surface-container-low">
              <h3 className="font-headline-md text-sm font-bold">Payment history</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-surface-container-low uppercase text-[11px] font-bold text-on-surface-variant">
                    <th className="py-3 px-4">Receipt</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Mode</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-on-surface-variant italic">
                        No payments recorded.
                      </td>
                    </tr>
                  )}
                  {payments.map((p: any) => (
                    <tr key={p.id}>
                      <td className="py-3 px-4 font-mono">{p.receiptNo}</td>
                      <td className="py-3 px-4">{formatDate(p.paymentDate)}</td>
                      <td className="py-3 px-4">{p.paymentMode}</td>
                      <td className="py-3 px-4 font-bold">{formatCurrency(p.amount)}</td>
                      <td className="py-3 px-4 text-on-surface-variant">{p.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ParentFeesPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-xs text-on-surface-variant">Loading...</div>}>
      <ParentFeesInner />
    </Suspense>
  );
}
