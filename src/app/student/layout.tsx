import React from "react";
import StudentNav from "@/components/StudentNav";
import ServiceBusyNotice from "@/components/ServiceBusyNotice";
import { requirePageRole } from "@/lib/page-auth";
import { loadStudentShellData } from "@/lib/layout-data";
import { ServiceUnavailableError } from "@/lib/firebase/firestore-errors";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // See admin/layout.tsx for why this catches only a confirmed Firestore outage: that message
  // must not be shown for an unrelated, unexpected error.
  let studentName: string, admissionNo: string, className: string, rollNo: string;
  try {
    const session = await requirePageRole("STUDENT");
    ({ studentName, admissionNo, className, rollNo } = await loadStudentShellData(session));
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return <ServiceBusyNotice />;
    throw e;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StudentNav studentName={studentName} admissionNo={admissionNo} className={className} rollNo={rollNo} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
