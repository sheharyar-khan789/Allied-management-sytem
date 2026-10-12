import { AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getSchoolSettingsServer,
  getSessionProfileServer,
  getStudentByIdServer,
  getStudentCountsByClassServer,
  getTeachersServer,
} from "@/lib/firebase/server-db";
import { resolveTeacherAllocation } from "@/lib/academic-access";

/**
 * Server-side data the role layouts render on every page navigation. Kept out of the layout
 * components so the per-navigation read cost can be measured and bounded by the quota tests
 * (scripts/firestore-quota-budget-test.ts).
 */

export interface AdminShellData {
  /** Display name from the admin's stored profile (null if it can't be resolved). */
  userName: string | null;
  totalStudents: number;
  totalTeachers: number;
  sessionName: string;
}

/**
 * Runs on every /admin navigation. It used to read every student document just to show the
 * sidebar count; it now uses per-class count() aggregations (cached 60s) plus the cached teacher
 * list and settings.
 */
export async function loadAdminShellData(schoolId: string, uid?: string): Promise<AdminShellData> {
  const [studentCounts, teachers, settings, profile] = await Promise.all([
    getStudentCountsByClassServer(schoolId),
    getTeachersServer(schoolId),
    getSchoolSettingsServer(schoolId),
    // The name shown in the sidebar comes from the stored profile (the same cached copy the
    // session check reads), so a renamed admin sees the new name without signing in again.
    uid ? getSessionProfileServer(schoolId, uid) : Promise.resolve(null),
  ]);
  return {
    userName: profile?.name?.trim() || null,
    totalStudents: Array.from(studentCounts.values()).reduce((sum, c) => sum + c.active, 0),
    totalTeachers: teachers.filter((t) => t.status === "ACTIVE").length,
    sessionName: settings?.academicYear
      ? `Session ${settings.academicYear} | ${settings.campusName || "Main Campus"}`
      : "Session not configured",
  };
}

export interface TeacherShellData {
  teacherName: string;
  designation: string;
  canTakeAttendance: boolean;
}

export async function loadTeacherShellData(session: AuthenticatedUser): Promise<TeacherShellData> {
  const data: TeacherShellData = {
    teacherName: session?.name || "Faculty Member",
    designation: "",
    canTakeAttendance: false,
  };
  if (session?.schoolId) {
    const allocation = await resolveTeacherAllocation(session);
    if (allocation) {
      const t = allocation.teacher;
      data.teacherName = t.fullName;
      data.designation = [t.designation, t.department].filter(Boolean).join(" • ");
      data.canTakeAttendance = allocation.inchargeClassIds.size > 0;
    }
  }
  return data;
}

export interface StudentShellData {
  studentName: string;
  admissionNo: string;
  className: string;
  rollNo: string;
}

export async function loadStudentShellData(session: AuthenticatedUser): Promise<StudentShellData> {
  const data: StudentShellData = {
    studentName: session?.name || "Student",
    admissionNo: "",
    className: "",
    rollNo: "",
  };
  if (session?.studentId && session?.schoolId) {
    const st = await getStudentByIdServer(session.schoolId, session.studentId);
    if (st) {
      data.studentName = st.fullName;
      data.admissionNo = st.admissionNo;
      data.className = st.className || "";
      data.rollNo = st.rollNo || "";
    }
  }
  return data;
}
