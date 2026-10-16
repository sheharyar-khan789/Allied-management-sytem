"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";
import { CONDUCT_RATING_LABELS, OBSERVATION_CATEGORIES, OBSERVATION_CATEGORY_LABELS } from "@/lib/exam-results";

export default function TeacherStudentsPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("all");
  const [loading, setLoading] = useState(true);

  // Quick note modal state
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteCategory, setNoteCategory] = useState("ACADEMIC");
  const [noteContent, setNoteContent] = useState("");
  const [noteSentiment, setNoteSentiment] = useState("NEUTRAL");
  const [noteExamId, setNoteExamId] = useState("");
  const [editingObsId, setEditingObsId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [noteNotice, setNoteNotice] = useState("");
  // Saved observations of the selected student (studentObservations collection, via the API).
  const [observations, setObservations] = useState<any[]>([]);
  const [examOptions, setExamOptions] = useState<any[]>([]);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsError, setObsError] = useState("");

  useEffect(() => {
    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setClasses(json.classes);
      });
  }, []);

  const fetchStudents = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedClassId !== "all") params.append("classId", selectedClassId);

      const res = await fetch(`/api/students?${params.toString()}`);
      const json = await res.json();
      if (json.success) setStudents(json.students);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, [selectedClassId]);

  const resetForm = () => {
    setEditingObsId(null);
    setNoteTitle("");
    setNoteCategory("ACADEMIC");
    setNoteContent("");
    setNoteSentiment("NEUTRAL");
    setNoteExamId("");
    setNoteError("");
  };

  const loadObservations = async (studentId: string) => {
    setObsLoading(true);
    setObsError("");
    try {
      const res = await fetch(`/api/observations?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setObsError(json.error || "Could not load saved observations.");
        return;
      }
      setObservations(json.observations || []);
      setExamOptions(json.exams || []);
    } catch {
      setObsError("Could not load saved observations.");
    } finally {
      setObsLoading(false);
    }
  };

  const openObservations = (st: any) => {
    setSelectedStudent(st);
    resetForm();
    setNoteNotice("");
    setObservations([]);
    setNoteModalOpen(true);
    loadObservations(st.id);
  };

  const startEdit = (obs: any) => {
    setEditingObsId(obs.id);
    setNoteTitle(obs.title || "");
    setNoteCategory(obs.category || "ACADEMIC");
    setNoteContent(obs.note || "");
    setNoteSentiment(obs.sentiment || "NEUTRAL");
    setNoteExamId(obs.examId || "");
    setNoteError("");
    setNoteNotice("");
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    if (!noteContent.trim()) {
      setNoteError("Please write the observation.");
      return;
    }
    setSavingNote(true);
    setNoteError("");
    setNoteNotice("");

    try {
      const res = await fetch("/api/observations", {
        method: editingObsId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingObsId ? { id: editingObsId } : { studentId: selectedStudent.id }),
          title: noteTitle,
          category: noteCategory,
          content: noteContent,
          sentiment: noteSentiment,
          examId: noteExamId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        setNoteNotice(editingObsId ? "Observation updated." : "Observation saved to the student's record.");
        resetForm();
        await loadObservations(selectedStudent.id);
      } else {
        setNoteError(json.error || "The observation could not be saved.");
      }
    } catch (err) {
      console.error(err);
      setNoteError("The observation could not be saved. Check your connection and try again.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              Student Roster & Observations
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {students.length} Authorized Students
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            View enrolled students in your classes and log behavioral commendations or observations.
          </p>
        </div>

        <select
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
          className="h-9 px-3 rounded-lg bg-surface-container text-xs font-semibold text-on-surface border border-outline-variant/40"
        >
          <option value="all">All Classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Student Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading student roster...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="col-span-full p-12 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-on-surface-variant text-xs">
            No students found for this class filter.
          </div>
        ) : (
          students.map((st) => (
            <div
              key={st.id}
              className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col justify-between space-y-3 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center font-bold text-sm">
                    {st.firstName.charAt(0)}
                    {st.lastName.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-on-surface">{st.fullName}</h3>
                    <span className="text-[11px] text-on-surface-variant font-mono">
                      {st.className} • Roll #{st.rollNumber}
                    </span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-tertiary-container/10 text-on-tertiary-container text-[10px] font-bold">
                  {st.attendanceRate}% Att.
                </span>
              </div>

              <div className="text-[11px] text-on-surface-variant space-y-1 bg-surface-container-low/60 p-2.5 rounded-lg">
                <div className="flex justify-between">
                  <span>Guardian:</span>
                  <span className="font-semibold text-on-surface">{st.guardianName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Admission:</span>
                  <span className="font-mono text-on-surface">{st.admissionNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span>Student Phone:</span>
                  {st.contactNumber ? (
                    <a href={`tel:${st.contactNumber}`} className="font-mono text-on-surface hover:underline">{st.contactNumber}</a>
                  ) : (
                    <span className="italic">Not provided</span>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-surface-container-low space-y-2">
                <div className="flex gap-2 text-[11px] font-semibold">
                  <a href={`/print/attendance/${st.id}`} className="flex-1 text-center py-1.5 rounded-lg bg-surface-container">Attendance</a>
                  <a href={`/print/report-card/${st.id}`} className="flex-1 text-center py-1.5 rounded-lg bg-surface-container">Report card</a>
                </div>
                <button
                  type="button"
                  onClick={() => openObservations(st)}
                  className="w-full py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-secondary text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">edit_note</span>
                  <span>Observations</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Observation Modal */}
      {noteModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="observation-heading"
            className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="observation-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Observations — {selectedStudent?.fullName}
              </h3>
              <button
                onClick={() => setNoteModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-on-surface">Saved observations</h4>
              {obsLoading ? (
                <p className="text-on-surface-variant">Loading saved observations...</p>
              ) : obsError ? (
                <p className="text-error font-semibold">{obsError}</p>
              ) : observations.length === 0 ? (
                <p className="text-on-surface-variant italic">No observations recorded for this student in the active session.</p>
              ) : (
                <ul className="space-y-2 max-h-56 overflow-y-auto">
                  {observations.map((o) => (
                    <li key={o.id} className="p-2.5 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-on-surface">{o.title || o.categoryLabel}</span>
                        <span className="text-[10px] text-on-surface-variant">{formatDate(o.date)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-on-surface">{o.note}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-on-surface-variant">
                        <span>{o.categoryLabel}</span>
                        <span>• Conduct: {o.conductLabel}</span>
                        <span>• {o.examName ? `Exam: ${o.examName}` : "General"}</span>
                        <span>• {o.teacherName}</span>
                        {o.canEdit && (
                          <button type="button" onClick={() => startEdit(o)} className="ml-auto text-secondary font-semibold hover:underline">
                            Edit
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={handleAddNote} className="space-y-3 text-xs border-t border-surface-container-low pt-3">
              <h4 className="font-bold text-on-surface">{editingObsId ? "Edit observation" : "Add an observation"}</h4>
              {noteNotice && <p className="text-on-tertiary-container font-semibold">{noteNotice}</p>}
              <div>
                <label htmlFor="students-title-key-highlight-1" className="block font-semibold text-on-surface mb-1">Title / Key Highlight (optional)</label>
                <input id="students-title-key-highlight-1"
                  type="text"
                  maxLength={200}
                  placeholder="e.g. Rapid Problem Solving in Geometry"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="students-category-2" className="block font-semibold text-on-surface mb-1">Category</label>
                <select id="students-category-2"
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  {OBSERVATION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{OBSERVATION_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="students-conduct-rating" className="block font-semibold text-on-surface mb-1">Conduct Rating</label>
                  <select id="students-conduct-rating"
                    value={noteSentiment}
                    onChange={(e) => setNoteSentiment(e.target.value)}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  >
                    {Object.entries(CONDUCT_RATING_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="students-observation-exam" className="block font-semibold text-on-surface mb-1">Report Card</label>
                  <select id="students-observation-exam"
                    value={noteExamId}
                    onChange={(e) => setNoteExamId(e.target.value)}
                    className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                  >
                    <option value="">General (every report card)</option>
                    {examOptions.map((ex) => (
                      <option key={ex.id} value={ex.id}>{ex.name}{ex.term ? ` (${ex.term})` : ""}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="students-observation-remarks-3" className="block font-semibold text-on-surface mb-1">Observation Remarks</label>
                <textarea id="students-observation-remarks-3"
                  required
                  rows={3}
                  placeholder="Enter observation notes for student dossier..."
                  value={noteContent}
                  maxLength={4000}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="w-full p-2 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              {noteError && <p className="text-error font-semibold">{noteError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => (editingObsId ? resetForm() : setNoteModalOpen(false))}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  {editingObsId ? "Cancel edit" : "Close"}
                </button>
                <button
                  type="submit"
                  disabled={savingNote}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {savingNote ? "Saving..." : editingObsId ? "Save Changes" : "Save to Dossier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
