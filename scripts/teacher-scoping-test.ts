import { NextRequest } from "next/server";
import { GET as attendanceGet, POST as attendancePost } from "../src/app/api/attendance/route";
import { GET as examsGet, PUT as examsMarksPut } from "../src/app/api/exams/route";
import { POST as observationsPost } from "../src/app/api/observations/route";
import { GET as timetableGet } from "../src/app/api/timetable/route";
import { GET as classesGet } from "../src/app/api/classes/route";
import { GET as studentsGet } from "../src/app/api/students/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  createUserServer,
  saveTeacherServer,
  saveClassServer,
  saveStudentServer,
  saveExamServer,
  saveExamScheduleServer,
  saveTimetableEntryServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, ExamDoc, ExamScheduleDoc, StudentDoc, TeacherDoc, TimetableDoc, UserProfile } from "../src/lib/firebase/types";

async function run() {
  console.log("==================================================");
  console.log("TEACHER CLASS-SCOPING VERIFICATION (M-1)");
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

  const schoolId = "school-scope-test";
  const now = new Date().toISOString();

  // Two classes in the same school. Teacher A is only assigned to Class A.
  const classA: ClassDoc = {
    id: "cls-scope-a", schoolId, name: "Grade 5", section: "A", numericLevel: 5,
    capacity: 30, classTeacherId: "tch-scope-a", classTeacherName: "Teacher A", academicYear: "2025-2026",
    createdAt: now, updatedAt: now,
  };
  const classB: ClassDoc = {
    id: "cls-scope-b", schoolId, name: "Grade 6", section: "B", numericLevel: 6,
    capacity: 30, classTeacherId: "tch-scope-b", classTeacherName: "Teacher B", academicYear: "2025-2026",
    createdAt: now, updatedAt: now,
  };
  await saveClassServer(classA);
  await saveClassServer(classB);

  const teacherA: TeacherDoc = {
    id: "tch-scope-a", schoolId, employeeId: "EMP-A", fullName: "Teacher A",
    email: "teacher.a@scope-test.school", phone: "0300", designation: "Teacher",
    department: "Primary", qualification: "B.Ed", status: "ACTIVE",
    assignedClassIds: [classA.id], assignedSubjectIds: [], weeklyLoad: 10,
    createdAt: now, updatedAt: now,
  };
  const teacherB: TeacherDoc = {
    id: "tch-scope-b", schoolId, employeeId: "EMP-B", fullName: "Teacher B",
    email: "teacher.b@scope-test.school", phone: "0301", designation: "Teacher",
    department: "Primary", qualification: "B.Ed", status: "ACTIVE",
    assignedClassIds: [classB.id], assignedSubjectIds: [], weeklyLoad: 10,
    createdAt: now, updatedAt: now,
  };
  await saveTeacherServer(teacherA);
  await saveTeacherServer(teacherB);

  const userA: UserProfile = {
    uid: "uid-scope-a", email: teacherA.email, role: "TEACHER", schoolId,
    teacherId: teacherA.id, name: teacherA.fullName, status: "ACTIVE", createdAt: now, updatedAt: now,
  };
  await createUserServer(userA);

  const studentA: StudentDoc = {
    id: "std-scope-a", schoolId, classId: classA.id, admissionNo: "ADM-A", rollNo: "1",
    fullName: "Student A", gender: "MALE", dob: "2015-01-01", status: "ACTIVE",
    guardianName: "Guardian A", guardianRelation: "Father", guardianPhone: "0300",
    createdAt: now, updatedAt: now,
  } as StudentDoc;
  const studentB: StudentDoc = {
    id: "std-scope-b", schoolId, classId: classB.id, admissionNo: "ADM-B", rollNo: "1",
    fullName: "Student B", gender: "FEMALE", dob: "2014-01-01", status: "ACTIVE",
    guardianName: "Guardian B", guardianRelation: "Mother", guardianPhone: "0301",
    createdAt: now, updatedAt: now,
  } as StudentDoc;
  await saveStudentServer(studentA);
  await saveStudentServer(studentB);

  const exam: ExamDoc = {
    id: "exam-scope-1", schoolId, name: "Scope Test Exam", term: "Term 1", session: "2025-2026",
    startDate: now, endDate: now, status: "UPCOMING", createdAt: now, updatedAt: now,
  };
  await saveExamServer(exam);

  const schedA: ExamScheduleDoc = {
    id: "sch-scope-a", schoolId, examId: exam.id, classId: classA.id, subjectId: "sub-a",
    examDate: now, startTime: "09:00", endTime: "10:00", totalMarks: 100, passingMarks: 33,
    createdAt: now,
  };
  const schedB: ExamScheduleDoc = {
    id: "sch-scope-b", schoolId, examId: exam.id, classId: classB.id, subjectId: "sub-b",
    examDate: now, startTime: "09:00", endTime: "10:00", totalMarks: 100, passingMarks: 33,
    createdAt: now,
  };
  await saveExamScheduleServer(schedA);
  await saveExamScheduleServer(schedB);

  const ttB: TimetableDoc = {
    id: "tt-scope-b", schoolId, teacherId: teacherB.id, teacherName: teacherB.fullName,
    classId: classB.id, className: "Grade 6-B", subjectId: "sub-b", subjectName: "Math",
    dayOfWeek: "Monday", periodName: "Period 1", startTime: "09:00", endTime: "10:00",
    roomNo: "101", topic: "", createdAt: now, updatedAt: now,
  };
  await saveTimetableEntryServer(ttB);

  const teacherAToken = await createSessionCookieServer({
    uid: "uid-scope-a", email: teacherA.email, role: "TEACHER", schoolId, teacherId: teacherA.id, name: teacherA.fullName,
  });

  function reqFor(url: string, opts: { method?: string; body?: any } = {}) {
    const headers = new Headers({ cookie: `allied_session=${teacherAToken}` });
    if (opts.body) headers.set("content-type", "application/json");
    return new NextRequest(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  }

  // --- ATTENDANCE ---
  const attOwn = await attendanceGet(reqFor(`http://x/api/attendance?classId=${classA.id}`));
  assert(attOwn.status === 200, "Attendance GET: Teacher A can view own class");

  const attOther = await attendanceGet(reqFor(`http://x/api/attendance?classId=${classB.id}`));
  assert(attOther.status === 403, "Attendance GET: Teacher A blocked (403) from Teacher B's class");

  const attPostOther = await attendancePost(reqFor(`http://x/api/attendance`, {
    method: "POST",
    body: { classId: classB.id, date: "2026-01-01", records: [{ studentId: studentB.id, status: "PRESENT" }] },
  }));
  assert(attPostOther.status === 403, "Attendance POST: Teacher A blocked (403) from marking Teacher B's class");

  // --- EXAMS ---
  const examsRes = await examsGet(reqFor(`http://x/api/exams?examId=${exam.id}`));
  const examsJson = await examsRes.json();
  const visibleClassIds = (examsJson.activeExam?.schedules || []).map((s: any) => s.classId);
  assert(
    visibleClassIds.includes(classA.id) && !visibleClassIds.includes(classB.id),
    "Exams GET: Teacher A only sees own class's schedule, not Teacher B's"
  );

  const marksOther = await examsMarksPut(reqFor(`http://x/api/exams`, {
    method: "PUT",
    body: { examScheduleId: schedB.id, studentMarks: [{ studentId: studentB.id, marksObtained: 50 }] },
  }));
  assert(marksOther.status === 403, "Exams PUT: Teacher A blocked (403) from grading Teacher B's schedule");

  const marksOwn = await examsMarksPut(reqFor(`http://x/api/exams`, {
    method: "PUT",
    body: { examScheduleId: schedA.id, studentMarks: [{ studentId: studentA.id, marksObtained: 80 }] },
  }));
  assert(marksOwn.status === 200, "Exams PUT: Teacher A can grade own class's schedule");

  // --- OBSERVATIONS ---
  const obsOther = await observationsPost(reqFor(`http://x/api/observations`, {
    method: "POST",
    body: { studentId: studentB.id, content: "Cross-class note attempt" },
  }));
  assert(obsOther.status === 403, "Observations POST: Teacher A blocked (403) from writing note on Teacher B's student");

  const obsOwn = await observationsPost(reqFor(`http://x/api/observations`, {
    method: "POST",
    body: { studentId: studentA.id, content: "Good progress" },
  }));
  assert(obsOwn.status === 201, "Observations POST: Teacher A can write note for own student");

  // --- TIMETABLE ---
  const ttOverride = await timetableGet(reqFor(`http://x/api/timetable?teacherId=${teacherB.id}`));
  const ttOverrideJson = await ttOverride.json();
  const leakedOther = (ttOverrideJson.timetable || []).some((t: any) => t.teacherId === teacherB.id);
  assert(
    ttOverride.status === 200 && !leakedOther,
    "Timetable GET: ?teacherId= override ignored — Teacher A cannot see Teacher B's schedule via query param"
  );

  const ttClassOther = await timetableGet(reqFor(`http://x/api/timetable?classId=${classB.id}`));
  assert(ttClassOther.status === 403, "Timetable GET: Teacher A blocked (403) filtering by Teacher B's classId");

  // --- CLASSES (selector/dropdown source) ---
  const classesRes = await classesGet(reqFor(`http://x/api/classes`));
  const classesJson = await classesRes.json();
  const classIds = (classesJson.classes || []).map((c: any) => c.id);
  assert(
    classIds.includes(classA.id) && !classIds.includes(classB.id),
    "Classes GET: Teacher A's class selector only lists own assigned class"
  );

  // --- STUDENTS ---
  const studentsNoFilter = await studentsGet(reqFor(`http://x/api/students`));
  const studentsJson = await studentsGet(reqFor(`http://x/api/students`)).then((r) => r.json());
  const studentIds = (studentsJson.students || []).map((s: any) => s.id);
  assert(
    studentIds.includes(studentA.id) && !studentIds.includes(studentB.id),
    "Students GET (no classId): Teacher A only sees own class's students"
  );

  const studentsOtherClass = await studentsGet(reqFor(`http://x/api/students?classId=${classB.id}`));
  assert(studentsOtherClass.status === 403, "Students GET (classId=B): Teacher A blocked (403)");

  console.log("==================================================");
  console.log(`TEACHER SCOPING SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  if (failed > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exitCode = 1;
});
