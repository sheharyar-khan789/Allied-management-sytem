"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";
import InlineAlert from "@/components/fees/InlineAlert";

const STRUCTURE_FIELDS = [
  { key: "monthlyTuitionFee", label: "Monthly Tuition Fee" },
  { key: "annualFee", label: "Annual Fee" },
  { key: "admissionFee", label: "Admission Fee" },
  { key: "otherCharges", label: "Other Charges" },
  { key: "discount", label: "Discount / Concession" },
];

const ADJUSTMENT_TYPES = [
  { value: "ADDITIONAL_CHARGE", label: "Additional Charge (increases total)" },
  { value: "CONCESSION", label: "Concession (reduces total)" },
  { value: "PREVIOUS_BALANCE_CORRECTION", label: "Balance Correction (either direction)" },
];

export default function StudentFeeUpdateTab({
  academicYear,
  onAcademicYearChange,
}: {
  academicYear: string;
  onAcademicYearChange: (year: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("all");
  const [matches, setMatches] = useState<any[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [account, setAccount] = useState<any>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);

  const [structureForm, setStructureForm] = useState<any>(null);
  const [savingStructure, setSavingStructure] = useState(false);
  const [structureError, setStructureError] = useState("");

  const [adjustingChallan, setAdjustingChallan] = useState<any>(null);
  const [adjustForm, setAdjustForm] = useState<any>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustError, setAdjustError] = useState("");

  const [reversingPaymentId, setReversingPaymentId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const [expandedChallanId, setExpandedChallanId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/classes")
      .then((r) => r.json())
      .then((d) => setClasses(d?.classes || d || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (search.trim().length < 2) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ search, limit: "10" });
      if (classId !== "all") params.append("classId", classId);
      fetch(`/api/students?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => setMatches(d?.students || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [search, classId]);

  const loadAccount = async (studentId: string) => {
    if (!academicYear) return;
    setSelectedStudentId(studentId);
    setLoadingAccount(true);
    setMatches([]);
    try {
      const res = await fetch(`/api/fees/student-account?studentId=${encodeURIComponent(studentId)}&academicYear=${encodeURIComponent(academicYear)}`);
      const json = await res.json();
      if (json.success) setAccount(json);
    } catch {
      // ignore
    } finally {
      setLoadingAccount(false);
    }
  };

  const openStructureEdit = () => {
    const s = account?.structure;
    setStructureError("");
    setStructureForm({
      monthlyTuitionFee: s?.monthlyTuitionFee || 0,
      annualFee: s?.annualFee || 0,
      admissionFee: s?.admissionFee || 0,
      otherCharges: s?.otherCharges || 0,
      discount: s?.discount || 0,
      reason: "",
      effectiveDate: new Date().toISOString().split("T")[0],
    });
  };

  const saveStructure = async () => {
    if (!structureForm || !structureForm.reason.trim() || !selectedStudentId) return;
    setSavingStructure(true);
    setStructureError("");
    try {
      const res = await fetch("/api/fees/yearly-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: selectedStudentId, academicYear, ...structureForm }),
      });
      const json = await res.json();
      if (res.ok) {
        setStructureForm(null);
        loadAccount(selectedStudentId);
      } else {
        setStructureError(json.error || "Failed to save changes.");
      }
    } catch {
      setStructureError("Failed to save changes.");
    } finally {
      setSavingStructure(false);
    }
  };

  const openAdjust = (challan: any) => {
    setAdjustingChallan(challan);
    setAdjustError("");
    setAdjustForm({ amount: "", adjustmentType: "ADDITIONAL_CHARGE", reason: "", effectiveDate: new Date().toISOString().split("T")[0] });
  };

  const saveAdjustment = async () => {
    if (!adjustingChallan || !adjustForm || !adjustForm.reason.trim() || !adjustForm.amount) return;
    setSavingAdjustment(true);
    setAdjustError("");
    try {
      const res = await fetch(`/api/fees/vouchers/${adjustingChallan.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...adjustForm, amount: Number(adjustForm.amount) }),
      });
      const json = await res.json();
      if (res.ok) {
        setAdjustingChallan(null);
        loadAccount(selectedStudentId);
      } else {
        setAdjustError(json.error || "Failed to apply adjustment.");
      }
    } catch {
      setAdjustError("Failed to apply adjustment.");
    } finally {
      setSavingAdjustment(false);
    }
  };

  const submitReversal = async () => {
    if (!reversingPaymentId || !reverseReason.trim()) return;
    setReversing(true);
    setReverseError("");
    try {
      const res = await fetch(`/api/fees/payments/${reversingPaymentId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reverseReason }),
      });
      const json = await res.json();
      if (res.ok) {
        setReversingPaymentId(null);
        setReverseReason("");
        loadAccount(selectedStudentId);
      } else {
        setReverseError(json.error || "Failed to reverse payment.");
      }
    } catch {
      setReverseError("Failed to reverse payment.");
    } finally {
      setReversing(false);
    }
  };

  const totals = account?.totals || { totalExpected: 0, totalPaid: 0, totalOutstanding: 0 };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline-lg text-xl font-bold text-on-surface">Student Fee Update</h2>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Search a student to view their complete fee account and make authorized adjustments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => onAcademicYearChange(e.target.value)}
            className="h-9 w-32 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40"
          />
        </div>
      </div>

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center gap-3 relative">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by admission # or student name..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container-low text-xs text-on-surface border border-transparent focus:border-outline-variant/50"
          />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-surface-container-lowest border border-surface-container-high rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {matches.map((s: any) => (
                <button key={s.id} onClick={() => loadAccount(s.id)} className="w-full text-left px-3 py-2 text-xs hover:bg-surface-container-low">
                  <div className="font-semibold">{s.fullName}</div>
                  <div className="text-on-surface-variant font-mono text-[10px]">{s.admissionNumber} • {s.className}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40">
          <option value="all">All Classes</option>
          {classes.map((c: any) => (
            <option key={c.id} value={c.id}>{c.displayName || `${c.name}-${c.section}`}</option>
          ))}
        </select>
      </div>

      {loadingAccount && <p className="text-xs text-on-surface-variant">Loading student fee account...</p>}

      {account && !loadingAccount && (
        <>
          <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline-md text-base font-bold text-on-surface">{account.student.fullName}</h3>
                <p className="text-xs text-on-surface-variant font-mono">{account.student.admissionNo} • {account.student.className}{account.student.section ? `-${account.student.section}` : ""}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div className="p-3 rounded-lg bg-surface-container text-center">
                <div className="text-base font-bold text-on-surface">{formatCurrency(totals.totalExpected)}</div>
                <div className="text-[10px] text-on-surface-variant">Total Expected</div>
              </div>
              <div className="p-3 rounded-lg bg-tertiary-container/10 text-center">
                <div className="text-base font-bold text-on-tertiary-container">{formatCurrency(totals.totalPaid)}</div>
                <div className="text-[10px] text-on-tertiary-container">Total Paid</div>
              </div>
              <div className="p-3 rounded-lg bg-error-container text-center">
                <div className="text-base font-bold text-on-error-container">{formatCurrency(totals.totalOutstanding)}</div>
                <div className="text-[10px] text-on-error-container">Outstanding</div>
              </div>
              <div className="p-3 rounded-lg bg-amber-100 text-center">
                <div className="text-base font-bold text-amber-800">{formatCurrency(account.advanceBalance)}</div>
                <div className="text-[10px] text-amber-800">Advance Balance</div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Yearly Fee Structure — {academicYear}</h3>
              <button onClick={openStructureEdit} className="text-secondary font-semibold text-[11px]">Edit Structure</button>
            </div>
            {account.structure ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {STRUCTURE_FIELDS.map((f) => (
                  <div key={f.key} className="p-2 rounded bg-surface-container-low">
                    <div className="text-[10px] text-on-surface-variant">{f.label}</div>
                    <div className="font-bold text-on-surface">{formatCurrency(account.structure[f.key])}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">No yearly fee structure set for {academicYear}. Click Edit Structure to create one.</p>
            )}
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="p-4 border-b border-surface-container-high/40">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Monthly Vouchers</h3>
            </div>
            {account.vouchers.length === 0 ? (
              <p className="text-xs text-on-surface-variant p-4">No vouchers generated yet.</p>
            ) : (
              <div className="divide-y divide-surface-container-low">
                {account.vouchers.map((v: any) => (
                  <div key={v.challan.id} className="p-3">
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold font-mono">{v.challan.challanNo}</span>
                        <span className="ml-2 text-on-surface-variant">{v.challan.month} {v.challan.year}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span>Total: <strong>{formatCurrency(v.challan.totalExpected)}</strong></span>
                        <span>Paid: <strong className="text-on-tertiary-container">{formatCurrency(v.challan.paidAmount)}</strong></span>
                        <span>Balance: <strong className="text-error">{formatCurrency(v.challan.balanceAmount)}</strong></span>
                        <button onClick={() => openAdjust(v.challan)} className="text-secondary font-semibold">Adjust</button>
                        <button onClick={() => setExpandedChallanId(expandedChallanId === v.challan.id ? null : v.challan.id)} className="text-on-surface-variant">
                          {expandedChallanId === v.challan.id ? "Hide payments" : `Payments (${v.payments.length})`}
                        </button>
                      </div>
                    </div>
                    {expandedChallanId === v.challan.id && (
                      <table className="w-full text-left text-[11px] mt-2">
                        <thead>
                          <tr className="text-on-surface-variant border-b border-surface-container-high/40">
                            <th className="py-1">Date</th>
                            <th className="py-1">Receipt</th>
                            <th className="py-1">Amount</th>
                            <th className="py-1">Source</th>
                            <th className="py-1">Notes</th>
                            <th className="py-1 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-container-low">
                          {v.payments.map((p: any) => (
                            <tr key={p.id}>
                              <td className="py-1">{formatDate(p.paymentDate)}</td>
                              <td className="py-1 font-mono">{p.receiptNo}</td>
                              <td className={`py-1 font-semibold ${p.amount < 0 ? "text-error" : ""}`}>{formatCurrency(p.amount)}</td>
                              <td className="py-1">{p.source || "MANUAL"}</td>
                              <td className="py-1 text-on-surface-variant">{p.notes || ""}</td>
                              <td className="py-1 text-right">
                                {p.amount > 0 && !p.reversed ? (
                                  <button onClick={() => setReversingPaymentId(p.id)} className="text-error font-semibold">Reverse</button>
                                ) : p.reversed ? (
                                  <span className="text-on-surface-variant">Reversed</span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="p-4 border-b border-surface-container-high/40">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Adjustment History</h3>
            </div>
            {account.adjustments.length === 0 ? (
              <p className="text-xs text-on-surface-variant p-4">No manual adjustments recorded for this student.</p>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant">
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Previous</th>
                    <th className="py-2 px-3">New</th>
                    <th className="py-2 px-3">Reason</th>
                    <th className="py-2 px-3">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {account.adjustments.map((a: any) => (
                    <tr key={a.id}>
                      <td className="py-1.5 px-3">{formatDate(a.effectiveDate)}</td>
                      <td className="py-1.5 px-3">{a.adjustmentType}</td>
                      <td className="py-1.5 px-3">{formatCurrency(a.previousValue)}</td>
                      <td className="py-1.5 px-3">{formatCurrency(a.newValue)}</td>
                      <td className="py-1.5 px-3 text-on-surface-variant">{a.reason}</td>
                      <td className="py-1.5 px-3">{a.adminEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Edit structure modal */}
      {structureForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Edit Yearly Fee Structure</h3>
              <button onClick={() => setStructureForm(null)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {STRUCTURE_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block font-semibold text-on-surface mb-1">{f.label}</label>
                  <input
                    type="number"
                    value={structureForm[f.key]}
                    onChange={(e) => setStructureForm({ ...structureForm, [f.key]: Number(e.target.value) })}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  />
                </div>
              ))}
              <div>
                <label className="block font-semibold text-on-surface mb-1">Effective Date *</label>
                <input
                  type="date"
                  value={structureForm.effectiveDate}
                  onChange={(e) => setStructureForm({ ...structureForm, effectiveDate: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-on-surface mb-1">Reason for change *</label>
                <input
                  type="text"
                  value={structureForm.reason}
                  onChange={(e) => setStructureForm({ ...structureForm, reason: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
            </div>
            <p className="text-[10px] text-on-surface-variant">This changes future vouchers only. Already-generated vouchers keep their original values.</p>
            <InlineAlert type="error" message={structureError} />
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button onClick={() => { setStructureForm(null); setStructureError(""); }} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">Cancel</button>
              <button
                onClick={saveStructure}
                disabled={savingStructure || !structureForm.reason.trim()}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
              >
                {savingStructure ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voucher adjustment modal */}
      {adjustingChallan && adjustForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface">Adjust {adjustingChallan.challanNo}</h3>
              <button onClick={() => setAdjustingChallan(null)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-on-surface mb-1">Adjustment Type</label>
                <select
                  value={adjustForm.adjustmentType}
                  onChange={(e) => setAdjustForm({ ...adjustForm, adjustmentType: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  {ADJUSTMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-on-surface mb-1">
                  Amount {adjustForm.adjustmentType === "PREVIOUS_BALANCE_CORRECTION" ? "(use negative to reduce)" : ""}
                </label>
                <input
                  type="number"
                  value={adjustForm.amount}
                  onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
              <div>
                <label className="block font-semibold text-on-surface mb-1">Effective Date *</label>
                <input
                  type="date"
                  value={adjustForm.effectiveDate}
                  onChange={(e) => setAdjustForm({ ...adjustForm, effectiveDate: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
              <div>
                <label className="block font-semibold text-on-surface mb-1">Reason *</label>
                <input
                  type="text"
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>
            </div>
            <InlineAlert type="error" message={adjustError} />
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button onClick={() => { setAdjustingChallan(null); setAdjustError(""); }} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">Cancel</button>
              <button
                onClick={saveAdjustment}
                disabled={savingAdjustment || !adjustForm.reason.trim() || !adjustForm.amount}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
              >
                {savingAdjustment ? "Saving..." : "Apply Adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse payment modal */}
      {reversingPaymentId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-sm w-full p-5 shadow-2xl border border-surface-container-high space-y-3">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Reverse Payment</h3>
            <p className="text-xs text-on-surface-variant">
              This creates a reversal entry; the original payment stays in the permanent record, marked reversed.
            </p>
            <div>
              <label className="block font-semibold text-on-surface mb-1 text-xs">Reason *</label>
              <input
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 text-xs"
              />
            </div>
            <InlineAlert type="error" message={reverseError} />
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button onClick={() => { setReversingPaymentId(null); setReverseReason(""); setReverseError(""); }} className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold text-xs">
                Cancel
              </button>
              <button
                onClick={submitReversal}
                disabled={reversing || !reverseReason.trim()}
                className="px-4 py-1.5 rounded bg-error text-on-error-container font-semibold text-xs disabled:opacity-50"
              >
                {reversing ? "Reversing..." : "Confirm Reversal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
