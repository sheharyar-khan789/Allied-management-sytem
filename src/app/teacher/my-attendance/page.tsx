"use client";

import React, { useEffect, useState } from "react";
import { formatDisplayDate } from "@/lib/date-utils";

const STATUS_STYLES: Record<string, string> = {
  PRESENT: "bg-tertiary-container/10 text-on-tertiary-container",
  ABSENT: "bg-error-container/20 text-error",
  LEAVE: "bg-secondary/10 text-secondary",
};

const now = new Date();

/** A teacher's own attendance history — read-only. The server resolves the viewer's own
 *  teacherId from the session; there is no way to request another teacher's record here. */
export default function MyAttendancePage() {
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/teacher-attendance?year=${year}&month=${month}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Could not load your attendance.");
        return json;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">My Attendance</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Your own attendance history. Only an administrator can correct a record.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Month</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 w-24 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40" />
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>}

      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Working Days", value: data.summary.workingDays, cls: "" },
              { label: "Present", value: data.summary.present, cls: "text-tertiary" },
              { label: "Leave", value: data.summary.leave, cls: "text-secondary" },
              { label: "Absent", value: data.summary.absent, cls: "text-error" },
            ].map((s) => (
              <div key={s.label} className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
                <div className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">{s.label}</div>
                <div className={`text-2xl font-bold mt-1 ${s.cls || "text-on-surface"}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-2 px-4 font-bold">Date</th>
                  <th className="py-2 px-4 font-bold">Status</th>
                  <th className="py-2 px-4 font-bold">Check-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {data.days.map((d: any) => (
                  <tr key={d.date}>
                    <td className="py-2 px-4 font-mono">{formatDisplayDate(d.date)}</td>
                    <td className="py-2 px-4">
                      <span className={`px-2 py-0.5 rounded font-bold ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                      {d.weeklyLeaveCapApplied && <span className="ml-1 text-[10px] text-on-surface-variant">(2nd leave this week)</span>}
                    </td>
                    <td className="py-2 px-4 font-mono">{d.record?.checkInTime || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
