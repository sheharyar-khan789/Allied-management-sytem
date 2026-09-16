"use client";

import React, { useEffect, useState } from "react";
import { calculateGrade } from "@/lib/utils";

export default function TeacherGradebookPage() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [studentMarks, setStudentMarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/exams")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.activeExam?.schedules) {
          setSchedules(json.activeExam.schedules);
          if (json.activeExam.schedules.length > 0) {
            const first = json.activeExam.schedules[0];
            setSelectedScheduleId(first.id);
            if (first.results) {
              setStudentMarks(
                first.results.map((r: any) => ({
                  studentId: r.studentId,
                  name: `${r.student?.firstName} ${r.student?.lastName}`,
                  rollNumber: r.student?.rollNumber,
                  marksObtained: r.marksObtained,
                  maxMarks: r.maxMarks,
                  grade: r.grade,
                  gpa: r.gpa,
                }))
              );
            }
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleScheduleChange = (id: string) => {
    setSelectedScheduleId(id);
    const found = schedules.find((s) => s.id === id);
    if (found?.results) {
      setStudentMarks(
        found.results.map((r: any) => ({
          studentId: r.studentId,
          name: `${r.student?.firstName} ${r.student?.lastName}`,
          rollNumber: r.student?.rollNumber,
          marksObtained: r.marksObtained,
          maxMarks: r.maxMarks,
          grade: r.grade,
          gpa: r.gpa,
        }))
      );
    }
  };

  const handleMarkChange = (studentId: string, marks: number, maxMarks: number = 100) => {
    const clamped = Math.max(0, Math.min(maxMarks, marks));
    const pct = (clamped / maxMarks) * 100;
    const { grade, gpa } = calculateGrade(pct);

    setStudentMarks((prev) =>
      prev.map((sm) =>
        sm.studentId === studentId ? { ...sm, marksObtained: clamped, grade, gpa } : sm
      )
    );
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/exams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examScheduleId: selectedScheduleId,
          studentMarks: studentMarks.map((sm) => ({
            studentId: sm.studentId,
            marksObtained: Number(sm.marksObtained),
          })),
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              Teacher Rapid Gradebook
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Marks Terminal
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Rapid marks entry and GPA calculator for assigned subjects.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">save</span>
          <span>{saving ? "Saving..." : "Save Grades"}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>Marks entered and saved into central database.</span>
        </div>
      )}

      {/* Schedule selector */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
        <label htmlFor="gradebook-select-subject-class-schedule-1" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
          Select Subject & Class Schedule
        </label>
        {schedules.length === 0 ? (
          <p className="text-xs text-on-surface-variant italic">No examination schedules assigned or found.</p>
        ) : (
          <select id="gradebook-select-subject-class-schedule-1"
            value={selectedScheduleId}
            onChange={(e) => handleScheduleChange(e.target.value)}
            className="w-full sm:w-auto h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40"
          >
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.subject?.name} — {s.class?.name}-{s.class?.section} (Max: {s.maxMarks})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Grade entry cards */}
      <div className="space-y-2">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading student grade cards...</p>
          </div>
        ) : schedules.length === 0 ? (
          <div className="p-12 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-on-surface-variant text-xs">
            No active exam schedules or subject rosters available.
          </div>
        ) : studentMarks.length === 0 ? (
          <div className="p-12 text-center bg-surface-container-lowest rounded-xl border border-surface-container-high/40 text-on-surface-variant text-xs">
            No students enrolled for this exam schedule.
          </div>
        ) : (
          studentMarks.map((sm) => (
            <div
              key={sm.studentId}
              className="p-3.5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center font-mono font-bold text-xs text-on-surface">
                  {sm.rollNumber}
                </span>
                <div>
                  <h4 className="font-bold text-xs text-on-surface">{sm.name}</h4>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-on-surface-variant">
                      Grade: <span className="font-bold text-secondary">{sm.grade}</span>
                    </span>
                    <span className="text-[10px] text-on-surface-variant">
                      GPA: <span className="font-bold text-primary">{sm.gpa.toFixed(1)}</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={sm.marksObtained}
                  onChange={(e) =>
                    handleMarkChange(sm.studentId, Number(e.target.value), sm.maxMarks || 100)
                  }
                  className="w-20 h-9 px-2.5 rounded-lg bg-surface-container-low font-bold text-xs text-on-surface border border-outline-variant/40 text-center"
                />
                <span className="text-xs text-on-surface-variant font-semibold">/ 100</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
