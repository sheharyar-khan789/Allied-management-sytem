"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";

interface DayEntry { date: string; dayOfWeek: string; content: string; isNonTeachingDay?: boolean }
interface PlanDetail {
  id: string; className?: string; subjectName?: string; teacherName?: string;
  weekId: string; weekStartDate: string; weekEndDate: string; days: DayEntry[];
  status: string; submittedAt: string | null;
}

/**
 * Print/export view laid out like the supplied "ASD Daily Lesson Plan" template: a
 * Class/Subject/Teacher header over a table of this week's dates. The template itself spans a
 * full calendar month per page; this app's record is one school week (see
 * lesson-plan-schedule.ts), so this prints one week per page — the same header/cell layout at
 * weekly granularity rather than inventing a month's worth of other weeks' data to fill the page.
 */
export default function PrintLessonPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/lesson-plans/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          setError(json.error || "Unable to load this lesson plan.");
          return;
        }
        setPlan(json.plan);
      })
      .catch(() => setError("Unable to load this lesson plan."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-xs text-on-surface-variant p-8">Loading…</p>;
  if (error || !plan) return <p className="text-sm text-error p-8">{error || "Lesson plan not found."}</p>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <PrintToolbar title="ASD Daily Lesson Plan" />
      <div className="border border-black">
        <h1 className="text-center font-bold text-lg py-2 border-b border-black">ASD Daily Lesson Plan</h1>
        <div className="flex justify-between px-4 py-2 border-b border-black text-sm font-semibold">
          <span>Class: {plan.className}</span>
          <span>Subject: {plan.subjectName}</span>
          <span>Teacher: {plan.teacherName}</span>
        </div>
        <div className="text-center py-1 border-b border-black bg-gray-100 text-sm font-semibold">
          Week of {plan.weekStartDate} to {plan.weekEndDate}
        </div>
        <table className="w-full text-xs border-collapse">
          <tbody>
            {plan.days.map((d) => (
              <tr key={d.date} className="border-b border-black">
                <td className="border-r border-black px-2 py-2 align-top w-32 font-semibold">
                  {d.dayOfWeek}
                  <br />
                  {d.date}
                </td>
                <td className="px-2 py-2 align-top whitespace-pre-wrap">
                  {d.isNonTeachingDay ? "No class / holiday" : d.content || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-on-surface-variant mt-3 no-print">
        Status: {plan.status}{plan.submittedAt ? ` • Submitted ${new Date(plan.submittedAt).toLocaleString()}` : ""}
      </p>
    </div>
  );
}
