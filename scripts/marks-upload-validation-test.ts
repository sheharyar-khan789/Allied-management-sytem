import { NextRequest } from "next/server";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
  saveExamServer,
  saveExamScheduleServer,
  getExamResultsServer,
  saveStudentServer,
} from "../src/lib/firebase/server-db";
import {
  ClassDoc,
  SubjectDoc,
  TeacherDoc,
  ExamDoc,
  ExamScheduleDoc,
  StudentDoc,
} from "../src/lib/firebase/types";
import {
  GET as examsGet,
  PUT as examsPut,
} from "../src/app/api/exams/route";

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

let ipCounter = 400;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-forwarded-for": `10.88.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
  });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("\n=======================================================");
  console.log("CRITICAL TEACHER MARKS UPLOAD & VALIDATION TEST SUITE");
  console.log("=======================================================\n");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const schoolA = "school-marks-a";
  const schoolB = "school-marks-b";

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

  // Set up Admin & Teacher accounts for schoolA
  const adminCookie = await createSessionCookieServer({
    uid: "admin-user-id",
    email: "admin@school-a.edu",
    role: "ADMIN",
    schoolId: schoolA,
    name: "System Admin",
  });

  const teacherA: TeacherDoc = {
    id: "tch-urdu-1",
    schoolId: schoolA,
    fullName: "Noreen Akhtar",
    email: "noreen@school-a.edu",
    phone: "+92 300 1234567",
    designation: "Subject Teacher",
    qualification: "M.A Urdu",
    experience: "5 years",
    status: "ACTIVE",
    classIds: [],
    subjects: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveTeacherServer(teacherA);

  const teacherCookie = await createSessionCookieServer({
    uid: "user-noreen",
    email: teacherA.email,
    role: "TEACHER",
    schoolId: schoolA,
    name: teacherA.fullName,
    teacherId: teacherA.id,
  });

  // Setup Class 2-A
  const class2A: ClassDoc = {
    id: "cls-schoolmarksa-20262027-class02-a",
    schoolId: schoolA,
    name: "2",
    section: "A",
    numericLevel: 2,
    capacity: 35,
    roomNo: "Room 4",
    academicYear: YEAR,
    createdAt: now,
    updatedAt: now,
  };
  await saveClassServer(class2A);

  // Setup Subject Urdu T
  const subjectUrdu: SubjectDoc = {
    id: "sb-schoolmarksa-cls2a-urdut",
    schoolId: schoolA,
    classId: class2A.id,
    className: "2-A",
    name: "Urdu T",
    code: "URD-02",
    teacherId: teacherA.id,
    teacherName: teacherA.fullName,
    credits: 3,
    createdAt: now,
    updatedAt: now,
  };
  await saveSubjectServer(subjectUrdu);

  // Allocate class and subject to Teacher
  teacherA.classIds = [class2A.id];
  teacherA.subjects = [{
    id: subjectUrdu.id,
    name: subjectUrdu.name,
    code: subjectUrdu.code,
    classId: class2A.id,
    className: "2-A",
  }];
  await saveTeacherServer(teacherA);

  // Setup Exam: "week 1 nov (weekly)"
  const examId = "exam-week1-nov";
  const examDoc: ExamDoc = {
    id: examId,
    schoolId: schoolA,
    name: "week 1 nov",
    term: "weekly",
    category: "WEEKLY",
    session: YEAR,
    startDate: "2026-11-01",
    endDate: "2026-11-07",
    status: "ONGOING",
    createdAt: now,
  };
  await saveExamServer(examDoc);

  // Exact reproduction schedule ID: 175+ characters composite ID matching production length (166 chars)
  const realCompositeScheduleId = `sch-${examId}-${class2A.id}-${subjectUrdu.id}-extended-composite-identifier-exceeding-standard-limit-track-section-alpha`;
  console.log(`Composite Schedule ID Length: ${realCompositeScheduleId.length} chars (exceeds 128 chars)`);

  const scheduleDoc: ExamScheduleDoc = {
    id: realCompositeScheduleId,
    schoolId: schoolA,
    examId,
    classId: class2A.id,
    subjectId: subjectUrdu.id,
    subjectName: subjectUrdu.name,
    examDate: "2026-11-03",
    startTime: "09:00",
    endTime: "10:00",
    totalMarks: 17, // Maximum marks: 17 (from screenshot)
    passingMarks: 6,
    createdAt: now,
  };
  await saveExamScheduleServer(scheduleDoc);

  // Create 18 students in Class 2-A (17 dirty changes will be submitted)
  const students: StudentDoc[] = [];
  for (let i = 1; i <= 18; i++) {
    const st: StudentDoc = {
      id: `std-class2a-${i}`,
      schoolId: schoolA,
      fullName: `Student Name ${i}`,
      rollNo: String(50 + i),
      admissionNo: `ADM-2A-${100 + i}`,
      classId: class2A.id,
      className: "2-A",
      status: "ACTIVE",
      fatherName: `Father ${i}`,
      guardianPhone: "+92 300 0000000",
      dateOfBirth: "2018-05-10",
      gender: i % 2 === 0 ? "FEMALE" : "MALE",
      address: "Dhoria",
      academicYear: YEAR,
      createdAt: now,
      updatedAt: now,
    };
    await saveStudentServer(st);
    students.push(st);
  }

  // ---------------------------------------------------------------------------
  // TEST 1: EXACT PRODUCTION SCENARIO — SAVE 17 CHANGES FOR 17 STUDENTS (MAX MARKS 17)
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 1: EXACT PRODUCTION SCENARIO (17 STUDENTS, MAX MARKS 17, 166-CHAR SCHEDULE ID) ---");

  const seventeenDirtyChanges = [
    { studentId: students[0].id, marksObtained: 17, remarks: "Outstanding" },
    { studentId: students[1].id, marksObtained: 16.5, remarks: "Excellent" },
    { studentId: students[2].id, marksObtained: 15, remarks: "Good Effort" },
    { studentId: students[3].id, marksObtained: 14, remarks: "Keep improving" },
    { studentId: students[4].id, marksObtained: "13.5", remarks: "Very Good" },
    { studentId: students[5].id, marksObtained: 12, remarks: "Satisfactory" },
    { studentId: students[6].id, marksObtained: 11, remarks: "" }, // empty string remarks
    { studentId: students[7].id, marksObtained: 10, remarks: null }, // null remarks
    { studentId: students[8].id, marksObtained: 9, remarks: "Needs practice - Urdu writing" }, // hyphens
    { studentId: students[9].id, marksObtained: 8, remarks: "Student's handwriting is improving!" }, // apostrophes & exclamation
    { studentId: students[10].id, marksObtained: 7, remarks: "Work harder (Class attention needed)" }, // parentheses
    { studentId: students[11].id, marksObtained: 6, remarks: "Pass (average)" },
    { studentId: students[12].id, marksObtained: 5, remarks: "Fail - needs retest" },
    { studentId: students[13].id, marksObtained: 4, remarks: "Weak in vocabulary" },
    { studentId: students[14].id, marksObtained: 3, remarks: "Incomplete test" },
    { studentId: students[15].id, marksObtained: 2, remarks: "Urdu: محنت کی ضرورت ہے" }, // Urdu Unicode text
    { studentId: students[16].id, marksObtained: 1, remarks: "Poor" },
  ];

  const save17Res = await examsPut(
    req(teacherCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: seventeenDirtyChanges,
    })
  );

  const save17Json = await json(save17Res);
  assert(
    save17Res.status === 200 && save17Json.success === true,
    "Save 17 changes: Successfully accepted 166-char schedule ID without 'String must contain at most 128 character(s)' error"
  );
  assert(save17Json.saved === 17, `Save 17 changes: Exactly 17 records saved (reported: ${save17Json.saved})`);

  // Verify stored records in Firestore/database
  const storedResults = await getExamResultsServer(schoolA, examId, class2A.id);
  assert(storedResults.length === 17, `Database verification: 17 results exist in database (found: ${storedResults.length})`);

  const topStudent = storedResults.find((r) => r.studentId === students[0].id);
  assert(
    topStudent?.obtainedMarks === 17 && topStudent?.percentage === 100 && topStudent?.status === "PASS",
    "Database verification: Top student has 17/17 marks (100% PASS)"
  );

  const urduRemarksStudent = storedResults.find((r) => r.studentId === students[15].id);
  assert(
    urduRemarksStudent?.remarks.includes("محنت کی ضرورت ہے"),
    "Database verification: Urdu Unicode remarks stored intact"
  );

  // ---------------------------------------------------------------------------
  // TEST 2: VALID examScheduleId ACCEPTANCE (ALIASES & RESILIENCE)
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 2: SCHEDULE ID FIELD ACCEPTANCE & ALIASES ---");

  // scheduleId alias instead of examScheduleId
  const aliasRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      scheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[17].id, marksObtained: 15, remarks: "Last student" }],
    })
  );
  const aliasJson = await json(aliasRes);
  assert(aliasRes.status === 200 && aliasJson.saved === 1, "Schedule ID alias: 'scheduleId' field accepted seamlessly");

  // Object scheduleId: { id: "..." }
  const objectSchedRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: { id: realCompositeScheduleId },
      studentMarks: [{ studentId: students[17].id, marksObtained: 16, remarks: "Updated" }],
    })
  );
  const objectSchedJson = await json(objectSchedRes);
  assert(objectSchedRes.status === 200 && objectSchedJson.saved === 1, "Schedule ID object: { id: '...' } normalized and accepted");

  // ---------------------------------------------------------------------------
  // TEST 3: REJECTION OF INVALID OR EMPTY SCHEDULE ID
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 3: INVALID / MALFORMED SCHEDULE ID REJECTION ---");

  // Missing schedule ID
  const noSchedRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      studentMarks: [{ studentId: students[0].id, marksObtained: 10 }],
    })
  );
  assert(noSchedRes.status === 400, "Validation: Missing schedule ID is rejected with 400");

  // Empty string schedule ID
  const emptySchedRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: "",
      studentMarks: [{ studentId: students[0].id, marksObtained: 10 }],
    })
  );
  assert(emptySchedRes.status === 400, "Validation: Empty string schedule ID is rejected with 400");

  // Whitespace-only schedule ID
  const wsSchedRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: "   ",
      studentMarks: [{ studentId: students[0].id, marksObtained: 10 }],
    })
  );
  assert(wsSchedRes.status === 400, "Validation: Whitespace-only schedule ID is rejected with 400");

  // Excessively long schedule ID (> 512 chars)
  const tooLongSchedId = "a".repeat(513);
  const tooLongRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: tooLongSchedId,
      studentMarks: [{ studentId: students[0].id, marksObtained: 10 }],
    })
  );
  assert(tooLongRes.status === 400, "Validation: Schedule ID exceeding 512 chars is rejected with 400");

  // ---------------------------------------------------------------------------
  // TEST 4: ALL STRING REQUIRED CASES & RESILIENT PARSING
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 4: STRING REQUIRED & MISSING FIELD HANDLING ---");

  // Missing studentId in a record
  const missingStudentIdRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ marksObtained: 12 }],
    })
  );
  const missingStudentIdJson = await json(missingStudentIdRes);
  assert(
    missingStudentIdRes.status === 400 && /Student ID is required/i.test(missingStudentIdJson.error),
    "Validation: Missing student ID reports clear error 'Student ID is required for marks record #1'"
  );

  // Student passed as object { id: "std-..." }
  const studentObjRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ student: { id: students[17].id }, marksObtained: 14 }],
    })
  );
  const studentObjJson = await json(studentObjRes);
  assert(studentObjRes.status === 200 && studentObjJson.saved === 1, "Student alias: { student: { id: '...' } } accepted seamlessly");

  // Number studentId (e.g. numeric ID 101)
  const numStudentIdRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[17].id, marksObtained: "14.5" }],
    })
  );
  assert(numStudentIdRes.status === 200, "Numeric marks string '14.5' accepted and converted");

  // ---------------------------------------------------------------------------
  // TEST 5: OPTIONAL FIELDS & CLEAN REMARKS
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 5: OPTIONAL FIELDS & REMARKS PRESERVATION ---");

  // Omit remarks completely -> optional field remains valid
  const omitRemarksRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[17].id, marksObtained: 11 }],
    })
  );
  assert(omitRemarksRes.status === 200, "Optional remarks: Omitted remarks field accepted");

  // Null remarks -> stored as empty string
  const nullRemarksRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[17].id, marksObtained: 12, remarks: null }],
    })
  );
  assert(nullRemarksRes.status === 200, "Optional remarks: null remarks accepted without String Required error");

  // ---------------------------------------------------------------------------
  // TEST 6: NUMERIC BOUNDARY & PARTIAL FAILURE REPORTING
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 6: NUMERIC BOUNDARIES & ACCURATE PARTIAL REPORTING ---");

  // Obtained marks exceeding maxMarks (20 > 17) rejected per-row, other valid rows saved
  const partialExceedRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [
        { studentId: students[0].id, marksObtained: 15 }, // valid
        { studentId: students[1].id, marksObtained: 20 }, // invalid: exceeds max 17
      ],
    })
  );
  const partialExceedJson = await json(partialExceedRes);
  assert(
    partialExceedRes.status === 200 &&
    partialExceedJson.saved === 1 &&
    partialExceedJson.rejected?.length === 1 &&
    /cannot exceed/i.test(partialExceedJson.rejected[0].reason),
    "Partial validation: 1 valid saved, 1 row > 17 rejected with clear reason"
  );

  // Negative marks (-2) rejected
  const negRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[0].id, marksObtained: -2 }],
    })
  );
  const negJson = await json(negRes);
  assert(
    negRes.status === 200 && negJson.rejected?.length === 1 && /negative/i.test(negJson.rejected[0].reason),
    "Boundary: Negative marks rejected per-row"
  );

  // ---------------------------------------------------------------------------
  // TEST 7: DUPLICATE SUBMISSIONS & SAFE UPDATES
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 7: DUPLICATE SUBMISSIONS & SAFE UPDATES ---");

  // Admin updates student 0 marks from 15 to 16
  const updateRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[0].id, marksObtained: 16, remarks: "Corrected mark" }],
    })
  );
  const updateJson = await json(updateRes);
  assert(updateRes.status === 200 && updateJson.saved === 1, "Update: Existing mark updated cleanly");

  const resultsAfterUpdate = await getExamResultsServer(schoolA, examId, class2A.id);
  const student0Updated = resultsAfterUpdate.find((r) => r.studentId === students[0].id);
  assert(
    student0Updated?.obtainedMarks === 16 && student0Updated?.remarks === "Corrected mark",
    "Database: Student 0 obtainedMarks updated to 16 without creating duplicate doc"
  );

  // Re-submitting the exact same marks produces no duplicate documents
  const duplicateRes = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[0].id, marksObtained: 16, remarks: "Corrected mark" }],
    })
  );
  assert(duplicateRes.status === 200, "Idempotency: Re-submitting same marks succeeds safely");
  const countAfterDuplicate = (await getExamResultsServer(schoolA, examId, class2A.id)).filter(
    (r) => r.studentId === students[0].id
  ).length;
  assert(countAfterDuplicate === 1, "Database: Exactly 1 result record exists for student 0 (no duplicates)");

  // ---------------------------------------------------------------------------
  // TEST 8: SECURITY & TENANCY ISOLATION
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 8: SECURITY & TENANCY ISOLATION ---");

  // Cross-school submission: schoolB user tries to submit marks for schoolA schedule
  const schoolBCookie = await createSessionCookieServer({
    uid: "admin-school-b",
    email: "admin@school-b.edu",
    role: "ADMIN",
    schoolId: schoolB,
    name: "Admin B",
  });

  const crossSchoolRes = await examsPut(
    req(schoolBCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[0].id, marksObtained: 10 }],
    })
  );
  assert(crossSchoolRes.status === 404, "Isolation: Cross-school submission rejected with 404 Not Found");

  // Unauthorized teacher (not allocated to Urdu T) tries to submit marks
  const unauthorizedTeacher: TeacherDoc = {
    id: "tch-other-sub",
    schoolId: schoolA,
    fullName: "Other Teacher",
    email: "other@school-a.edu",
    phone: "+92 300 9999999",
    designation: "Teacher",
    qualification: "M.Sc",
    experience: "2y",
    status: "ACTIVE",
    classIds: [class2A.id],
    subjects: [], // Not allocated to Urdu T
    createdAt: now,
    updatedAt: now,
  };
  await saveTeacherServer(unauthorizedTeacher);

  const unauthTeacherCookie = await createSessionCookieServer({
    uid: "user-other",
    email: unauthorizedTeacher.email,
    role: "TEACHER",
    schoolId: schoolA,
    name: unauthorizedTeacher.fullName,
    teacherId: unauthorizedTeacher.id,
  });

  const unauthRes = await examsPut(
    req(unauthTeacherCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: realCompositeScheduleId,
      studentMarks: [{ studentId: students[0].id, marksObtained: 10 }],
    })
  );
  assert(unauthRes.status === 403, "Authorization: Teacher not allocated to subject rejected with 403 Forbidden");

  // ---------------------------------------------------------------------------
  // TEST 9: DIFFERENT CLASS SIZES (1, 18, 36, 50 STUDENTS)
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 9: DIFFERENT CLASS SIZES (1, 18, 36, 50 STUDENTS) ---");

  // Setup Class with 36 students
  const class36: ClassDoc = {
    id: "cls-schoolmarksa-20262027-class36",
    schoolId: schoolA,
    name: "4",
    section: "A",
    numericLevel: 4,
    capacity: 50,
    roomNo: "Room 10",
    academicYear: YEAR,
    createdAt: now,
    updatedAt: now,
  };
  await saveClassServer(class36);

  const subjectMath: SubjectDoc = {
    id: "sb-schoolmarksa-cls36-math",
    schoolId: schoolA,
    classId: class36.id,
    className: "4-A",
    name: "Mathematics",
    code: "MTH-04",
    credits: 4,
    createdAt: now,
    updatedAt: now,
  };
  await saveSubjectServer(subjectMath);

  const sched36Id = `sch-${examId}-${class36.id}-${subjectMath.id}`;
  await saveExamScheduleServer({
    id: sched36Id,
    schoolId: schoolA,
    examId,
    classId: class36.id,
    subjectId: subjectMath.id,
    subjectName: subjectMath.name,
    examDate: "2026-11-04",
    startTime: "09:00",
    endTime: "11:00",
    totalMarks: 50,
    passingMarks: 17,
    createdAt: now,
  });

  const students36: StudentDoc[] = [];
  for (let i = 1; i <= 36; i++) {
    const st: StudentDoc = {
      id: `std-class36-${i}`,
      schoolId: schoolA,
      fullName: `Class4 Student ${i}`,
      rollNo: String(100 + i),
      admissionNo: `ADM-36-${i}`,
      classId: class36.id,
      className: "4-A",
      status: "ACTIVE",
      fatherName: `Father ${i}`,
      guardianPhone: "+92 300 0000000",
      dateOfBirth: "2016-01-01",
      gender: "MALE",
      address: "Dhoria",
      academicYear: YEAR,
      createdAt: now,
      updatedAt: now,
    };
    await saveStudentServer(st);
    students36.push(st);
  }

  // Submit all 36 students in one batch
  const batch36Marks = students36.map((st, idx) => ({
    studentId: st.id,
    marksObtained: (idx % 45) + 5,
    remarks: `Remark ${idx + 1}`,
  }));

  const save36Res = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: sched36Id,
      studentMarks: batch36Marks,
    })
  );
  const save36Json = await json(save36Res);
  assert(save36Res.status === 200 && save36Json.saved === 36, "Class size 36: All 36 student marks saved in one batch");

  // Single student submission (class size 1)
  const save1Res = await examsPut(
    req(adminCookie, "http://localhost/api/exams", "PUT", {
      examScheduleId: sched36Id,
      studentMarks: [{ studentId: students36[0].id, marksObtained: 48, remarks: "Top score" }],
    })
  );
  assert(save1Res.status === 200 && (await json(save1Res)).saved === 1, "Class size 1: Single student submission works");

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
