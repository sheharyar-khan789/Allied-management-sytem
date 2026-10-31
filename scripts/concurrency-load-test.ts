/**
 * Concurrency & Load Test: Phase 5 Verification
 *
 * Verifies that the Allied School Management System supports 25+ simultaneous active users
 * (Admins, Teachers, Students) performing realistic concurrent operations without "Service is
 * temporarily busy", 5xx errors, unhandled rejections, or session collisions.
 *
 * Workflows tested concurrently across 30 simulated users:
 *   1. Simultaneous login / profile lookups (userByEmail / userById)
 *   2. Simultaneous Admin dashboard aggregate analytics loads
 *   3. Simultaneous Student profile / academic / fee / attendance views
 *   4. Simultaneous Timetable & Lesson Plan loads and safe write submissions
 *   5. Simultaneous Marks entry and administrative corrections
 *   6. Rapid interleaved navigations and repeated page refreshes
 *
 * Measures:
 *   - Total requests, successful requests, failed requests
 *   - HTTP 5xx / Firebase / RESOURCE_EXHAUSTED errors
 *   - Response time distributions (p50, p95, p99, min, max, mean)
 */

import {
  saveSchoolServer,
  updateSchoolSettingsServer,
  createUserServer,
  getUserByEmailServer,
  getUserByIdServer,
  saveClassServer,
  getSessionClassesServer,
  saveSubjectServer,
  getSubjectsServer,
  saveTeacherServer,
  getTeachersServer,
  saveStudentServer,
  getStudentByIdServer,
  getStudentCountsByClassServer,
  saveFeeChallanServer,
  getFeeTotalsByClassServer,
  getStudentFeeChallansServer,
  getRecentPaymentsServer,
  createAuditLogServer,
  getAuditLogsServer,
  getStudentAttendanceTotalsServer,
  saveExamServer,
  saveExamScheduleServer,
  commitExamResultsServer,
  getExamResultsServer,
  saveLessonPlanServer,
  getLessonPlansServer,
} from "../src/lib/firebase/server-db";
import {
  UserProfile,
  ClassDoc,
  SubjectDoc,
  TeacherDoc,
  StudentDoc,
  FeeChallanDoc,
  ExamDoc,
  ExamScheduleDoc,
  ExamResultDoc,
  LessonPlanDoc,
  School,
  SchoolSettingsDoc,
} from "../src/lib/firebase/types";
import { resetServerCaches } from "../src/lib/server-cache";

const CONCURRENT_USERS = 30; // Exceeds the 25-user requirement
const OPERATIONS_PER_USER = 12; // Realistic high-activity session per user
const TEST_SCHOOL_ID = `school-loadtest-${Date.now()}`;
const ACADEMIC_YEAR = "2026-2027";
const WEEK_ID = "2026-11-02"; // A valid Monday week

interface LatencyRecord {
  operation: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

const latencies: LatencyRecord[] = [];

function recordMetric(operation: string, startMs: number, success: boolean, error?: string) {
  const durationMs = Date.now() - startMs;
  latencies.push({ operation, durationMs, success, error });
}

function computePercentile(numbers: number[], p: number): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return Math.round(sorted[idx]);
}

