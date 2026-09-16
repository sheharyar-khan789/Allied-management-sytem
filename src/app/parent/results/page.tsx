"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { ChildSelector, useParentChild } from "@/components/parent/use-parent-child";

function ParentResultsInner() {
  const { children, selectedId, payload, loading, error, selectChild } = useParentChild();
  const results = payload?.results || [];
  const academics = payload?.academics || { percentage: 0, gpa: null, obtainedMarks: 0, totalMarks: 0 };

  if (loading && !payload) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading results...</p>
      </div>
    );
  }

  if (!selectedId && children.length > 1) {
    return (
      <div className="p-8 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 text-center">
        <p className="text-sm font-semibold mb-3">Select a linked child to view results.</p>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Results</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Published exam marks for {payload?.student?.fullName || "the selected child"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
          {selectedId && (
            <Link
              href={`/print/report-card/${selectedId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              Print report card
            </Link>
          )}
        </div>
      </div>

      {error && !payload ? (
        <div className="p-6 rounded-xl bg-error-container/20 text-error text-sm">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Marks</span>
              <div className="text-2xl font-bold mt-1">
                {academics.totalMarks ? `${academics.obtainedMarks} / ${academics.totalMarks}` : "—"}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Percentage</span>
              <div className="text-2xl font-bold mt-1">{academics.totalMarks ? `${academics.percentage}%` : "—"}</div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
              <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">GPA</span>
              <div className="text-2xl font-bold text-secondary mt-1">
                {typeof academics.gpa === "number" ? academics.gpa.toFixed(2) : "Not recorded"}
              </div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-surface-container-low uppercase text-[11px] font-bold text-on-surface-variant">
                    <th className="py-3 px-4">Exam</th>
                    <th className="py-3 px-4">Subject</th>
                    <th className="py-3 px-4">Marks</th>
                    <th className="py-3 px-4">%</th>
                    <th className="py-3 px-4">Grade</th>
                    <th className="py-3 px-4">GPA</th>
                    <th className="py-3 px-4">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-on-surface-variant italic">
                        No results have been published for this child.
                      </td>
                    </tr>
                  )}
                  {results.map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-3 px-4">{r.examName || "—"}</td>
                      <td className="py-3 px-4 font-semibold">{r.subjectName || "—"}</td>
                      <td className="py-3 px-4">{r.obtainedMarks} / {r.totalMarks}</td>
                      <td className="py-3 px-4">{r.percentage}%</td>
                      <td className="py-3 px-4 font-bold text-secondary">{r.grade || "—"}</td>
                      <td className="py-3 px-4">{typeof r.gpa === "number" ? r.gpa : "—"}</td>
                      <td className="py-3 px-4 text-on-surface-variant">{r.remarks || "—"}</td>
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

export default function ParentResultsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-xs text-on-surface-variant">Loading...</div>}>
      <ParentResultsInner />
    </Suspense>
  );
}
