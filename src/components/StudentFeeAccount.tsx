"use client";

import React, { useEffect, useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { todayLocalISO } from "@/lib/date-utils";

const CHARGE_TYPES = [
  { value: "EVENT", label: "Event Fee" },
  { value: "TRIP", label: "Trip Fee" },
  { value: "SPORTS", label: "Sports Fee" },
  { value: "EXAM", label: "Exam Fee" },
  { value: "ACTIVITY", label: "Activity Fee" },
  { value: "OTHER", label: "Other Charges" },
];
const chargeLabel = (type: string) => CHARGE_TYPES.find((t) => t.value === type)?.label || type;

const EMPTY_CHARGE = { id: "", type: "EVENT", description: "", amount: "", date: "", status: "UNPAID", notes: "" };

interface ClassOption {
  id: string;
  name: string;
  section: string;
}

/**
 * Admin view of one student's fees: fee structure (monthly + annual), the 12-month paid status
 * for a calendar year, the annual fee's paid status, and additional / event payments. Every
 * value shown is what the server returned after its last write — nothing is kept only locally.
 */
export default function StudentFeeAccount({ classes, initialStudentId }: { classes: ClassOption[]; initialStudentId?: string }) {
  const thisYear = new Date().getFullYear();
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [studentId, setStudentId] = useState(initialStudentId || "");
  const [year, setYear] = useState(thisYear);
  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feeForm, setFeeForm] = useState({ monthlyFee: "", annualFee: "" });
  const [chargeForm, setChargeForm] = useState(EMPTY_CHARGE);
  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [chargeError, setChargeError] = useState("");

  // The account on screen must always be the selected student's: responses for a student/year
  // that is no longer selected are dropped instead of overwriting the current one.
  const selectionRef = useRef("");
  selectionRef.current = `${studentId}|${year}`;

  const applyAccount = (json: any) => {
    setAccount(json);
    setFeeForm({ monthlyFee: String(json.student.monthlyFee ?? 0), annualFee: String(json.student.annualFee ?? 0) });
  };

  const loadAccount = async () => {
    if (!studentId) return;
    const key = `${studentId}|${year}`;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/fees/student-account?studentId=${encodeURIComponent(studentId)}&year=${year}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (selectionRef.current !== key) return;
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load the fee account.");
      applyAccount(json);
      if (!classId && json.student?.classId) setClassId(json.student.classId);
    } catch (err: any) {
      if (selectionRef.current === key) {
        setAccount(null);
        setError(err?.message || "Failed to load the fee account.");
      }
    } finally {
      if (selectionRef.current === key) setLoading(false);
    }
  };

  useEffect(() => {
    setAccount(null);
    setNotice("");
    loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, year]);

  useEffect(() => {
    if (!classId) {
      setStudents([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/students?classId=${encodeURIComponent(classId)}&limit=250`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setStudents(j.success && Array.isArray(j.students) ? j.students : []);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const toggleMonth = async (month: string, paid: boolean) => {
    const key = `${studentId}|${year}`;
    setSavingKey(month);
    setError("");
    try {
      const res = await fetch("/api/fees/student-account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, year, month, paid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save.");
      if (selectionRef.current === key) applyAccount(json);
    } catch (err: any) {
      setError(err?.message || "Failed to save the month's status.");
    } finally {
      setSavingKey(null);
    }
  };

  const toggleAnnual = async (paid: boolean) => {
    const key = `${studentId}|${year}`;
    setSavingKey("annual");
    setError("");
    try {
      const res = await fetch("/api/fees/student-account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, year, annualFeePaid: paid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save.");
      if (selectionRef.current === key) applyAccount(json);
    } catch (err: any) {
      setError(err?.message || "Failed to save the annual fee status.");
    } finally {
      setSavingKey(null);
    }
  };

  const saveFeeStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey("structure");
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(studentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyFee: feeForm.monthlyFee === "" ? 0 : Number(feeForm.monthlyFee),
          annualFee: feeForm.annualFee === "" ? 0 : Number(feeForm.annualFee),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save the fee structure.");
      setNotice("Fee structure saved.");
      await loadAccount();
    } catch (err: any) {
      setError(err?.message || "Failed to save the fee structure.");
    } finally {
      setSavingKey(null);
    }
  };

  const openCharge = (charge?: any) => {
    setChargeForm(
      charge
        ? {
            id: charge.id,
            type: charge.type,
            description: charge.description,
            amount: String(charge.amount),
            date: charge.date,
            status: charge.status,
            notes: charge.notes || "",
          }
        : { ...EMPTY_CHARGE, date: todayLocalISO() }
    );
    setChargeError("");
    setChargeModalOpen(true);
  };

  const saveCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey("charge");
    setChargeError("");
    try {
      const { id, ...fields } = chargeForm;
      const res = await fetch("/api/fees/charges", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id, ...fields, amount: Number(fields.amount) } : { studentId, ...fields, amount: Number(fields.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save the payment.");
      setChargeModalOpen(false);
      await loadAccount();
    } catch (err: any) {
      setChargeError(err?.message || "Failed to save the payment.");
    } finally {
      setSavingKey(null);
    }
  };

  const inputClass = "w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40";
  const selectClass = "h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40";
  const charges: any[] = account?.charges || [];

  return (
    <div className="flex flex-col gap-4">
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="fee-acct-class" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Class</label>
          <select id="fee-acct-class" value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(""); }} className={selectClass}>
            <option value="">Select class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}-{c.section}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label htmlFor="fee-acct-student" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Student</label>
          <select id="fee-acct-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={`${selectClass} w-full`} disabled={!classId && !studentId}>
            <option value="">{classId ? "Select student" : "Select a class first"}</option>
            {studentId && !students.some((s) => s.id === studentId) && account?.student && (
              <option value={studentId}>{account.student.fullName} ({account.student.admissionNo})</option>
            )}
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber})</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fee-acct-year" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Year</label>
          <select id="fee-acct-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectClass}>
            {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="p-3 rounded-lg bg-tertiary-container/10 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{notice}</span>
        </div>
      )}

      {!studentId ? (
        <div className="p-10 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-xs text-on-surface-variant">
          Select a class and student to view and update their fees.
        </div>
      ) : loading && !account ? (
        <div className="p-10 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading fee account...</p>
        </div>
      ) : account ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <form onSubmit={saveFeeStructure} className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3 text-xs">
              <div>
                <h3 className="font-bold text-sm text-on-surface">{account.student.fullName}</h3>
                <p className="text-[11px] text-on-surface-variant font-mono">{account.student.admissionNo} • {account.student.className}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fee-acct-monthly" className="block font-semibold text-on-surface mb-1">Monthly Fee (PKR)</label>
                  <input id="fee-acct-monthly" type="number" min={0} step="any" value={feeForm.monthlyFee} onChange={(e) => setFeeForm({ ...feeForm, monthlyFee: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="fee-acct-annual" className="block font-semibold text-on-surface mb-1">Annual Fee (PKR)</label>
                  <input id="fee-acct-annual" type="number" min={0} step="any" value={feeForm.annualFee} onChange={(e) => setFeeForm({ ...feeForm, annualFee: e.target.value })} className={inputClass} />
                </div>
              </div>
              <button type="submit" disabled={savingKey === "structure"} className="px-3 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
                {savingKey === "structure" ? "Saving..." : "Save Fee Structure"}
              </button>
            </form>

            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-2 text-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Annual Fee {year}</span>
              <div className="text-xl font-bold text-on-surface">{formatCurrency(account.annualFee.amount)}</div>
              <label className="flex items-center gap-2 font-semibold text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={account.annualFee.paid}
                  disabled={savingKey === "annual"}
                  onChange={(e) => toggleAnnual(e.target.checked)}
                  className="w-4 h-4"
                />
                {account.annualFee.paid ? "Paid" : "Unpaid"}
                {account.annualFee.paidAt && <span className="text-[10px] text-on-surface-variant font-normal">on {formatDate(account.annualFee.paidAt)}</span>}
              </label>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-1 text-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Monthly Fees {year}</span>
              <div className="text-xl font-bold text-on-surface">{account.paidMonths} / 12 paid</div>
              <p className="text-on-surface-variant">
                Monthly fee {formatCurrency(account.student.monthlyFee)} • Outstanding months: {12 - account.paidMonths}
              </p>
            </div>
          </div>

          <section className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Monthly Payment Status — {year}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {account.months.map((m: any) => (
                <label
                  key={m.month}
                  className={`p-3 rounded-lg border flex items-start gap-2 cursor-pointer text-xs transition-colors ${
                    m.paid ? "bg-tertiary-container/10 border-on-tertiary-container/30" : "bg-surface-container-low border-outline-variant/30"
                  } ${savingKey === m.month ? "opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={m.paid}
                    disabled={savingKey !== null}
                    onChange={(e) => toggleMonth(m.month, e.target.checked)}
                    className="mt-0.5 w-4 h-4"
                    aria-label={`${m.month} ${year} paid`}
                  />
                  <span className="flex flex-col">
                    <span className="font-bold text-on-surface">{m.month}</span>
                    <span className={m.paid ? "text-on-tertiary-container font-semibold" : "text-error font-semibold"}>
                      {savingKey === m.month ? "Saving..." : m.paid ? "Paid" : "Unpaid"}
                    </span>
                    {m.source === "CHALLAN" && <span className="text-[10px] text-on-surface-variant">via paid challan</span>}
                    {m.challans.length > 0 && m.source !== "CHALLAN" && (
                      <span className="text-[10px] text-on-surface-variant">Challan: {m.challans.map((c: any) => c.status).join(", ")}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="p-4 border-b border-surface-container-low flex items-center justify-between gap-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Additional / Event Payments</h3>
              <button type="button" onClick={() => openCharge()} className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold flex items-center gap-1 hover:bg-secondary/90">
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add Payment
              </button>
            </div>
            {charges.length === 0 ? (
              <p className="p-6 text-center text-xs text-on-surface-variant">No additional payments recorded for this student.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                      <th className="py-2.5 px-4">Type</th>
                      <th className="py-2.5 px-4">Description</th>
                      <th className="py-2.5 px-4">Amount</th>
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Notes</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container-low">
                    {charges.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5 px-4 font-semibold">{chargeLabel(c.type)}</td>
                        <td className="py-2.5 px-4">{c.description}</td>
                        <td className="py-2.5 px-4 font-semibold">{formatCurrency(c.amount)}</td>
                        <td className="py-2.5 px-4 text-on-surface-variant">{formatDate(c.date)}</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${c.status === "PAID" ? "bg-tertiary-container/10 text-on-tertiary-container" : "bg-error-container text-on-error-container"}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-on-surface-variant">{c.notes || "—"}</td>
                        <td className="py-2.5 px-4 text-right">
                          <button type="button" onClick={() => openCharge(c)} className="text-secondary font-semibold" aria-label={`Edit ${c.description}`}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {chargeModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" aria-labelledby="charge-heading" className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="charge-heading" className="font-headline-md text-sm font-bold text-on-surface">{chargeForm.id ? "Edit Payment" : "Add Payment"}</h3>
              <button type="button" onClick={() => setChargeModalOpen(false)} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            {chargeError && (
              <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs">{chargeError}</div>
            )}
            <form onSubmit={saveCharge} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="charge-type" className="block font-semibold text-on-surface mb-1">Payment Type *</label>
                  <select id="charge-type" value={chargeForm.type} onChange={(e) => setChargeForm({ ...chargeForm, type: e.target.value })} className={inputClass}>
                    {CHARGE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="charge-status" className="block font-semibold text-on-surface mb-1">Status *</label>
                  <select id="charge-status" value={chargeForm.status} onChange={(e) => setChargeForm({ ...chargeForm, status: e.target.value })} className={inputClass}>
                    <option value="UNPAID">Unpaid</option>
                    <option value="PAID">Paid</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label htmlFor="charge-description" className="block font-semibold text-on-surface mb-1">Description *</label>
                  <input id="charge-description" type="text" required maxLength={200} value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} placeholder="e.g. Sports Event" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="charge-amount" className="block font-semibold text-on-surface mb-1">Amount (PKR) *</label>
                  <input id="charge-amount" type="number" required min={1} step="any" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="charge-date" className="block font-semibold text-on-surface mb-1">Date *</label>
                  <input id="charge-date" type="date" required value={chargeForm.date} onChange={(e) => setChargeForm({ ...chargeForm, date: e.target.value })} className={inputClass} />
                </div>
                <div className="col-span-2">
                  <label htmlFor="charge-notes" className="block font-semibold text-on-surface mb-1">Notes</label>
                  <textarea id="charge-notes" rows={2} maxLength={500} value={chargeForm.notes} onChange={(e) => setChargeForm({ ...chargeForm, notes: e.target.value })} className="w-full p-2 rounded bg-surface-container-low text-on-surface border border-outline-variant/40" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button type="button" onClick={() => setChargeModalOpen(false)} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold">Cancel</button>
                <button type="submit" disabled={savingKey === "charge"} className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
                  {savingKey === "charge" ? "Saving..." : chargeForm.id ? "Save Changes" : "Add Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
