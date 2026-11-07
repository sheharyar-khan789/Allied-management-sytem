import { NextRequest } from "next/server";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getTimetableServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
  saveExamServer,
  saveExamScheduleServer,
  getExamResultsServer,
  saveStudentServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc, TimetableDoc, ExamDoc, ExamScheduleDoc, StudentDoc } from "../src/lib/firebase/types";
import {
  GET as timetableGet,
  POST as timetablePost,
  PUT as timetablePut,
} from "../src/app/api/timetable/route";
import {
  GET as examsGet,
  POST as examsPost,
  PUT as examsPut,
} from "../src/app/api/exams/route";
import {
  periodOrder,
  comparePeriodNames,
  sortTimetableEntries,
  toMinutes,
} from "../src/lib/timetable-import";
import { validateObtainedMarks } from "../src/lib/exam-results";

let passed = 0;
let failed = 0;

function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${name}`);
    failed++;
  }
}

let ipCounter = 200;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.99.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("\n=======================================================");
  console.log("TIMETABLE ORDERING & MARKS VALIDATION REGRESSION SUITE");
  console.log("=======================================================\n");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const schoolA = "school-ord-a";
  const schoolB = "school-ord-b";

  for (const sId of [schoolA, schoolB]) {
    await updateSchoolSettingsServer({
      id: sId,
      schoolId: sId,
      schoolName: `Allied School ${sId}`,
      campusName: "Dhoria Campus",
      motto: "",
      address: "",
      phone: "",
      email: `admin@${sId}.edu`,
      principalName: "Principal",
      academicYear: YEAR,
      gradingScale: [],
      updatedAt: now,
    });
  }

  // ---------------------------------------------------------------------------
  // TASK 1: TIMETABLE PERIOD ORDERING TESTS
  // ---------------------------------------------------------------------------
  console.log("--- TASK 1: TIMETABLE PERIOD ORDERING ---");

  // 1. periodOrder extraction
  assert(periodOrder("Period 1") === 1, "periodOrder('Period 1') === 1");
  assert(periodOrder("Period 8") === 8, "periodOrder('Period 8') === 8");
  assert(periodOrder("Period 10") === 10, "periodOrder('Period 10') === 10");
  assert(periodOrder("1") === 1, "periodOrder('1') === 1");
  assert(periodOrder("8") === 8, "periodOrder('8') === 8");
  assert(periodOrder("10") === 10, "periodOrder('10') === 10");
  assert(periodOrder("P-1") === 1, "periodOrder('P-1') === 1");
  assert(periodOrder("1st Period") === 1, "periodOrder('1st Period') === 1");
  assert(periodOrder("8th Period") === 8, "periodOrder('8th Period') === 8");
  assert(periodOrder("First Period") === 1, "periodOrder('First Period') === 1");
  assert(periodOrder("Eighth Period") === 8, "periodOrder('Eighth Period') === 8");
  assert(periodOrder("Morning Assembly") === 0, "periodOrder('Morning Assembly') === 0 (pre-period)");
  assert(periodOrder("Zero Period") === 0, "periodOrder('Zero Period') === 0");

  // 2. comparePeriodNames numeric sorting (Period 1 -> Period 8 -> Period 10, NOT alphabetical)
  assert(comparePeriodNames("Period 1", "Period 2") < 0, "comparePeriodNames: Period 1 < Period 2");
  assert(comparePeriodNames("Period 2", "Period 8") < 0, "comparePeriodNames: Period 2 < Period 8");
  assert(comparePeriodNames("Period 8", "Period 1") > 0, "comparePeriodNames: Period 8 > Period 1");
  assert(comparePeriodNames("Period 2", "Period 10") < 0, "comparePeriodNames: Period 2 < Period 10 (numeric, not alpha where 10 < 2)");
  assert(comparePeriodNames("1", "2") < 0, "comparePeriodNames: '1' < '2'");
  assert(comparePeriodNames("2", "10") < 0, "comparePeriodNames: '2' < '10'");
  assert(comparePeriodNames("8", "1") > 0, "comparePeriodNames: '8' > '1'");

  // 3. toMinutes: handles 12h school time without AM/PM (e.g. 01:00 afternoon)
  assert(toMinutes("08:00") === 480, "toMinutes: 08:00 is 480 min (8:00 AM)");
  assert(toMinutes("12:00") === 720, "toMinutes: 12:00 is 720 min (12:00 PM)");
  assert(toMinutes("01:00") === 780, "toMinutes: 01:00 without PM is 780 min (1:00 PM afternoon, not 1 AM)");
  assert(toMinutes("01:30") === 810, "toMinutes: 01:30 without PM is 810 min (1:30 PM afternoon)");
  assert(toMinutes("08:00 AM") === 480, "toMinutes: 08:00 AM is 480 min");
  assert(toMinutes("01:00 PM") === 780, "toMinutes: 01:00 PM is 780 min");
  assert(toMinutes("13:00") === 780, "toMinutes: 13:00 is 780 min");

  // 4. sortTimetableEntries: Period 1 to Period 8 in strict numeric order even with jumbled times or 01:00 PM
  const jumbledPeriods: Partial<TimetableDoc>[] = [
    { id: "p8", dayOfWeek: "Monday", periodName: "Period 8", startTime: "01:00", endTime: "01:40", className: "Grade 9" },
    { id: "p3", dayOfWeek: "Monday", periodName: "Period 3", startTime: "09:40", endTime: "10:20", className: "Grade 9" },
    { id: "p1", dayOfWeek: "Monday", periodName: "Period 1", startTime: "08:00", endTime: "08:40", className: "Grade 9" },
    { id: "p7", dayOfWeek: "Monday", periodName: "Period 7", startTime: "12:20", endTime: "01:00", className: "Grade 9" },
    { id: "p5", dayOfWeek: "Monday", periodName: "Period 5", startTime: "11:00", endTime: "11:40", className: "Grade 9" },
    { id: "p2", dayOfWeek: "Monday", periodName: "Period 2", startTime: "08:40", endTime: "09:20", className: "Grade 9" },
    { id: "p6", dayOfWeek: "Monday", periodName: "Period 6", startTime: "11:40", endTime: "12:20", className: "Grade 9" },
    { id: "p4", dayOfWeek: "Monday", periodName: "Period 4", startTime: "10:20", endTime: "11:00", className: "Grade 9" },
  ];
  const sortedP = sortTimetableEntries(jumbledPeriods as TimetableDoc[]);
  const periodSequence = sortedP.map((p) => p.periodName);
  assert(
    JSON.stringify(periodSequence) ===
      JSON.stringify(["Period 1", "Period 2", "Period 3", "Period 4", "Period 5", "Period 6", "Period 7", "Period 8"]),
    "sortTimetableEntries: Jumbled periods 1-8 sort exactly: Period 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8"
  );
  assert(sortedP[0].periodName === "Period 1", "Period 1 appears FIRST (index 0)");
  assert(sortedP[7].periodName === "Period 8", "Period 8 appears EIGHTH (index 7, never first)");

  // 5. Configurable periods (e.g. Period 9, Period 10, Period 11, Period 12)
  const extendedPeriods: Partial<TimetableDoc>[] = [
    { dayOfWeek: "Tuesday", periodName: "Period 12", startTime: "03:00" },
    { dayOfWeek: "Tuesday", periodName: "Period 2", startTime: "08:40" },
    { dayOfWeek: "Tuesday", periodName: "Period 10", startTime: "02:00" },
    { dayOfWeek: "Tuesday", periodName: "Period 1", startTime: "08:00" },
  ];
  const sortedExt = sortTimetableEntries(extendedPeriods as TimetableDoc[]);
  assert(sortedExt[0].periodName === "Period 1", "Extended: Period 1 is 1st");
  assert(sortedExt[1].periodName === "Period 2", "Extended: Period 2 is 2nd");
  assert(sortedExt[2].periodName === "Period 10", "Extended: Period 10 is 3rd");
  assert(sortedExt[3].periodName === "Period 12", "Extended: Period 12 is 4th");

  // 6. String numbers as periods: "1", "2", "8", "10"
  const bareNumbers: Partial<TimetableDoc>[] = [
    { dayOfWeek: "Wednesday", periodName: "10", startTime: "02:00" },
    { dayOfWeek: "Wednesday", periodName: "8", startTime: "01:00" },
    { dayOfWeek: "Wednesday", periodName: "1", startTime: "08:00" },
    { dayOfWeek: "Wednesday", periodName: "2", startTime: "08:40" },
  ];
  const sortedBare = sortTimetableEntries(bareNumbers as TimetableDoc[]);
  assert(sortedBare.map((b) => b.periodName).join("->") === "1->2->8->10", "Bare numbers '1', '2', '8', '10' sort numerically");

  // 7. Parallel periods: Grade 9 Science and Arts both in Period 1
  const parallelPeriods: Partial<TimetableDoc>[] = [
    { dayOfWeek: "Thursday", periodName: "Period 2", className: "Grade 9 - Science", subjectName: "Physics", startTime: "08:40" },
    { dayOfWeek: "Thursday", periodName: "Period 1", className: "Grade 9 - Science", subjectName: "Biology", startTime: "08:00" },
    { dayOfWeek: "Thursday", periodName: "Period 1", className: "Grade 9 - Arts", subjectName: "General Science", startTime: "08:00" },
    { dayOfWeek: "Thursday", periodName: "Period 2", className: "Grade 9 - Arts", subjectName: "Computer", startTime: "08:40" },
  ];
  const sortedParallel = sortTimetableEntries(parallelPeriods as TimetableDoc[]);
  assert(sortedParallel[0].periodName === "Period 1" && sortedParallel[1].periodName === "Period 1", "Parallel: Both Period 1s appear first");
  assert(sortedParallel[2].periodName === "Period 2" && sortedParallel[3].periodName === "Period 2", "Parallel: Both Period 2s appear second");

  // 8. API level: Timetable periods created via API return in canonical order
  const adminA = await createSessionCookieServer({ uid: "admin-ord-a", email: "admin@ord-a.edu", role: "ADMIN", schoolId: schoolA, name: "Admin Ord" });
  const clsA = { id: "cls-ord-1", schoolId: schoolA, name: "Grade 9", section: "A", numericLevel: 9, capacity: 40, roomNo: "101", classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(clsA);
  const tchA = { id: "tch-ord-1", schoolId: schoolA, fullName: "Prof. Asif", email: "asif@ord-a.edu", phone: "+92 300 1111111", designation: "Teacher", qualification: "M.Sc", experience: "5y", subjects: [], classIds: [], status: "ACTIVE" as const, createdAt: now, updatedAt: now };
  await saveTeacherServer(tchA);
  const sbjA = { id: "sb-ord-1", schoolId: schoolA, classId: clsA.id, name: "Math", code: "MTH", teacherId: tchA.id, credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveSubjectServer(sbjA);

  // Create Period 8 first, then Period 1
  await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: clsA.id, subjectId: sbjA.id, teacherId: tchA.id, dayOfWeek: "Monday", periodName: "Period 8", startTime: "01:00", endTime: "01:40", roomNo: "101",
  }));
  await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: clsA.id, subjectId: sbjA.id, teacherId: tchA.id, dayOfWeek: "Monday", periodName: "Period 1", startTime: "08:00", endTime: "08:40", roomNo: "101",
  }));

  const getRes = await timetableGet(req(adminA, "http://localhost/api/timetable"));
  const getJson = await json(getRes);
  const monApi = getJson.timetable.filter((t: any) => t.dayOfWeek === "Monday");
  assert(monApi[0].periodName === "Period 1", "API GET: Period 1 is first even though Period 8 was inserted first");
  assert(monApi[1].periodName === "Period 8", "API GET: Period 8 is second");

  // ---------------------------------------------------------------------------
  // TASK 2: TEACHER MARKS UPLOAD & VALIDATION TESTS
  // ---------------------------------------------------------------------------
  console.log("\n--- TASK 2: TEACHER MARKS UPLOAD & VALIDATION ---");

  // 1. validateObtainedMarks unit tests
  assert(validateObtainedMarks(50, 100) === null, "validateObtainedMarks: 50/100 is valid (null)");
  assert(validateObtainedMarks(0, 100) === null, "validateObtainedMarks: 0/100 is valid");
  assert(validateObtainedMarks(100, 100) === null, "validateObtainedMarks: 100/100 is valid");
  assert(validateObtainedMarks(45.5, 100) === null, "validateObtainedMarks: decimal 45.5 is valid");
  assert(validateObtainedMarks("45.5", 100) === null, "validateObtainedMarks: numeric string '45.5' is valid");
  assert(validateObtainedMarks(" 85 ", 100) === null, "validateObtainedMarks: whitespace trimmed ' 85 ' is valid");
  assert(validateObtainedMarks("45,5", 100) === null, "validateObtainedMarks: comma decimal '45,5' is valid");
  assert(validateObtainedMarks(null, 100) === null, "validateObtainedMarks: null is valid (unrecorded mark)");
  assert(validateObtainedMarks("", 100) === null, "validateObtainedMarks: empty string is valid (unrecorded mark)");
  assert(validateObtainedMarks(undefined, 100) === null, "validateObtainedMarks: undefined is valid");
  assert(validateObtainedMarks(-5, 100) === "Marks cannot be negative.", "validateObtainedMarks: -5 rejected as negative");
  assert(validateObtainedMarks(105, 100) === "Marks cannot exceed the maximum of 100.", "validateObtainedMarks: 105 > 100 rejected");
  assert(validateObtainedMarks("abc", 100) === "Marks must be a valid number.", "validateObtainedMarks: 'abc' rejected as non-numeric");

  // 2. Setup Exam, Schedule, Teacher and Students for API tests
  const examId = "exam-val-1";
  const examDoc: ExamDoc = {
    id: examId, schoolId: schoolA, name: "Mid-Term Examination 2026", term: "Mid-Term",
    category: "MONTHLY_TEST", session: YEAR, startDate: "2026-10-01", endDate: "2026-10-15",
    status: "ONGOING", createdAt: now, updatedAt: now,
  };
  await saveExamServer(examDoc);

  const schId = `sch-${examId}-${clsA.id}-${sbjA.id}`;
  const schDoc: ExamScheduleDoc = {
    id: schId, schoolId: schoolA, examId, classId: clsA.id, subjectId: sbjA.id, subjectName: sbjA.name,
    examDate: "2026-10-05", startTime: "09:00", endTime: "11:00", totalMarks: 100, passingMarks: 33,
    createdAt: now,
  };
  await saveExamScheduleServer(schDoc);

  const makeStudent = (id: string, name: string, roll: string): StudentDoc => ({
    id, schoolId: schoolA, fullName: name, rollNo: roll, admissionNo: `ADM-${roll}`, classId: clsA.id,
    className: "Grade 9-A", status: "ACTIVE", fatherName: "Father", guardianPhone: "+92 300 0000000",
    dateOfBirth: "2010-01-01", gender: "MALE", address: "Dhoria", academicYear: YEAR, createdAt: now, updatedAt: now,
  });

  const st1 = makeStudent("std-v-1", "Muhammad Ali", "101");
  const st2 = makeStudent("std-v-2", "Fatima-Zahra", "102"); // hyphen in name
  const st3 = makeStudent("std-v-3", "Ahmad O'Connor", "103"); // apostrophe in name
  const st4 = makeStudent("std-v-4", "Zainab Bibi", "104");

  for (const s of [st1, st2, st3, st4]) await saveStudentServer(s);

  // Teacher allocation
  tchA.classIds = [clsA.id];
  tchA.subjects = [{ id: sbjA.id, name: sbjA.name, code: sbjA.code, classId: clsA.id, className: "Grade 9-A" }];
  await saveTeacherServer(tchA);

  const teacherA = await createSessionCookieServer({
    uid: "user-asif", email: tchA.email, role: "TEACHER", schoolId: schoolA, name: tchA.fullName, teacherId: tchA.id,
  });

  // 3. Teacher uploads marks with:
  // - Number marks: 85
  // - Numeric string: "72.5"
  // - Valid text with apostrophes, hyphens, parentheses, special characters
  // - Empty remarks (null or undefined)
  const uploadRes = await examsPut(req(teacherA, "http://localhost/api/exams", "PUT", {
    examScheduleId: schId,
    studentMarks: [
      {
        studentId: st1.id,
        marksObtained: 85,
        remarks: "Excellent performance in math (Class topper - keep it up!)", // hyphens, parens, exclamations
      },
      {
        studentId: st2.id,
        marksObtained: "72.5", // decimal numeric string
        remarks: "Student's work was very good - needs small improvement.", // apostrophe & hyphen
      },
      {
        studentId: st3.id,
        marksObtained: 40,
        remarks: null, // null remarks -> handled gracefully, no String Required error
      },
      {
        studentId: st4.id,
        marksObtained: null, // blank/unrecorded mark
      },
    ],
  }));

  const uploadJson = await json(uploadRes);
  assert(uploadRes.status === 200 && uploadJson.success === true, "Marks PUT: Teacher successfully uploads marks with numeric strings and special characters");
  assert(uploadJson.saved === 3, "Marks PUT: Exactly 3 marks saved, 1 unrecorded mark skipped");

  // Verify stored records
  const resultsA = await getExamResultsServer(schoolA, examId, clsA.id);
  const r1 = resultsA.find((r) => r.studentId === st1.id);
  const r2 = resultsA.find((r) => r.studentId === st2.id);
  const r3 = resultsA.find((r) => r.studentId === st3.id);
  const r4 = resultsA.find((r) => r.studentId === st4.id);

  assert(r1?.obtainedMarks === 85 && r1.remarks.includes("Class topper"), "Stored: Student 1 has 85 marks and remarks with parens/hyphens intact");
  assert(r2?.obtainedMarks === 72.5 && r2.remarks.includes("Student's work"), "Stored: Student 2 has decimal 72.5 from string input and apostrophe remark intact");
  assert(r3?.obtainedMarks === 40 && r3.remarks === "", "Stored: Student 3 saved with 40 marks and null remarks stored as empty string");
  assert(r4 === undefined, "Stored: Student 4 with null marksObtained has no record created");

  // 4. Test field name aliases: scheduleId instead of examScheduleId, marks instead of marksObtained, comment instead of remarks
  const adminEditRes = await examsPut(req(adminA, "http://localhost/api/exams", "PUT", {
    scheduleId: schId, // alias for examScheduleId
    studentMarks: [
      {
        id: st4.id, // alias for studentId
        marks: "60", // alias for marksObtained
        comment: "Passed comfortably", // alias for remarks
      },
    ],
  }));
  const adminEditJson = await json(adminEditRes);
  assert(adminEditRes.status === 200 && adminEditJson.saved === 1, "Field Aliases: scheduleId, id, marks, comment are seamlessly accepted");

  const r4After = (await getExamResultsServer(schoolA, examId, clsA.id)).find((r) => r.studentId === st4.id);
  assert(r4After?.obtainedMarks === 60 && r4After.remarks === "Passed comfortably", "Stored: Student 4 marks and remarks saved via alias fields");

  // 5. Test invalid numeric inputs are rejected with clear message
  const invalidRes = await examsPut(req(adminA, "http://localhost/api/exams", "PUT", {
    examScheduleId: schId,
    studentMarks: [
      { studentId: st1.id, marksObtained: "not-a-number" },
    ],
  }));
  const invalidJson = await json(invalidRes);
  assert(invalidRes.status === 400 && /valid number/i.test(JSON.stringify(invalidJson)), "Validation: Non-numeric marks 'not-a-number' rejected with clear error message");

  // 6. Test marks exceeding maximum are rejected per-row (not whole batch)
  const exceedRes = await examsPut(req(adminA, "http://localhost/api/exams", "PUT", {
    examScheduleId: schId,
    studentMarks: [
      { studentId: st1.id, marksObtained: 150 }, // Exceeds max 100
    ],
  }));
  const exceedJson = await json(exceedRes);
  assert(
    exceedRes.status === 200 && exceedJson.rejected?.length === 1 && /exceed/i.test(exceedJson.rejected[0].reason),
    "Validation: Marks > 100 rejected per-row with clear message 'Marks cannot exceed the maximum'"
  );

  // 7. Test missing required schedule ID produces clear message
  const noSchedRes = await examsPut(req(adminA, "http://localhost/api/exams", "PUT", {
    studentMarks: [{ studentId: st1.id, marksObtained: 50 }],
  }));
  assert(noSchedRes.status === 400, "Validation: Missing schedule ID is rejected (400)");

  // 8. Test missing student ID produces clear message
  const noStudentRes = await examsPut(req(adminA, "http://localhost/api/exams", "PUT", {
    examScheduleId: schId,
    studentMarks: [{ studentId: "", marksObtained: 50 }],
  }));
  assert(noStudentRes.status === 400, "Validation: Missing student ID is rejected (400)");

  // 9. Unauthorized teacher cannot submit marks for another teacher's subject
  const tchOther = { id: "tch-other", schoolId: schoolA, fullName: "Prof. Other", email: "other@ord-a.edu", phone: "+92 300 2222222", designation: "Teacher", qualification: "M.A", experience: "2y", subjects: [], classIds: [clsA.id], status: "ACTIVE" as const, createdAt: now, updatedAt: now };
  await saveTeacherServer(tchOther);
  const teacherOther = await createSessionCookieServer({
    uid: "user-other", email: tchOther.email, role: "TEACHER", schoolId: schoolA, name: tchOther.fullName, teacherId: tchOther.id,
  });

  const unauthRes = await examsPut(req(teacherOther, "http://localhost/api/exams", "PUT", {
    examScheduleId: schId,
    studentMarks: [{ studentId: st1.id, marksObtained: 50 }],
  }));
  assert(unauthRes.status === 403, "Authorization: Teacher not allocated to subject is blocked (403)");

  // 10. Cross-school isolation: Admin of School B cannot access School A exam schedule
  const adminB = await createSessionCookieServer({ uid: "admin-ord-b", email: "admin@ord-b.edu", role: "ADMIN", schoolId: schoolB, name: "Admin B" });
  const crossRes = await examsPut(req(adminB, "http://localhost/api/exams", "PUT", {
    examScheduleId: schId,
    studentMarks: [{ studentId: st1.id, marksObtained: 50 }],
  }));
  assert(crossRes.status === 404, "Isolation: Cross-school marks update rejected (404)");

  // Final summary
  console.log("\n=======================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Unhandled test runner exception:", err);
  process.exit(1);
});
