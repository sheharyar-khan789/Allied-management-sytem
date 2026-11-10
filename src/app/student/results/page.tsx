"use client";

import React, { useEffect, useState } from "react";

export default function StudentResultsReportCardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/me")
      .then((res) => res.json())
      .then((d) => {
        if (d?.success) setData(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Generating report card...</p>
      </div>
    );
  }

  const student = data?.student;
  const stats = data?.stats?.academics || {
    totalMarks: 0,
    obtainedMarks: 0,
    percentage: 0,
    gpa: 0,
  };

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto gap-space-lg">
      {/* Action Header */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
            Official Academic Report Card
          </h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Recorded examination results for this student. Rankings are not calculated.
          </p>
        </div>

        {student?.id && (
          <a
            href={`/print/report-card/${student.id}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            <span>Print Official Report Card</span>
          </a>
        )}
      </div>

      {/* Printable Report Card Sheet */}
      <div className="p-8 rounded-xl bg-surface-container-lowest shadow-md border-2 border-primary/20 space-y-6 print:border-0 print:shadow-none print:p-0">
        {/* School Header */}
        <div className="text-center border-b-2 border-primary/20 pb-6 space-y-2">
          <div className="flex items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary text-white flex items-center justify-center font-bold">
              <span className="material-symbols-outlined text-[24px]">school</span>
            </div>
            <h2 className="font-headline-xl text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
              {data?.school?.name || "School information not configured"}
            </h2>
          </div>
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider">
            {data?.school?.campusName || data?.school?.address || "School information not configured"}
          </p>
          {data?.school?.academicYear ? (
            <p className="text-xs text-on-surface-variant italic font-medium">
              Academic year {data.school.academicYear}
            </p>
          ) : null}
          <div className="pt-2">
            <span className="px-4 py-1 rounded bg-surface-container font-headline-md text-xs font-bold text-on-surface uppercase tracking-wide">
              Student Report Card
            </span>
          </div>
        </div>

        {/* Student Biodata Box */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg bg-surface-container-low/60 border border-surface-container-high text-xs">
          <div>
            <span className="text-[10px] text-on-surface-variant uppercase font-bold">Student Name</span>
            <p className="font-bold text-on-surface text-sm">{student?.firstName} {student?.lastName}</p>
          </div>
          <div>
            <span className="text-[10px] text-on-surface-variant uppercase font-bold">Admission #</span>
            <p className="font-mono font-bold text-on-surface">{student?.admissionNumber}</p>
          </div>
          <div>
            <span className="text-[10px] text-on-surface-variant uppercase font-bold">Class & Section</span>
            <p className="font-bold text-secondary">{student?.class?.name}-{student?.class?.section}</p>
          </div>
          <div>
            <span className="text-[10px] text-on-surface-variant uppercase font-bold">Roll Number</span>
            <p className="font-bold text-on-surface">{student?.rollNumber}</p>
          </div>
        </div>

        {/* Marks Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-surface-container text-on-surface font-bold uppercase text-[11px] border-b border-surface-container-high">
                <th className="py-3 px-3">Subject Name</th>
                <th className="py-3 px-3">Course Code</th>
                <th className="py-3 px-3 text-center">Max Marks</th>
                <th className="py-3 px-3 text-center">Marks Obtained</th>
                <th className="py-3 px-3 text-center">Percentage</th>
                <th className="py-3 px-3 text-center">Letter Grade</th>
                <th className="py-3 px-3 text-center">GPA</th>
                <th className="py-3 px-3">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {(!student?.examResults || student.examResults.length === 0) && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-on-surface-variant italic">
                    No examination records available for this student.
                  </td>
                </tr>
              )}
              {student?.examResults?.map((r: any) => {
                const pct = Math.round((r.marksObtained / r.maxMarks) * 100);
                return (
                  <tr key={r.id}>
                    <td className="py-3 px-3 font-bold text-on-surface">
                      {r.examSchedule?.subject?.name || "Subject"}
                    </td>
                    <td className="py-3 px-3 font-mono text-on-surface-variant">
                    {r.examSchedule?.subject?.code || "—"}
                  </td>
                  <td className="py-3 px-3 text-center">{r.maxMarks}</td>
                  <td className="py-3 px-3 text-center font-bold text-on-surface">{r.marksObtained}</td>
                  <td className="py-3 px-3 text-center font-semibold">{Number.isFinite(pct) ? `${pct}%` : "—"}</td>
                  <td className="py-3 px-3 text-center font-bold text-secondary">{r.grade || "—"}</td>
                  <td className="py-3 px-3 text-center font-bold">
                    {typeof r.gpa === "number" ? r.gpa.toFixed(1) : "—"}
                  </td>
                  <td className="py-3 px-3 text-on-surface-variant text-xs">{r.remarks || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-container-low font-bold text-xs border-t-2 border-primary/20">
                <td className="py-3 px-3 font-bold" colSpan={2}>Grand Total & Overall Performance</td>
                <td className="py-3 px-3 text-center">{stats.totalMarks}</td>
                <td className="py-3 px-3 text-center text-secondary font-bold">{stats.obtainedMarks}</td>
                <td className="py-3 px-3 text-center">{stats.percentage}%</td>
                <td className="py-3 px-3 text-center text-secondary font-bold">—</td>
                <td className="py-3 px-3 text-center">
                  {typeof stats.gpa === "number" && stats.gpa > 0 ? stats.gpa.toFixed(2) : "—"}
                </td>
                <td className="py-3 px-3 text-on-tertiary-container">
                  {stats.totalMarks > 0 ? "From recorded results" : "No records"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Grading Scale Footnote & Signature Seals */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t-2 border-primary/20 text-xs">
          <div className="space-y-1">
            <span className="font-bold text-on-surface block">Grading Standard Key:</span>
            <p className="text-[11px] text-on-surface-variant">
              A+ (90-100% | GPA 4.0) • A (80-89% | GPA 3.8) • B+ (70-79% | GPA 3.4) • B (60-69% | GPA 3.0) • C (50-59% | GPA 2.0) • D (40-49% | GPA 1.0) • F (&lt;40% | GPA 0.0)
            </p>
          </div>

          <div className="flex justify-between items-end pt-4 sm:pt-0">
            <div className="text-center">
              <div className="w-28 border-b border-outline-variant pb-1 font-semibold text-on-surface">
                {student?.classTeacherName || "Class Teacher"}
              </div>
              <span className="text-[10px] text-on-surface-variant uppercase mt-1 block">Class Teacher</span>
            </div>

            <div className="text-center">
              <div className="w-40 border-b border-outline-variant pb-1 font-semibold text-on-surface text-center">
                {data?.school?.principalName || "School information not configured"}
              </div>
              <span className="text-[10px] text-on-surface-variant uppercase mt-1 block">Principal / Head</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
