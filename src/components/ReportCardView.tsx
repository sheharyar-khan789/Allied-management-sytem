"use client";

import React from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

/**
 * The report card, rendered from the /api/print/report-card/[studentId] payload. Used by both
 * the printable page and the student portal's report card so the screen and the printout always
 * show the same persisted marks and the same totals (computed once on the server).
 */

function SummaryRow({ summary, hasGpa }: { summary: any; hasGpa: boolean }) {
  return (
    <tr className="border-t-2 border-on-surface font-bold">
      <td className="py-2 px-2" colSpan={2}>Total</td>
      <td className="py-2 px-2 text-center">{summary.obtainedMarks}</td>
      <td className="py-2 px-2 text-center">{summary.totalMarks}</td>
      <td className="py-2 px-2 text-center">{summary.percentage}%</td>
      <td className="py-2 px-2 text-center">{summary.grade || "—"}</td>
      {hasGpa ? <td className="py-2 px-2 text-center">{typeof summary.gpa === "number" ? summary.gpa.toFixed(2) : "—"}</td> : null}
      <td className="py-2 px-2 text-left" colSpan={2}>
        Passed {summary.passed} of {summary.subjects} subject{summary.subjects === 1 ? "" : "s"}
      </td>
    </tr>
  );
}

function ObservationList({ items }: { items: any[] }) {
  return (
    <ul className="space-y-2">
      {items.map((o) => (
        <li key={o.id} className="border border-outline-variant/50 rounded p-2 break-inside-avoid">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold">
              {o.title || o.categoryLabel}
              {o.title ? <span className="font-normal text-on-surface-variant"> · {o.categoryLabel}</span> : null}
            </span>
            <span className="text-on-surface-variant">
              Conduct: <strong>{o.conductLabel}</strong> · {formatDate(o.date)} · {o.teacherName}
            </span>
          </div>
          <p className="text-xs mt-1 whitespace-pre-wrap">{o.note}</p>
        </li>
      ))}
    </ul>
  );
}

