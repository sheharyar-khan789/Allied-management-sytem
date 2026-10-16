"use client";

import React, { useEffect, useState, useCallback } from "react";
import { formatDate } from "@/lib/utils";
import FileUpload from "@/components/FileUpload";
import MarksEntryGrid from "@/components/MarksEntryGrid";
import { DEFAULT_GRADING_SCALE } from "@/lib/exam-results";

const STATUS_LABELS: Record<string, string> = {
  UPCOMING: "Upcoming",
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  PUBLISHED: "Published (visible to students & parents)",
};

const EMPTY_SCHEDULE = {
  classId: "", subjectId: "", examDate: "", startTime: "", endTime: "", totalMarks: "100", passingMarks: "33", roomNo: "",
};

const inputCls =
  "w-full h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20";
const labelCls = "block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1";
const btnCls =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-xs font-semibold hover:bg-surface-container-high transition-all disabled:opacity-50";

/**
 * Exams & results workflow:
 *  1. New Exam — name, term, dates (saved to `exams/{examId}`, tagged with the active session).
 *  2. Add Subject — class, subject, date/time, max & passing marks (`examSchedules/{sch-exam-class-subject}`).
 *  3. Enter marks per subject (`examResults/{schoolId_examId_studentId_subjectId}`).
 *  4. Set the status to Published so students and parents can see the results and report cards.
 */
