import React from "react";
import AdminShell from "@/components/AdminShell";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { getStudentsServer, getTeachersServer, getSchoolSettingsServer } from "@/lib/firebase/server-db";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthenticatedUser();
  // No hardcoded tenant fallback. This previously defaulted to the literal schoolId
  // "allied-school-main", so any request that reached this layout without a resolvable session
  // would have read (and displayed) a different tenant's real student and teacher counts.
  // src/middleware.ts already guarantees an ADMIN session on /admin/*, so an unresolved session
  // here is a genuine fault and is surfaced as one rather than papered over.
  const schoolId = session?.schoolId;

  let totalStudents = 0;
  let totalTeachers = 0;
  let sessionName = "Session not configured";
  let dataLoadError = false;

  try {
    if (!schoolId) {
      throw new Error("No authenticated school context available for the admin layout.");
    }
    const [students, teachers, settings] = await Promise.all([
      getStudentsServer(schoolId),
      getTeachersServer(schoolId),
      getSchoolSettingsServer(schoolId)
    ]);
    totalStudents = students.filter((s) => s.status === "ACTIVE").length;
    totalTeachers = teachers.filter((t) => t.status === "ACTIVE").length;
    if (settings?.academicYear) {
      sessionName = `Session ${settings.academicYear} | Main Campus`;
    }
  } catch (e) {
    // Previously this was a silent no-op ("Graceful fallback") that let 0/0 counts and a
    // hardcoded fake session label render as if they were real data, with no record of the
    // failure anywhere. A genuine Firestore outage now (a) is logged, and (b) surfaces a
    // visible, honest banner instead of pretending the zeroed-out counts are accurate — while
    // still letting the admin section render and stay navigable rather than crashing outright.
    console.error("[AdminLayout] Failed to load school statistics/settings:", e);
    dataLoadError = true;
    sessionName = "Session data unavailable";
  }

  return (
    <AdminShell
      totalStudents={totalStudents}
      totalTeachers={totalTeachers}
      userName={session?.name || "Administrator"}
      userRole={session?.role === "ADMIN" ? "Super Admin" : "Staff"}
      sessionName={sessionName}
      dataLoadError={dataLoadError}
    >
      {children}
    </AdminShell>
  );
}
