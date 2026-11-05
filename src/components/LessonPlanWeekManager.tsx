"use client";

import React, { useCallback, useEffect, useState } from "react";

interface WeekRow {
  id: string;
  weekId: string;
  label: string;
  academicYear: string;
  startDate: string;
  endDate: string;
  planCount: number;
  state: "PAST" | "CURRENT" | "UPCOMING";
  datesEditable: boolean;
}

const input = "w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 text-xs";

/**
 * Admin schedule of lesson-plan weeks: create custom weeks of any dates and any year (there is no
 * hardcoded last week), rename or re-date them while nothing is filed under them, remove unused
 * ones, and see how many lesson plans each week holds. The standard Monday weeks need no setup.
 */
export default function LessonPlanWeekManager({ onChanged }: { onChanged?: () => void }) {
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [defaultYear, setDefaultYear] = useState("");
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ label: "", startDate: "", endDate: "", academicYear: "" });
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/lesson-plan-weeks", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setLoadError(json.error || "Could not load the week schedule.");
        return;
      }
      setWeeks(json.weeks || []);
      setDefaultYear(json.defaultAcademicYear || "");
      setToday(json.today || "");
    } catch {
      setLoadError("Could not load the week schedule. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setForm({ label: "", startDate: "", endDate: "", academicYear: "" });
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const editing = weeks.find((w) => w.id === editingId);
      const res = await fetch(editing ? `/api/lesson-plan-weeks/${encodeURIComponent(editing.id)}` : "/api/lesson-plan-weeks", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label,
          // Dates of a week that already holds plans are not sent (the server would refuse them).
          ...(!editing || editing.datesEditable ? { startDate: form.startDate, endDate: form.endDate } : {}),
          ...(form.academicYear ? { academicYear: form.academicYear } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "The week could not be saved.");
        return;
      }
      setMessage(editing ? "Week updated." : "Week created. It is now available to teachers and in the review page.");
      reset();
      await load();
      onChanged?.();
    } catch {
      setError("The week could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: WeekRow) => {
    if (busy) return;
    if (!window.confirm(`Remove the week "${w.label}"? Only weeks with no lesson plans can be removed.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/lesson-plan-weeks/${encodeURIComponent(w.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "The week could not be removed.");
        return;
      }
      setMessage("Week removed.");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (w: WeekRow) => {
    setEditingId(w.id);
    setForm({ label: w.label, startDate: w.startDate, endDate: w.endDate, academicYear: w.academicYear });
    setError("");
    setMessage("");
  };

  const editing = weeks.find((w) => w.id === editingId);
  const datesLocked = Boolean(editing && !editing.datesEditable);

  return (
    <section className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4 text-xs">
      <div>
        <h2 className="font-headline-md text-sm font-bold text-on-surface">Lesson-plan week schedule</h2>
        <p className="text-on-surface-variant mt-0.5">
          Standard Monday–Sunday weeks are always available, with no end date. Add a custom week for any dates (for
          example a holiday week or a term-end block), in any academic session, including future ones.
        </p>
      </div>

      {message && <p role="status" className="p-2 rounded bg-tertiary-container/10 text-on-tertiary-container font-semibold">{message}</p>}
      {error && <p role="alert" className="p-2 rounded bg-error-container/20 text-error font-semibold">{error}</p>}

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
        <div className="sm:col-span-2">
          <label htmlFor="lpw-label" className="block font-semibold text-on-surface mb-1">Week name</label>
          <input id="lpw-label" className={input} maxLength={80} required value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Winter term, week 1" />
        </div>
        <div>
          <label htmlFor="lpw-start" className="block font-semibold text-on-surface mb-1">Start date</label>
          <input id="lpw-start" type="date" className={input} required value={form.startDate} disabled={datesLocked}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div>
          <label htmlFor="lpw-end" className="block font-semibold text-on-surface mb-1">End date</label>
          <input id="lpw-end" type="date" className={input} required value={form.endDate} disabled={datesLocked}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
        <div>
          <label htmlFor="lpw-year" className="block font-semibold text-on-surface mb-1">Session</label>
          <input id="lpw-year" className={`${input} font-mono`} placeholder={defaultYear || "2026-2027"} pattern="\d{4}-\d{4}" value={form.academicYear}
            onChange={(e) => setForm({ ...form, academicYear: e.target.value })} />
        </div>
        <div className="sm:col-span-5 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50">
            {busy ? "Saving..." : editing ? "Save changes" : "Add week"}
          </button>
          {editing && (
            <button type="button" onClick={reset} className="px-3 py-2 rounded-lg bg-surface-container font-semibold">Cancel edit</button>
          )}
          {datesLocked && <span className="text-on-surface-variant">Lesson plans are filed under this week, so only its name and session can change.</span>}
        </div>
      </form>

      {loading ? (
        <p className="text-on-surface-variant">Loading weeks...</p>
      ) : loadError ? (
        <div className="flex items-center gap-3">
          <p className="text-error font-semibold">{loadError}</p>
          <button type="button" onClick={load} className="px-3 py-1.5 rounded bg-surface-container font-semibold">Retry</button>
        </div>
      ) : weeks.length === 0 ? (
        <p className="text-on-surface-variant italic">No custom weeks yet. Standard weeks are in use.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-on-surface-variant uppercase text-[10px] border-b border-surface-container-high/40">
                <th className="py-2 pr-3">Week</th>
                <th className="py-2 pr-3">Dates</th>
                <th className="py-2 pr-3">Session</th>
                <th className="py-2 pr-3">Plans</th>
                <th className="py-2 pr-3">State</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {weeks.map((w) => (
                <tr key={w.id} className={w.startDate <= today && w.endDate >= today ? "bg-secondary/5" : ""}>
                  <td className="py-2 pr-3 font-semibold text-on-surface">{w.label}</td>
                  <td className="py-2 pr-3 font-mono">{w.startDate} to {w.endDate}</td>
                  <td className="py-2 pr-3 font-mono">{w.academicYear}</td>
                  <td className="py-2 pr-3">{w.planCount}</td>
                  <td className="py-2 pr-3">{w.state === "CURRENT" ? "Current" : w.state === "UPCOMING" ? "Upcoming" : "Past"}</td>
                  <td className="py-2 text-right whitespace-nowrap space-x-3">
                    <button type="button" onClick={() => startEdit(w)} className="text-secondary font-semibold hover:underline">Edit</button>
                    <button type="button" onClick={() => remove(w)} disabled={w.planCount > 0 || busy}
                      title={w.planCount > 0 ? "Lesson plans are filed under this week" : "Remove this week"}
                      className="text-error font-semibold hover:underline disabled:opacity-40 disabled:no-underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
