import React from "react";
import StudentNav from "@/components/StudentNav";
import { requirePageRole } from "@/lib/page-auth";
import { loadStudentShellData } from "@/lib/layout-data";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageRole("STUDENT");

  const { studentName, admissionNo, className, rollNo } = await loadStudentShellData(session);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StudentNav studentName={studentName} admissionNo={admissionNo} className={className} rollNo={rollNo} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
