import { NextRequest } from "next/server";
import { GET as attendanceGet, POST as attendancePost } from "../src/app/api/attendance/route";
import { POST as classesPost } from "../src/app/api/classes/route";
import { POST as studentsPost } from "../src/app/api/students/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  createUserServer,
  getAttendanceServer,
  getClassByIdServer,
  getClassesServer,
  getExamResultsServer,
  getExamsServer,
  getFeeChallansServer,
  getStudentsServer,
  saveAttendanceRecordServer,
  saveClassServer,
  saveExamResultServer,
  saveExamServer,
  saveFeeChallanServer,
  saveStudentServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import {
  ATTENDANCE_TEACHER_EDIT_WINDOW_MS,
  isAttendanceDateOpenForTeacher,
  isAttendanceLockedForTeacher,
} from "../src/lib/attendance-lock";
import { resolveRecordSession } from "../src/lib/academic-session";
import { ClassDoc, SchoolSettingsDoc, StudentDoc, TeacherDoc } from "../src/lib/firebase/types";

async function run() {
  console.log("==================================================");
  console.log("ATTENDANCE LOCK + ACADEMIC SESSION ISOLATION");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      failed++;
    }
  }

  const schoolId = "school-session-lock-test";
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const HOUR = 60 * 60 * 1000;
  const OLD_SESSION = "2026-2027";
  const NEW_SESSION = "2027-2028";

  const settings: SchoolSettingsDoc = {
    id: schoolId, schoolId, schoolName: "Session Test School", campusName: "Main Campus",
    motto: "", address: "", phone: "", email: "admin@session-test.school", principalName: "Principal",
    academicYear: OLD_SESSION, gradingScale: [], updatedAt: now,
  };
  await updateSchoolSettingsServer(settings);

  // ---------------------------------------------------------------------------
  // Pure lock rules
  // ---------------------------------------------------------------------------
  const t0 = Date.parse("2026-09-10T08:00:00.000Z");
  const rec = { createdAt: new Date(t0).toISOString(), updatedAt: new Date(t0).toISOString() };
  assert(!isAttendanceLockedForTeacher(rec, t0 + 23 * HOUR), "Lock rule: record editable 23h after marking");
  assert(isAttendanceLockedForTeacher(rec, t0 + ATTENDANCE_TEACHER_EDIT_WINDOW_MS), "Lock rule: record locked at exactly 24h");
  assert(isAttendanceLockedForTeacher({ createdAt: "", updatedAt: "" }, t0), "Lock rule: record with no timestamp fails closed (locked)");
  assert(isAttendanceDateOpenForTeacher("2026-09-10", t0 + 20 * HOUR), "Lock rule: teacher may still mark yesterday's date within 24h");
  assert(!isAttendanceDateOpenForTeacher("2026-09-05", t0), "Lock rule: teacher cannot backfill a date older than 24h");

  // ---------------------------------------------------------------------------
  // Fixture: one class/teacher/student in the OLD session
  // ---------------------------------------------------------------------------
  const oldClass: ClassDoc = {
    id: "cls-lock-10a", schoolId, name: "Grade 10", section: "A", numericLevel: 10, capacity: 30,
    academicYear: OLD_SESSION, createdAt: now, updatedAt: now,
  };
  await saveClassServer(oldClass);

  const teacher: TeacherDoc = {
    id: "tch-lock-1", schoolId, employeeId: "EMP-L1", fullName: "Lock Teacher",
    email: "teacher@session-test.school", phone: "0300", designation: "Teacher", department: "Science",
    qualification: "B.Ed", status: "ACTIVE", assignedClassIds: [oldClass.id], assignedSubjectIds: [],
    weeklyLoad: 10, createdAt: now, updatedAt: now,
  };
  await saveTeacherServer(teacher);
  await createUserServer({
    uid: "uid-lock-teacher", email: teacher.email, role: "TEACHER", schoolId, teacherId: teacher.id,
    name: teacher.fullName, status: "ACTIVE", createdAt: now, updatedAt: now,
  });

  const oldStudent = {
    id: "std-lock-1", schoolId, classId: oldClass.id, admissionNo: "STD-2026-001", rollNo: "1",
    fullName: "Old Session Student", fatherName: "Father", gender: "MALE", status: "ACTIVE",
    guardianName: "Guardian", guardianRelation: "Father", guardianPhone: "0300",
    section: "A", monthlyFee: 1000, discount: 0, createdAt: now, updatedAt: now,
  } as StudentDoc;
  await saveStudentServer(oldStudent);

  const teacherToken = await createSessionCookieServer({
    uid: "uid-lock-teacher", email: teacher.email, role: "TEACHER", schoolId, teacherId: teacher.id, name: teacher.fullName,
  });
  const adminToken = await createSessionCookieServer({
    uid: "uid-lock-admin", email: "admin@session-test.school", role: "ADMIN", schoolId, name: "Admin",
  });
  function req(token: string, url: string, body?: unknown) {
    const headers = new Headers({ cookie: `allied_session=${token}` });
    if (body) headers.set("content-type", "application/json");
    return new NextRequest(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const mark = (token: string, date: string, status: string) =>
    attendancePost(req(token, "http://x/api/attendance", {
      classId: oldClass.id, date, records: [{ studentId: oldStudent.id, status, remarks: "" }],
    }));
  const recordFor = async (date: string) =>
    (await getAttendanceServer(schoolId, date, oldClass.id))[0];

  // ---------------------------------------------------------------------------
  // Attendance locking (server-side)
  // ---------------------------------------------------------------------------
  assert((await mark(teacherToken, today, "PRESENT")).status === 200, "Teacher can mark today's attendance");
  const first = await recordFor(today);
  assert(first?.academicYear === OLD_SESSION, "New attendance record is stamped with its class's session");

  assert((await mark(teacherToken, today, "LATE")).status === 200, "Teacher can edit within 24 hours");
  const edited = await recordFor(today);
  assert(edited.status === "LATE" && edited.createdAt === first.createdAt, "Edit keeps the original createdAt (lock window not restarted)");

  // Age the record past the teacher window.
  const agedCreatedAt = new Date(Date.now() - 25 * HOUR).toISOString();
  await saveAttendanceRecordServer({ ...edited, createdAt: agedCreatedAt });

  const lockedGet = await attendanceGet(req(teacherToken, `http://x/api/attendance?classId=${oldClass.id}&date=${today}`)).then((r) => r.json());
  assert(lockedGet.locked === true && lockedGet.roster[0].editable === false, "Teacher GET reports register as locked/read-only after 24h");

  const teacherLockedEdit = await mark(teacherToken, today, "ABSENT");
  assert(teacherLockedEdit.status === 403, "Teacher edit of a locked record is rejected (403)");
  assert((await recordFor(today)).status === "LATE", "Locked record is unchanged after rejected teacher edit");

  assert((await mark(teacherToken, today, "LATE")).status === 200, "Teacher re-submitting an unchanged locked register is a no-op, not an error");

  const adminGet = await attendanceGet(req(adminToken, `http://x/api/attendance?classId=${oldClass.id}&date=${today}`)).then((r) => r.json());
  assert(adminGet.locked === false && adminGet.lockedForTeachers === true && adminGet.roster[0].editable === true, "Admin GET: locked for teachers but editable by admin");

  assert((await mark(adminToken, today, "ABSENT")).status === 200, "Admin can edit a locked record");
  const overridden = await recordFor(today);
  assert(
    overridden.status === "ABSENT" && overridden.createdAt === agedCreatedAt && overridden.updatedBy === "uid-lock-admin",
    "Admin override keeps createdAt/lock and records updatedBy"
  );

  const oldDate = new Date(Date.now() - 5 * 24 * HOUR).toISOString().split("T")[0];
  assert((await mark(teacherToken, oldDate, "PRESENT")).status === 403, "Teacher cannot backfill attendance for a date older than 24h");
  assert((await mark(adminToken, oldDate, "PRESENT")).status === 200, "Admin can backfill attendance for an old date");

  // Old-session exam, result and challan for the history checks below.
  await saveExamServer({
    id: "exam-lock-old", schoolId, name: "Old Final", term: "Final", session: OLD_SESSION,
    startDate: "2027-03-01", endDate: "2027-03-10", status: "PUBLISHED", createdAt: now, updatedAt: now,
  });
  await saveExamResultServer({
    id: "", schoolId, examId: "exam-lock-old", studentId: oldStudent.id, classId: oldClass.id,
    subjectId: "sub-x", obtainedMarks: 80, totalMarks: 100, percentage: 80, grade: "A", gpa: 3.7,
    status: "PASS", evaluatedBy: "uid-lock-admin", createdAt: now, updatedAt: now,
  });
  await saveFeeChallanServer({
    id: "ch-lock-old", schoolId, studentId: oldStudent.id, classId: oldClass.id, challanNo: "CHL-OLD",
    month: "March", year: 2027, issueDate: "2027-03-01", dueDate: "2027-03-10", tuitionFee: 1000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 1000, paidAmount: 0,
    balanceAmount: 1000, status: "PENDING", createdAt: now, updatedAt: now,
  });
  const oldSnapshot = JSON.stringify(await getAttendanceServer(schoolId, undefined, oldClass.id));

  // ---------------------------------------------------------------------------
  // Academic session isolation
  // ---------------------------------------------------------------------------
  await updateSchoolSettingsServer({ ...settings, academicYear: NEW_SESSION, updatedAt: new Date().toISOString() });

  assert((await getClassesServer(schoolId)).length === 0, "New session starts with no classes");
  assert((await getStudentsServer(schoolId)).length === 0, "New session starts with no students");
  assert((await getAttendanceServer(schoolId)).length === 0, "New session starts with no attendance");
  assert((await getExamsServer(schoolId)).length === 0, "New session starts with no exams");
  assert((await getExamResultsServer(schoolId)).length === 0, "New session starts with no results");
  assert((await getFeeChallansServer(schoolId)).length === 0, "New session starts with no fee challans");

  const crossSessionMark = await mark(adminToken, today, "PRESENT");
  assert(crossSessionMark.status === 404, "Attendance cannot be written to a previous session's class while a new session is active");

  const newClassRes = await classesPost(req(adminToken, "http://x/api/classes", { name: "Grade 10", section: "A" }));
  const newClassJson = await newClassRes.json();
  const newClassId: string = newClassJson?.class?.id || newClassJson?.classId || newClassJson?.id || "";
  const newClasses = await getClassesServer(schoolId);
  assert(newClassRes.status < 300 && newClasses.length === 1 && newClasses[0].academicYear === NEW_SESSION, "Same class name/section can be created in the new session");
  assert(newClasses[0].id !== oldClass.id && (!newClassId || newClassId === newClasses[0].id), "New session's class is a separate document");
  const oldClassAfter = await getClassByIdServer(schoolId, oldClass.id);
  assert(oldClassAfter?.academicYear === OLD_SESSION, "Previous session's class document is untouched");

  const newStudentRes = await studentsPost(req(adminToken, "http://x/api/students", {
    firstName: "New", lastName: "Student", classId: newClasses[0].id, guardianName: "Guardian", guardianPhone: "0301", gender: "Female",
  }));
  const newStudents = await getStudentsServer(schoolId);
  assert(newStudentRes.status < 300 && newStudents.length === 1 && newStudents[0].academicYear === NEW_SESSION, "Student enrolled in new session is stamped with the new session");
  assert(newStudents[0].admissionNo !== oldStudent.admissionNo, "Admission numbers stay unique across sessions");

  const enrolIntoOldClass = await studentsPost(req(adminToken, "http://x/api/students", {
    firstName: "Mixed", lastName: "Up", classId: oldClass.id, guardianName: "Guardian", guardianPhone: "0302", gender: "Male",
  }));
  assert(enrolIntoOldClass.status === 400, "Enrolling into a previous session's class is rejected");

  // Switch back: the old session's data is shown exactly as it was.
  await updateSchoolSettingsServer({ ...settings, academicYear: OLD_SESSION, updatedAt: new Date().toISOString() });
  const restoredStudents = await getStudentsServer(schoolId);
  assert(restoredStudents.length === 1 && restoredStudents[0].id === oldStudent.id, "Switching back restores the previous session's students only");
  assert((await getClassesServer(schoolId)).map((c) => c.id).join() === oldClass.id, "Switching back restores the previous session's classes only");
  assert(JSON.stringify(await getAttendanceServer(schoolId, undefined, oldClass.id)) === oldSnapshot, "Previous session's attendance is byte-for-byte unchanged");
  assert((await getExamResultsServer(schoolId)).length === 1 && (await getFeeChallansServer(schoolId)).length === 1, "Previous session's results and challans are restored");
  assert((await getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true })).length === 2, "allSessions scope sees both sessions");
  assert((await getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { academicYear: NEW_SESSION })).length === 1, "Explicit session scope reads another session without switching");

  // Legacy (pre-stamp) records are attributed to their class / exam session.
  const ctx = {
    academicYear: NEW_SESSION,
    classYears: new Map([["cls-legacy", OLD_SESSION]]),
    examSessions: new Map([["exam-legacy", OLD_SESSION]]),
  };
  assert(resolveRecordSession(ctx, { classId: "cls-legacy" }) === OLD_SESSION, "Legacy record without academicYear follows its class's session");
  assert(resolveRecordSession(ctx, { examId: "exam-legacy", classId: "cls-unknown" }) === OLD_SESSION, "Legacy result follows its exam's session");
  assert(resolveRecordSession(ctx, { academicYear: "2020-2021", classId: "cls-legacy" }) === "2020-2021", "Explicit academicYear stamp always wins");

  console.log("==================================================");
  console.log(`SESSION/LOCK SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exitCode = 1;
});
