import React from "react";
import { requirePageRole } from "@/lib/page-auth";
import { resolveTeacherAllocation } from "@/lib/academic-access";
import { getSchoolSettingsServer, getClassesServer, getSubjectsServer } from "@/lib/firebase/server-db";

export const dynamic = "force-dynamic";

export default async function TeacherAccountPage() {
  const session = await requirePageRole("TEACHER");
  const [allocation, settings, classes, subjects] = await Promise.all([
    resolveTeacherAllocation(session),
    getSchoolSettingsServer(session.schoolId),
    getClassesServer(session.schoolId),
    getSubjectsServer(session.schoolId),
  ]);

  const teacher = allocation?.teacher;
  const name = teacher?.fullName || session.name || "Faculty Member";
  const email = teacher?.email || session.email || "—";
  const employeeId = teacher?.employeeId || "—";
  const designation = teacher?.designation || "Teacher";
  const department = teacher?.department || "General";
  const phone = teacher?.phone || "—";
  const qualification = teacher?.qualification || "—";
  const joiningDate = teacher?.joiningDate || "—";
  const status = teacher?.status || "ACTIVE";

  const assignedClasses = classes
    .filter((c) => teacher?.assignedClassIds?.includes(c.id))
    .map((c) => `${c.name} (${c.section})`);

  const assignedSubjects = subjects
    .filter((s) => teacher?.assignedSubjectIds?.includes(s.id))
    .map((s) => s.name);

  return (
    <div className="flex flex-col w-full max-w-3xl mx-auto gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">My Account</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          View your faculty profile, departmental information, and active academic assignments.
        </p>
      </div>

      {/* Main Profile Information */}
      <div className="bg-surface-container-lowest border border-surface-container-high/60 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-6 border-b border-surface-container-low">
          <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-2xl">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-on-surface">{name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-error-container text-error"
              }`}>
                {status}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {designation} • {department}
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Campus: {settings?.campusName || "Main Campus"}
            </p>
          </div>
        </div>

        {/* Detailed Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 text-xs">
          <div className="p-3 rounded-lg bg-surface-container-low/50 border border-surface-container-high/30">
            <span className="text-on-surface-variant font-medium block">Employee ID</span>
            <span className="text-on-surface font-semibold font-mono text-sm mt-0.5 block">{employeeId}</span>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low/50 border border-surface-container-high/30">
            <span className="text-on-surface-variant font-medium block">Email Address</span>
            <span className="text-on-surface font-semibold text-sm mt-0.5 block">{email}</span>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low/50 border border-surface-container-high/30">
            <span className="text-on-surface-variant font-medium block">Phone Number</span>
            <span className="text-on-surface font-semibold text-sm mt-0.5 block">{phone}</span>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low/50 border border-surface-container-high/30">
            <span className="text-on-surface-variant font-medium block">Qualification</span>
            <span className="text-on-surface font-semibold text-sm mt-0.5 block">{qualification}</span>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low/50 border border-surface-container-high/30">
            <span className="text-on-surface-variant font-medium block">Date of Joining</span>
            <span className="text-on-surface font-semibold text-sm mt-0.5 block">{joiningDate}</span>
          </div>

          <div className="p-3 rounded-lg bg-surface-container-low/50 border border-surface-container-high/30">
            <span className="text-on-surface-variant font-medium block">Academic Session</span>
            <span className="text-on-surface font-semibold text-sm mt-0.5 block">{settings?.academicYear || "Active"}</span>
          </div>
        </div>
      </div>

      {/* Academic Assignments */}
      <div className="bg-surface-container-lowest border border-surface-container-high/60 rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="font-headline-sm text-sm font-bold text-on-surface">Academic Allocations</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-on-surface-variant font-medium block mb-1.5">Assigned Classes</span>
            {assignedClasses.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {assignedClasses.map((c, idx) => (
                  <span key={idx} className="px-2 py-1 rounded bg-surface-container-high text-on-surface font-semibold">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant italic">No classes currently assigned.</p>
            )}
          </div>

          <div>
            <span className="text-on-surface-variant font-medium block mb-1.5">Assigned Subjects</span>
            {assignedSubjects.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {assignedSubjects.map((s, idx) => (
                  <span key={idx} className="px-2 py-1 rounded bg-secondary/10 text-secondary font-semibold">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant italic">No subjects currently assigned.</p>
            )}
          </div>
        </div>
      </div>

      {/* Security & Credentials Notice */}
      <div className="p-4 rounded-xl bg-surface-container-low border border-surface-container-high/60 text-xs text-on-surface-variant">
        <div className="flex items-start gap-2.5">
          <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">verified_user</span>
          <div>
            <p className="font-bold text-on-surface">Account Security Notice</p>
            <p className="mt-0.5">
              Faculty credentials, roles, and access permissions are managed centrally by the School Administration. If you require password assistance or credential updates, please contact your school administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
