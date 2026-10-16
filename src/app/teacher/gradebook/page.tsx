"use client";

import React, { useCallback, useEffect, useState } from "react";
import MarksEntryGrid from "@/components/MarksEntryGrid";
import { DEFAULT_GRADING_SCALE } from "@/lib/exam-results";

/**
 * Marks entry for the subjects allocated to this teacher. The API returns only the schedules of
 * the teacher's own subjects/classes; any exam of the active session can be selected (this page
 * used to show only the most recent exam, so marks of any other exam could not be entered).
 */
export default function TeacherGradebookPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [examId, setExamId] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [gradingScale, setGradingScale] = useState(DEFAULT_GRADING_SCALE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // silent: refresh after a save without unmounting the grid (it keeps its success message).
  const load = useCallback(async (nextExamId?: string, scheduleId?: string, silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ rosters: "one" });
      if (nextExamId) params.set("examId", nextExamId);
      if (scheduleId) params.set("scheduleId", scheduleId);
      const res = await fetch(`/api/exams?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || "Could not load exams.");
        return;
      }
      setExams(json.exams || []);
      setGradingScale(json.gradingScale || DEFAULT_GRADING_SCALE);
      setExamId(json.activeExam?.id || "");
      setExamTitle(json.activeExam?.title || "");
      const scheds = json.activeExam?.schedules || [];
      setSchedules(scheds);
      const loaded = scheds.find((s: any) => s.results) || scheds[0];
      setSelectedScheduleId(loaded?.id || "");
    } catch {
      setError("Could not load exams. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeSchedule = schedules.find((s) => s.id === selectedScheduleId);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Teacher Gradebook</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
            Marks Entry
          </span>
        </div>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Enter marks for your allocated subjects. Leave a cell blank when no mark is recorded.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>
      )}

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap gap-4">
        <div>
          <label htmlFor="gradebook-exam" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Exam</label>
          {exams.length === 0 ? (
            <p className="text-xs text-on-surface-variant italic">No exams created for this session yet.</p>
          ) : (
            <select
              id="gradebook-exam"
              value={examId}
              onChange={(e) => load(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40"
            >
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} ({e.term}){e.status === "PUBLISHED" ? " — published" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="gradebook-select-subject-class-schedule-1" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
            Subject &amp; Class
          </label>
          {schedules.length === 0 ? (
            <p className="text-xs text-on-surface-variant italic">
              {exams.length === 0 ? "—" : "None of your subjects are scheduled in this exam."}
            </p>
          ) : (
            <select
              id="gradebook-select-subject-class-schedule-1"
              value={selectedScheduleId}
              onChange={(e) => load(examId, e.target.value)}
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
      </div>

      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading marks...</p>
        </div>
      ) : activeSchedule?.results ? (
        <MarksEntryGrid
          examTitle={examTitle}
          schedule={activeSchedule}
          gradingScale={gradingScale}
          onSaved={() => load(examId, activeSchedule.id, true)}
        />
      ) : null}
    </div>
  );
}
