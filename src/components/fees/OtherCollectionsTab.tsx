"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import InlineAlert from "@/components/fees/InlineAlert";
import Pagination, { PAGE_SIZE } from "@/components/fees/Pagination";

const CATEGORIES = ["REGISTRATION", "CERTIFICATE", "FINE", "EVENT", "OTHER"];

export default function OtherCollectionsTab() {
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ totalAmount: 0, byCategory: {}, count: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], category: "REGISTRATION", description: "", amount: "", paymentMethod: "CASH", reference: "" });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (category !== "ALL") params.append("category", category);
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      const res = await fetch(`/api/other-collections?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setRecords(json.records);
        setStats(json.stats);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, dateFrom, dateTo]);

  const submitAdd = async () => {
    if (!form.description.trim() || !form.amount) return;
    setSaving(true);
    setAddError("");
    try {
      const res = await fetch("/api/other-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json();
      if (res.ok) {
        setAddOpen(false);
        setForm({ date: new Date().toISOString().split("T")[0], category: "REGISTRATION", description: "", amount: "", paymentMethod: "CASH", reference: "" });
        fetchRecords();
      } else {
        setAddError(json.error || "Failed to record collection.");
      }
    } catch {
      setAddError("Failed to record collection.");
    } finally {
      setSaving(false);
    }
  };

  const submitReverse = async () => {
    if (!reversingId || !reverseReason.trim()) return;
    setReversing(true);
    setReverseError("");
    try {
      const res = await fetch(`/api/other-collections/${reversingId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reverseReason }),
      });
      const json = await res.json();
      if (res.ok) {
        setReversingId(null);
        setReverseReason("");
        fetchRecords();
      } else {
        setReverseError(json.error || "Failed to reverse record.");
      }
    } catch {
      setReverseError("Failed to reverse record.");
    } finally {
      setReversing(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-xl font-bold text-on-surface">Other Collections</h2>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Non-tuition school income — registration, certificates, fines, events. Counted in total income, never as a student fee payment.
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs self-start sm:self-auto">
          + Record Collection
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="col-span-2 p-3 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 text-center">
          <div className="text-xl font-bold text-on-tertiary-container">{formatCurrency(stats.totalAmount)}</div>
          <div className="text-[10px] text-on-surface-variant">Total Collections ({stats.count})</div>
        </div>
        {CATEGORIES.map((c) => (
          <div key={c} className="p-3 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 text-center">
            <div className="text-sm font-bold text-on-surface">{formatCurrency(stats.byCategory?.[c] || 0)}</div>
            <div className="text-[10px] text-on-surface-variant">{c}</div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center gap-3">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description / reference..." className="flex-1 h-9 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium border border-outline-variant/40">
          <option value="ALL">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs border border-outline-variant/40" />
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <p className="text-xs text-on-surface-variant p-8">Loading...</p>
        ) : records.length === 0 ? (
          <p className="text-xs text-on-surface-variant p-8 text-center">No collections recorded for these filters.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase">
                <th className="py-2 px-4">Date</th>
                <th className="py-2 px-4">Category</th>
                <th className="py-2 px-4">Description</th>
                <th className="py-2 px-4">Amount</th>
                <th className="py-2 px-4">Reference</th>
                <th className="py-2 px-4">By</th>
                <th className="py-2 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
                <tr key={r.id} className={r.reversed ? "opacity-50" : ""}>
                  <td className="py-2 px-4">{formatDate(r.date)}</td>
                  <td className="py-2 px-4">{r.category}</td>
                  <td className="py-2 px-4">{r.description}</td>
                  <td className="py-2 px-4 font-bold">{formatCurrency(r.amount)}</td>
                  <td className="py-2 px-4 font-mono text-[11px]">{r.reference || "—"}</td>
                  <td className="py-2 px-4 text-[11px] text-on-surface-variant">{r.createdByEmail}</td>
                  <td className="py-2 px-4 text-right">
                    {r.reversed ? (
                      <span className="text-[10px] text-error font-semibold">Reversed</span>
                    ) : (
                      <button onClick={() => setReversingId(r.id)} className="text-error font-semibold text-[11px]">Reverse</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} totalItems={records.length} onPageChange={setPage} />
      </div>

      {addOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2">Record Other Collection</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40" />
              </div>
              <div>
                <label className="block font-semibold mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-semibold mb-1">Description *</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40" />
              </div>
              <div>
                <label className="block font-semibold mb-1">Amount *</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40" />
              </div>
              <div>
                <label className="block font-semibold mb-1">Payment Method</label>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40">
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="ONLINE">Online</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-semibold mb-1">Reference</label>
                <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40" />
              </div>
            </div>
            <InlineAlert type="error" message={addError} />
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button onClick={() => { setAddOpen(false); setAddError(""); }} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">Cancel</button>
              <button onClick={submitAdd} disabled={saving || !form.description.trim() || !form.amount} className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reversingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-sm w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Reverse Collection</h3>
            <p className="text-xs text-on-surface-variant">The original record stays in history, marked reversed and excluded from totals.</p>
            <input type="text" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="Reason *" className="w-full h-8 px-3 rounded bg-surface-container-low border border-outline-variant/40 text-xs" />
            <InlineAlert type="error" message={reverseError} />
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button onClick={() => { setReversingId(null); setReverseReason(""); setReverseError(""); }} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">Cancel</button>
              <button onClick={submitReverse} disabled={reversing || !reverseReason.trim()} className="px-4 py-1.5 rounded bg-error text-on-error-container font-semibold text-xs disabled:opacity-50">
                {reversing ? "Reversing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
