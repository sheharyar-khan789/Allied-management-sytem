import React from "react";
import TeacherNav from "@/components/TeacherNav";
import ServiceBusyNotice from "@/components/ServiceBusyNotice";
import { requirePageRole } from "@/lib/page-auth";
import { loadTeacherShellData } from "@/lib/layout-data";
import { ServiceUnavailableError } from "@/lib/firebase/firestore-errors";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // See admin/layout.tsx for why this catches only a confirmed Firestore outage: that message
  // must not be shown for an unrelated, unexpected error.
  let teacherName: string, designation: string, canTakeAttendance: boolean;
  try {
    const session = await requirePageRole("TEACHER");
    ({ teacherName, designation, canTakeAttendance } = await loadTeacherShellData(session));
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return <ServiceBusyNotice />;
    throw e;
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