export default function ReportCardView({
  data,
  onSelectExam,
}: {
  data: any;
  /** Called with "" for all exams; omit to hide the exam selector. */
  onSelectExam?: (examId: string) => void;
}) {
  const school = data.school;
  const student = data.student;
  const sections: any[] = data.exams || [];
  const generalObservations: any[] = (data.observations || []).filter((o: any) => !o.examId);
  const hasGpa = (data.results || []).some((r: any) => typeof r.gpa === "number");
  const cols = hasGpa ? 9 : 8;
  const examOptions: any[] = data.examOptions || [];

  return (
    <article className="print-sheet p-6 sm:p-8 rounded-xl bg-white border border-surface-container-high shadow-sm print:border-0 print:shadow-none">
      {onSelectExam && examOptions.length > 0 && (
        <div className="no-print print:hidden mb-4 flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="report-card-exam" className="font-semibold">Exam:</label>
          <select
            id="report-card-exam"
            value={data.selectedExamId || ""}
            onChange={(e) => onSelectExam(e.target.value)}
            className="h-8 px-2 rounded border border-outline-variant/60 bg-white"
          >
            <option value="">All exams of this session</option>
            {examOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}{e.term ? ` (${e.term})` : ""}{e.status !== "PUBLISHED" ? " — not published" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Not a <header>: the print stylesheet hides every header element (the app chrome). */}
      <div className="text-center border-b-2 border-on-surface pb-4 mb-4">
        <h2 className="text-xl font-bold">{school.name}</h2>
        {school.campusName ? <p className="text-xs mt-1">{school.campusName}</p> : null}
        <p className="text-[11px] text-on-surface-variant">{school.address}</p>
        <p className="text-[11px] text-on-surface-variant">Phone: {school.phone} • Email: {school.email}</p>
        {school.academicYear ? <p className="text-[11px] mt-1">Academic session: {school.academicYear}</p> : null}
        <p className="mt-3 text-sm font-bold uppercase">Student Report Card</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
        <p><span className="text-on-surface-variant block">Student</span><strong>{student.fullName}</strong></p>
        <p><span className="text-on-surface-variant block">Admission #</span><strong>{student.admissionNo}</strong></p>
        <p><span className="text-on-surface-variant block">Class</span><strong>{student.className}{student.section ? `-${student.section}` : ""}</strong></p>
        <p><span className="text-on-surface-variant block">Roll</span><strong>{student.rollNo}</strong></p>
      </div>

      {sections.length === 0 ? (
        <p className="py-6 text-center text-xs text-on-surface-variant italic border border-outline-variant">
          No examination results are recorded for this student{data.selectedExamId ? " in this exam" : ""}.
        </p>
      ) : (
        sections.map((sec) => (
          <section key={sec.examId} className="mb-6 break-inside-avoid">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h3 className="text-sm font-bold">
                {sec.examName}{sec.term ? ` — ${sec.term}` : ""}
              </h3>
              <span className="text-[11px] text-on-surface-variant">
                {sec.session ? `Session ${sec.session} • ` : ""}
                {formatDate(sec.startDate)} – {formatDate(sec.endDate)}
                {sec.status !== "PUBLISHED" ? " • Not yet published" : ""}
              </span>
            </div>
            <table className="w-full text-xs border border-outline-variant">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="text-left py-2 px-2">Subject</th>
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-center py-2 px-2">Marks</th>
                  <th className="text-center py-2 px-2">Max</th>
                  <th className="text-center py-2 px-2">%</th>
                  <th className="text-center py-2 px-2">Grade</th>
                  {hasGpa ? <th className="text-center py-2 px-2">GPA</th> : null}
                  <th className="text-center py-2 px-2">Result</th>
                  <th className="text-left py-2 px-2">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {sec.results.map((r: any) => (
                  <tr key={r.id} className="border-t border-outline-variant/40">
                    <td className="py-2 px-2">{r.subjectName || "—"}</td>
                    <td className="py-2 px-2">{r.examDate ? formatDate(r.examDate) : "—"}</td>
                    <td className="py-2 px-2 text-center">{r.obtainedMarks}</td>
                    <td className="py-2 px-2 text-center">{r.totalMarks}</td>
                    <td className="py-2 px-2 text-center">{r.percentage}</td>
                    <td className="py-2 px-2 text-center">{r.grade || "—"}</td>
                    {hasGpa ? <td className="py-2 px-2 text-center">{typeof r.gpa === "number" ? r.gpa : "—"}</td> : null}
                    <td className="py-2 px-2 text-center">{r.status === "PASS" ? "Pass" : r.status === "FAIL" ? "Fail" : "—"}</td>
                    <td className="py-2 px-2">{r.remarks || "—"}</td>
                  </tr>
                ))}
                {sec.notRecorded.map((n: any) => (
                  <tr key={`nr-${n.subjectId}`} className="border-t border-outline-variant/40 text-on-surface-variant italic">
                    <td className="py-2 px-2">{n.subjectName || "—"}</td>
                    <td className="py-2 px-2">{n.examDate ? formatDate(n.examDate) : "—"}</td>
                    <td className="py-2 px-2 text-center" colSpan={cols - 2}>Marks not recorded — not included in the totals</td>
                  </tr>
                ))}
              </tbody>
              {sec.results.length > 0 && (
                <tfoot>
                  <SummaryRow summary={sec.summary} hasGpa={hasGpa} />
                </tfoot>
              )}
            </table>
            {sec.observations.length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-bold mb-1">Teacher observations — {sec.examName}</h4>
                <ObservationList items={sec.observations} />
              </div>
            )}
          </section>
        ))
      )}

      {sections.length > 1 && data.academics?.subjects > 0 && (
        <p className="text-xs font-bold mb-4">
          Session aggregate: {data.academics.obtainedMarks} / {data.academics.totalMarks} ({data.academics.percentage}%)
          {data.academics.grade ? ` • Grade ${data.academics.grade}` : ""}
          {typeof data.academics.gpa === "number" ? ` • GPA ${data.academics.gpa.toFixed(2)}` : ""}
        </p>
      )}

      <div className="mb-4">
        <h4 className="text-xs font-bold mb-1">Conduct &amp; observations</h4>
        {generalObservations.length === 0 ? (
          <p className="text-xs text-on-surface-variant italic">No general observations recorded.</p>
        ) : (
          <ObservationList items={generalObservations} />
        )}
      </div>

      {Array.isArray(data.gradingScale) && data.gradingScale.length > 0 && (
        <p className="text-[10px] text-on-surface-variant mb-2">
          Grading scale:{" "}
          {[...data.gradingScale]
            .sort((a: any, b: any) => b.minPercentage - a.minPercentage)
            .map((g: any) => `${g.grade} ≥ ${g.minPercentage}%`)
            .join(" • ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-8 mt-10 text-xs">
        <div className="text-center">
          <div className="border-t border-outline-variant pt-1 mt-10">
            {data.classTeacherName || ""}
            <div className="text-[10px] text-on-surface-variant">Class teacher</div>
          </div>
        </div>
        <div className="text-center">
          <div className="border-t border-outline-variant pt-1 mt-10">
            {school.principalName}
            <div className="text-[10px] text-on-surface-variant">{school.principalTitle}</div>
            {!school.principalConfigured && data.canConfigure ? (
              <Link href="/admin/settings#report-card" className="no-print print:hidden text-[10px] text-secondary underline">
                Configure head of institution
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
