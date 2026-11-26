"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDate } from "@/lib/utils";

/**
 * Result Card redesigned to match the Allied Schools 1st Term Result Card 2026-27 reference.
 *
 * Reference layout (from 1st_Term_Result_Card_26.docx):
 *  - School header with logo, name, campus
 *  - Exam title (e.g. "1st Term Result Card 2026-27")
 *  - Student info row: Name | Class | Roll No | Class Teacher
 *  - Subject table: Sr# / Subject / Total Marks / Obtained Marks
 *  - Academic Report: Total Marks, Obtained Marks, Percentage, Grade
 *  - Non-Academic Report (two columns):
 *      Personality Development: Manners, Discipline, Cleanliness, Confidence
 *      Academic Progress: Class Participation, Co-Curricular Activities, Handwriting, Homework
 *      Each item rated G / S / NI (Good / Satisfactory / Needs Improvement)
 *  - Remarks
 *  - Class Teacher and Principal signature blocks
 *
 * The existing server-side result calculation (marks, grade, percentage, pass/fail) is preserved.
 * No hardcoded marks or dummy data — all values come from the API payload.
 */

// ─── Non-Academic rating constants ───────────────────────────────────────────

const PERSONALITY_ITEMS = [
  "Manners",
  "Discipline",
  "Cleanliness",
  "Confidence",
] as const;

const ACADEMIC_PROGRESS_ITEMS = [
  "Class Participation",
  "Co-Curricular Activities",
  "Handwriting",
  "Homework",
] as const;

const RATINGS = ["G", "S", "NI"] as const;

// ─── Small helpers ────────────────────────────────────────────────────────────

function RatingCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-block w-4 h-4 border border-black text-center leading-4 text-[10px] font-bold ${
        checked ? "bg-black text-white" : "bg-white"
      } print:border-black`}
    >
      {checked ? "✓" : ""}
    </span>
  );
}

function NonAcademicRow({
  label,
  ratings,
  observation,
}: {
  label: string;
  ratings: readonly (typeof RATINGS)[number][];
  /** Null-safe: undefined means the section was not stored. */
  observation?: string | null;
}) {
  return (
    <tr className="border-b border-gray-300 text-[11px]">
      <td className="py-1 px-2 text-left">{label}</td>
      {ratings.map((r) => (
        <td key={r} className="py-1 px-2 text-center">
          <RatingCheckbox checked={observation === r} />
        </td>
      ))}
    </tr>
  );
}

// ─── Exam selector (screen-only) ─────────────────────────────────────────────

function ExamSelector({
  examOptions,
  selectedExamId,
  onSelect,
}: {
  examOptions: any[];
  selectedExamId?: string;
  onSelect: (id: string) => void;
}) {
  if (!examOptions.length) return null;
  return (
    <div className="no-print print:hidden mb-4 flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor="report-card-exam" className="font-semibold">
        Exam:
      </label>
      <select
        id="report-card-exam"
        value={selectedExamId || ""}
        onChange={(e) => onSelect(e.target.value)}
        className="h-8 px-2 rounded border border-gray-300 bg-white text-xs"
      >
        <option value="">All exams of this session</option>
        {examOptions.map((e: any) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.term ? ` (${e.term})` : ""}
            {e.status !== "PUBLISHED" ? " — not published" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Single exam card ─────────────────────────────────────────────────────────

function ExamCard({
  sec,
  school,
  student,
  classTeacherName,
  canConfigure,
}: {
  sec: any;
  school: any;
  student: any;
  classTeacherName?: string;
  canConfigure?: boolean;
}) {
  const summary = sec.summary;

  // Build the combined subject list in display order:
  // recorded results first, then subjects with no marks (not-recorded)
  const allSubjects: Array<{
    srNo: number;
    name: string;
    total: number | null;
    obtained: number | string | null;
    notRecorded: boolean;
  }> = [
    ...sec.results.map((r: any, i: number) => ({
      srNo: i + 1,
      name: r.subjectName || "—",
      total: r.totalMarks,
      obtained: r.obtainedMarks,
      notRecorded: false,
    })),
    ...sec.notRecorded.map((n: any, i: number) => ({
      srNo: sec.results.length + i + 1,
      name: n.subjectName || "—",
      total: n.totalMarks,
      obtained: null,
      notRecorded: true,
    })),
  ];

  return (
    <article
      className="result-card-page print-sheet bg-white border border-gray-400 rounded-none
                 mx-auto my-4 print:my-0 print:border-0 print:break-after-page"
      style={{ maxWidth: "210mm", fontFamily: "Arial, sans-serif" }}
    >
      {/* ── Header ── */}
      <div className="border-b-2 border-black px-6 pt-4 pb-3 flex items-center gap-4">
        {school.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={school.logoUrl}
            alt="School logo"
            className="h-16 w-16 object-contain flex-shrink-0"
            style={{ maxWidth: 64 }}
          />
        ) : (
          <div className="h-16 w-16 flex items-center justify-center border border-gray-300 flex-shrink-0 text-[9px] text-gray-400 text-center">
            Logo
          </div>
        )}
        <div className="flex-1 text-center">
          <h1 className="text-lg font-bold uppercase tracking-wide leading-tight">
            {school.name}
          </h1>
          {school.campusName && (
            <p className="text-sm font-semibold">{school.campusName}</p>
          )}
          {school.address && (
            <p className="text-[11px] text-gray-600">{school.address}</p>
          )}
          {(school.phone || school.email) && (
            <p className="text-[10px] text-gray-500">
              {school.phone ? `Ph: ${school.phone}` : ""}
              {school.phone && school.email ? " | " : ""}
              {school.email ? `Email: ${school.email}` : ""}
            </p>
          )}
        </div>
        {/* Right side spacer to keep logo-balanced */}
        <div className="h-16 w-16 flex-shrink-0" aria-hidden />
      </div>

      {/* ── Exam title ── */}
      <div className="text-center py-2 border-b border-gray-300">
        <p className="text-sm font-bold uppercase tracking-widest">
          {sec.examName}
          {sec.term ? ` — ${sec.term}` : ""}
          {school.academicYear ? ` ${school.academicYear}` : ""}
        </p>
        {sec.status !== "PUBLISHED" && (
          <span className="text-[10px] text-gray-500 italic">
            (Not yet published)
          </span>
        )}
      </div>

      {/* ── Student info row ── */}
      <div className="px-4 py-2 border-b border-gray-400 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
        <div className="flex gap-2">
          <span className="font-bold w-28 flex-shrink-0">Student Name:</span>
          <span className="border-b border-dotted border-gray-500 flex-1">
            {student.fullName}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold w-20 flex-shrink-0">Admission No:</span>
          <span className="border-b border-dotted border-gray-500 flex-1">
            {student.admissionNo}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold w-28 flex-shrink-0">Class:</span>
          <span className="border-b border-dotted border-gray-500 flex-1">
            {student.className}
            {student.section ? ` ${student.section}` : ""}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="font-bold w-20 flex-shrink-0">Roll No:</span>
          <span className="border-b border-dotted border-gray-500 flex-1">
            {student.rollNo || "—"}
          </span>
        </div>
        <div className="flex gap-2 col-span-2">
          <span className="font-bold w-28 flex-shrink-0">Class Teacher:</span>
          <span className="border-b border-dotted border-gray-500 flex-1">
            {classTeacherName || "—"}
          </span>
        </div>
      </div>

      {/* ── Subject marks table ── */}
      <div className="px-4 pt-2 pb-1">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 py-1 px-2 text-center w-10">
                Sr #
              </th>
              <th className="border border-gray-400 py-1 px-2 text-left">
                Subject
              </th>
              <th className="border border-gray-400 py-1 px-2 text-center w-24">
                Total Marks
              </th>
              <th className="border border-gray-400 py-1 px-2 text-center w-28">
                Obtained Marks
              </th>
            </tr>
          </thead>
          <tbody>
            {allSubjects.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="border border-gray-400 py-4 text-center text-gray-500 italic"
                >
                  No subjects recorded for this exam.
                </td>
              </tr>
            ) : (
              allSubjects.map((s) => (
                <tr key={`${s.name}-${s.srNo}`}>
                  <td className="border border-gray-400 py-1 px-2 text-center">
                    {String(s.srNo).padStart(2, "0")}
                  </td>
                  <td className="border border-gray-400 py-1 px-2 font-semibold">
                    {s.name}
                  </td>
                  <td className="border border-gray-400 py-1 px-2 text-center">
                    {s.total ?? "—"}
                  </td>
                  <td className="border border-gray-400 py-1 px-2 text-center">
                    {s.notRecorded ? (
                      <span className="text-gray-400 italic text-[10px]">
                        Not recorded
                      </span>
                    ) : (
                      s.obtained ?? "—"
                    )}
                  </td>
                </tr>
              ))
            )}
            {/* Total row */}
            {allSubjects.length > 0 && (
              <tr className="font-bold bg-gray-50">
                <td
                  colSpan={2}
                  className="border border-gray-400 py-1 px-2 text-right"
                >
                  Total Marks:
                </td>
                <td className="border border-gray-400 py-1 px-2 text-center">
                  {summary.totalMarks}
                </td>
                <td className="border border-gray-400 py-1 px-2 text-center">
                  &nbsp;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Academic Report ── */}
      {sec.results.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-300">
          <p className="text-[11px] font-bold uppercase mb-1">
            Academic Report
          </p>
          <div className="grid grid-cols-2 text-[11px] gap-y-1">
            <div className="flex gap-2">
              <span className="font-semibold w-28 flex-shrink-0">
                Total Marks:
              </span>
              <span className="font-bold border-b border-dotted border-gray-500 flex-1">
                {summary.totalMarks}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold w-28 flex-shrink-0">
                Obtained Marks:
              </span>
              <span className="font-bold border-b border-dotted border-gray-500 flex-1">
                {summary.obtainedMarks}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold w-28 flex-shrink-0">
                Percentage:
              </span>
              <span className="font-bold border-b border-dotted border-gray-500 flex-1">
                {summary.percentage}%
              </span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold w-28 flex-shrink-0">Grade:</span>
              <span className="font-bold border-b border-dotted border-gray-500 flex-1">
                {summary.grade || "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Non-Academic Report ── */}
      <div className="px-4 py-2 border-t border-gray-300">
        <p className="text-[11px] font-bold uppercase mb-1">
          Non-Academic Report
        </p>
        <div className="grid grid-cols-2 gap-x-4 text-[11px]">
          {/* Personality Development */}
          <div>
            <p className="font-bold text-[10px] uppercase mb-1 text-center">
              Personality Development
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border border-gray-300 py-0.5 px-1 text-left text-[10px]">
                    &nbsp;
                  </th>
                  {RATINGS.map((r) => (
                    <th
                      key={r}
                      className="border border-gray-300 py-0.5 px-2 text-center text-[10px] font-bold"
                    >
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERSONALITY_ITEMS.map((item, idx) => (
                  <NonAcademicRow
                    key={item}
                    label={`${["i", "ii", "iii", "iv"][idx]}- ${item}`}
                    ratings={RATINGS}
                    observation={undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Academic Progress */}
          <div>
            <p className="font-bold text-[10px] uppercase mb-1 text-center">
              Academic Progress
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border border-gray-300 py-0.5 px-1 text-left text-[10px]">
                    &nbsp;
                  </th>
                  {RATINGS.map((r) => (
                    <th
                      key={r}
                      className="border border-gray-300 py-0.5 px-2 text-center text-[10px] font-bold"
                    >
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACADEMIC_PROGRESS_ITEMS.map((item, idx) => (
                  <NonAcademicRow
                    key={item}
                    label={`${["i", "ii", "iii", "iv"][idx]}- ${item}`}
                    ratings={RATINGS}
                    observation={undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rating legend */}
        <p className="text-[10px] text-gray-600 mt-1">
          <strong>G</strong> = Good &nbsp;&nbsp;&nbsp;{" "}
          <strong>S</strong> = Satisfactory &nbsp;&nbsp;&nbsp;{" "}
          <strong>NI</strong> = Needs Improvement
        </p>
      </div>

      {/* ── Remarks ── */}
      <div className="px-4 py-2 border-t border-gray-300">
        <div className="flex gap-2 text-[11px]">
          <span className="font-bold flex-shrink-0">Remarks:</span>
          <span className="border-b border-dotted border-gray-500 flex-1 min-h-[18px]">
            {/* Collect any per-subject remarks or exam-level observations */}
            {sec.results
              .filter((r: any) => r.remarks)
              .map((r: any) => `${r.subjectName}: ${r.remarks}`)
              .join(" | ") ||
              sec.observations
                .map((o: any) => o.note)
                .filter(Boolean)
                .join(" | ") ||
              ""}
          </span>
        </div>
      </div>

      {/* ── Signature blocks ── */}
      <div className="px-4 pt-4 pb-6 border-t border-gray-300 grid grid-cols-2 gap-8 text-[11px]">
        <div className="text-center">
          <div className="border-t border-black pt-1 mt-10">
            <span className="font-semibold">{classTeacherName || ""}</span>
            <div className="text-[10px] text-gray-600">Class Teacher</div>
          </div>
        </div>
        <div className="text-center">
          <div className="border-t border-black pt-1 mt-10">
            <span className="font-semibold">
              {school.principalName || ""}
            </span>
            <div className="text-[10px] text-gray-600">
              {school.principalTitle || "Principal"}
            </div>
            {!school.principalConfigured && canConfigure ? (
              <Link
                href="/admin/settings#report-card"
                className="no-print print:hidden text-[10px] text-blue-600 underline"
              >
                Configure head of institution
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

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
  const examOptions: any[] = data.examOptions || [];
  const generalObservations: any[] = (data.observations || []).filter(
    (o: any) => !o.examId
  );

  return (
    <div className="result-card-wrapper">
      {/* Screen-only exam picker */}
      {onSelectExam && (
        <ExamSelector
          examOptions={examOptions}
          selectedExamId={data.selectedExamId}
          onSelect={onSelectExam}
        />
      )}

      {sections.length === 0 ? (
        <div
          className="print-sheet bg-white border border-gray-300 rounded p-8 text-center mx-auto my-4"
          style={{ maxWidth: "210mm" }}
        >
          <p className="text-sm text-gray-500 italic">
            No examination results are recorded for this student
            {data.selectedExamId ? " in this exam" : ""}.
          </p>
        </div>
      ) : (
        sections.map((sec) => (
          <ExamCard
            key={sec.examId}
            sec={sec}
            school={school}
            student={student}
            classTeacherName={data.classTeacherName}
            canConfigure={data.canConfigure}
          />
        ))
      )}

      {/* Session aggregate (screen only, when multiple exams shown) */}
      {sections.length > 1 && data.academics?.subjects > 0 && (
        <div
          className="no-print print:hidden mx-auto my-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded text-xs"
          style={{ maxWidth: "210mm" }}
        >
          <span className="font-bold">Session aggregate:</span>{" "}
          {data.academics.obtainedMarks} / {data.academics.totalMarks} (
          {data.academics.percentage}%)
          {data.academics.grade ? ` • Grade ${data.academics.grade}` : ""}
        </div>
      )}

      {/* General (non-exam) observations — screen only */}
      {generalObservations.length > 0 && (
        <div
          className="no-print print:hidden mx-auto my-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded text-xs"
          style={{ maxWidth: "210mm" }}
        >
          <p className="font-bold mb-1">General observations</p>
          <ul className="space-y-1">
            {generalObservations.map((o: any) => (
              <li key={o.id} className="border-b border-gray-100 pb-1">
                <span className="font-semibold">
                  {o.title || o.categoryLabel}
                </span>{" "}
                · {formatDate(o.date)} · {o.teacherName}
                {o.note ? (
                  <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">
                    {o.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Grading scale legend (screen only) */}
      {Array.isArray(data.gradingScale) && data.gradingScale.length > 0 && (
        <p
          className="no-print print:hidden mx-auto my-2 text-[10px] text-gray-500"
          style={{ maxWidth: "210mm" }}
        >
          Grading scale:{" "}
          {[...data.gradingScale]
            .sort((a: any, b: any) => b.minPercentage - a.minPercentage)
            .map((g: any) => `${g.grade} ≥ ${g.minPercentage}%`)
            .join(" • ")}
        </p>
      )}
    </div>
  );
}
