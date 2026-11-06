"use client";

import React, { useCallback, useEffect, useState } from "react";

export interface WeekRow {
  id: string;
  weekId: string;
  label: string;
  weekNumber?: number | null;
  status?: "ACTIVE" | "INACTIVE";
  order?: number | null;
  academicYear: string;
  startDate: string;
  endDate: string;
  planCount: number;
  state: "PAST" | "CURRENT" | "UPCOMING";
  datesEditable: boolean;
}

const input =
  "w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 text-xs focus:outline-none focus:ring-1 focus:ring-secondary";

/**
 * Admin schedule of lesson-plan weeks: create custom weeks of any dates and any year (there is no
 * hardcoded last week), rename, set custom week numbers, activate/deactivate, re-date them while
 * nothing is filed under them, remove unused ones, search, filter, and sort.
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

  // Form state
  const [form, setForm] = useState<{
    label: string;
    weekNumber: string;
    startDate: string;
    endDate: string;
    academicYear: string;
    status: "ACTIVE" | "INACTIVE";
    order: string;
  }>({
    label: "",
    weekNumber: "",
    startDate: "",
    endDate: "",
    academicYear: "",
    status: "ACTIVE",
    order: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  // Search & Filter & Sort state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [sortOption, setSortOption] = useState<"startDate_asc" | "startDate_desc" | "weekNumber_asc" | "weekNumber_desc" | "label_asc">("startDate_asc");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [sortBy, sortOrder] = sortOption.split("_") as [string, "asc" | "desc"];
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (sortBy) params.set("sortBy", sortBy);
      if (sortOrder) params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/lesson-plan-weeks?${params.toString()}`, { cache: "no-store" });
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
  }, [search, statusFilter, sortOption]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setForm({
      label: "",
      weekNumber: "",
      startDate: "",
      endDate: "",
      academicYear: "",
      status: "ACTIVE",
      order: "",
    });
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");

    if (form.weekNumber) {
      const parsed = Number(form.weekNumber);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 999) {
        setError("Week number must be a whole number between 1 and 999.");
        return;
      }
    }

    setBusy(true);
    try {
      const editing = weeks.find((w) => w.id === editingId);
      const payload: Record<string, any> = {
        label: form.label,
        status: form.status,
      };

      if (form.weekNumber) {
        payload.weekNumber = Number(form.weekNumber);
      }
      if (form.order) {
        payload.order = Number(form.order);
      }
      if (form.academicYear) {
        payload.academicYear = form.academicYear;
      }

      // Dates of a week that already holds plans are not sent (the server would refuse them).
      if (!editing || editing.datesEditable) {
        payload.startDate = form.startDate;
        payload.endDate = form.endDate;
      }

      const res = await fetch(
        editing ? `/api/lesson-plan-weeks/${encodeURIComponent(editing.id)}` : "/api/lesson-plan-weeks",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "The week could not be saved.");
        return;
      }
      setMessage(editing ? "Week updated successfully." : "Week created. It is now available to teachers and in the review page.");
      reset();
      await load();
      onChanged?.();
    } catch {
      setError("The week could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (w: WeekRow) => {
    if (busy) return;
    const nextStatus = w.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/lesson-plan-weeks/${encodeURIComponent(w.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Could not set week status to ${nextStatus}.`);
        return;
      }
      setMessage(`Week "${w.label}" is now ${nextStatus === "ACTIVE" ? "Active" : "Inactive"}.`);
      await load();
      onChanged?.();
    } catch {
      setError(`Failed to update status for "${w.label}".`);
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
      setMessage("Week removed successfully.");
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (w: WeekRow) => {
    setEditingId(w.id);
    setForm({
      label: w.label,
      weekNumber: w.weekNumber !== undefined && w.weekNumber !== null ? String(w.weekNumber) : "",
      startDate: w.startDate,
      endDate: w.endDate,
      academicYear: w.academicYear,
      status: w.status ?? "ACTIVE",
      order: w.order !== undefined && w.order !== null ? String(w.order) : "",
    });
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
          Standard Monday–Sunday weeks are always available, with no end date. Add or manage custom weeks for any dates (such as
          term weeks, exam blocks, or holiday weeks), set custom week numbers, and activate or deactivate weeks.
        </p>
      </div>

      {message && (
        <p role="status" className="p-2.5 rounded-lg bg-tertiary-container/15 text-tertiary font-semibold border border-tertiary/20">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="p-2.5 rounded-lg bg-error-container/20 text-error font-semibold border border-error/20">
          {error}
        </p>
      )}

      {/* Week Form */}
      <form onSubmit={submit} className="p-4 rounded-lg bg-surface-container-low/40 border border-outline-variant/30 space-y-3">
        <h3 className="font-semibold text-on-surface text-xs uppercase tracking-wider">
          {editing ? `Editing: ${editing.label}` : "Create Custom Week"}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
          <div className="sm:col-span-1">
            <label htmlFor="lpw-num" className="block font-semibold text-on-surface mb-1">
              Week #
            </label>
            <input
              id="lpw-num"
              type="number"
              min="1"
              max="999"
              className={input}
              placeholder="e.g. 1"
              value={form.weekNumber}
              onChange={(e) => setForm({ ...form, weekNumber: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="lpw-label" className="block font-semibold text-on-surface mb-1">
              Week name *
            </label>
            <input
              id="lpw-label"
              className={input}
              maxLength={80}
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. First Term — Week 1"
            />
          </div>
          <div>
            <label htmlFor="lpw-start" className="block font-semibold text-on-surface mb-1">
              Start date *
            </label>
            <input
              id="lpw-start"
              type="date"
              className={input}
              required
              value={form.startDate}
              disabled={datesLocked}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="lpw-end" className="block font-semibold text-on-surface mb-1">
              End date *
            </label>
            <input
              id="lpw-end"
              type="date"
              className={input}
              required
              value={form.endDate}
              disabled={datesLocked}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="lpw-year" className="block font-semibold text-on-surface mb-1">
              Session
            </label>
            <input
              id="lpw-year"
              className={`${input} font-mono`}
              placeholder={defaultYear || "2026-2027"}
              pattern="\d{4}-\d{4}"
              value={form.academicYear}
              onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-on-surface">Status:</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="lpw-status"
                  value="ACTIVE"
                  checked={form.status === "ACTIVE"}
                  onChange={() => setForm({ ...form, status: "ACTIVE" })}
                  className="text-secondary focus:ring-secondary"
                />
                <span className="text-on-surface">Active</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="lpw-status"
                  value="INACTIVE"
                  checked={form.status === "INACTIVE"}
                  onChange={() => setForm({ ...form, status: "INACTIVE" })}
                  className="text-secondary focus:ring-secondary"
                />
                <span className="text-on-surface">Inactive (Deactivated)</span>
              </label>
            </div>
            {datesLocked && (
              <span className="text-on-surface-variant text-[11px]">
                Lesson plans are filed under this week, so dates cannot be changed.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {editing && (
              <button
                type="button"
                onClick={reset}
                className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold"
              >
                Cancel edit
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
            >
              {busy ? "Saving..." : editing ? "Save changes" : "Add week"}
            </button>
          </div>
        </div>
      </form>

      {/* Search, Filter, and Sort Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center pt-2">
        <div className="sm:col-span-2">
          <input
            type="text"
            className={input}
            placeholder="Search weeks by name or week number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <select
            className={input}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE")}
          >
            <option value="ALL">All Statuses (Active & Inactive)</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive (Deactivated) Only</option>
          </select>
        </div>
        <div>
          <select
            className={input}
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
          >
            <option value="startDate_asc">Sort by: Date (Earliest first)</option>
            <option value="startDate_desc">Sort by: Date (Latest first)</option>
            <option value="weekNumber_asc">Sort by: Week # (Low to High)</option>
            <option value="weekNumber_desc">Sort by: Week # (High to Low)</option>
            <option value="label_asc">Sort by: Name (A to Z)</option>
          </select>
        </div>
      </div>

      {/* Week Table */}
      {loading ? (
        <p className="text-on-surface-variant">Loading weeks...</p>
      ) : loadError ? (
        <div className="flex items-center gap-3">
          <p className="text-error font-semibold">{loadError}</p>
          <button type="button" onClick={load} className="px-3 py-1.5 rounded bg-surface-container font-semibold">
            Retry
          </button>
        </div>
      ) : weeks.length === 0 ? (
        <p className="text-on-surface-variant italic">
          {search || statusFilter !== "ALL" ? "No weeks matching the filter." : "No custom weeks yet. Standard weeks are in use."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-on-surface-variant uppercase text-[10px] border-b border-surface-container-high/40">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Week Name</th>
                <th className="py-2 pr-3">Date Range</th>
                <th className="py-2 pr-3">Session</th>
                <th className="py-2 pr-3">Plans</th>
                <th className="py-2 pr-3">Timing</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {weeks.map((w) => (
                <tr key={w.id} className={w.startDate <= today && w.endDate >= today ? "bg-secondary/5" : ""}>
                  <td className="py-2 pr-3 font-mono font-bold text-on-surface">
                    {w.weekNumber !== undefined && w.weekNumber !== null ? `Week ${w.weekNumber}` : "—"}
                  </td>
                  <td className="py-2 pr-3 font-semibold text-on-surface">{w.label}</td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">
                    {w.startDate} to {w.endDate}
                  </td>
                  <td className="py-2 pr-3 font-mono">{w.academicYear}</td>
                  <td className="py-2 pr-3">{w.planCount}</td>
                  <td className="py-2 pr-3">
                    <span className="text-[11px] text-on-surface-variant">
                      {w.state === "CURRENT" ? "Current" : w.state === "UPCOMING" ? "Upcoming" : "Past"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {w.status === "INACTIVE" ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-container-high text-on-surface-variant">
                        Inactive
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => toggleStatus(w)}
                      disabled={busy}
                      className="text-on-surface-variant hover:text-on-surface font-semibold underline text-[11px]"
                    >
                      {w.status === "INACTIVE" ? "Activate" : "Deactivate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(w)}
                      className="text-secondary font-semibold hover:underline text-[11px]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(w)}
                      disabled={w.planCount > 0 || busy}
                      title={w.planCount > 0 ? "Lesson plans are filed under this week" : "Remove this week"}
                      className="text-error font-semibold hover:underline text-[11px] disabled:opacity-40 disabled:no-underline"
                    >
                      Remove
                    </button>
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
