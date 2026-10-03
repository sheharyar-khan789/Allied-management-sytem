import React from "react";
import TeacherNav from "@/components/TeacherNav";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthenticatedUser();

  let teacherName = session?.name || "Faculty Member";
  // No fabricated professional title. This previously defaulted to
  // "Senior Educator • Academic Faculty" and rendered it beside the teacher's real name
  // whenever their teacher record could not be resolved — presenting an invented seniority and
  // department as though they were the school's own personnel data. When there is no real
  // designation on file, nothing is shown.
  let designation = "";

  // Falls back to the login profile's teacherId when the session token doesn't carry one.
  if (session?.schoolId) {
    const t = await resolveAuthenticatedTeacher(session);
    if (t) {
      teacherName = t.fullName;
      designation = [t.designation, t.department].filter(Boolean).join(" • ");
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TeacherNav teacherName={teacherName} designation={designation} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
