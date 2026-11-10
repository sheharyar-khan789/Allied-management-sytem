"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";

export default function PrintReportCardPage({ params }: { params: Promise<{ studentId: string }> }) {
  const [studentId, setStudentId] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setStudentId(p.studentId));
  }, [params]);

  useEffect(() => {
    if (!studentId) return;
    fetch(`/api/print/report-card/${encodeURIComponent(studentId)}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load this report card.");
          return;
        }
        setData(d);
      })
      .catch(() => setError("Unable to load this report card."))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <p className="text-xs text-on-surface-variant p-8">Loading report card...</p>;
  if (error || !data) return <p className="text-sm text-error p-8">{error || "Report card not found."}</p>;

  const school = data.school;
  const student = data.student;
  const results = data.results || [];
  const academics = data.academics || {};
  const hasGpa = typeof academics.gpa === "number";

  return (
    <div>
      <PrintToolbar title="Report card" />
      <article className="print-sheet p-6 sm:p-8 rounded-xl bg-white border border-surface-container-high shadow-sm print:border-0 print:shadow-none">
        <header className="text-center border-b-2 border-on-surface pb-4 mb-4">
          <h2 className="text-xl font-bold">{school.name}</h2>
          {school.campusName ? <p className="text-xs mt-1">{school.campusName}</p> : null}
          <p className="text-[11px] text-on-surface-variant">{school.address}</p>
          <p className="text-[11px] text-on-surface-variant">Phone: {school.phone} • Email: {school.email}</p>
          {school.academicYear ? <p className="text-[11px] mt-1">Academic year: {school.academicYear}</p> : null}
          <p className="mt-3 text-sm font-bold uppercase">Student Report Card</p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
          <p><span className="text-on-surface-variant block">Student</span><strong>{student.fullName}</strong></p>
          <p><span className="text-on-surface-variant block">Admission #</span><strong>{student.admissionNo}</strong></p>
          <p><span className="text-on-surface-variant block">Class</span><strong>{student.className}{student.section ? `-${student.section}` : ""}</strong></p>
          <p><span className="text-on-surface-variant block">Roll</span><strong>{student.rollNo}</strong></p>
        </div>

        <table className="w-full text-xs border border-outline-variant">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="text-left py-2 px-2">Exam</th>
              <th className="text-left py-2 px-2">Subject</th>
              <th className="text-center py-2 px-2">Marks</th>
              <th className="text-center py-2 px-2">Total</th>
              <th className="text-center py-2 px-2">%</th>
              <th className="text-center py-2 px-2">Grade</th>
              {hasGpa ? <th className="text-center py-2 px-2">GPA</th> : null}
              <th className="text-left py-2 px-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr>
                <td colSpan={hasGpa ? 8 : 7} className="py-6 text-center text-on-surface-variant italic">
                  No examination results are recorded for this student.
                </td>
              </tr>
            ) : (
              results.map((r: any) => (
                <tr key={r.id} className="border-t border-outline-variant/40">
                  <td className="py-2 px-2">{r.examName || "—"}</td>
                  <td className="py-2 px-2">{r.subjectName || "—"}</td>
                  <td className="py-2 px-2 text-center">{r.obtainedMarks}</td>
                  <td className="py-2 px-2 text-center">{r.totalMarks}</td>
                  <td className="py-2 px-2 text-center">{r.percentage}</td>
                  <td className="py-2 px-2 text-center">{r.grade || "—"}</td>
                  {hasGpa ? <td className="py-2 px-2 text-center">{typeof r.gpa === "number" ? r.gpa : "—"}</td> : null}
                  <td className="py-2 px-2">{r.remarks || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          {results.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-on-surface font-bold">
                <td className="py-2 px-2" colSpan={2}>Overall</td>
                <td className="py-2 px-2 text-center">{academics.obtainedMarks}</td>
                <td className="py-2 px-2 text-center">{academics.totalMarks}</td>
                <td className="py-2 px-2 text-center">{academics.percentage}%</td>
                <td className="py-2 px-2 text-center">—</td>
                {hasGpa ? <td className="py-2 px-2 text-center">{academics.gpa.toFixed(2)}</td> : null}
                <td className="py-2 px-2"></td>
              </tr>
            </tfoot>
          )}
        </table>

        <div className="grid grid-cols-2 gap-8 mt-10 text-xs">
          <div className="text-center">
            <div className="border-t border-outline-variant pt-1 mt-10">Class teacher</div>
          </div>
          <div className="text-center">
            <div className="border-t border-outline-variant pt-1 mt-10">
              {school.principalName}
              <div className="text-[10px] text-on-surface-variant">Principal / Head</div>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
