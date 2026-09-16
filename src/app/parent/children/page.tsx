"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { ChildSelector, useParentChild } from "@/components/parent/use-parent-child";

function ParentChildrenInner() {
  const { children, selectedId, loading, error, selectChild } = useParentChild({ loadAcademic: false });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading children...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Linked children</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">Only students associated with this guardian account are listed.</p>
        </div>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>

      {error && children.length === 0 ? (
        <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40">
          <p className="text-sm font-semibold text-on-surface">No children linked</p>
          <p className="text-xs text-on-surface-variant mt-1">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {children.map((c) => (
            <div key={c.id} className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
              <div>
                <h3 className="font-bold text-on-surface">{c.fullName}</h3>
                <p className="text-xs text-on-surface-variant">
                  {c.className || "Class not assigned"} • Adm {c.admissionNo} • Roll {c.rollNo}
                </p>
                <p className="text-[10px] text-on-surface-variant mt-1">Status: {c.status}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/parent?studentId=${c.id}`} className="px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-[11px] font-semibold">Dashboard</Link>
                <Link href={`/parent/attendance?studentId=${c.id}`} className="px-3 py-1.5 rounded-lg bg-surface-container text-[11px] font-semibold">Attendance</Link>
                <Link href={`/parent/fees?studentId=${c.id}`} className="px-3 py-1.5 rounded-lg bg-surface-container text-[11px] font-semibold">Fees</Link>
                <Link href={`/parent/results?studentId=${c.id}`} className="px-3 py-1.5 rounded-lg bg-surface-container text-[11px] font-semibold">Results</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ParentChildrenPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-xs text-on-surface-variant">Loading...</div>}>
      <ParentChildrenInner />
    </Suspense>
  );
}
