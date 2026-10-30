import React from "react";
import AdminShell from "@/components/AdminShell";
import ServiceBusyNotice from "@/components/ServiceBusyNotice";
import { requirePageRole } from "@/lib/page-auth";
import { loadAdminShellData } from "@/lib/layout-data";
import { ServiceUnavailableError } from "@/lib/firebase/firestore-errors";
export const dynamic = 'force-dynamic';
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // requirePageRole's own session-revocation check reads Firestore; when that read is confirmed
  // unavailable (quota exhausted / unreachable) it throws ServiceUnavailableError rather than
  // silently letting a possibly-revoked session through. That used to propagate straight past
  // this layout into the generic app/error.tsx boundary, which blames "Service is temporarily
  // busy" on literally any uncaught error — including ones that have nothing to do with
  // Firestore. Catching only this confirmed case here keeps that message honest.
  let session;
  try {
    session = await requirePageRole("ADMIN");
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return <ServiceBusyNotice />;
    throw e;
  }
  // No hardcoded tenant fallback. This previously defaulted to the literal schoolId
  // "allied-school-main", so any request that reached this layout without a resolvable session
  // would have read (and displayed) a different tenant's real student and teacher counts.
  // src/middleware.ts already guarantees an ADMIN session on /admin/*, so an unresolved session
  // here is a genuine fault and is surfaced as one rather than papered over.
  const schoolId = session?.schoolId;

  let totalStudents = 0;
  let totalTeachers = 0;
  let sessionName = "Session not configured";
  let profileName: string | null = null;
  let dataLoadError = false;

  try {
    if (!schoolId) {
      throw new Error("No authenticated school context available for the admin layout.");
    }
    ({ totalStudents, totalTeachers, sessionName, userName: profileName } = await loadAdminShellData(schoolId, session?.uid));
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
      userName={profileName || session?.name || "Administrator"}
      userRole={session?.role === "ADMIN" ? "Super Admin" : "Staff"}
      sessionName={sessionName}
      dataLoadError={dataLoadError}
    >
      {children}
    </AdminShell>
  );
}
