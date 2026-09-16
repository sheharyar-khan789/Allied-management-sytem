"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

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
  const [savingNote, setSavingNote] = useState(false);

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

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || !noteTitle || !noteContent) return;
    setSavingNote(true);

    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          title: noteTitle,
          category: noteCategory,
          content: noteContent,
        }),
      });

      if (res.ok) {
        setNoteModalOpen(false);
        setNoteTitle("");
        setNoteContent("");
        alert("Observation note saved to student academic dossier.");
      }
    } catch (err) {
      console.error(err);
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
              </div>

              <div className="pt-2 border-t border-surface-container-low space-y-2">
                <div className="flex gap-2 text-[11px] font-semibold">
                  <a href={`/print/attendance/${st.id}`} className="flex-1 text-center py-1.5 rounded-lg bg-surface-container">Attendance</a>
                  <a href={`/print/report-card/${st.id}`} className="flex-1 text-center py-1.5 rounded-lg bg-surface-container">Report card</a>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStudent(st);
                    setNoteModalOpen(true);
                  }}
                  className="w-full py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-secondary text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">edit_note</span>
                  <span>Add Quick Observation</span>
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
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="observation-heading" className="font-headline-md text-sm font-bold text-on-surface">
                Observation for {selectedStudent?.fullName}
              </h3>
              <button
                onClick={() => setNoteModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddNote} className="space-y-3 text-xs">
              <div>
                <label htmlFor="students-title-key-highlight-1" className="block font-semibold text-on-surface mb-1">Title / Key Highlight</label>
                <input id="students-title-key-highlight-1"
                  type="text"
                  required
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
                  <option value="ACADEMIC">Academic Excellence</option>
                  <option value="LEADERSHIP">Leadership & Citizenship</option>
                  <option value="CONDUCT">Behavior & Conduct</option>
                  <option value="PARTICIPATION">Classroom Participation</option>
                </select>
              </div>

              <div>
                <label htmlFor="students-observation-remarks-3" className="block font-semibold text-on-surface mb-1">Observation Remarks</label>
                <textarea id="students-observation-remarks-3"
                  required
                  rows={3}
                  placeholder="Enter observation notes for student dossier..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="w-full p-2 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setNoteModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNote}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {savingNote ? "Saving..." : "Save to Dossier"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
