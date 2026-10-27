"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/utils";
import {
  TEACHER_OBSERVATION_CATEGORIES,
  TEACHER_OBSERVATION_CATEGORY_LABELS,
  TEACHER_OBSERVATION_RATINGS,
  TEACHER_OBSERVATION_RATING_LABELS,
} from "@/lib/teacher-observations";

/**
 * Admin-only screen for writing and reviewing formal evaluation notes about teachers. Distinct
 * from /admin/observations (a teacher's note about a student) — different collection, different
 * API (`/api/teacher-observations`), only an ADMIN can write or edit here.
 */
export default function AdminTeacherObservationsPage() {
  return (
    <Suspense fallback={null}>
      <AdminTeacherObservationsContent />
    </Suspense>
  );
}

function AdminTeacherObservationsContent() {
  // A teacher profile page can deep-link here with ?teacherId=... to pre-filter this screen.
  const searchParams = useSearchParams();
  const [observations, setObservations] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [teacherFilter, setTeacherFilter] = useState(() => searchParams.get("teacherId") || "");
  const [category, setCategory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [openId, setOpenId] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editRating, setEditRating] = useState("SATISFACTORY");
  const [editCategory, setEditCategory] = useState("TEACHING_QUALITY");
  const [editDate, setEditDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [notice, setNotice] = useState("");

  // Add-observation modal
  const [addOpen, setAddOpen] = useState(false);
  const [addTeacherId, setAddTeacherId] = useState("");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addCategory, setAddCategory] = useState("TEACHING_QUALITY");
  const [addRating, setAddRating] = useState("SATISFACTORY");
  const [addTitle, setAddTitle] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (teacherFilter) params.set("teacherId", teacherFilter);
      if (category) params.set("category", category);
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      const res = await fetch(`/api/teacher-observations?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || "Could not load observations.");
        return;
      }
      setObservations(json.observations || []);
      if (json.teachers) setTeachers(json.teachers);
    } catch {
      setError("Could not load observations. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [search, teacherFilter, category, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const openObservation = observations.find((o) => o.id === openId);

  const startEdit = () => {
    if (!openObservation) return;
    setEditTitle(openObservation.title || "");
    setEditNote(openObservation.note || "");
    setEditRating(openObservation.rating);
    setEditCategory(openObservation.category);
    setEditDate(openObservation.observationDate);
    setEditing(true);
    setNotice("");
  };

  const saveEdit = async () => {
    if (!openObservation || !editNote.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/teacher-observations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: openObservation.id,
          title: editTitle,
          note: editNote,
          rating: editRating,
          category: editCategory,
          observationDate: editDate,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setNotice(json.error || "Could not save the change.");
        return;
      }
      setEditing(false);
      setNotice("Observation updated. The original text is kept in its edit history.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/teacher-observations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setNotice(json.error || "Could not delete the observation.");
        return;
      }
      setConfirmDeleteId("");
      setOpenId("");
      setNotice("Observation deleted.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const submitAdd = async () => {
    setAddError("");
    if (!addTeacherId) {
      setAddError("Select a teacher.");
      return;
    }
    if (!addNote.trim()) {
      setAddError("Please write the observation.");
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch("/api/teacher-observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId: addTeacherId,
          observationDate: addDate,
          category: addCategory,
          rating: addRating,
          title: addTitle,
          note: addNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setAddError(json.error || "Could not save the observation.");
        return;
      }
      setAddOpen(false);
      setAddTeacherId("");
      setAddTitle("");
      setAddNote("");
      setAddCategory("TEACHING_QUALITY");
      setAddRating("SATISFACTORY");
      setNotice("Observation added.");
      await load();
    } catch {
      setAddError("Could not save the observation. Check your connection and try again.");
    } finally {
      setAddSaving(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Teacher Observations</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {observations.length} Note{observations.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Formal evaluation notes written about a teacher. Only an administrator can add, edit, or remove one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setAddOpen(true); setAddError(""); }}
          className="shrink-0 h-9 px-4 rounded-lg bg-secondary text-on-secondary text-xs font-bold hover:bg-secondary/90 inline-flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">add</span> Add Observation
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>
      )}
      {notice && !openId && !addOpen && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold">{notice}</div>
      )}

      {/* Filter bar */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <label htmlFor="tobs-search" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Search</label>
          <span className="material-symbols-outlined absolute left-3 top-[30px] text-on-surface-variant text-[18px]">search</span>
          <input
            id="tobs-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Text, title, or teacher name..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40"
          />
        </div>
        <div>
          <label htmlFor="tobs-teacher" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Teacher</label>
          <select id="tobs-teacher" value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
            <option value="">All teachers</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tobs-category" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Category</label>
          <select id="tobs-category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
            <option value="">All categories</option>
            {TEACHER_OBSERVATION_CATEGORIES.map((c) => <option key={c} value={c}>{TEACHER_OBSERVATION_CATEGORY_LABELS[c] || c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tobs-from" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">From</label>
          <input id="tobs-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
        </div>
        <div>
          <label htmlFor="tobs-to" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">To</label>
          <input id="tobs-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
        </div>
        {(teacherFilter || category || fromDate || toDate || search) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setTeacherFilter(""); setCategory(""); setFromDate(""); setToDate(""); }}
            className="h-9 px-3 rounded-lg bg-surface-container text-on-surface-variant text-xs font-semibold hover:bg-surface-container-high"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading observations...</p>
          </div>
        ) : observations.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">fact_check</span>
            <p className="text-sm font-semibold text-on-surface">No observations match this filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Date</th>
                  <th className="py-3 px-4 font-bold">Teacher</th>
                  <th className="py-3 px-4 font-bold">Category</th>
                  <th className="py-3 px-4 font-bold">Rating</th>
                  <th className="py-3 px-4 font-bold">Title / Excerpt</th>
                  <th className="py-3 px-4 font-bold">Author</th>
                  <th className="py-3 px-4 font-bold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {observations.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-container-low/40 cursor-pointer" onClick={() => { setOpenId(o.id); setEditing(false); setNotice(""); }}>
                    <td className="py-3 px-4 text-on-surface-variant whitespace-nowrap font-mono text-[11px]">{formatDate(o.observationDate)}</td>
                    <td className="py-3 px-4 font-semibold text-on-surface">{o.teacherName || "Unknown teacher"}</td>
                    <td className="py-3 px-4">
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-semibold text-on-surface">{o.categoryLabel}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        o.rating === "EXCELLENT" ? "bg-tertiary-container/30 text-on-tertiary-container" :
                        o.rating === "NEEDS_IMPROVEMENT" ? "bg-error-container/20 text-error" :
                        "bg-surface-container-high text-on-surface"
                      }`}>{o.ratingLabel}</span>
                    </td>
                    <td className="py-3 px-4 font-medium text-on-surface max-w-sm truncate">{o.title || o.note}</td>
                    <td className="py-3 px-4 text-on-surface-variant">{o.authorName}</td>
                    <td className="py-3 px-4 text-secondary font-semibold">
                      {o.editHistory.length > 0 ? `Edited (${o.editHistory.length})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add modal */}
      {addOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAddOpen(false)}>
          <div className="bg-surface-container-lowest rounded-xl shadow-lg max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-headline-md text-base font-bold text-on-surface">Add Observation</h2>
              <button type="button" onClick={() => setAddOpen(false)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {addError && (
              <div className="p-2.5 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{addError}</div>
            )}

            <div>
              <label htmlFor="tobs-add-teacher" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Teacher</label>
              <select id="tobs-add-teacher" value={addTeacherId} onChange={(e) => setAddTeacherId(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
                <option value="">Select a teacher...</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="tobs-add-date" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Date</label>
                <input id="tobs-add-date" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
              </div>
              <div>
                <label htmlFor="tobs-add-category" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Category</label>
                <select id="tobs-add-category" value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
                  {TEACHER_OBSERVATION_CATEGORIES.map((c) => <option key={c} value={c}>{TEACHER_OBSERVATION_CATEGORY_LABELS[c] || c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="tobs-add-rating" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Rating</label>
                <select id="tobs-add-rating" value={addRating} onChange={(e) => setAddRating(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
                  {TEACHER_OBSERVATION_RATINGS.map((r) => <option key={r} value={r}>{TEACHER_OBSERVATION_RATING_LABELS[r] || r}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="tobs-add-title" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Title (optional)</label>
              <input id="tobs-add-title" maxLength={200} value={addTitle} onChange={(e) => setAddTitle(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
            </div>
            <div>
              <label htmlFor="tobs-add-note" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Observation</label>
              <textarea id="tobs-add-note" maxLength={4000} rows={6} value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="Describe what was observed..." className="w-full px-3 py-2 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={submitAdd} disabled={addSaving || !addNote.trim() || !addTeacherId} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
                {addSaving ? "Saving..." : "Save Observation"}
              </button>
              <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {openObservation && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setOpenId(""); setConfirmDeleteId(""); }}>
          <div className="bg-surface-container-lowest rounded-xl shadow-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold text-on-surface-variant uppercase">{openObservation.categoryLabel} • {openObservation.ratingLabel}</p>
                <h2 className="font-headline-md text-base font-bold text-on-surface mt-0.5">{openObservation.title || "Untitled note"}</h2>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  {openObservation.teacherName || "Unknown teacher"} • Written by {openObservation.authorName} on {formatDate(openObservation.observationDate)}
                  {openObservation.updatedAt !== openObservation.createdAt ? ` • last edited ${formatDate(openObservation.updatedAt)}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => { setOpenId(""); setConfirmDeleteId(""); }} className="text-on-surface-variant hover:text-on-surface shrink-0">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {notice && (
              <div className="p-2.5 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold">{notice}</div>
            )}

            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="tobs-edit-date" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Date</label>
                    <input id="tobs-edit-date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
                  </div>
                  <div>
                    <label htmlFor="tobs-edit-category" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Category</label>
                    <select id="tobs-edit-category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
                      {TEACHER_OBSERVATION_CATEGORIES.map((c) => <option key={c} value={c}>{TEACHER_OBSERVATION_CATEGORY_LABELS[c] || c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="tobs-edit-rating" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Rating</label>
                    <select id="tobs-edit-rating" value={editRating} onChange={(e) => setEditRating(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
                      {TEACHER_OBSERVATION_RATINGS.map((r) => <option key={r} value={r}>{TEACHER_OBSERVATION_RATING_LABELS[r] || r}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="tobs-edit-title" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Title</label>
                  <input id="tobs-edit-title" maxLength={200} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
                </div>
                <div>
                  <label htmlFor="tobs-edit-note" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Observation Text</label>
                  <textarea id="tobs-edit-note" maxLength={4000} rows={6} value={editNote} onChange={(e) => setEditNote(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={saveEdit} disabled={saving || !editNote.trim()} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
                    {saving ? "Saving..." : "Save Correction"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">{openObservation.note}</p>

                <div className="flex gap-2 pt-2 border-t border-surface-container-high/40">
                  <button type="button" onClick={startEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high">
                    <span className="material-symbols-outlined text-[16px]">edit</span> Edit
                  </button>
                  {confirmDeleteId === openObservation.id ? (
                    <>
                      <span className="text-xs text-error font-semibold self-center">Delete this observation permanently from view?</span>
                      <button type="button" onClick={() => confirmDelete(openObservation.id)} disabled={saving} className="px-3 py-1.5 rounded-lg bg-error text-on-error text-xs font-semibold hover:bg-error/90 disabled:opacity-50">
                        {saving ? "Deleting..." : "Confirm Delete"}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId("")} className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(openObservation.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error-container/10 text-error text-xs font-semibold hover:bg-error-container/20">
                      <span className="material-symbols-outlined text-[16px]">delete</span> Delete
                    </button>
                  )}
                </div>

                {openObservation.editHistory.length > 0 && (
                  <div className="pt-3 border-t border-surface-container-high/40 space-y-2">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase">Edit History ({openObservation.editHistory.length})</p>
                    {openObservation.editHistory.slice().reverse().map((h: any, i: number) => (
                      <div key={i} className="p-2.5 rounded-lg bg-surface-container-low text-xs space-y-1">
                        <p className="text-[10px] text-on-surface-variant">Before {formatDate(h.at)}, edited by {h.byName || "an authorized user"}</p>
                        {h.previousTitle && <p className="font-semibold text-on-surface">{h.previousTitle}</p>}
                        <p className="text-on-surface-variant whitespace-pre-wrap">{h.previousNote}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
