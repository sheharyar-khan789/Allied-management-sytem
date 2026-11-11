"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { todayLocalISO } from "@/lib/date-utils";

const COLLECTION_CATEGORIES = [
  { value: "REGISTRATION", label: "Registration Income" },
  { value: "CERTIFICATE", label: "Certificate Charges" },
  { value: "FINE", label: "Fine Collection" },
  { value: "EVENT", label: "Event Collection" },
  { value: "OTHER_INCOME", label: "Other Income" },
];
const EXPENSE_CATEGORIES = [
  { value: "ELECTRICITY", label: "Electricity" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "STATIONERY", label: "Stationery" },
  { value: "STAFF", label: "Staff-related" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "OTHER_EXPENSE", label: "Other Expense" },
];

const categoryLabel = (list: typeof COLLECTION_CATEGORIES, value: string) => list.find((c) => c.value === value)?.label || value;

const EMPTY_FORM = { date: "", category: "", description: "", amount: "", paymentMethod: "", receiptRef: "" };

interface Row {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod?: string;
  receiptRef?: string;
}

function RecordSection({
  title,
  addLabel,
  endpoint,
  categories,
  amountTone,
}: {
  title: string;
  addLabel: string;
  endpoint: string;
  categories: typeof COLLECTION_CATEGORIES;
  amountTone: "income" | "expense";
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load records.");
      const key = endpoint.includes("other-collections") ? "collections" : "expenses";
      setRows(json[key] || []);
      setTotal(json.total || 0);
    } catch (err: any) {
      setError(err?.message || "Failed to load records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openModal = () => {
    setForm({ ...EMPTY_FORM, date: todayLocalISO(), category: categories[0].value });
    setSaveError("");
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save.");
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "w-full h-9 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 text-xs";

  return (
    <section className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
      <div className="p-4 border-b border-surface-container-low flex items-center justify-between gap-2">
        <div>
          <h3 className="font-headline-md text-sm font-bold text-on-surface">{title}</h3>
          <p className={`text-xs font-bold mt-0.5 ${amountTone === "income" ? "text-on-tertiary-container" : "text-error"}`}>
            Total: {formatCurrency(total)}
          </p>
        </div>
        <button type="button" onClick={openModal} className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold flex items-center gap-1 hover:bg-secondary/90">
          <span className="material-symbols-outlined text-[16px]">add</span>
          {addLabel}
        </button>
      </div>

      {error && <div role="alert" className="p-3 text-xs text-error">{error}</div>}

      {loading ? (
        <p className="p-6 text-center text-xs text-on-surface-variant">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-xs text-on-surface-variant">No records yet.</p>
      ) : (
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-surface-container-low">
              <tr className="text-on-surface-variant uppercase text-[11px] font-bold">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Category</th>
                <th className="py-2.5 px-4">Description</th>
                <th className="py-2.5 px-4">Amount</th>
                <th className="py-2.5 px-4">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-4 text-on-surface-variant">{formatDate(r.date)}</td>
                  <td className="py-2.5 px-4 font-semibold">{categoryLabel(categories, r.category)}</td>
                  <td className="py-2.5 px-4">{r.description}</td>
                  <td className="py-2.5 px-4 font-semibold">{formatCurrency(r.amount)}</td>
                  <td className="py-2.5 px-4 text-on-surface-variant">{r.receiptRef || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">{addLabel}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {saveError && <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs">{saveError}</div>}
            <form onSubmit={save} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="orec-date" className="block font-semibold text-on-surface mb-1">Date *</label>
                  <input id="orec-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="orec-category" className="block font-semibold text-on-surface mb-1">Category *</label>
                  <select id="orec-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputClass}>
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label htmlFor="orec-description" className="block font-semibold text-on-surface mb-1">Description *</label>
                  <input id="orec-description" type="text" required maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="orec-amount" className="block font-semibold text-on-surface mb-1">Amount (PKR) *</label>
                  <input id="orec-amount" type="number" required min={1} step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="orec-method" className="block font-semibold text-on-surface mb-1">Payment Method</label>
                  <input id="orec-method" type="text" maxLength={60} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} placeholder="Cash, Bank..." className={inputClass} />
                </div>
                <div className="col-span-2">
                  <label htmlFor="orec-ref" className="block font-semibold text-on-surface mb-1">Receipt / Reference No.</label>
                  <input id="orec-ref" type="text" maxLength={120} value={form.receiptRef} onChange={(e) => setForm({ ...form, receiptRef: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default function OtherFinancialRecords() {
  return (
    <div className="flex flex-col gap-4">
      <RecordSection
        title="Other Collections (School Income)"
        addLabel="Add Collection"
        endpoint="/api/fees/other-collections"
        categories={COLLECTION_CATEGORIES}
        amountTone="income"
      />
      <RecordSection
        title="Other Expenses (Operational)"
        addLabel="Add Expense"
        endpoint="/api/fees/other-expenses"
        categories={EXPENSE_CATEGORIES}
        amountTone="expense"
      />
    </div>
  );
}