export default function ExamsManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedExamId, setSelectedExamId] = useState("");
  const [activeSheetUrl, setActiveSheetUrl] = useState("");
  const [showSheetUploader, setShowSheetUploader] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [gradingScale, setGradingScale] = useState(DEFAULT_GRADING_SCALE);

  const [showNewExam, setShowNewExam] = useState(false);
  const [newExam, setNewExam] = useState({ title: "", term: "", startDate: "", endDate: "", resultSheetUrl: "" });
  const [creatingExam, setCreatingExam] = useState(false);

  const [showEditExam, setShowEditExam] = useState(false);
  const [editExam, setEditExam] = useState({ title: "", term: "", startDate: "", endDate: "", status: "UPCOMING" });
  const [savingExam, setSavingExam] = useState(false);
  const [confirmDeleteExam, setConfirmDeleteExam] = useState(false);

  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [newSchedule, setNewSchedule] = useState(EMPTY_SCHEDULE);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [confirmRemoveScheduleId, setConfirmRemoveScheduleId] = useState("");

  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const loadClasses = useCallback(() => {
    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setClasses(json.classes);
      })
      .catch(console.error);
  }, []);

  // silent: refresh without the full-page spinner (used after saving marks, so the grid stays).
  const loadExams = useCallback(async (examId?: string, scheduleId?: string, silent = false) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ rosters: "one" });
      if (examId) params.set("examId", examId);
      if (scheduleId) params.set("scheduleId", scheduleId);
      const res = await fetch(`/api/exams?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setLoadError(json.error || "Could not load exams.");
        return;
      }
      setData(json);
      setGradingScale(json.gradingScale || DEFAULT_GRADING_SCALE);
      const active = json.activeExam;
      setSelectedExamId(active?.id || "");
      setActiveSheetUrl(active?.resultSheetUrl || "");
      if (active) {
        setEditExam({
          title: active.title || "",
          term: active.term || "",
          startDate: active.startDate || "",
          endDate: active.endDate || "",
          status: active.status || "UPCOMING",
        });
      }
      const scheds = active?.schedules || [];
      setSchedules(scheds);
      setSelectedScheduleId((scheds.find((s: any) => s.results) || scheds[0])?.id || "");
    } catch {
      setLoadError("Could not load exams. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExams();
    loadClasses();
  }, [loadExams, loadClasses]);

  const activeExam = data?.activeExam;
  const activeSchedule = schedules.find((s) => s.id === selectedScheduleId);

  const callApi = async (method: string, body?: unknown, query = "") => {
    const res = await fetch(`/api/exams${query}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json.success !== false, json };
  };

  const handleUpdateResultSheet = async (url: string) => {
    if (!selectedExamId) return;
    setFormError("");
    const { ok, json } = await callApi("PUT", { examId: selectedExamId, resultSheetUrl: url });
    if (!ok) {
      setFormError(json.error || "Could not attach the document.");
      return;
    }
    setActiveSheetUrl(url);
    await loadExams(selectedExamId, selectedScheduleId, true);
  };

  const handleCreateExam = async () => {
    setFormError("");
    setNotice("");
    if (!newExam.title.trim() || !newExam.startDate || !newExam.endDate) {
      setFormError("Title, start date, and end date are required.");
      return;
    }
    setCreatingExam(true);
    try {
      const { ok, json } = await callApi("POST", newExam);
      if (!ok) {
        setFormError(json.error || "Failed to create exam.");
        return;
      }
      setShowNewExam(false);
      setNewExam({ title: "", term: "", startDate: "", endDate: "", resultSheetUrl: "" });
      setNotice(`Exam "${json.exam.name}" created. Next: add its subjects.`);
      await loadExams(json.exam.id);
      setShowScheduleForm(true);
      setEditingSchedule(false);
      setNewSchedule(EMPTY_SCHEDULE);
    } catch {
      setFormError("Failed to create exam.");
    } finally {
      setCreatingExam(false);
    }
  };

  const handleSaveExam = async () => {
    if (!selectedExamId) return;
    setFormError("");
    setNotice("");
    setSavingExam(true);
    try {
      const { ok, json } = await callApi("PUT", { examId: selectedExamId, ...editExam });
      if (!ok) {
        setFormError(json.error || "Could not update the exam.");
        return;
      }
      setShowEditExam(false);
      setNotice(
        editExam.status === "PUBLISHED"
          ? "Exam saved and published — students and parents can now see its results."
          : "Exam details saved."
      );
      await loadExams(selectedExamId, selectedScheduleId, true);
    } finally {
      setSavingExam(false);
    }
  };

  const handleDeleteExam = async () => {
    if (!selectedExamId) return;
    setFormError("");
    setNotice("");
    const { ok, json } = await callApi("DELETE", undefined, `?examId=${encodeURIComponent(selectedExamId)}`);
    setConfirmDeleteExam(false);
    if (!ok) {
      setFormError(json.error || "Could not delete the exam.");
      return;
    }
    setShowEditExam(false);
    setNotice("Exam deleted.");
    await loadExams();
  };

  const openScheduleForm = (sched?: any) => {
    setFormError("");
    setEditingSchedule(Boolean(sched));
    setNewSchedule(
      sched
        ? {
            classId: sched.classId,
            subjectId: sched.subjectId,
            examDate: sched.examDate || "",
            startTime: sched.startTime || "",
            endTime: sched.endTime || "",
            totalMarks: String(sched.maxMarks ?? 100),
            passingMarks: String(sched.passingMarks ?? 33),
            roomNo: sched.roomNo || "",
          }
        : EMPTY_SCHEDULE
    );
    setShowScheduleForm(true);
  };

  const handleSaveSchedule = async () => {
    setFormError("");
    setNotice("");
    if (!selectedExamId || !newSchedule.classId || !newSchedule.subjectId || !newSchedule.examDate || !newSchedule.startTime || !newSchedule.endTime) {
      setFormError("Class, subject, date, and both times are required.");
      return;
    }
    const total = Number(newSchedule.totalMarks);
    const passing = Number(newSchedule.passingMarks);
    if (!(total > 0)) return setFormError("Maximum marks must be a positive number.");
    if (!(passing >= 0) || passing > total) return setFormError("Passing marks must be between 0 and the maximum marks.");
    setSavingSchedule(true);
    try {
      const { ok, json } = await callApi("PATCH", { examId: selectedExamId, ...newSchedule });
      if (!ok) {
        setFormError(json.error || "Failed to save the subject schedule.");
        return;
      }
      setShowScheduleForm(false);
      setNewSchedule(EMPTY_SCHEDULE);
      setNotice(
        json.updated
          ? `Subject schedule updated${json.resultsRecomputed ? `; ${json.resultsRecomputed} recorded result(s) re-graded with the new marks` : ""}.`
          : "Subject added. Select it below to enter marks."
      );
      await loadExams(selectedExamId, json.schedule?.id);
    } catch {
      setFormError("Failed to save the subject schedule.");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleRemoveSchedule = async (scheduleId: string) => {
    setFormError("");
    setNotice("");
    const { ok, json } = await callApi("DELETE", undefined, `?scheduleId=${encodeURIComponent(scheduleId)}`);
    setConfirmRemoveScheduleId("");
    if (!ok) {
      setFormError(json.error || "Could not remove the subject.");
      return;
    }
    setNotice("Subject removed from this exam.");
    await loadExams(selectedExamId, undefined, true);
  };

  const scheduleClass = classes.find((c) => c.id === newSchedule.classId);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Examinations &amp; Results</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">Gradebook</span>
        </div>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          1. Create an exam • 2. Add its subjects with maximum and passing marks • 3. Enter marks per subject • 4. Publish to show results to students and parents.
        </p>
      </div>

      {loadError && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{loadError}</div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{notice}</span>
        </div>
      )}
      {formError && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{formError}</span>
        </div>
      )}

      {/* Exam selection + actions */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-center justify-between gap-4">
        <div>
          <label htmlFor="exams-examination-cycle-1" className={labelCls}>Exam</label>
          {data?.exams?.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="exams-examination-cycle-1"
                value={selectedExamId}
                onChange={(e) => {
                  setNotice("");
                  setFormError("");
                  setShowEditExam(false);
                  loadExams(e.target.value);
                }}
                className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20"
              >
                {data.exams.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.title} ({e.term})</option>
                ))}
              </select>
              {activeExam && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${activeExam.status === "PUBLISHED" ? "bg-tertiary-container/10 text-on-tertiary-container" : "bg-surface-container text-on-surface-variant"}`}>
                  {STATUS_LABELS[activeExam.status] || activeExam.status}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant">{loading ? "Loading..." : "No exams created for this session yet."}</p>
          )}
          {activeExam && (
            <p className="text-[11px] text-on-surface-variant mt-1">
              Session {activeExam.session || "—"} • {formatDate(activeExam.startDate)} – {formatDate(activeExam.endDate)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeSheetUrl && (
            <a href={activeSheetUrl} target="_blank" rel="noopener noreferrer" className={btnCls} title="View attached date sheet / result sheet">
              <span className="material-symbols-outlined text-[18px]">description</span>
              <span>Date Sheet / Results</span>
            </a>
          )}
          {selectedExamId && (
            <button type="button" onClick={() => setShowSheetUploader((v) => !v)} className={btnCls}>
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              <span>{activeSheetUrl ? "Update Document" : "Attach Document"}</span>
            </button>
          )}
          {selectedExamId && (
            <button type="button" onClick={() => { setShowEditExam((v) => !v); setConfirmDeleteExam(false); }} className={btnCls}>
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span>Edit / Publish</span>
            </button>
          )}
          <button type="button" onClick={() => setShowNewExam((v) => !v)} className={btnCls}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>New Exam</span>
          </button>
          {selectedExamId && (
            <button type="button" onClick={() => openScheduleForm()} className={btnCls}>
              <span className="material-symbols-outlined text-[18px]">event</span>
              <span>Add Subject</span>
            </button>
          )}
        </div>
      </div>

      {showSheetUploader && selectedExamId && (
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-on-surface">Attach Exam Date Sheet / Consolidated Result Sheet</h4>
            <button type="button" onClick={() => setShowSheetUploader(false)} className="text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <FileUpload
            folder="result-cards"
            value={activeSheetUrl}
            onChange={(url) => handleUpdateResultSheet(url)}
            accept="image/*,application/pdf"
            previewType="file"
            helperText="Upload official exam timetable, date sheet, or consolidated result sheet (Max 10MB)"
          />
        </div>
      )}

      {showNewExam && (
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label htmlFor="exams-title-2" className={labelCls}>Title</label>
            <input id="exams-title-2" maxLength={160} value={newExam.title}
              onChange={(e) => setNewExam((s) => ({ ...s, title: e.target.value }))}
              placeholder="Mid-Term Examination" className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-term-3" className={labelCls}>Term</label>
            <input id="exams-term-3" maxLength={80} value={newExam.term}
              onChange={(e) => setNewExam((s) => ({ ...s, term: e.target.value }))}
              placeholder="Mid-Term" className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-start-date-4" className={labelCls}>Start Date</label>
            <input id="exams-start-date-4" type="date" value={newExam.startDate}
              onChange={(e) => setNewExam((s) => ({ ...s, startDate: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-end-date-5" className={labelCls}>End Date</label>
            <input id="exams-end-date-5" type="date" value={newExam.endDate}
              onChange={(e) => setNewExam((s) => ({ ...s, endDate: e.target.value }))} className={inputCls} />
          </div>
          <div className="sm:col-span-4">
            <label className={labelCls}>Result Sheet / Timetable Document (Optional)</label>
            <FileUpload
              folder="result-cards"
              value={newExam.resultSheetUrl}
              onChange={(url) => setNewExam((s) => ({ ...s, resultSheetUrl: url }))}
              accept="image/*,application/pdf"
              previewType="file"
              helperText="Upload official exam timetable, date sheet, or consolidated result sheet (Max 10MB)"
            />
          </div>
          <div className="sm:col-span-4">
            <button type="button" onClick={handleCreateExam} disabled={creatingExam}
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
              {creatingExam ? "Creating..." : "Create Exam"}
            </button>
          </div>
        </div>
      )}

      {showEditExam && activeExam && (
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div>
            <label htmlFor="exams-edit-title" className={labelCls}>Title</label>
            <input id="exams-edit-title" maxLength={160} value={editExam.title}
              onChange={(e) => setEditExam((s) => ({ ...s, title: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-edit-term" className={labelCls}>Term</label>
            <input id="exams-edit-term" maxLength={80} value={editExam.term}
              onChange={(e) => setEditExam((s) => ({ ...s, term: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-edit-start" className={labelCls}>Start Date</label>
            <input id="exams-edit-start" type="date" value={editExam.startDate}
              onChange={(e) => setEditExam((s) => ({ ...s, startDate: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-edit-end" className={labelCls}>End Date</label>
            <input id="exams-edit-end" type="date" value={editExam.endDate}
              onChange={(e) => setEditExam((s) => ({ ...s, endDate: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-edit-status" className={labelCls}>Status</label>
            <select id="exams-edit-status" value={editExam.status}
              onChange={(e) => setEditExam((s) => ({ ...s, status: e.target.value }))} className={inputCls}>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleSaveExam} disabled={savingExam}
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
              {savingExam ? "Saving..." : "Save Exam"}
            </button>
            {confirmDeleteExam ? (
              <>
                <span className="text-xs text-error font-semibold">Delete this exam and its subject schedules? Only possible while no marks are recorded.</span>
                <button type="button" onClick={handleDeleteExam} className="px-3 py-2 rounded-lg bg-error text-on-error text-xs font-semibold">Yes, delete</button>
                <button type="button" onClick={() => setConfirmDeleteExam(false)} className={btnCls}>Keep</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDeleteExam(true)} className={`${btnCls} text-error`}>
                <span className="material-symbols-outlined text-[18px]">delete</span>
                <span>Delete Exam</span>
              </button>
            )}
          </div>
        </div>
      )}

      {showScheduleForm && selectedExamId && (
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <p className="sm:col-span-3 text-xs font-bold text-on-surface">
            {editingSchedule ? "Edit subject schedule" : "Add a subject to this exam"}
          </p>
          <div>
            <label htmlFor="exams-class-6" className={labelCls}>Class</label>
            <select id="exams-class-6" value={newSchedule.classId} disabled={editingSchedule}
              onChange={(e) => setNewSchedule((s) => ({ ...s, classId: e.target.value, subjectId: "" }))} className={`${inputCls} disabled:opacity-60`}>
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="exams-subject-7" className={labelCls}>Subject</label>
            <select id="exams-subject-7" value={newSchedule.subjectId} disabled={!newSchedule.classId || editingSchedule}
              onChange={(e) => setNewSchedule((s) => ({ ...s, subjectId: e.target.value }))} className={`${inputCls} disabled:opacity-60`}>
              <option value="">Select subject</option>
              {(scheduleClass?.subjects || []).map((sub: any) => (
                <option key={sub.id} value={sub.id}>{sub.name}</option>
              ))}
            </select>
            {newSchedule.classId && (scheduleClass?.subjects || []).length === 0 && (
              <p className="text-[10px] text-error mt-1">This class has no subjects. Add them in Classes first.</p>
            )}
          </div>
          <div>
            <label htmlFor="exams-exam-date-8" className={labelCls}>Exam Date</label>
            <input id="exams-exam-date-8" type="date" value={newSchedule.examDate}
              onChange={(e) => setNewSchedule((s) => ({ ...s, examDate: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-start-time-9" className={labelCls}>Start Time</label>
            <input id="exams-start-time-9" type="time" value={newSchedule.startTime}
              onChange={(e) => setNewSchedule((s) => ({ ...s, startTime: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-end-time-10" className={labelCls}>End Time</label>
            <input id="exams-end-time-10" type="time" value={newSchedule.endTime}
              onChange={(e) => setNewSchedule((s) => ({ ...s, endTime: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label htmlFor="exams-max-marks-11" className={labelCls}>Max / Passing Marks</label>
            <div className="flex gap-2">
              <input id="exams-max-marks-11" type="number" min={1} aria-label="Maximum marks" value={newSchedule.totalMarks}
                onChange={(e) => setNewSchedule((s) => ({ ...s, totalMarks: e.target.value }))} className={inputCls} />
              <input type="number" min={0} aria-label="Passing marks" value={newSchedule.passingMarks}
                onChange={(e) => setNewSchedule((s) => ({ ...s, passingMarks: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div>
            <label htmlFor="exams-room-12" className={labelCls}>Room (optional)</label>
            <input id="exams-room-12" maxLength={40} value={newSchedule.roomNo}
              onChange={(e) => setNewSchedule((s) => ({ ...s, roomNo: e.target.value }))} className={inputCls} />
          </div>
          <div className="sm:col-span-3 flex gap-2">
            <button type="button" onClick={handleSaveSchedule} disabled={savingSchedule}
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 disabled:opacity-50">
              {savingSchedule ? "Saving..." : editingSchedule ? "Save Changes" : "Add Subject"}
            </button>
            <button type="button" onClick={() => setShowScheduleForm(false)} className={btnCls}>Cancel</button>
          </div>
        </div>
      )}

      {/* Subjects of the selected exam */}
      {selectedExamId && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-x-auto">
          {schedules.length === 0 ? (
            <p className="p-6 text-xs text-on-surface-variant text-center">
              No subjects added to this exam yet. Use “Add Subject” to configure subjects and their maximum marks.
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-4">Subject</th>
                  <th className="py-2.5 px-4">Class</th>
                  <th className="py-2.5 px-4">Date &amp; Time</th>
                  <th className="py-2.5 px-4">Max / Pass</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {schedules.map((s) => (
                  <tr key={s.id} className={s.id === selectedScheduleId ? "bg-secondary/5" : ""}>
                    <td className="py-2 px-4 font-bold">{s.subject?.name}</td>
                    <td className="py-2 px-4">{s.class?.name}{s.class?.section ? `-${s.class.section}` : ""}</td>
                    <td className="py-2 px-4">{formatDate(s.examDate)} {s.startTime}–{s.endTime}</td>
                    <td className="py-2 px-4">{s.maxMarks} / {s.passingMarks}</td>
                    <td className="py-2 px-4 text-right whitespace-nowrap space-x-2">
                      <button type="button" onClick={() => { setNotice(""); loadExams(selectedExamId, s.id); }}
                        className="text-secondary font-semibold hover:underline">Enter marks</button>
                      <button type="button" onClick={() => openScheduleForm(s)} className="text-on-surface font-semibold hover:underline">Edit</button>
                      {confirmRemoveScheduleId === s.id ? (
                        <>
                          <button type="button" onClick={() => handleRemoveSchedule(s.id)} className="text-error font-semibold hover:underline">Confirm remove</button>
                          <button type="button" onClick={() => setConfirmRemoveScheduleId("")} className="text-on-surface-variant hover:underline">Keep</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirmRemoveScheduleId(s.id)} className="text-error font-semibold hover:underline">Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Marks entry for the selected subject */}
      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading exam mark sheets...</p>
        </div>
      ) : activeSchedule?.results ? (
        <MarksEntryGrid
          examTitle={activeExam?.title || ""}
          schedule={activeSchedule}
          gradingScale={gradingScale}
          onSaved={() => loadExams(selectedExamId, activeSchedule.id, true)}
        />
      ) : null}
    </div>
  );
}
