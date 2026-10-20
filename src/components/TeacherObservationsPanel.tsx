"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";
import {
  TEACHER_OBSERVATION_CATEGORIES,
  TEACHER_OBSERVATION_CATEGORY_LABELS,
} from "@/lib/teacher-observations";

/**
 * Observations about a teacher. `mode="admin"` (admin teacher profile): list, add, edit and
 * delete the observations for `teacherId`. `mode="teacher"` (teacher portal): read-only list of
 * the signed-in teacher's own observations. Display only — /api/teacher-observations decides
 * what each caller may read or change.
 */
export default function TeacherObservationsPanel({ mode, teacherId }: { mode: "admin" | "teacher"; teacherId?: string }) {
  const isAdmin = mode === "admin";
  const [observations, setObservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "GENERAL" });
  const [editingId, setEditingId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [openHistoryId, setOpenHistoryId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = isAdmin && teacherId ? `?teacherId=${encodeURIComponent(teacherId)}` : "";
      const res = await fetch(`/api/teacher-observations${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || "Could not load observations.");
        return;
      }
      setObservations(json.observations || []);
    } catch {
      setError("Could not load observations. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, teacherId]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setForm({ title: "", content: "", category: "GENERAL" });
    setEditingId("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.content.trim() || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/teacher-observations", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : { teacherId, ...form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setNotice(json.error || "Could not save the observation.");
        return;
      }
      setNotice(editingId ? "Observation updated. The previous text is kept in its history." : "Observation saved.");
      resetForm();
      await load();
    } catch {
      setNotice("Could not save the observation. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/teacher-observations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setNotice(json.error || "Could not delete the observation.");
        return;
      }
      setConfirmDeleteId("");
      setNotice("Observation deleted.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 rounded-lg bg-surface-container-low text-on-surface text-xs border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20";

  return (
    <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col gap-4">
      <div>
        <h2 className="font-headline-md text-sm font-bold text-on-surface">
          {isAdmin ? "Teacher Observations" : "Observations About Me"}
        </h2>
        <p className="text-[11px] text-on-surface-variant mt-0.5">
          {isAdmin
            ? "Written by administration. Visible only to administrators and this teacher."
            : "Written by school administration. Only you and administrators can see these."}
        </p>
      </div>

      {notice && (
        <div className="p-2.5 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-semibold">{notice}</div>
      )}

      {isAdmin && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              aria-label="Observation title"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Title (optional)"
              className={`${inputClass} h-9 sm:col-span-2`}
            />
            <select
              aria-label="Observation category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={`${inputClass} h-9`}
            >
              {TEACHER_OBSERVATION_CATEGORIES.map((c) => (
                <option key={c} value={c}>{TEACHER_OBSERVATION_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <textarea
            aria-label="Observation text"
            value={form.content}
            maxLength={8000}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="Write the observation..."
            rows={4}
            className={`${inputClass} py-2`}
          />
          <div className="flex justify-end gap-2">
            {editingId && (
              <button type="button" onClick={resetForm} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container">
                Cancel edit
              </button>
            )}
            <button
              type="submit"
              disabled={saving || !form.content.trim()}
              className="px-4 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId ? "Save changes" : "Add observation"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-on-surface-variant">Loading observations...</p>
      ) : error ? (
        <p className="text-xs text-error font-semibold">{error}</p>
      ) : observations.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No observations yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {observations.map((o) => (
            <li key={o.id} className="p-3 rounded-lg border border-surface-container-high/60 bg-surface-container-low/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-semibold text-on-surface shrink-0">{o.categoryLabel}</span>
                  <span className="text-xs font-bold text-on-surface truncate">{o.title || "Observation"}</span>
                </div>
                <span className="text-[10px] text-on-surface-variant">
                  {o.authorName} • {formatDate(o.date)}
                  {o.updatedAt !== o.date ? ` • edited ${formatDate(o.updatedAt)}` : ""}
                </span>
              </div>
              <p className="text-xs text-on-surface mt-2 whitespace-pre-wrap break-words">{o.note}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] font-semibold">
                {o.editHistory?.length > 0 && (
                  <button type="button" onClick={() => setOpenHistoryId(openHistoryId === o.id ? "" : o.id)} className="text-secondary hover:underline">
                    {openHistoryId === o.id ? "Hide" : "Show"} edit history ({o.editHistory.length})
                  </button>
                )}
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(o.id);
                        setForm({ title: o.title || "", content: o.note || "", category: o.category });
                        setNotice("");
                      }}
                      className="text-secondary hover:underline"
                    >
                      Edit
                    </button>
                    {confirmDeleteId === o.id ? (
                      <span className="flex gap-2">
                        <button type="button" disabled={saving} onClick={() => remove(o.id)} className="text-error hover:underline">Confirm delete</button>
                        <button type="button" onClick={() => setConfirmDeleteId("")} className="text-on-surface-variant hover:underline">Keep</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDeleteId(o.id)} className="text-error hover:underline">Delete</button>
                    )}
                  </>
                )}
              </div>
              {openHistoryId === o.id && (
                <ol className="mt-2 flex flex-col gap-1.5 border-l-2 border-surface-container-high pl-3">
                  {o.editHistory.map((h: any, i: number) => (
                    <li key={i} className="text-[11px] text-on-surface-variant">
                      <span className="font-semibold">Before edit on {formatDate(h.at)}{h.byName ? ` by ${h.byName}` : ""}:</span>{" "}
                      {h.previousTitle ? `${h.previousTitle} — ` : ""}
                      <span className="whitespace-pre-wrap">{h.previousNote}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
