"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

export default function StudentAttendancePage() {
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
        <p className="text-xs text-on-surface-variant">Loading attendance logs...</p>
      </div>
    );
  }

  const student = data?.student;
  const stats = data?.stats?.attendance || { percentage: 0, present: 0, absent: 0, late: 0, leave: 0, total: 0 };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
            My Attendance Record
          </h1>
          <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
            {data?.school?.academicYear
              ? `Academic Session ${data.school.academicYear}`
              : "Academic Session Not Configured"}
          </span>
        </div>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Daily attendance standing, excused leaves, and punctuality summary.
        </p>
        {student?.id && (
          <a
            href={`/print/attendance/${student.id}`}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg bg-surface-container text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            Print attendance report
          </a>
        )}
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Overall Rate
          </span>
          <div className="text-2xl font-bold text-on-tertiary-container mt-1">{stats.percentage}%</div>
          <span className="text-[10px] text-on-surface-variant">Target: &gt; 80%</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Days Present
          </span>
          <div className="text-2xl font-bold text-on-surface mt-1">{stats.present}</div>
          <span className="text-[10px] text-on-tertiary-container font-semibold">Active In Class</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Leaves / Late
          </span>
          <div className="text-2xl font-bold text-secondary mt-1">{stats.leave + stats.late}</div>
          <span className="text-[10px] text-on-surface-variant">{stats.late} Late • {stats.leave} Leave</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Unexcused Absences
          </span>
          <div className="text-2xl font-bold text-error mt-1">{stats.absent}</div>
          <span className="text-[10px] text-error font-semibold">Absence Count</span>
        </div>
      </div>

      {/* Attendance History Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        <div className="p-4 border-b border-surface-container-low">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">Daily Attendance Log</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Notes / Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {(!student?.attendances || student.attendances.length === 0) && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-on-surface-variant italic">
                    No attendance records found for this academic period.
                  </td>
                </tr>
              )}
              {student?.attendances?.map((att: any) => (
                <tr key={att.id} className="hover:bg-surface-container-low/40">
                  <td className="py-2.5 px-4 font-semibold text-on-surface">{formatDate(att.date)}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        att.status === "PRESENT"
                          ? "bg-tertiary-container/10 text-on-tertiary-container"
                          : att.status === "LATE"
                          ? "bg-amber-100 text-amber-800"
                          : att.status === "LEAVE"
                          ? "bg-secondary/10 text-secondary"
                          : "bg-error-container text-on-error-container"
                      }`}
                    >
                      {att.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-on-surface-variant">{att.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
