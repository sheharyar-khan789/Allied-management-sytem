"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ChildSelector, useParentChild } from "@/components/parent/use-parent-child";

function ParentDashboardInner() {
  const { children, selectedId, payload, loading, error, selectChild } = useParentChild();

  if (loading && !payload) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading parent portal...</p>
      </div>
    );
  }

  if (error && children.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">family_restroom</span>
        <h2 className="text-lg font-bold text-on-surface">No children linked</h2>
        <p className="text-xs text-on-surface-variant mt-1 max-w-sm">
          {error || "Your guardian account is not linked to a student record. Please contact the campus administrator."}
        </p>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="p-6 rounded-xl bg-error-container/20 text-error text-sm">{error}</div>
    );
  }

  if (!selectedId && children.length > 1) {
    return (
      <div className="flex flex-col w-full gap-space-lg">
        <div className="p-8 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 text-center">
          <h2 className="text-lg font-bold text-on-surface">Select a child</h2>
          <p className="text-xs text-on-surface-variant mt-1 mb-4">
            Multiple students are linked to this account. Choose one to view their dashboard.
          </p>
          <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
        </div>
      </div>
    );
  }

  const student = payload?.student;
  const att = payload?.attendance?.stats || { percentage: 0, present: 0, absent: 0, leave: 0 };
  const fees = payload?.fees?.stats || { outstanding: 0, paid: 0, expected: 0 };
  const payments = payload?.fees?.payments || [];
  const results = payload?.results || [];
  const announcements = payload?.announcements || [];

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary-container to-primary p-space-lg text-on-primary shadow-sm">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div>
            <span className="px-2 py-0.5 rounded bg-secondary-container/40 text-secondary-fixed text-[11px] font-bold tracking-wide uppercase">
              Parent Portal
            </span>
            <h1 className="font-headline-lg text-2xl sm:text-3xl font-bold tracking-tight text-on-primary mt-2">
              {student?.fullName || "Linked child"}
            </h1>
            <p className="text-xs sm:text-sm text-on-primary-container mt-1">
              {student?.className || "Class not assigned"}
              {student?.section ? `-${student.section}` : ""} • Adm {student?.admissionNo || "—"}
            </p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Attendance</span>
          <div className="text-2xl font-bold text-on-tertiary-container mt-1">
            {att.total ? `${att.percentage}%` : "—"}
          </div>
          <span className="text-[10px] text-on-surface-variant">
            {att.total ? `${att.present} present • ${att.absent} absent • ${att.leave} leave` : "No attendance recorded"}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Outstanding fees</span>
          <div className="text-2xl font-bold text-on-surface mt-1">
            {fees.outstanding > 0 ? formatCurrency(fees.outstanding) : fees.expected > 0 ? "Clear" : "—"}
          </div>
          <span className="text-[10px] text-on-surface-variant">
            {payload?.fees?.challans?.length ? `Paid ${formatCurrency(fees.paid)}` : "No fee challans issued"}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Results</span>
          <div className="text-2xl font-bold text-secondary mt-1">
            {typeof payload?.academics?.gpa === "number" ? payload.academics.gpa.toFixed(2) : results.length ? `${payload?.academics?.percentage || 0}%` : "—"}
          </div>
          <span className="text-[10px] text-on-surface-variant">
            {results.length ? `${results.length} subject result(s)` : "No results published"}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Class</span>
          <div className="text-2xl font-bold text-primary mt-1 truncate">
            {student?.className || "Not assigned"}
          </div>
          <span className="text-[10px] text-on-surface-variant">Roll {student?.rollNo || "—"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Recent payments</h3>
            <Link href={`/parent/fees?studentId=${encodeURIComponent(selectedId)}`} className="text-xs font-semibold text-secondary">
              View fees →
            </Link>
          </div>
          {payments.length === 0 ? (
            <p className="text-xs text-on-surface-variant py-6 text-center">No payments recorded for this child.</p>
          ) : (
            payments.slice(0, 5).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-surface-container-low/60">
                <div>
                  <p className="font-bold text-on-surface">{p.receiptNo}</p>
                  <p className="text-[10px] text-on-surface-variant">{formatDate(p.paymentDate)} • {p.paymentMode}</p>
                </div>
                <span className="font-bold text-on-tertiary-container">{formatCurrency(p.amount)}</span>
              </div>
            ))
          )}
        </div>

        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Recent results</h3>
            <Link href={`/parent/results?studentId=${encodeURIComponent(selectedId)}`} className="text-xs font-semibold text-secondary">
              Full results →
            </Link>
          </div>
          {results.length === 0 ? (
            <p className="text-xs text-on-surface-variant py-6 text-center">No examination results published yet.</p>
          ) : (
            results.slice(0, 5).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-surface-container-low/60">
                <div>
                  <p className="font-bold text-on-surface">{r.subjectName || "Subject"}</p>
                  <p className="text-[10px] text-on-surface-variant">{r.examName || "Exam"}</p>
                </div>
                <span className="font-bold">{r.obtainedMarks}/{r.totalMarks} {r.grade ? `• ${r.grade}` : ""}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">Recent announcements</h3>
          <Link href="/parent/announcements" className="text-xs font-semibold text-secondary">
            All announcements →
          </Link>
        </div>
        {announcements.length === 0 ? (
          <p className="text-xs text-on-surface-variant py-6 text-center">No announcements published for parents.</p>
        ) : (
          announcements.slice(0, 4).map((a: any) => (
            <div key={a.id} className="text-xs p-2.5 rounded-lg bg-surface-container-low/60">
              <p className="font-bold text-on-surface">{a.title}</p>
              <p className="text-on-surface-variant mt-0.5 line-clamp-2">{a.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function ParentDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <ParentDashboardInner />
    </Suspense>
  );
}
