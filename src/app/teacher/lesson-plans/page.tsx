"use client";

import React, { useEffect, useMemo, useState } from "react";

interface ClassSubjectOption {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
}

interface DayEntry {
  date: string;
  dayOfWeek: string;
  content: string;
  isNonTeachingDay?: boolean;
}

interface PlanView {
  id: string;
  classId: string;
  className?: string;
  subjectId: string;
  subjectName?: string;
  weekId: string;
  weekStartDate: string;
  weekEndDate: string;
  days: DayEntry[];
  submitted: boolean;
  submittedAt: string | null;
  submissionDeadline: string;
  status: "DRAFT" | "SUBMITTED" | "LOCKED" | "LATE";
  editableByTeacher: boolean;
  hasAdminCorrections: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-secondary/10 text-secondary",
  SUBMITTED: "bg-primary/10 text-primary",
  LOCKED: "bg-surface-container-high text-on-surface-variant",
  LATE: "bg-error-container text-error",
};

function fmt(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function TeacherLessonPlansPage() {
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [classesSubjects, setClassesSubjects] = useState<ClassSubjectOption[]>([]);
  const [weeks, setWeeks] = useState<{ weekId: string; submissionWindow: { opensAt: string; closesAt: string } }[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");

  const [selectedKey, setSelectedKey] = useState(""); // `${classId}:${subjectId}`
  const [weekId, setWeekId] = useState("");

  const [plan, setPlan] = useState<PlanView | null>(null);
  const [days, setDays] = useState<DayEntry[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");

  const [saving, setSaving] = useState<"DRAFT" | "SUBMIT" | null>(null);
  const [notice, setNotice] = useState("");

  const [myPlans, setMyPlans] = useState<PlanView[]>([]);
  const [myPlansLoading, setMyPlansLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lesson-plans/options")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          setOptionsError(json.error || "Failed to load your assigned classes and subjects.");
          return;
        }
        setTimezone(json.timezone);
        setClassesSubjects(json.classesSubjects || []);
        setWeeks(json.weeks || []);
        setWeekId(json.defaultWeekId);
        if ((json.classesSubjects || []).length > 0) {
          const first = json.classesSubjects[0];
          setSelectedKey(`${first.classId}:${first.subjectId}`);
        }
      })
      .catch(() => setOptionsError("Failed to load your assigned classes and subjects."))
      .finally(() => setOptionsLoading(false));
  }, []);

  const loadMyPlans = () => {
    setMyPlansLoading(true);
    fetch("/api/lesson-plans")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setMyPlans(json.plans || []);
      })
      .finally(() => setMyPlansLoading(false));
  };
  useEffect(loadMyPlans, []);

  const selected = useMemo(() => {
    const [classId, subjectId] = selectedKey.split(":");
    return classesSubjects.find((c) => c.classId === classId && c.subjectId === subjectId) || null;
  }, [selectedKey, classesSubjects]);

  // Opening a historical plan from "My Lesson Plans" may name a week outside the nearby-weeks
  // list the options endpoint returns; extend the dropdown with it so the selector stays in sync.
  const displayWeeks = useMemo(() => {
    if (!weekId || weeks.some((w) => w.weekId === weekId)) return weeks;
    return [...weeks, { weekId, submissionWindow: { opensAt: "", closesAt: "" } }].sort((a, b) => a.weekId.localeCompare(b.weekId));
  }, [weeks, weekId]);
  const currentWindow = useMemo(() => {
    const w = weeks.find((w) => w.weekId === weekId)?.submissionWindow;
    return w && w.opensAt ? w : null;
  }, [weeks, weekId]);

  useEffect(() => {
    if (!selected || !weekId) {
      setPlan(null);
      setDays([]);
      return;
    }
    setPlanLoading(true);
    setPlanError("");
    setNotice("");
    fetch(`/api/lesson-plans?classId=${selected.classId}&subjectId=${selected.subjectId}&weekId=${weekId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          setPlanError(json.error || "Failed to load this week's plan.");
          return;
        }
        const found: PlanView | undefined = (json.plans || [])[0];
        setPlan(found || null);
        if (found) {
          setDays(found.days);
        } else {
          // Build blank Monday-Saturday day cells for this week (Sunday is never a plan day).
          const [y, m, d] = weekId.split("-").map(Number);
          const blanks: DayEntry[] = [];
          const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          for (let i = 0; i < 6; i++) {
            const dt = new Date(Date.UTC(y, m - 1, d));
            dt.setUTCDate(dt.getUTCDate() + i);
            const dateStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
            blanks.push({ date: dateStr, dayOfWeek: dayNames[i], content: "" });
          }
          setDays(blanks);
        }
      })
      .catch(() => setPlanError("Failed to load this week's plan."))
      .finally(() => setPlanLoading(false));
  }, [selected, weekId]);

  const updateDayContent = (date: string, content: string) => {
    setDays((prev) => prev.map((d) => (d.date === date ? { ...d, content } : d)));
  };
  const toggleNonTeaching = (date: string) => {
    setDays((prev) => prev.map((d) => (d.date === date ? { ...d, isNonTeachingDay: !d.isNonTeachingDay } : d)));
  };

  const save = async (action: "SAVE_DRAFT" | "SUBMIT") => {
    if (!selected) return;
    setSaving(action === "SAVE_DRAFT" ? "DRAFT" : "SUBMIT");
    setPlanError("");
    setNotice("");
    try {
      const res = await fetch("/api/lesson-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: selected.classId, subjectId: selected.subjectId, weekId, days, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setPlanError(json.error || "Failed to save the lesson plan.");
        return;
      }
      setPlan(json.plan);
      setDays(json.plan.days);
      setNotice(action === "SUBMIT" ? "Lesson plan submitted." : "Draft saved.");
      loadMyPlans();
    } catch {
      setPlanError("Failed to save the lesson plan. Please check your connection.");
    } finally {
      setSaving(null);
    }
  };

  const windowOpen = currentWindow ? Date.now() >= Date.parse(currentWindow.opensAt) && Date.now() < Date.parse(currentWindow.closesAt) : false;
  const locked = plan ? !plan.editableByTeacher : (currentWindow ? Date.now() >= Date.parse(currentWindow.closesAt) : false);

  if (optionsLoading) {
    return <div className="p-6 text-sm text-on-surface-variant">Loading your lesson plan assignments…</div>;
  }
  if (optionsError) {
    return <div className="p-6 text-sm text-error">{optionsError}</div>;
  }
  if (classesSubjects.length === 0) {
    return (
      <div className="p-6 rounded-xl bg-surface-container-lowest border border-surface-container-high/40 text-sm text-on-surface-variant">
        You have no subjects allocated yet. Lesson plans can only be created for a class and subject assigned to you by an administrator.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">ASD Lesson Plans</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Weekly lesson plan for your assigned class and subject. Submit every Saturday — the plan locks 24 hours after the window opens.
        </p>
      </div>

      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-on-surface mb-1">Class &amp; Subject</label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
            >
              {classesSubjects.map((c) => (
                <option key={`${c.classId}:${c.subjectId}`} value={`${c.classId}:${c.subjectId}`}>
                  {c.className} — {c.subjectName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-on-surface mb-1">School Week (Monday start)</label>
            <select
              value={weekId}
              onChange={(e) => setWeekId(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono"
            >
              {displayWeeks.map((w) => (
                <option key={w.weekId} value={w.weekId}>
                  Week of {w.weekId}
                </option>
              ))}
            </select>
          </div>
        </div>

        {currentWindow && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-on-surface-variant border-t border-surface-container-low pt-3">
            <span>
              Submission window: <strong className="text-on-surface">{fmt(currentWindow.opensAt, timezone)}</strong> to{" "}
              <strong className="text-on-surface">{fmt(currentWindow.closesAt, timezone)}</strong> ({timezone})
            </span>
            <span className={`px-2 py-0.5 rounded-full font-bold ${windowOpen ? "bg-primary/10 text-primary" : "bg-surface-container-high text-on-surface-variant"}`}>
              {windowOpen ? "Submission window is open" : locked ? "Window closed — locked" : "Window not open yet"}
            </span>
            {plan && (
              <span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[plan.status] || ""}`}>{plan.status}</span>
            )}
          </div>
        )}
      </div>

      {planError && <div className="p-3 rounded-lg bg-error-container text-error text-xs font-semibold">{planError}</div>}
      {notice && <div className="p-3 rounded-lg bg-primary/10 text-primary text-xs font-semibold">{notice}</div>}

      {planLoading ? (
        <div className="p-6 text-sm text-on-surface-variant">Loading…</div>
      ) : (
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
          {plan?.hasAdminCorrections && (
            <p className="text-[11px] font-semibold text-secondary">
              An administrator has corrected this plan after the original submission. Your original content is preserved in the audit history.
            </p>
          )}
          {days.map((d) => (
            <div key={d.date} className="border border-surface-container-high/40 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-label-sm text-xs font-bold text-on-surface">
                  {d.dayOfWeek} — {d.date}
                </span>
                <label className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={Boolean(d.isNonTeachingDay)}
                    disabled={locked}
                    onChange={() => toggleNonTeaching(d.date)}
                  />
                  No class / holiday
                </label>
              </div>
              <textarea
                value={d.content}
                disabled={locked || Boolean(d.isNonTeachingDay)}
                onChange={(e) => updateDayContent(d.date, e.target.value)}
                placeholder="Topic, teaching activity, homework/assessment for this date…"
                rows={3}
                maxLength={4000}
                className="w-full px-3 py-2 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 text-xs disabled:opacity-60"
              />
            </div>
          ))}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={locked || saving !== null}
              onClick={() => save("SAVE_DRAFT")}
              className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-xs font-bold disabled:opacity-50"
            >
              {saving === "DRAFT" ? "Saving…" : "Save Draft"}
            </button>
            <button
              type="button"
              disabled={locked || !windowOpen || saving !== null}
              onClick={() => save("SUBMIT")}
              title={!windowOpen ? "Submissions are only accepted during the Saturday window." : ""}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-bold disabled:opacity-50"
            >
              {saving === "SUBMIT" ? "Submitting…" : plan?.submitted ? "Re-submit" : "Submit"}
            </button>
            {locked && <span className="text-[11px] text-on-surface-variant">This week&apos;s plan is locked and can no longer be changed.</span>}
          </div>
        </div>
      )}

      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
        <h2 className="font-headline-md text-sm font-bold text-on-surface mb-3">My Lesson Plans</h2>
        {myPlansLoading ? (
          <p className="text-xs text-on-surface-variant">Loading…</p>
        ) : myPlans.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No lesson plans yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-on-surface-variant border-b border-surface-container-low">
                  <th className="py-2 pr-3">Week</th>
                  <th className="py-2 pr-3">Class</th>
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {myPlans.map((p) => (
                  <tr key={p.id} className="border-b border-surface-container-low/60">
                    <td className="py-2 pr-3 font-mono">{p.weekId}</td>
                    <td className="py-2 pr-3">{p.className}</td>
                    <td className="py-2 pr-3">{p.subjectName}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[p.status] || ""}`}>{p.status}</span>
                    </td>
                    <td className="py-2 pr-3">{fmt(p.submittedAt, timezone)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-primary font-semibold"
                        onClick={() => {
                          setSelectedKey(`${p.classId}:${p.subjectId}`);
                          setWeekId(p.weekId);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
