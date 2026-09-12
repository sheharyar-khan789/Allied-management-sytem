"use client";

import React, { useEffect, useState } from "react";
import { calculateGrade, formatDate } from "@/lib/utils";

export default function ExamsManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [studentMarks, setStudentMarks] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/exams")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.exams.length > 0) {
          setData(json);
          setSelectedExamId(json.exams[0].id);
          if (json.activeExam?.schedules) {
            setSchedules(json.activeExam.schedules);
            if (json.activeExam.schedules.length > 0) {
              const firstSched = json.activeExam.schedules[0];
              setSelectedScheduleId(firstSched.id);
              setSelectedClassId(firstSched.classId);
              initStudentMarks(firstSched);
            }
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setClasses(json.classes);
      })
      .catch(console.error);
  }, []);

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
          disabled={saving}
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

      {/* Selector Ribbon: Schedule selection */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              Select Examination Subject Schedule
            </label>
            <select
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
