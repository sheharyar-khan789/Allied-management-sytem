"use client";

import React from "react";

export const TIMETABLE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface TimetableEntry {
  id: string;
  dayOfWeek: string;
  periodName: string;
  startTime: string;
  endTime: string;
  classId: string;
  className: string;
  subjectName: string;
  teacherName?: string;
  teacherId?: string;
  roomNo?: string;
}

/** "HH:MM" (24h) or legacy "hh:mm AM/PM" → minutes, for ordering only. */
function minutes(value: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(value || "");
  if (!m) return Number.MAX_SAFE_INTEGER;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return h * 60 + Number(m[2]);
}

/** Periods as columns (like the school's printed timetable), ordered by their earliest start. */
function periodColumns(entries: TimetableEntry[]): string[] {
  const earliest = new Map<string, number>();
  for (const e of entries) {
    const t = minutes(e.startTime);
    earliest.set(e.periodName, Math.min(earliest.get(e.periodName) ?? Number.MAX_SAFE_INTEGER, t));
  }
  return [...earliest.keys()].sort(
    (a, b) => earliest.get(a)! - earliest.get(b)! || a.localeCompare(b, undefined, { numeric: true })
  );
}

function Cell({ items, onSelect }: { items: TimetableEntry[]; onSelect?: (e: TimetableEntry) => void }) {
  if (items.length === 0) return <span className="text-on-surface-variant">—</span>;
  return (
    <div className="space-y-1.5">
      {items.map((e) => {
        const body = (
          <>
            <span className="block font-bold text-on-surface">{e.subjectName}</span>
            {e.teacherName && <span className="block text-on-surface-variant">{e.teacherName}</span>}
            <span className="block font-mono text-[10px] text-on-surface-variant">
              {e.startTime}–{e.endTime}
              {e.roomNo && e.roomNo !== "-" ? ` • ${e.roomNo}` : ""}
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e)}
            className="block w-full text-left rounded p-1 -m-1 hover:bg-secondary/10 focus:outline-none focus:ring-2 focus:ring-secondary/30"
            aria-label={`Edit ${e.subjectName} ${e.className} ${e.dayOfWeek} ${e.startTime}`}
          >
            {body}
          </button>
        ) : (
          <div key={e.id}>{body}</div>
        );
      })}
    </div>
  );
}

/**
 * Read-only weekly grid. `rows="day"`: one row per day (a single class's week — student and
 * parent views). `rows="class"`: one row per class (one day across the school — admin view);
 * `onSelect` makes each period clickable for editing. On small screens the day view collapses
 * into one card per day so it stays usable on a phone.
 */
export default function TimetableGrid({
  entries,
  rows,
  onSelect,
  highlightDay,
}: {
  entries: TimetableEntry[];
  rows: "day" | "class";
  onSelect?: (e: TimetableEntry) => void;
  highlightDay?: string;
}) {
  const columns = periodColumns(entries);
  const rowKeys =
    rows === "day"
      ? TIMETABLE_DAYS.filter((d) => entries.some((e) => e.dayOfWeek === d))
      : [...new Map(entries.map((e) => [e.classId, e.className])).entries()]
          .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
          .map(([id]) => id);
  const rowLabel = (key: string) => (rows === "day" ? key : entries.find((e) => e.classId === key)?.className || key);
  const inRow = (key: string) => entries.filter((e) => (rows === "day" ? e.dayOfWeek === key : e.classId === key));
  const sortByTime = (list: TimetableEntry[]) => [...list].sort((a, b) => minutes(a.startTime) - minutes(b.startTime));

  return (
    <>
      <div className={`${rows === "day" ? "hidden md:block" : ""} overflow-x-auto bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40`}>
        <table className="w-full border-collapse text-xs min-w-[640px]">
          <thead>
            <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider">
              <th className="py-2.5 px-3 text-left font-bold sticky left-0 bg-surface-container-low z-10">{rows === "day" ? "Day" : "Class"}</th>
              {columns.map((p) => (
                <th key={p} className="py-2.5 px-3 text-left font-bold whitespace-nowrap">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {rowKeys.map((key) => {
              const list = inRow(key);
              const today = rows === "day" && key === highlightDay;
              return (
                <tr key={key} className={today ? "bg-secondary/5" : ""}>
                  <th scope="row" className="py-2.5 px-3 text-left font-bold text-on-surface whitespace-nowrap align-top sticky left-0 bg-surface-container-lowest z-10">
                    {rowLabel(key)}
                    {today && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-secondary text-on-secondary text-[9px] font-bold">Today</span>}
                  </th>
                  {columns.map((p) => (
                    <td key={p} className="py-2.5 px-3 align-top min-w-[120px]">
                      <Cell items={list.filter((e) => e.periodName === p)} onSelect={onSelect} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows === "day" && (
        <div className="md:hidden space-y-3">
          {rowKeys.map((day) => (
            <section key={day} className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-container-low border-b border-surface-container-high/40 flex items-center gap-2">
                <h3 className="font-bold text-sm text-on-surface">{day}</h3>
                {day === highlightDay && (
                  <span className="px-2 py-0.5 rounded-full bg-secondary text-on-secondary text-[10px] font-bold">Today</span>
                )}
              </div>
              <ul className="divide-y divide-surface-container-low">
                {sortByTime(inRow(day)).map((e) => (
                  <li key={e.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs">
                    <div>
                      <span className="block font-bold text-on-surface">{e.subjectName}</span>
                      {e.teacherName && <span className="block text-on-surface-variant">{e.teacherName}</span>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block font-semibold text-on-surface">{e.periodName}</span>
                      <span className="block font-mono text-[10px] text-on-surface-variant">{e.startTime}–{e.endTime}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
