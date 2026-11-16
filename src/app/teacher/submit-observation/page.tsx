"use client";

import React, { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";
import {
  TEACHER_OBSERVATION_CATEGORIES,
  TEACHER_OBSERVATION_CATEGORY_LABELS,
  TEACHER_OBSERVATION_RATINGS,
  TEACHER_OBSERVATION_RATING_LABELS,
} from "@/lib/teacher-observations";

/**
 * Coordinator-only: submit a draft observation about another teacher for admin review. Never
 * publishes directly — every submission is saved PENDING and only becomes a real observation if
 * an admin approves it (see /api/teacher-observation-submissions). The nav link to this page is
 * shown only when the server-resolved `canSubmitObservations` flag is true, but the POST route
 * re-checks that flag itself regardless of how this page was reached.
 */

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved & published",
  REJECTED: "Rejected",
};

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-surface-container-high text-on-surface",
  APPROVED: "bg-tertiary-container/30 text-on-tertiary-container",
  REJECTED: "bg-error-container/20 text-error",
};

export default function SubmitObservationPage() {
  const [teachers, setTeachers] = useState<{ id: string; fullName: string }[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [coordinator, setCoordinator] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("TEACHING_QUALITY");
  const [rating, setRating] = useState("SATISFACTORY");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/teacher-observation-submissions", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || "Could not load your submissions.");
        return;
      }
      setCoordinator(json.coordinator !== false);
      setTeachers(json.teachers || []);
      setSubmissions(json.submissions || []);
    } catch {
      setError("Could not load your submissions. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    if (!teacherId) return setSubmitError("Select the teacher this observation is about.");
    if (!note.trim()) return setSubmitError("Please write the observation.");
    setSaving(true);
    try {
      const res = await fetch("/api/teacher-observation-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId, observationDate: date, category, rating, title, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setSubmitError(json.error || "Could not submit the observation.");
        return;
      }
      setTeacherId("");
      setTitle("");
      setNote("");
      setCategory("TEACHING_QUALITY");
      setRating("SATISFACTORY");
      setNotice("Submitted for admin review.");
      await load();
    } catch {
      setSubmitError("Could not submit the observation. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!loading && !coordinator) {
    return (
      <div className="p-10 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40">
        <p className="text-sm font-semibold text-on-surface">You are not authorized to submit observations.</p>
        <p className="text-xs text-on-surface-variant mt-1">Ask an administrator to grant Coordinator Observation Submission permission.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Submit Observation</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Submit a draft observation about another teacher. It stays private and pending until an administrator reviews and approves it — it never reaches the teacher&apos;s portal directly.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold">{notice}</div>
      )}

      <form onSubmit={submit} className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3 text-xs">
        {submitError && (
          <div className="p-2.5 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{submitError}</div>
        )}
        <div>
          <label htmlFor="sub-teacher" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Teacher (this observation is about)</label>
          <select id="sub-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
            <option value="">Select a teacher...</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="sub-date" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Date</label>
            <input id="sub-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
          </div>
          <div>
            <label htmlFor="sub-category" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Category</label>
            <select id="sub-category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
              {TEACHER_OBSERVATION_CATEGORIES.map((c) => <option key={c} value={c}>{TEACHER_OBSERVATION_CATEGORY_LABELS[c] || c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sub-rating" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Rating</label>
            <select id="sub-rating" value={rating} onChange={(e) => setRating(e.target.value)} className="w-full h-9 px-2 rounded-lg bg-surface-container-low text-xs font-semibold text-on-surface border border-outline-variant/40">
              {TEACHER_OBSERVATION_RATINGS.map((r) => <option key={r} value={r}>{TEACHER_OBSERVATION_RATING_LABELS[r] || r}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="sub-title" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Title (optional)</label>
          <input id="sub-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
        </div>
        <div>
          <label htmlFor="sub-note" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Observation</label>
          <textarea id="sub-note" maxLength={4000} rows={6} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe what was observed..." className="w-full px-3 py-2 rounded-lg bg-surface-container-low text-xs text-on-surface border border-outline-variant/40" />
        </div>
        <button type="submit" disabled={saving || !note.trim() || !teacherId} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
          {saving ? "Submitting..." : "Submit for Review"}
        </button>
      </form>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        <div className="p-4 border-b border-surface-container-low">
          <h2 className="font-headline-md text-sm font-bold text-on-surface">Your Submissions</h2>
        </div>
        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="w-6 h-6 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : submissions.length === 0 ? (
          <p className="p-6 text-center text-xs text-on-surface-variant">No submissions yet.</p>
        ) : (
          <div className="divide-y divide-surface-container-low">
            {submissions.map((s) => (
              <div key={s.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-on-surface">{s.teacherName || s.teacherId}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_CLASS[s.status] || ""}`}>
                    {STATUS_LABEL[s.status] || s.status}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant">
                  Submitted {formatDate(s.submittedAt)} • {s.title || s.note.slice(0, 80)}
                </p>
                {s.status === "REJECTED" && s.reviewNote && (
                  <p className="text-[11px] text-error">Reason: {s.reviewNote}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
