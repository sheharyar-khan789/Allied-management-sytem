import React from "react";
import TeacherNav from "@/components/TeacherNav";
import { requirePageRole } from "@/lib/page-auth";
import { resolveTeacherAllocation } from "@/lib/academic-access";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageRole("TEACHER");

  let teacherName = session?.name || "Faculty Member";
  // No fabricated professional title. This previously defaulted to
  // "Senior Educator • Academic Faculty" and rendered it beside the teacher's real name
  // whenever their teacher record could not be resolved — presenting an invented seniority and
  // department as though they were the school's own personnel data. When there is no real
  // designation on file, nothing is shown.
  let designation = "";
  let canTakeAttendance = false;

  // Falls back to the login profile's teacherId when the session token doesn't carry one.
  if (session?.schoolId) {
    const allocation = await resolveTeacherAllocation(session);
    if (allocation) {
      const t = allocation.teacher;
      teacherName = t.fullName;
      designation = [t.designation, t.department].filter(Boolean).join(" • ");
      canTakeAttendance = allocation.inchargeClassIds.size > 0;
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TeacherNav teacherName={teacherName} designation={designation} canTakeAttendance={canTakeAttendance} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
