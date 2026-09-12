import React from "react";
import StudentNav from "@/components/StudentNav";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { getStudentByIdServer } from "@/lib/firebase/server-db";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthenticatedUser();

  let studentName = session?.name || "Student";
  let admissionNo = "STD-2024";
  let className = "Class 10-A";

  if (session?.studentId && session?.schoolId) {
    const st = await getStudentByIdServer(session.schoolId, session.studentId);
    if (st) {
      studentName = st.fullName;
      admissionNo = st.admissionNo;
      className = st.className || "Class 10-A";
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StudentNav studentName={studentName} admissionNo={admissionNo} className={className} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
