"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";
import { formatDate } from "@/lib/utils";

export default function PrintAttendancePage({ params }: { params: Promise<{ studentId: string }> }) {
  const [studentId, setStudentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setStudentId(p.studentId));
  }, [params]);

  useEffect(() => {
    if (!studentId) return;
    const qs = new URLSearchParams();
    if (applied.from) qs.set("from", applied.from);
    if (applied.to) qs.set("to", applied.to);
    setLoading(true);
    fetch(`/api/print/attendance/${encodeURIComponent(studentId)}?${qs.toString()}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load attendance report.");
          return;
        }
        setError("");
        setData(d);
      })
      .catch(() => setError("Unable to load attendance report."))
      .finally(() => setLoading(false));
  }, [studentId, applied.from, applied.to]);

  if (!studentId || (loading && !data)) {
    return <p className="text-xs text-on-surface-variant p-8">Loading attendance report...</p>;
  }
  if (error && !data) return <p className="text-sm text-error p-8">{error}</p>;

  const school = data.school;
  const student = data.student;
  const stats = data.attendance.stats;
  const records = data.attendance.records || [];

  return (
    <div>
      <PrintToolbar title="Attendance report" />
      <div className="no-print mb-4 flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 px-2 rounded bg-surface-container-low" />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 px-2 rounded bg-surface-container-low" />
        </label>
        <button
          type="button"
          onClick={() => setApplied({ from, to })}
          className="h-8 px-3 rounded bg-surface-container font-semibold"
        >
          Apply range
        </button>
      </div>

      <article className="print-sheet p-6 sm:p-8 rounded-xl bg-white border border-surface-container-high shadow-sm print:border-0 print:shadow-none">
        <header className="text-center border-b-2 border-on-surface pb-4 mb-4">
          <h2 className="text-xl font-bold">{school.name}</h2>
          <p className="text-[11px] text-on-surface-variant">{school.address}</p>
          <p className="mt-3 text-sm font-bold uppercase">Attendance Report</p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
          <p><span className="text-on-surface-variant block">Student</span><strong>{student.fullName}</strong></p>
          <p><span className="text-on-surface-variant block">Class</span><strong>{student.className}{student.section ? `-${student.section}` : ""}</strong></p>
          <p><span className="text-on-surface-variant block">Date range</span><strong>{applied.from || "All records"}{applied.to ? ` → ${applied.to}` : ""}</strong></p>
          <p><span className="text-on-surface-variant block">Attendance %</span><strong>{stats.total ? `${stats.percentage}%` : "—"}</strong></p>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center text-xs mb-4">
          <div className="p-2 border border-outline-variant rounded">Present<br /><strong>{stats.present}</strong></div>
          <div className="p-2 border border-outline-variant rounded">Absent<br /><strong>{stats.absent}</strong></div>
          <div className="p-2 border border-outline-variant rounded">Leave<br /><strong>{stats.leave}</strong></div>
          <div className="p-2 border border-outline-variant rounded">Late<br /><strong>{stats.late}</strong></div>
        </div>

        <table className="w-full text-xs border border-outline-variant">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="text-left py-2 px-3">Date</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-on-surface-variant italic">
                  No attendance records in this range.
                </td>
              </tr>
            ) : (
              records.map((r: any) => (
                <tr key={r.id} className="border-t border-outline-variant/40">
                  <td className="py-2 px-3">{formatDate(r.date)}</td>
                  <td className="py-2 px-3">{r.status}</td>
                  <td className="py-2 px-3">{r.remarks || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>
    </div>
  );
}
