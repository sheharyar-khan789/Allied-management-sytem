"use client";

import React, { useEffect, useState } from "react";
import ReportCardView from "@/components/ReportCardView";

/**
 * The student's report card. It renders the exact payload of the printable report card
 * (/api/print/report-card/[studentId]) with the same component, so what the student sees on
 * screen and what prints are always the same saved marks and totals. Only published exams are
 * included (enforced by the API for STUDENT sessions).
 */
export default function StudentResultsReportCardPage() {
  const [studentId, setStudentId] = useState("");
  const [examId, setExamId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/student/me?view=profile")
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d?.success || !d.student?.id) {
          setError(d?.error || "Unable to load your student record.");
          setLoading(false);
          return;
        }
        setStudentId(d.student.id);
      })
      .catch(() => {
        setError("Unable to load your student record.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    const qs = examId ? `?examId=${encodeURIComponent(examId)}` : "";
    fetch(`/api/print/report-card/${encodeURIComponent(studentId)}${qs}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load your report card.");
          return;
        }
        setError("");
        setData(d);
      })
      .catch(() => setError("Unable to load your report card."))
      .finally(() => setLoading(false));
  }, [studentId, examId]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Generating report card...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto gap-space-lg">
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
            Official Academic Report Card
          </h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Published examination results. Rankings are not calculated.
          </p>
        </div>

        {studentId && (
          <a
            href={`/print/report-card/${studentId}${examId ? `?examId=${encodeURIComponent(examId)}` : ""}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            <span>Print Official Report Card</span>
          </a>
        )}
      </div>

      {error ? (
        <div className="p-6 rounded-xl bg-error-container/20 text-error text-sm">{error}</div>
      ) : data ? (
        <ReportCardView data={data} onSelectExam={setExamId} />
      ) : null}
    </div>
  );
}
