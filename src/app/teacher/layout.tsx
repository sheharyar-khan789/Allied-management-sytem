import React from "react";
import TeacherNav from "@/components/TeacherNav";
import { requirePageRole } from "@/lib/page-auth";
import { loadTeacherShellData } from "@/lib/layout-data";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageRole("TEACHER");

  const { teacherName, designation, canTakeAttendance } = await loadTeacherShellData(session);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TeacherNav teacherName={teacherName} designation={designation} canTakeAttendance={canTakeAttendance} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
