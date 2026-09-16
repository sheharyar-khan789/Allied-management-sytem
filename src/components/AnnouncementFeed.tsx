"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

type AnnouncementItem = {
  id: string;
  title: string;
  message: string;
  audience: string;
  publishedAt?: string | null;
  createdAt?: string;
  status?: string;
};

export default function AnnouncementFeed({ emptyLabel = "No announcements have been published for you." }: { emptyLabel?: string }) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/announcements")
      .then((res) => res.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.announcements)) setItems(d.announcements);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 space-y-2">
        <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading announcements...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-10 text-on-surface-variant">
        <span className="material-symbols-outlined text-3xl block mb-2">campaign</span>
        <p className="text-sm font-semibold text-on-surface">No announcements</p>
        <p className="text-xs mt-1">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((a) => (
        <div
          key={a.id}
          className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-1.5"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">{a.title}</h3>
            <span className="px-2 py-0.5 rounded bg-surface-container text-[10px] font-bold text-secondary uppercase shrink-0">
              {a.audience}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant whitespace-pre-wrap leading-relaxed">{a.message}</p>
          <p className="text-[10px] text-on-surface-variant">
            {formatDate(a.publishedAt || a.createdAt)}
            {a.status && a.status !== "PUBLISHED" ? ` • ${a.status}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