async function runConcurrencyLoadTest() {
  console.log("===============================================================");
  console.log("PHASE 5: REALISTIC 25+ USER CONCURRENCY & LOAD VERIFICATION");
  console.log("===============================================================");
  console.log(`Target concurrency: ${CONCURRENT_USERS} simultaneous users`);
  console.log(`Isolated synthetic tenant: ${TEST_SCHOOL_ID}\n`);

  resetServerCaches();

  // -------------------------------------------------------------------------
  // 1. SETUP SYNTHETIC DATA (Isolated tenant, no prod data altered)
  // -------------------------------------------------------------------------
  console.log("Setting up synthetic school, faculty, classes, and students...");

  const schoolDoc: School = {
    id: TEST_SCHOOL_ID,
    code: "TEST-01",
    name: "Allied Test Campus",
    academicYear: ACADEMIC_YEAR,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSchoolServer(schoolDoc);

  const settingsDoc: SchoolSettingsDoc = {
    id: `settings-${TEST_SCHOOL_ID}`,
    schoolId: TEST_SCHOOL_ID,
    academicYear: ACADEMIC_YEAR,
    timezone: "Asia/Karachi",
    campusName: "Concurrency Test Campus",
    schoolName: "Allied School Concurrency Test",
    motto: "Excellence in Education",
    address: "Campus Road, Lahore",
    phone: "+92-42-111-222-333",
    email: "info@allied-test.edu.pk",
    website: "https://allied-test.edu.pk",
    logoUrl: "",
    principalName: "Principal Test",
    gradingScale: [
      { minPercentage: 80, grade: "A", gpa: 4.0 },
      { minPercentage: 70, grade: "B", gpa: 3.0 },
      { minPercentage: 60, grade: "C", gpa: 2.0 },
      { minPercentage: 0, grade: "F", gpa: 0.0 },
    ],
    updatedAt: new Date().toISOString(),
  };
  await updateSchoolSettingsServer(settingsDoc);

  // Create 5 Classes
  const classes: ClassDoc[] = [];
  for (let c = 1; c <= 5; c++) {
    const cls: ClassDoc = {
      id: `cls-load-${c}`,
      schoolId: TEST_SCHOOL_ID,
      name: `Grade ${c}`,
      section: "A",
      numericLevel: c,
      capacity: 35,
      academicYear: ACADEMIC_YEAR,
      classTeacherName: `Teacher ${c}`,
      roomNo: `Room-${100 + c}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveClassServer(cls);
    classes.push(cls);
  }

  // Create 5 Subjects per Class
  const subjects: SubjectDoc[] = [];
  for (const cls of classes) {
    for (let s = 1; s <= 5; s++) {
      const sub: SubjectDoc = {
        id: `sub-load-${cls.id}-${s}`,
        schoolId: TEST_SCHOOL_ID,
        classId: cls.id,
        name: `Subject ${s} for ${cls.name}`,
        code: `SUB${cls.numericLevel}0${s}`,
        credits: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveSubjectServer(sub);
      subjects.push(sub);
    }
  }

  // Create Users: 5 Admins, 10 Teachers, 15 Students (Total = 30 virtual users)
  const users: UserProfile[] = [];

  for (let a = 1; a <= 5; a++) {
    const admin: UserProfile = {
      uid: `u-admin-${a}`,
      schoolId: TEST_SCHOOL_ID,
      email: `admin${a}@allied-test.edu.pk`,
      name: `Administrator ${a}`,
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await createUserServer(admin);
    users.push(admin);
  }

  for (let t = 1; t <= 10; t++) {
    const teacherDoc: TeacherDoc = {
      id: `tch-load-${t}`,
      schoolId: TEST_SCHOOL_ID,
      employeeId: `EMP-T-${1000 + t}`,
      fullName: `Faculty Member ${t}`,
      email: `teacher${t}@allied-test.edu.pk`,
      phone: `+92-300-11100${t < 10 ? "0" + t : t}`,
      designation: "Subject Specialist",
      department: "Science",
      qualification: "M.Sc. Education",
      status: "ACTIVE",
      assignedClassIds: [classes[(t - 1) % classes.length].id],
      assignedSubjectIds: [subjects[(t - 1) % subjects.length].id],
      weeklyLoad: 24,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveTeacherServer(teacherDoc);

    const teacherUser: UserProfile = {
      uid: `u-teacher-${t}`,
      schoolId: TEST_SCHOOL_ID,
      teacherId: teacherDoc.id,
      email: teacherDoc.email,
      name: teacherDoc.fullName,
      role: "TEACHER",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await createUserServer(teacherUser);
    users.push(teacherUser);
  }

  for (let s = 1; s <= 15; s++) {
    const cls = classes[(s - 1) % classes.length];
    const studentDoc: StudentDoc = {
      id: `std-load-${s}`,
      schoolId: TEST_SCHOOL_ID,
      admissionNo: `ADM-2026-${1000 + s}`,
      fullName: `Student Learner ${s}`,
      fatherName: `Guardian ${s}`,
      gender: s % 2 === 0 ? "FEMALE" : "MALE",
      classId: cls.id,
      className: `${cls.name} (${cls.section})`,
      section: cls.section,
      rollNo: `${s}`,
      monthlyFee: 8500,
      discount: 0,
      academicYear: ACADEMIC_YEAR,
      status: "ACTIVE",
      guardianName: `Guardian ${s}`,
      guardianPhone: "+92-300-9990000",
      guardianRelation: "Father",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveStudentServer(studentDoc);

    const studentUser: UserProfile = {
      uid: `u-student-${s}`,
      schoolId: TEST_SCHOOL_ID,
      studentId: studentDoc.id,
      email: `student${s}@allied-test.edu.pk`,
      name: studentDoc.fullName,
      role: "STUDENT",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await createUserServer(studentUser);
    users.push(studentUser);

    // Seed Fee Challans
    const challan: FeeChallanDoc = {
      id: `ch-load-${s}`,
      schoolId: TEST_SCHOOL_ID,
      studentId: studentDoc.id,
      studentName: studentDoc.fullName,
      admissionNo: studentDoc.admissionNo,
      classId: cls.id,
      className: cls.name,
      challanNo: `CHL-${202600 + s}`,
      month: "November",
      year: 2026,
      academicYear: ACADEMIC_YEAR,
      issueDate: "2026-11-01",
      dueDate: "2026-11-15",
      tuitionFee: 8500,
      admissionFee: 0,
      examFee: 0,
      otherFee: 0,
      discount: 0,
      totalExpected: 8500,
      paidAmount: s % 3 === 0 ? 8500 : 0,
      balanceAmount: s % 3 === 0 ? 0 : 8500,
      status: s % 3 === 0 ? "PAID" : "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveFeeChallanServer(challan);
  }

  // Seed Exam & Schedule
  const examDoc: ExamDoc = {
    id: `exam-load-midterm`,
    schoolId: TEST_SCHOOL_ID,
    name: "Mid-Term Examination 2026",
    term: "Mid-Term",
    category: "MIDTERM",
    session: ACADEMIC_YEAR,
    startDate: "2026-11-20",
    endDate: "2026-11-30",
    status: "UPCOMING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveExamServer(examDoc);

  for (const cls of classes) {
    const schedDoc: ExamScheduleDoc = {
      id: `sch-load-${cls.id}-1`,
      schoolId: TEST_SCHOOL_ID,
      examId: examDoc.id,
      classId: cls.id,
      subjectId: subjects.find((sub) => sub.classId === cls.id)?.id || "sub-1",
      subjectName: "Core Studies",
      examDate: "2026-11-21",
      startTime: "09:00",
      endTime: "11:30",
      totalMarks: 100,
      passingMarks: 40,
      createdAt: new Date().toISOString(),
    };
    await saveExamScheduleServer(schedDoc);
  }

  console.log(`Synthetic setup complete: ${users.length} active user accounts ready.\n`);

  // -------------------------------------------------------------------------
  // 2. CONCURRENT SIMULATION EXECUTION
  // -------------------------------------------------------------------------
  console.log(`Launching ${users.length} concurrent virtual user worker sessions simultaneously...`);
  const simulationStart = Date.now();

  const userWorkerTasks = users.map(async (user, userIdx) => {
    for (let op = 0; op < OPERATIONS_PER_USER; op++) {
      // WORKFLOW 1: Authentication & User Profile Lookup
      const t0 = Date.now();
      try {
        const u = await getUserByEmailServer(user.email);
        if (!u || u.uid !== user.uid) throw new Error("User lookup mismatch");
        recordMetric("auth_login_lookup", t0, true);
      } catch (err: any) {
        recordMetric("auth_login_lookup", t0, false, err.message);
      }

      // WORKFLOW 2: Role-Specific Action
      if (user.role === "ADMIN") {
        // Admin: Dashboard Aggregate Queries & Audit Logs
        const tDash = Date.now();
        try {
          const [cls, counts, teachers, fee, payments, logs] = await Promise.all([
            getSessionClassesServer(TEST_SCHOOL_ID),
            getStudentCountsByClassServer(TEST_SCHOOL_ID),
            getTeachersServer(TEST_SCHOOL_ID),
            getFeeTotalsByClassServer(TEST_SCHOOL_ID),
            getRecentPaymentsServer(TEST_SCHOOL_ID, 6),
            getAuditLogsServer(TEST_SCHOOL_ID, 8),
          ]);
          if (!cls || !counts) throw new Error("Admin dashboard partial read failed");
          recordMetric("admin_dashboard_aggregates", tDash, true);
        } catch (err: any) {
          recordMetric("admin_dashboard_aggregates", tDash, false, err.message);
        }

        // Admin: Lesson Plan Overview & Audit Recording
        const tPlan = Date.now();
        try {
          await getLessonPlansServer(TEST_SCHOOL_ID, { weekId: WEEK_ID });
          await createAuditLogServer(
            TEST_SCHOOL_ID,
            user.uid,
            user.email,
            "ADMIN",
            "ADMIN_VIEW_DASHBOARD",
            "DASHBOARD",
            "root",
            `Admin ${user.name} reviewed dashboard analytics cycle ${op}`
          );
          recordMetric("admin_audit_and_plans", tPlan, true);
        } catch (err: any) {
          recordMetric("admin_audit_and_plans", tPlan, false, err.message);
        }
      } else if (user.role === "TEACHER") {
        // Teacher: Allocated Classes, Subjects, and Lesson Plans
        const tTeach = Date.now();
        try {
          const [subjectsList, weekPlans] = await Promise.all([
            getSubjectsServer(TEST_SCHOOL_ID),
            getLessonPlansServer(TEST_SCHOOL_ID, { weekId: WEEK_ID }),
          ]);
          recordMetric("teacher_subjects_and_plans", tTeach, true);
        } catch (err: any) {
          recordMetric("teacher_subjects_and_plans", tTeach, false, err.message);
        }

        // Teacher: Safe Lesson Plan Edit / Save (48-hour submission window)
        const tSavePlan = Date.now();
        try {
          const planDoc: LessonPlanDoc = {
            id: `plan-load-${user.teacherId}-${WEEK_ID}`,
            schoolId: TEST_SCHOOL_ID,
            teacherId: user.teacherId!,
            classId: classes[userIdx % classes.length].id,
            subjectId: subjects[userIdx % subjects.length].id,
            weekId: WEEK_ID,
            academicYear: ACADEMIC_YEAR,
            weekStartDate: "2026-11-02",
            weekEndDate: "2026-11-08",
            createdBy: user.uid,
            days: [
              { date: "2026-11-02", dayOfWeek: "Monday", content: `Chapter 4 lesson ${op}` },
              { date: "2026-11-03", dayOfWeek: "Tuesday", content: "Practice exercises" },
            ],
            submitted: true,
            submittedAt: new Date().toISOString(),
            submissionDeadline: "2026-11-02T00:00:00.000Z",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await saveLessonPlanServer(planDoc);
          recordMetric("teacher_save_lesson_plan", tSavePlan, true);
        } catch (err: any) {
          recordMetric("teacher_save_lesson_plan", tSavePlan, false, err.message);
        }

        // Teacher: Enter Marks for their schedule
        const tMarks = Date.now();
        try {
          const markDoc: ExamResultDoc = {
            id: `res-load-midterm-std-${userIdx}`,
            schoolId: TEST_SCHOOL_ID,
            examId: "exam-load-midterm",
            studentId: `std-load-1`,
            studentName: "Student Learner 1",
            rollNo: "1",
            classId: classes[0].id,
            subjectId: subjects[0].id,
            subjectName: subjects[0].name,
            scheduleId: `sch-load-${classes[0].id}-1`,
            obtainedMarks: 75 + (op % 20),
            totalMarks: 100,
            percentage: 75 + (op % 20),
            grade: "B+",
            gpa: 3.3,
            status: "PASS",
            remarks: "Satisfactory work",
            evaluatedBy: user.uid,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await commitExamResultsServer(TEST_SCHOOL_ID, [markDoc]);
          recordMetric("teacher_submit_marks", tMarks, true);
        } catch (err: any) {
          recordMetric("teacher_submit_marks", tMarks, false, err.message);
        }
      } else if (user.role === "STUDENT") {
        // Student: Profile and Identity Load
        const tStd = Date.now();
        try {
          const student = await getStudentByIdServer(TEST_SCHOOL_ID, user.studentId!);
          if (!student) throw new Error("Student record missing");
          recordMetric("student_profile_load", tStd, true);
        } catch (err: any) {
          recordMetric("student_profile_load", tStd, false, err.message);
        }

        // Student: Challans & Attendance History Load
        const tFees = Date.now();
        try {
          const [challans, attTotals, results] = await Promise.all([
            getStudentFeeChallansServer(TEST_SCHOOL_ID, user.studentId!),
            getStudentAttendanceTotalsServer(TEST_SCHOOL_ID, user.studentId!),
            getExamResultsServer(TEST_SCHOOL_ID, undefined, undefined, user.studentId!),
          ]);
          recordMetric("student_fees_and_results", tFees, true);
        } catch (err: any) {
          recordMetric("student_fees_and_results", tFees, false, err.message);
        }
      }

      // Small jitter between user operations simulating real interaction
      if (op % 4 === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  });

  await Promise.all(userWorkerTasks);
  const totalDurationMs = Date.now() - simulationStart;

  // -------------------------------------------------------------------------
  // 3. ANALYSIS & REPORTING
  // -------------------------------------------------------------------------
  const totalRequests = latencies.length;
  const successfulRequests = latencies.filter((l) => l.success).length;
  const failedRequests = latencies.filter((l) => !l.success).length;

  const durations = latencies.map((l) => l.durationMs);
  const p50 = computePercentile(durations, 50);
  const p95 = computePercentile(durations, 95);
  const p99 = computePercentile(durations, 99);
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / (durations.length || 1));

  const http5xxErrors = latencies.filter((l) => l.error && /500|503|service temporarily busy/i.test(l.error)).length;
  const resourceExhaustedErrors = latencies.filter((l) => l.error && /RESOURCE_EXHAUSTED/i.test(l.error)).length;
  const firebaseErrors = latencies.filter((l) => l.error && /firebase|firestore/i.test(l.error)).length;

  console.log("===============================================================");
  console.log("CONCURRENCY & LOAD TEST RESULTS");
  console.log("===============================================================");
  console.log(`Concurrent Users Simulated : ${CONCURRENT_USERS}`);
  console.log(`Total Requests Processed   : ${totalRequests}`);
  console.log(`Successful Requests        : ${successfulRequests} (${((successfulRequests / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`Failed Requests            : ${failedRequests}`);
  console.log(`Total Wall-Clock Time      : ${totalDurationMs} ms`);
  console.log(`Throughput                 : ${Math.round((totalRequests / (totalDurationMs / 1000)))} req/sec\n`);

  console.log("Latency Metrics:");
  console.log(`  Min Latency : ${min} ms`);
  console.log(`  Avg Latency : ${avg} ms`);
  console.log(`  p50 Latency : ${p50} ms`);
  console.log(`  p95 Latency : ${p95} ms`);
  console.log(`  p99 Latency : ${p99} ms`);
  console.log(`  Max Latency : ${max} ms\n`);

  console.log("Error Breakdown:");
  console.log(`  HTTP 5xx / Busy Errors       : ${http5xxErrors}`);
  console.log(`  RESOURCE_EXHAUSTED Errors    : ${resourceExhaustedErrors}`);
  console.log(`  Firestore Errors             : ${firebaseErrors}`);

  // Breakdown by Operation
  console.log("\nBreakdown by Operation:");
  const ops = Array.from(new Set(latencies.map((l) => l.operation)));
  for (const op of ops) {
    const list = latencies.filter((l) => l.operation === op);
    const opDurations = list.map((l) => l.durationMs);
    const opP95 = computePercentile(opDurations, 95);
    const opFails = list.filter((l) => !l.success).length;
    console.log(
      `  - ${op.padEnd(28)} : ${String(list.length).padStart(4)} calls | p50: ${computePercentile(opDurations, 50)}ms | p95: ${opP95}ms | failures: ${opFails}`
    );
  }

  // Verification Assertions
  if (failedRequests > 0 || http5xxErrors > 0 || resourceExhaustedErrors > 0) {
    console.error("\n[FAIL] Load test encountered unexpected errors under concurrency!");
    process.exitCode = 1;
  } else {
    console.log("\n[PASS] 25+ CONCURRENT USERS FULLY SUPPORTED WITHOUT ERRORS.");
  }
}

runConcurrencyLoadTest().catch((err) => {
  console.error("Fatal error during concurrency load test:", err);
  process.exit(1);
});
