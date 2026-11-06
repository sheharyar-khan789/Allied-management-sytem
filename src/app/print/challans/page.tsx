"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FeeVoucherPage, VoucherStyles } from "@/components/FeeVoucher";
import type { VoucherData } from "@/lib/fee-voucher";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Meta {
  activeSession: string;
  sessions: string[];
  academicYear: string;
  classes: { id: string; name: string; section: string }[];
}
interface Batch {
  className: string;
  students: { id: string; fullName: string; admissionNo: string }[];
  vouchers: VoucherData[];
  missing: { studentId: string; fullName: string; admissionNo: string }[];
  duplicates: { studentId: string; fullName: string; count: number }[];
  truncated: boolean;
}

const selectCls =
  "h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40";

/**
 * Admin bulk voucher print: pick session -> class -> fee month, preview the real challans of that
 * class, tick the students to print, then print. Each student is one A4 landscape page holding the
 * Admin Office Copy and the Student Copy. Everything above the preview is screen-only.
 */
export default function BulkPrintChallansPage() {
  const now = new Date();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [session, setSession] = useState("");
  const [classId, setClassId] = useState("");
  const [month, setMonth] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [batch, setBatch] = useState<Batch | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingBatch, setLoadingBatch] = useState(false);

  useEffect(() => {
    setLoadingMeta(true);
    fetch(`/api/print/challans?meta=1${session ? `&academicYear=${encodeURIComponent(session)}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load sessions and classes.");
          return;
        }
        setError("");
        setMeta(d);
        if (!session) setSession(d.academicYear || "");
        setClassId((cur) => (d.classes.some((c: any) => c.id === cur) ? cur : ""));
      })
      .catch(() => setError("Unable to load sessions and classes."))
      .finally(() => setLoadingMeta(false));
  }, [session]);

  useEffect(() => {
    setBatch(null);
    setSelected(new Set());
    if (!classId || !session) return;
    let cancelled = false;
    setLoadingBatch(true);
    const q = new URLSearchParams({ classId, month, academicYear: session });
    if (/^\d{4}$/.test(year)) q.set("year", year);
    fetch(`/api/print/challans?${q.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load vouchers.");
          return;
        }
        setError("");
        setBatch(d);
        setSelected(new Set(d.vouchers.map((v: VoucherData) => v.student.id)));
      })
      .catch(() => !cancelled && setError("Unable to load vouchers."))
      .finally(() => !cancelled && setLoadingBatch(false));
    return () => {
      cancelled = true;
    };
  }, [classId, month, year, session]);

  const toPrint = useMemo(
    () => (batch ? batch.vouchers.filter((v) => selected.has(v.student.id)) : []),
    [batch, selected]
  );
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <VoucherStyles />
      <div className="no-print space-y-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="font-headline-lg text-xl font-bold text-on-surface">Print fee vouchers</h1>
          <button
            type="button"
            disabled={toPrint.length === 0}
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm self-start disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            Print {toPrint.length > 0 ? `${toPrint.length} voucher${toPrint.length === 1 ? "" : "s"}` : "vouchers"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Academic session" value={session} onChange={(e) => setSession(e.target.value)} className={selectCls} disabled={loadingMeta}>
            {(meta?.sessions || []).map((s) => (
              <option key={s} value={s}>{s}{s === meta?.activeSession ? " (active)" : ""}</option>
            ))}
          </select>
          <select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} className={selectCls}>
            <option value="">Select class…</option>
            {(meta?.classes || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.section ? `-${c.section}` : ""}</option>
            ))}
          </select>
          <select aria-label="Fee month" value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            aria-label="Fee year"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            className={`${selectCls} w-20`}
          />
        </div>

        {error && <p className="text-xs text-error" role="alert">{error}</p>}
        {!classId && !error && <p className="text-xs text-on-surface-variant">Choose a class to load its fee vouchers.</p>}
        {loadingBatch && <p className="text-xs text-on-surface-variant">Loading vouchers…</p>}

        {batch && (
          <div className="rounded-xl border border-surface-container-high bg-surface-container-lowest p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <strong>{batch.className}</strong>
              <span>{month} {year} · {batch.vouchers.length} voucher{batch.vouchers.length === 1 ? "" : "s"} found · {toPrint.length} selected</span>
              <button type="button" className="text-secondary font-semibold" onClick={() => setSelected(new Set(batch.vouchers.map((v) => v.student.id)))}>Select all</button>
              <button type="button" className="text-secondary font-semibold" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
            {batch.vouchers.length === 0 && (
              <p className="text-xs text-on-surface-variant">No fee challans exist for this class and month, so there is nothing to print.</p>
            )}
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-xs max-h-56 overflow-y-auto">
              {batch.vouchers.map((v) => (
                <li key={v.challan.id}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selected.has(v.student.id)} onChange={() => toggle(v.student.id)} />
                    <span>{v.student.fullName}</span>
                    <span className="text-on-surface-variant">{v.student.admissionNo}</span>
                  </label>
                </li>
              ))}
            </ul>
            {batch.missing.length > 0 && (
              <p className="text-xs text-on-surface-variant" role="status">
                No challan for {month}: {batch.missing.map((m) => m.fullName).join(", ")}. These students will not be printed.
              </p>
            )}
            {batch.duplicates.length > 0 && (
              <p className="text-xs text-error" role="status">
                More than one challan exists for {batch.duplicates.map((d) => `${d.fullName} (${d.count})`).join(", ")}; only the most recent is printed.
              </p>
            )}
            {batch.truncated && (
              <p className="text-xs text-error" role="status">Only the first 300 vouchers are shown. Print the rest by class section or in a second batch.</p>
            )}
          </div>
        )}
      </div>

      {toPrint.length > 0 && (
        <div className="voucher-sheet-screen-frame overflow-x-auto rounded-xl border border-surface-container-high bg-white p-3 shadow-sm">
          {toPrint.map((v) => (
            <FeeVoucherPage key={v.challan.id} voucher={v} />
          ))}
        </div>
      )}
    </div>
  );
}
