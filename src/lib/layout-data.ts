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
 * Runs on every /admin navigation. Uses per-class count() aggregations (cached 60s)
 * plus cached teacher list and settings. Resilient to quota/transient outage.
 */
export async function loadAdminShellData(schoolId: string, uid?: string): Promise<AdminShellData> {
  const [studentCountsRes, teachersRes, settingsRes, profileRes] = await Promise.allSettled([
    getStudentCountsByClassServer(schoolId),
    getTeachersServer(schoolId),
    getSchoolSettingsServer(schoolId),
    uid ? getSessionProfileServer(schoolId, uid) : Promise.resolve(null),
  ]);

  const studentCounts = studentCountsRes.status === "fulfilled" ? studentCountsRes.value : new Map();
  const teachers = teachersRes.status === "fulfilled" ? teachersRes.value : [];
  const settings = (settingsRes.status === "fulfilled" && settingsRes.value)
    ? settingsRes.value
    : null; // Do not retry — if the first attempt failed (quota/outage) a second call will also fail.
  const profile = profileRes.status === "fulfilled" ? profileRes.value : null;

  return {
    userName: profile?.name?.trim() || null,
    totalStudents: Array.from(studentCounts.values()).reduce((sum, c) => sum + c.active, 0),
    totalTeachers: teachers.filter((t) => !t.status || t.status.toUpperCase() === "ACTIVE").length,
    sessionName: settings?.academicYear
      ? `Session ${settings.academicYear} | ${settings.campusName || "Main Campus"}`
      : "Session 2024-2025 | Main Campus",
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
    const allocation = await resolveTeacherAllocation(session).catch(() => null);
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
    const st = await getStudentByIdServer(session.schoolId, session.studentId).catch(() => null);
    if (st) {
      data.studentName = st.fullName;
      data.admissionNo = st.admissionNo;
      data.className = st.className || "";
      data.rollNo = st.rollNo || "";
    }
  }
  return data;
}
