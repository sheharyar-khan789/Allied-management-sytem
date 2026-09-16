"use client";

import React, { useEffect, useState, useCallback } from "react";
import { calculateGrade, formatDate } from "@/lib/utils";

export default function ExamsManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [classes, setClasses] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [studentMarks, setStudentMarks] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [showNewExam, setShowNewExam] = useState(false);
  const [newExam, setNewExam] = useState({ title: "", term: "", startDate: "", endDate: "" });
  const [creatingExam, setCreatingExam] = useState(false);

  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    classId: "", subjectId: "", examDate: "", startTime: "", endTime: "", totalMarks: "100", passingMarks: "33",
  });
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [formError, setFormError] = useState("");

  const loadClasses = useCallback(() => {
    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setClasses(json.classes);
      })
      .catch(console.error);
  }, []);

  const loadExams = useCallback((examId?: string) => {
    setLoading(true);
    const qs = examId ? `?examId=${encodeURIComponent(examId)}` : "";
    return fetch(`/api/exams${qs}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setData(json);
          const activeId = json.activeExam?.id || json.exams[0]?.id || "";
          setSelectedExamId(activeId);
          const scheds = json.activeExam?.schedules || [];
          setSchedules(scheds);
          if (scheds.length > 0) {
            setSelectedScheduleId(scheds[0].id);
            initStudentMarks(scheds[0]);
          } else {
            setSelectedScheduleId("");
            setStudentMarks([]);
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadExams();
    loadClasses();
  }, [loadExams, loadClasses]);

  const handleCreateExam = async () => {
    setFormError("");
    if (!newExam.title || !newExam.startDate || !newExam.endDate) {
      setFormError("Title, start date, and end date are required.");
      return;
    }
    setCreatingExam(true);
    try {
      const res = await fetch("/api/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newExam),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || "Failed to create exam.");
        return;
      }
      setShowNewExam(false);
      setNewExam({ title: "", term: "", startDate: "", endDate: "" });
      await loadExams(json.exam.id);
    } catch {
      setFormError("Failed to create exam.");
    } finally {
      setCreatingExam(false);
    }
  };

  const handleAddSchedule = async () => {
    setFormError("");
    if (!selectedExamId || !newSchedule.classId || !newSchedule.subjectId || !newSchedule.examDate || !newSchedule.startTime || !newSchedule.endTime) {
      setFormError("Class, subject, date, and both times are required.");
      return;
    }
    setAddingSchedule(true);
    try {
      const res = await fetch("/api/exams", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId: selectedExamId, ...newSchedule }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || "Failed to add schedule.");
        return;
      }
      setShowAddSchedule(false);
      setNewSchedule({ classId: "", subjectId: "", examDate: "", startTime: "", endTime: "", totalMarks: "100", passingMarks: "33" });
      await loadExams(selectedExamId);
    } catch {
      setFormError("Failed to add schedule.");
    } finally {
      setAddingSchedule(false);
    }
  };

  const initStudentMarks = (schedule: any) => {
    if (schedule.results && schedule.results.length > 0) {
      setStudentMarks(
        schedule.results.map((r: any) => ({
          studentId: r.studentId,
          name: `${r.student?.firstName} ${r.student?.lastName}`,
          rollNumber: r.student?.rollNumber,
          admissionNumber: r.student?.admissionNumber,
          marksObtained: r.marksObtained,
          maxMarks: r.maxMarks,
          grade: r.grade,
          gpa: r.gpa,
          remarks: r.remarks || "",
        }))
      );
    } else {
      setStudentMarks([]);
    }
  };

  const handleScheduleSelect = (schedId: string) => {
    setSelectedScheduleId(schedId);
    const sched = schedules.find((s) => s.id === schedId);
    if (sched) {
      initStudentMarks(sched);
    }
  };

  const handleMarkChange = (studentId: string, marks: number, maxMarks: number = 100) => {
    const clamped = Math.max(0, Math.min(maxMarks, marks));
    const pct = (clamped / maxMarks) * 100;
    const { grade, gpa, remarks } = calculateGrade(pct);

    setStudentMarks((prev) =>
      prev.map((sm) =>
        sm.studentId === studentId
          ? { ...sm, marksObtained: clamped, grade, gpa, remarks }
          : sm
      )
    );
    setSaveSuccess(false);
  };

  const handleSaveMarks = async () => {
    if (!selectedScheduleId) return;
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
            remarks: sm.remarks,
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

  const activeSchedule = schedules.find((s) => s.id === selectedScheduleId);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Examinations & Rapid Gradebook
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Gradebook Terminal
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Manage examination timetables, process mark sheets, and auto-compute GPA & letter grades.
          </p>
        </div>

        <button
          onClick={handleSaveMarks}
          disabled={saving || !selectedScheduleId}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all disabled:opacity-50 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">save</span>
          <span>{saving ? "Saving Marks..." : "Save & Finalize Grades"}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>Exam grades computed and saved into student academic records successfully.</span>
        </div>
      )}

      {formError && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{formError}</span>
        </div>
      )}

      {/* Exam cycle selection + creation */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-center justify-between gap-4">
        <div>
          <label htmlFor="exams-examination-cycle-1" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
            Examination Cycle
          </label>
          {data?.exams?.length > 0 ? (
            <select id="exams-examination-cycle-1"
              value={selectedExamId}
              onChange={(e) => loadExams(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {data.exams.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.title} ({e.term})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-on-surface-variant">No examination cycles created yet.</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewExam((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-xs font-semibold hover:bg-surface-container-high transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>New Exam</span>
          </button>
          {selectedExamId && (
            <button
              onClick={() => setShowAddSchedule((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-xs font-semibold hover:bg-surface-container-high transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">event</span>
              <span>Add Subject Schedule</span>
            </button>
          )}
        </div>
      </div>

      {showNewExam && (
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label htmlFor="exams-title-2" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Title</label>
            <input id="exams-title-2"
              value={newExam.title}
              onChange={(e) => setNewExam((s) => ({ ...s, title: e.target.value }))}
              placeholder="Mid-Term Examination"
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="exams-term-3" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Term</label>
            <input id="exams-term-3"
              value={newExam.term}
              onChange={(e) => setNewExam((s) => ({ ...s, term: e.target.value }))}
              placeholder="Mid-Term"
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="exams-start-date-4" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Start Date</label>
            <input id="exams-start-date-4"
              type="date"
              value={newExam.startDate}
              onChange={(e) => setNewExam((s) => ({ ...s, startDate: e.target.value }))}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="exams-end-date-5" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">End Date</label>
            <input id="exams-end-date-5"
              type="date"
              value={newExam.endDate}
              onChange={(e) => setNewExam((s) => ({ ...s, endDate: e.target.value }))}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div className="sm:col-span-4">
            <button
              onClick={handleCreateExam}
              disabled={creatingExam}
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50"
            >
              {creatingExam ? "Creating..." : "Create Exam Cycle"}
            </button>
          </div>
        </div>
      )}

      {showAddSchedule && selectedExamId && (
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label htmlFor="exams-class-6" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Class</label>
            <select id="exams-class-6"
              value={newSchedule.classId}
              onChange={(e) => setNewSchedule((s) => ({ ...s, classId: e.target.value, subjectId: "" }))}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="exams-subject-7" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Subject</label>
            <select id="exams-subject-7"
              value={newSchedule.subjectId}
              onChange={(e) => setNewSchedule((s) => ({ ...s, subjectId: e.target.value }))}
              disabled={!newSchedule.classId}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20 disabled:opacity-50"
            >
              <option value="">Select subject</option>
              {(classes.find((c) => c.id === newSchedule.classId)?.subjects || []).map((sub: any) => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="exams-exam-date-8" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Exam Date</label>
            <input id="exams-exam-date-8"
              type="date"
              value={newSchedule.examDate}
              onChange={(e) => setNewSchedule((s) => ({ ...s, examDate: e.target.value }))}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="exams-start-time-9" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Start Time</label>
            <input id="exams-start-time-9"
              type="time"
              value={newSchedule.startTime}
              onChange={(e) => setNewSchedule((s) => ({ ...s, startTime: e.target.value }))}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="exams-end-time-10" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">End Time</label>
            <input id="exams-end-time-10"
              type="time"
              value={newSchedule.endTime}
              onChange={(e) => setNewSchedule((s) => ({ ...s, endTime: e.target.value }))}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div>
            <label htmlFor="exams-max-passing-marks-11" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Max / Passing Marks</label>
            <div className="flex gap-2">
              <input id="exams-max-passing-marks-11"
                type="number"
                value={newSchedule.totalMarks}
                onChange={(e) => setNewSchedule((s) => ({ ...s, totalMarks: e.target.value }))}
                className="w-1/2 h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
              <input
                type="number"
                value={newSchedule.passingMarks}
                onChange={(e) => setNewSchedule((s) => ({ ...s, passingMarks: e.target.value }))}
                className="w-1/2 h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              />
            </div>
          </div>
          <div className="sm:col-span-3">
            <button
              onClick={handleAddSchedule}
              disabled={addingSchedule}
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50"
            >
              {addingSchedule ? "Adding..." : "Add Schedule"}
            </button>
          </div>
        </div>
      )}

      {/* Selector Ribbon: Schedule selection */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="exams-select-examination-subject-schedule-12" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              Select Examination Subject Schedule
            </label>
            {schedules.length > 0 ? (
              <select id="exams-select-examination-subject-schedule-12"
                value={selectedScheduleId}
                onChange={(e) => handleScheduleSelect(e.target.value)}
                className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.subject?.name} — {s.class?.name}-{s.class?.section} (Max: {s.maxMarks} Marks)
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-on-surface-variant">No subject schedules configured for this exam yet.</p>
            )}
          </div>
        </div>

        {activeSchedule && (
          <div className="flex items-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-surface-container font-semibold text-on-surface">
              Exam Date: {formatDate(activeSchedule.examDate)}
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-surface-container font-semibold text-on-surface">
              Passing: {activeSchedule.passingMarks} / {activeSchedule.maxMarks}
            </div>
          </div>
        )}
      </div>

      {/* Rapid Marks Entry Grid */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading exam mark sheets...</p>
          </div>
        ) : studentMarks.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">assignment_turned_in</span>
            <p className="text-sm font-semibold text-on-surface">No student mark entries found for this schedule</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Roll #</th>
                  <th className="py-3 px-4 font-bold">Student Name</th>
                  <th className="py-3 px-4 font-bold">Admission #</th>
                  <th className="py-3 px-4 font-bold">Marks Obtained (Max: 100)</th>
                  <th className="py-3 px-4 font-bold">Percentage</th>
                  <th className="py-3 px-4 font-bold">Grade</th>
                  <th className="py-3 px-4 font-bold">GPA</th>
                  <th className="py-3 px-4 font-bold">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {studentMarks.map((sm) => {
                  const pct = Math.round((sm.marksObtained / (sm.maxMarks || 100)) * 100);
                  return (
                    <tr key={sm.studentId} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-on-surface">{sm.rollNumber}</td>
                      <td className="py-3 px-4 font-bold text-on-surface">{sm.name}</td>
                      <td className="py-3 px-4 font-mono text-on-surface-variant">{sm.admissionNumber}</td>

                      {/* Marks Input */}
                      <td className="py-3 px-4">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={sm.marksObtained}
                          onChange={(e) =>
                            handleMarkChange(sm.studentId, Number(e.target.value), sm.maxMarks || 100)
                          }
                          className="w-24 h-8 px-2.5 rounded bg-surface-container-low font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
                        />
                      </td>

                      {/* Percentage */}
                      <td className="py-3 px-4 font-semibold text-on-surface">{pct}%</td>

                      {/* Grade Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded font-bold text-xs ${
                            sm.grade === "A+" || sm.grade === "A"
                              ? "bg-tertiary-container/10 text-on-tertiary-container"
                              : sm.grade === "B+" || sm.grade === "B"
                              ? "bg-secondary/10 text-secondary"
                              : sm.grade === "C"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-error-container text-on-error-container"
                          }`}
                        >
                          {sm.grade}
                        </span>
                      </td>

                      {/* GPA */}
                      <td className="py-3 px-4 font-bold text-secondary">{sm.gpa.toFixed(1)}</td>

                      {/* Remarks */}
                      <td className="py-3 px-4 text-on-surface-variant text-[11px]">{sm.remarks}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
