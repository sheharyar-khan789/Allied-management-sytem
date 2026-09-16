"use client";

import React from "react";

export default function PrintToolbar({ title }: { title: string }) {
  return (
    <div className="no-print mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <h1 className="font-headline-lg text-xl font-bold text-on-surface">{title}</h1>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm self-start"
      >
        <span className="material-symbols-outlined text-[18px]">print</span>
        Print / Save PDF
      </button>
    </div>
  );
}
