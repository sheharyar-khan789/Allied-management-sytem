"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface VoucherRow {
  id: string;
  receiptNo: string;
  studentName: string;
  admissionNo: string;
  className: string;
  challanNo: string;
  feeMonth: string;
  feeYear: number | null;
  amount: number;
  paymentDate: string;
  paymentMode: string;
  transactionRef: string;
  notes: string;
  createdAt: string;
  lastEditedAt: string | null;
  voucherStatus: "ACTIVE" | "REVERSED";
  locked: boolean;
}

interface DaySummary {
  date: string;
  grossCount: number;
  grossAmount: number;
  validCount: number;
  reversedCount: number;
  lockedCount: number;
  adjustmentCount: number;
  adjustmentAmount: number;
  netAmount: number;
}

const todayStr = () => new Date().toISOString().split("T")[0];

export default function VoucherManagementPage() {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 400);

  const [days, setDays] = useState<DaySummary[]>([]);
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState<VoucherRow | null>(null);
  const [adjusting, setAdjusting] = useState<VoucherRow | null>(null);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchRegister = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/vouchers?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load the voucher register.");
      setDays(data.days || []);
      setVouchers(data.vouchers || []);
    } catch (err: any) {
      setError(err.message || "Failed to load the voucher register.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRegister();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, debouncedSearch]);

  const totals = days.reduce(
    (acc, d) => ({
      grossCount: acc.grossCount + d.grossCount,
      grossAmount: acc.grossAmount + d.grossAmount,
      reversedCount: acc.reversedCount + d.reversedCount,
      lockedCount: acc.lockedCount + d.lockedCount,
      adjustmentAmount: acc.adjustmentAmount + d.adjustmentAmount,
      netAmount: acc.netAmount + d.netAmount,
    }),
    { grossCount: 0, grossAmount: 0, reversedCount: 0, lockedCount: 0, adjustmentAmount: 0, netAmount: 0 }
  );

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Voucher Management</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Daily Register
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Every fee payment collected is a voucher here. Edit within 24 hours of entry; after
            that, use a reversal or adjustment — the original record is never rewritten.
          </p>
        </div>
        <Link
          href="/admin/fees"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs font-semibold shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Back to Fees</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
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
        <button
          type="button"
          onClick={() => {
            setFrom(todayStr());
            setTo(todayStr());
          }}
          className="h-9 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
        >
          Today
        </button>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">
            Search student / admission no. / receipt
          </label>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. STD-2026-012"
            className="h-9 w-full px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/20 border border-error/30 text-error text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Vouchers Received", value: String(totals.grossCount), icon: "receipt_long" },
          { label: "Total Amount", value: formatCurrency(totals.grossAmount), icon: "payments" },
          { label: "Reversed", value: String(totals.reversedCount), icon: "undo" },
          { label: "Adjustments", value: formatCurrency(totals.adjustmentAmount), icon: "tune" },
          { label: "Net Collected", value: formatCurrency(totals.netAmount), icon: "account_balance" },
          { label: "Locked Vouchers", value: String(totals.lockedCount), icon: "lock" },
        ].map((card) => (
          <div key={card.label} className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
            <div className="flex items-center gap-1.5 text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px]">{card.icon}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide">{card.label}</span>
            </div>
            <div className="mt-1 font-headline-md text-lg font-bold text-on-surface">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Per-day breakdown, when the range spans more than one day */}
      {days.length > 1 && (
        <div className="overflow-x-auto bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase">
                <th className="py-2 px-3 text-left">Date</th>
                <th className="py-2 px-3 text-right">Received</th>
                <th className="py-2 px-3 text-right">Amount</th>
                <th className="py-2 px-3 text-right">Reversed</th>
                <th className="py-2 px-3 text-right">Net</th>
                <th className="py-2 px-3 text-right">Locked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {days.map((d) => (
                <tr key={d.date}>
                  <td className="py-2 px-3 font-semibold text-on-surface">{formatDate(d.date)}</td>
                  <td className="py-2 px-3 text-right">{d.grossCount}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatCurrency(d.grossAmount)}</td>
                  <td className="py-2 px-3 text-right">{d.reversedCount}</td>
                  <td className="py-2 px-3 text-right font-mono font-semibold">{formatCurrency(d.netAmount)}</td>
                  <td className="py-2 px-3 text-right">{d.lockedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Voucher list */}
      <div className="overflow-x-auto bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase">
              <th className="py-2.5 px-3 text-left">Receipt</th>
              <th className="py-2.5 px-3 text-left">Student</th>
              <th className="py-2.5 px-3 text-left">Class</th>
              <th className="py-2.5 px-3 text-left">Fee Period</th>
              <th className="py-2.5 px-3 text-left">Date</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3 text-left">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-on-surface-variant">
                  Loading…
                </td>
              </tr>
            ) : vouchers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-on-surface-variant">
                  No vouchers in this range.
                </td>
              </tr>
            ) : (
              vouchers.map((v) => (
                <tr key={v.id} className={v.voucherStatus === "REVERSED" ? "opacity-60" : ""}>
                  <td className="py-2.5 px-3 font-mono text-on-surface">{v.receiptNo}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-on-surface">{v.studentName}</div>
                    <div className="text-[10px] text-on-surface-variant font-mono">{v.admissionNo}</div>
                  </td>
                  <td className="py-2.5 px-3 text-on-surface-variant">{v.className}</td>
                  <td className="py-2.5 px-3 text-on-surface-variant">
                    {v.feeMonth} {v.feeYear || ""}
                  </td>
                  <td className="py-2.5 px-3 text-on-surface-variant">{formatDate(v.paymentDate)}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-on-surface">{formatCurrency(v.amount)}</td>
                  <td className="py-2.5 px-3">
                    {v.voucherStatus === "REVERSED" ? (
                      <span className="px-2 py-0.5 rounded-full bg-error-container/30 text-error text-[10px] font-bold">
                        Reversed
                      </span>
                    ) : v.locked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold">
                        <span className="material-symbols-outlined text-[12px]">lock</span>
                        Locked
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-tertiary-container/20 text-on-tertiary-container text-[10px] font-bold">
                        Editable
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {v.voucherStatus !== "REVERSED" && !v.locked && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError("");
                            setEditing(v);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-[11px] font-semibold"
                        >
                          Edit
                        </button>
                      )}
                      {v.voucherStatus !== "REVERSED" && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError("");
                            setAdjusting(v);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-error-container/20 hover:bg-error-container/30 text-error text-[11px] font-semibold"
                        >
                          Reverse / Adjust
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditVoucherModal
          voucher={editing}
          saving={saving}
          error={actionError}
          onClose={() => setEditing(null)}
          onSave={async (updates) => {
            setSaving(true);
            setActionError("");
            try {
              const res = await fetch(`/api/vouchers/${editing.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || "Failed to update the voucher.");
              setEditing(null);
              await fetchRegister();
            } catch (err: any) {
              setActionError(err.message || "Failed to update the voucher.");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {adjusting && (
        <AdjustVoucherModal
          voucher={adjusting}
          saving={saving}
          error={actionError}
          onClose={() => setAdjusting(null)}
          onSave={async (input) => {
            setSaving(true);
            setActionError("");
            try {
              const res = await fetch(`/api/vouchers/${adjusting.id}/adjust`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || "Failed to record the adjustment.");
              setAdjusting(null);
              await fetchRegister();
            } catch (err: any) {
              setActionError(err.message || "Failed to record the adjustment.");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}

function EditVoucherModal({
  voucher,
  saving,
  error,
  onClose,
  onSave,
}: {
  voucher: VoucherRow;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (updates: { amount: number; paymentDate: string; paymentMode: string; transactionRef: string; notes: string }) => void;
}) {
  const [amount, setAmount] = useState(String(voucher.amount));
  const [paymentDate, setPaymentDate] = useState(voucher.paymentDate);
  const [paymentMode, setPaymentMode] = useState(voucher.paymentMode);
  const [transactionRef, setTransactionRef] = useState(voucher.transactionRef);
  const [notes, setNotes] = useState(voucher.notes);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="font-headline-md text-sm font-bold text-on-surface">Edit Voucher {voucher.receiptNo}</h2>
        <p className="text-[11px] text-on-surface-variant">
          Only available within 24 hours of entry. This updates the same record — it does not
          create a new voucher.
        </p>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-on-surface-variant mb-1">Amount (Rs.)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            />
          </div>
          <div>
            <label className="block text-on-surface-variant mb-1">Payment Date</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            />
          </div>
          <div>
            <label className="block text-on-surface-variant mb-1">Payment Mode</label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            >
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="ONLINE">Online</option>
              <option value="CHEQUE">Cheque</option>
            </select>
          </div>
          <div>
            <label className="block text-on-surface-variant mb-1">Reference</label>
            <input
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-on-surface-variant mb-1">Notes</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave({ amount: Number(amount), paymentDate, paymentMode, transactionRef, notes })}
            className="px-4 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustVoucherModal({
  voucher,
  saving,
  error,
  onClose,
  onSave,
}: {
  voucher: VoucherRow;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: { type: "REVERSAL" | "ADJUSTMENT"; amount?: number; reason: string }) => void;
}) {
  const [type, setType] = useState<"REVERSAL" | "ADJUSTMENT">("REVERSAL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h2 className="font-headline-md text-sm font-bold text-on-surface">
          Reverse / Adjust Voucher {voucher.receiptNo}
        </h2>
        <p className="text-[11px] text-on-surface-variant">
          The original voucher ({formatCurrency(voucher.amount)} on {formatDate(voucher.paymentDate)}) is
          never rewritten. This records a separate, auditable correction with your reason attached.
        </p>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="space-y-3 text-xs">
          <div className="flex gap-2">
            {(["REVERSAL", "ADJUSTMENT"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 px-3 py-2 rounded-lg font-semibold text-[11px] border ${
                  type === t
                    ? "bg-secondary text-on-secondary border-secondary"
                    : "bg-surface-container border-surface-container-high text-on-surface-variant"
                }`}
              >
                {t === "REVERSAL" ? "Full Reversal" : "Partial Adjustment"}
              </button>
            ))}
          </div>
          {type === "REVERSAL" ? (
            <p className="text-[11px] text-on-surface-variant">
              This fully cancels the voucher&apos;s net contribution ({formatCurrency(voucher.amount)}). It
              will no longer count toward the collected balance, but stays visible here for audit.
            </p>
          ) : (
            <div>
              <label className="block text-on-surface-variant mb-1">
                Adjustment amount (Rs., use a negative number to reduce)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. -200"
                className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
              />
            </div>
          )}
          <div>
            <label className="block text-on-surface-variant mb-1">Reason (required)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              minLength={5}
              placeholder="Why is this correction being made?"
              className="w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || reason.trim().length < 5 || (type === "ADJUSTMENT" && !Number(amount))}
            onClick={() =>
              onSave({ type, reason, ...(type === "ADJUSTMENT" ? { amount: Number(amount) } : {}) })
            }
            className="px-4 py-1.5 rounded-lg bg-error text-on-error text-xs font-semibold disabled:opacity-60"
          >
            {saving ? "Saving..." : type === "REVERSAL" ? "Confirm Reversal" : "Confirm Adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
