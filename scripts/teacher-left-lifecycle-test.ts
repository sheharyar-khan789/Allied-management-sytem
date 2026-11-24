/**
 * Teacher "Left" employment-status lifecycle (Task 3): marking a teacher INACTIVE via
 * PUT /api/teachers/[id] (by setting endingDate) must clear their forward-looking timetable/
 * class/subject assignments, revoke login access, and exclude them from future active payroll
 * totals — while preserving all historical records (payroll history, assignments shown via
 * audit trail) untouched. Reactivation must restore login without creating a duplicate profile.
 * Runs against the in-memory store (no Firebase credentials loaded by tsx).
 */
import { NextRequest } from "next/server";
import { PUT as teacherPut } from "../src/app/api/teachers/[id]/route";
import { GET as payrollGet } from "../src/app/api/payroll/route";
import {
  createUserServer,
  getClassesServer,
  getSubjectsServer,
  getTeacherByIdServer,
  getTimetableServer,
  getUserByIdServer,
  savePayrollRecordServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  saveTimetableEntryServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { ClassDoc, SubjectDoc, TeacherDoc, TimetableDoc } from "../src/lib/firebase/types";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  console.log("==================================================");
  console.log("TEACHER LEFT — EMPLOYMENT STATUS LIFECYCLE");
  console.log("==================================================");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const SCHOOL = "school-left-a";
  await updateSchoolSettingsServer({
    id: SCHOOL, schoolId: SCHOOL, schoolName: "Left Test School", campusName: "Main", motto: "", address: "",
    phone: "", email: `admin@${SCHOOL}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
  });

  const cls: ClassDoc = {
    id: "cls-left-9", schoolId: SCHOOL, name: "Class 9", section: "A", numericLevel: 9, capacity: 30,
    roomNo: "R-9", classTeacherId: "tch-left-1", academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveClassServer(cls);

  const subj: SubjectDoc = {
    id: "sb-left-math9", schoolId: SCHOOL, classId: cls.id, name: "Mathematics", code: "MATH9",
    teacherId: "tch-left-1", credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveSubjectServer(subj);

  const slot: TimetableDoc = {
    id: "tt-left-1", schoolId: SCHOOL, teacherId: "tch-left-1", teacherName: "Teacher Leaving",
    classId: cls.id, className: "Class 9-A", subjectId: subj.id, subjectName: "Mathematics",
    dayOfWeek: "Monday", periodName: "Period 1", startTime: "08:00 AM", endTime: "08:45 AM",
    academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveTimetableEntryServer(slot);

  const teacher: TeacherDoc = {
    id: "tch-left-1", schoolId: SCHOOL, userId: "uid-left-1", employeeId: "TCH-LEFT-1",
    fullName: "Teacher Leaving", email: "leaving@school-left-a.edu", phone: "0300",
    designation: "Teacher", department: "Science", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [cls.id], assignedSubjectIds: [subj.id], weeklyLoad: 10,
    baseSalary: 50000, salary: 50000, joiningDate: "2023-01-01", endingDate: null,
    createdAt: now, updatedAt: now,
  };
  await saveTeacherServer(teacher);
  await createUserServer({
    uid: "uid-left-1", email: teacher.email, name: teacher.fullName, role: "TEACHER",
    schoolId: SCHOOL, teacherId: teacher.id, status: "ACTIVE", createdAt: now, updatedAt: now,
  });

  // A payroll record from BEFORE the teacher leaves — must survive untouched.
  await savePayrollRecordServer({
    id: "payrec-left-past", schoolId: SCHOOL, teacherId: teacher.id, teacherName: teacher.fullName,
    employeeId: teacher.employeeId, month: "January", year: 2026, amount: 50000, status: "PAID",
    paidDate: "2026-01-28", createdAt: now, updatedAt: now,
  });

  const ADMIN = await createSessionCookieServer({ uid: "uid-left-admin", email: "admin@x.edu", role: "ADMIN", schoolId: SCHOOL, name: "Admin" });

  // ======================================================================
  // 1. PAYROLL BEFORE DEPARTURE — active teacher appears, past record intact
  // ======================================================================
  const payrollPastBefore = await json(await payrollGet(req(ADMIN, "http://x/api/payroll?month=January&year=2026")));
  assert(
    payrollPastBefore.records.some((r: any) => r.teacherId === teacher.id && r.status === "PAID" && r.baseSalary === 50000),
    "Before departure: January 2026 payroll still shows the existing PAID record"
  );
  const payrollCurrentBefore = await json(await payrollGet(req(ADMIN, "http://x/api/payroll?month=March&year=2026")));
  assert(
    payrollCurrentBefore.records.some((r: any) => r.teacherId === teacher.id),
    "Before departure: active teacher appears in a month with no record yet (synthesized UNPAID row)"
  );

  // ======================================================================
  // 2. MARK AS LEFT — one admin action, PUT with endingDate set
  // ======================================================================
  const markLeftRes = await teacherPut(
    req(ADMIN, `http://x/api/teachers/${teacher.id}`, "PUT", { endingDate: "2026-02-15" }),
    idParams(teacher.id)
  );
  const markLeftJson = await json(markLeftRes);
  assert(markLeftRes.status === 200, "Admin marks the teacher as Left (sets ending date) in one PUT request");
  assert(markLeftJson.teacher?.status === "INACTIVE", "Teacher status flips to INACTIVE");
  assert(
    markLeftJson.referenceCleanup?.classesCleared === 1 &&
      markLeftJson.referenceCleanup?.subjectsCleared === 1 &&
      markLeftJson.referenceCleanup?.timetableSlotsCleared === 1,
    "Response reports exactly the class/subject/timetable references that were cleared"
  );

  // --- Timetable (C): forward-looking assignments cleared, slot itself preserved ---
  const updatedClass = (await getClassesServer(SCHOOL)).find((c) => c.id === cls.id);
  assert(updatedClass?.classTeacherId === null, "Class incharge reference cleared (no invalid teacher shown)");
  const updatedSubject = (await getSubjectsServer(SCHOOL)).find((s) => s.id === subj.id);
  assert(updatedSubject?.teacherId === null, "Subject teacher reference cleared");
  const updatedSlots = await getTimetableServer(SCHOOL, undefined, undefined, undefined, { allSessions: true });
  const updatedSlot = updatedSlots.find((s) => s.id === slot.id);
  assert(updatedSlot !== undefined && updatedSlot.teacherId === "", "Timetable slot itself is preserved (belongs to the class), just shows Unassigned");

  // --- Login access (D): revoked immediately ---
  const profileAfterLeft = await getUserByIdServer("uid-left-1");
  assert(profileAfterLeft?.status === "INACTIVE", "Login profile status set to INACTIVE — session/refresh tokens revoked by syncTeacherAccountStatus");

  // --- Historical data (A): past payroll record untouched ---
  const payrollPastAfter = await json(await payrollGet(req(ADMIN, "http://x/api/payroll?month=January&year=2026")));
  const pastRecordAfter = payrollPastAfter.records.find((r: any) => r.teacherId === teacher.id);
  assert(
    pastRecordAfter?.status === "PAID" && pastRecordAfter?.baseSalary === 50000 && pastRecordAfter?.paidDate === "2026-01-28",
    "Historical January 2026 PAID record is preserved exactly, unmodified by the departure"
  );

  // --- Salary exclusion (B): no phantom UNPAID row for a month with no record ---
  const payrollCurrentAfter = await json(await payrollGet(req(ADMIN, "http://x/api/payroll?month=March&year=2026")));
  assert(
    !payrollCurrentAfter.records.some((r: any) => r.teacherId === teacher.id),
    "After departure: teacher with no March 2026 record is excluded from active payroll — no phantom UNPAID row"
  );
  assert(
    !payrollCurrentAfter.stats || typeof payrollCurrentAfter.stats.totalSalaryDue === "number",
    "Payroll stats still compute cleanly with the departed teacher excluded"
  );

  const teacherDocAfter = await getTeacherByIdServer(SCHOOL, teacher.id);
  assert(teacherDocAfter?.endingDate === "2026-02-15", "Teacher record keeps the ending date for reporting");

  // ======================================================================
  // 3. REACTIVATION (E) — clearing the ending date restores access, no duplicate profile
  // ======================================================================
  const reactivateRes = await teacherPut(
    req(ADMIN, `http://x/api/teachers/${teacher.id}`, "PUT", { endingDate: "" }),
    idParams(teacher.id)
  );
  const reactivateJson = await json(reactivateRes);
  assert(reactivateRes.status === 200 && reactivateJson.teacher?.status === "ACTIVE", "Admin reactivates the same teacher by clearing the ending date");
  assert(reactivateJson.referenceCleanup === null, "Reactivation does not re-run reference cleanup (admin reassigns manually, avoiding stale/conflicting periods)");

  const teacherDocReactivated = await getTeacherByIdServer(SCHOOL, teacher.id);
  assert(teacherDocReactivated?.id === teacher.id, "Reactivation reuses the exact same teacher record — no duplicate profile created");

  const profileAfterReactivate = await getUserByIdServer("uid-left-1");
  assert(profileAfterReactivate?.status === "ACTIVE", "Login profile status restored to ACTIVE on reactivation");
  assert(profileAfterReactivate?.uid === "uid-left-1", "Same Firebase uid is reused — login identity was never duplicated");

  const payrollAfterReactivate = await json(await payrollGet(req(ADMIN, "http://x/api/payroll?month=March&year=2026")));
  assert(
    payrollAfterReactivate.records.some((r: any) => r.teacherId === teacher.id),
    "After reactivation, the teacher reappears in active payroll for a month with no record yet"
  );

  console.log("==================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
