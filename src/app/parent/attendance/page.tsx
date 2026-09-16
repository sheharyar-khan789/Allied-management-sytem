"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { ChildSelector, useParentChild } from "@/components/parent/use-parent-child";

function ParentAttendanceInner() {
  const { children, selectedId, payload, loading, error, selectChild } = useParentChild();
  const stats = payload?.attendance?.stats || { percentage: 0, present: 0, absent: 0, leave: 0, late: 0, total: 0 };
  const records = payload?.attendance?.records || [];

  if (loading && !payload) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading attendance...</p>
      </div>
    );
  }

  if (!selectedId && children.length > 1) {
    return (
      <div className="p-8 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 text-center">
        <p className="text-sm font-semibold mb-3">Select a linked child to view attendance.</p>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Child attendance</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {payload?.student?.fullName || "Select a linked child"} • Present, absent, and leave records only for this student.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
          {selectedId && (
            <Link
              href={`/print/attendance/${selectedId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              Print report
            </Link>
          )}
        </div>
      </div>

      {error && !payload ? (
        <div className="p-6 rounded-xl bg-error-container/20 text-error text-sm">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Attendance %</span>
              <div className="text-2xl font-bold text-on-tertiary-container mt-1">{stats.total ? `${stats.percentage}%` : "—"}</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Present</span>
              <div className="text-2xl font-bold mt-1">{stats.present}</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Absent</span>
              <div className="text-2xl font-bold text-error mt-1">{stats.absent}</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Leave</span>
              <div className="text-2xl font-bold text-secondary mt-1">{stats.leave}</div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[11px] font-bold">
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-on-surface-variant italic">
                        No attendance records found for this child.
                      </td>
                    </tr>
                  )}
                  {records.map((att: any) => (
                    <tr key={att.id}>
                      <td className="py-2.5 px-4 font-semibold">{formatDate(att.date)}</td>
                      <td className="py-2.5 px-4">{att.status}</td>
                      <td className="py-2.5 px-4 text-on-surface-variant">{att.remarks || "—"}</td>
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

export default function ParentAttendancePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-xs text-on-surface-variant">Loading...</div>}>
      <ParentAttendanceInner />
    </Suspense>
  );
}
