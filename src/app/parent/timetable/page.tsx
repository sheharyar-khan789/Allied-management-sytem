"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import TimetableGrid, { TimetableEntry } from "@/components/TimetableGrid";
import { ChildSelector, useParentChild } from "@/components/parent/use-parent-child";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ParentTimetableInner() {
  const { children, selectedId, loading: childLoading, error: childError, selectChild } = useParentChild({ loadAcademic: false });
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [className, setClassName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const today = WEEKDAYS[new Date().getDay()];
  // Only the selected child's response may be shown when switching between children.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    setEntries([]);
    setClassName("");
    setError("");
    if (!selectedId) return;
    const requested = selectedId;
    setLoading(true);
    // The server checks this child is linked to the parent and derives the child's class itself.
    fetch(`/api/timetable?studentId=${encodeURIComponent(requested)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (selectedRef.current !== requested) return;
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to load the timetable.");
        setEntries(Array.isArray(json.timetable) ? json.timetable : []);
        setClassName(json.student?.className || "");
      })
      .catch((err) => {
        if (selectedRef.current === requested) setError(err?.message || "Failed to load the timetable.");
      })
      .finally(() => {
        if (selectedRef.current === requested) setLoading(false);
      });
  }, [selectedId]);

  if (childLoading && children.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading...</p>
      </div>
    );
  }

  if (!selectedId && children.length > 1) {
    return (
      <div className="p-8 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 text-center">
        <p className="text-sm font-semibold mb-3">Select a linked child to view their class timetable.</p>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>
    );
  }

  const shownError = childError || error;
  const child = children.find((c) => c.id === selectedId);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Class Timetable</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {child ? `${child.fullName} • ${className || child.className || "Class"}` : "Select a linked child"}
          </p>
        </div>
        <ChildSelector linkedChildren={children} selectedId={selectedId} onSelect={selectChild} />
      </div>

      {shownError && <div role="alert" className="p-6 rounded-xl bg-error-container/20 text-error text-sm">{shownError}</div>}

      {!shownError && loading && (
        <div className="flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading timetable...</p>
        </div>
      )}

      {!shownError && !loading && selectedId && entries.length === 0 && (
        <div className="p-8 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 space-y-2">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant">calendar_clock</span>
          <p className="font-semibold text-sm text-on-surface">No timetable published yet</p>
          <p className="text-xs text-on-surface-variant">The school has not scheduled any periods for this class yet.</p>
        </div>
      )}

      {!shownError && !loading && entries.length > 0 && <TimetableGrid entries={entries} rows="day" highlightDay={today} />}
    </div>
  );
}

export default function ParentTimetablePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-xs text-on-surface-variant">Loading...</div>}>
      <ParentTimetableInner />
    </Suspense>
  );
}
