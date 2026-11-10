"use client";

import React from "react";

export const PAGE_SIZE = 25;

export default function Pagination({
  page,
  totalItems,
  pageSize = PAGE_SIZE,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-surface-container-high/40 text-[11px] text-on-surface-variant no-print">
      <span>
        Showing {from}–{to} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded bg-surface-container text-on-surface font-semibold disabled:opacity-40"
        >
          Previous
        </button>
        <span className="font-semibold">
          Page {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2.5 py-1 rounded bg-surface-container text-on-surface font-semibold disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
