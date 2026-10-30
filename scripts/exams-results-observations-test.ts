/**
 * Exams, results, observations and report cards: exam creation and subject configuration, marks
 * entry/validation/editing/clearing, totals and grading on the school's scale, report card and
 * dossier agreement, written observations (title/text/conduct rating/exam), the configurable head
 * of institution, and isolation between exams, sessions, students, teachers and schools.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder. It does NOT verify Firestore writes.
 */
import { NextRequest } from "next/server";
import { GET as examsGet, POST as examsPost, PATCH as examsPatch, PUT as examsPut, DELETE as examsDelete } from "../src/app/api/exams/route";
import { GET as obsGet, POST as obsPost, PUT as obsPut, DELETE as obsDelete } from "../src/app/api/observations/route";
import { GET as settingsGet, PUT as settingsPut } from "../src/app/api/settings/route";
import { GET as reportCardGet } from "../src/app/api/print/report-card/[studentId]/route";
import { GET as studentGet } from "../src/app/api/students/[id]/route";
import { GET as studentMeGet } from "../src/app/api/student/me/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getAuditLogsServer,
  getExamResultsServer,
  saveClassServer,
  saveStudentObservationServer,
  saveStudentServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, StudentDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";
import { computeSubjectResult, DEFAULT_GRADING_SCALE, summarizeResults, gradeFor } from "../src/lib/exam-results";
import { SCHOOL_INFO_UNCONFIGURED } from "../src/lib/school-display";

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

let ipCounter = 1;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.88.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const sidParams = (studentId: string) => ({ params: Promise.resolve({ studentId }) });

async function run() {
  console.log("==================================================");
  console.log("EXAMS / RESULTS / OBSERVATIONS / REPORT CARDS");
  console.log("==================================================");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const OTHER_YEAR = "2027-2028";
  const A = "school-erx-a";
  const B = "school-erx-b";
  const settingsFor = (schoolId: string, academicYear: string, principalName: string) => ({
    id: schoolId, schoolId, schoolName: `School ${schoolId}`, campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: `admin@${schoolId}.edu`, principalName, academicYear,
    gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
  });
  // School A carries the literal placeholder "Principal" the old settings route wrote.
  await updateSchoolSettingsServer(settingsFor(A, YEAR, "Principal"));
  await updateSchoolSettingsServer(settingsFor(B, YEAR, "Head of B"));

  const cls = (id: string, schoolId: string, name: string): ClassDoc => ({
    id, schoolId, name, section: "A", numericLevel: 8, capacity: 30, classTeacherId: null,
    academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const c1 = cls("cls-erx-1", A, "Class 7");
  const c2 = cls("cls-erx-2", A, "Class 8");
  const cB = cls("cls-erx-b", B, "Class 7");
  for (const c of [c1, c2, cB]) await saveClassServer(c);

  const subj = (id: string, schoolId: string, classId: string, name: string, teacherId: string | null): SubjectDoc => ({
    id, schoolId, classId, name, code: id.toUpperCase(), teacherId, credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const math = subj("sb-erx-math", A, c1.id, "Mathematics", "tch-erx-math");
  const eng = subj("sb-erx-eng", A, c1.id, "English", "tch-erx-eng");
  const sci = subj("sb-erx-sci", A, c2.id, "Science", "tch-erx-sci");
  const bMath = subj("sb-erx-bmath", B, cB.id, "Mathematics", null);
  for (const s of [math, eng, sci, bMath]) await saveSubjectServer(s);

  const teacher = (id: string, subjectIds: string[], classIds: string[]): TeacherDoc => ({
    id, schoolId: A, employeeId: id.toUpperCase(), fullName: id, email: `${id}@a.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: classIds, assignedSubjectIds: subjectIds, weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  for (const t of [
    teacher("tch-erx-math", [math.id], [c1.id]),
    teacher("tch-erx-eng", [eng.id], [c1.id]),
    teacher("tch-erx-sci", [sci.id], [c2.id]),
  ]) await saveTeacherServer(t);

  const student = (id: string, schoolId: string, classId: string, name: string, roll: string): StudentDoc => ({
    id, schoolId, admissionNo: `ADM-${id}`, fullName: name, fatherName: "F", gender: "MALE", classId, section: "A",
    rollNo: roll, status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 0, discount: 0, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const s1 = student("std-erx-1", A, c1.id, "Ali Raza", "1");
  const s2 = student("std-erx-2", A, c1.id, "Sara Khan", "2");
  const s3 = student("std-erx-3", A, c1.id, "Omar Farooq", "3");
  const s4 = student("std-erx-4", A, c2.id, "Hina Ali", "1");
  const sB = student("std-erx-b", B, cB.id, "Bilal", "1");
  for (const s of [s1, s2, s3, s4, sB]) await saveStudentServer(s);

  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra });
  const ADMIN = await session("uid-erx-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-erx-admin-b", "ADMIN", B);
  const T_MATH = await session("uid-erx-tmath", "TEACHER", A, { teacherId: "tch-erx-math" });
  const T_ENG = await session("uid-erx-teng", "TEACHER", A, { teacherId: "tch-erx-eng" });
  const T_SCI = await session("uid-erx-tsci", "TEACHER", A, { teacherId: "tch-erx-sci" });
  const STUDENT1 = await session("uid-erx-s1", "STUDENT", A, { studentId: s1.id });
  const STUDENT2 = await session("uid-erx-s2", "STUDENT", A, { studentId: s2.id });

  // ---------------------------------------------------------------- grading arithmetic (pure)
  {
    const r = computeSubjectResult(32.6, 100, 33, DEFAULT_GRADING_SCALE);
    assert(r.status === "FAIL" && r.percentage === 33, "Pass/fail compares real marks (32.6 < 33 fails even though 33% after rounding)");
    assert(computeSubjectResult(33, 100, 33, DEFAULT_GRADING_SCALE).status === "PASS", "Marks equal to passing marks pass");
    assert(gradeFor(85, DEFAULT_GRADING_SCALE).grade === "A" && gradeFor(39, DEFAULT_GRADING_SCALE).grade === "F", "Grades follow the configured scale");
    const sum = summarizeResults([], DEFAULT_GRADING_SCALE);
    assert(sum.totalMarks === 0 && sum.grade === null && sum.gpa === null, "Empty results summarize to no grade (never a fabricated F/0)");
  }

  // ---------------------------------------------------------------- 1. principal configuration
  {
    const g = await json(await settingsGet(req(ADMIN, "/api/settings")));
    assert(g.settings?.principalName === "", "Settings GET: the old \"Principal\" placeholder is reported as not configured");
    const rc = await json(await reportCardGet(req(ADMIN, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(rc.school?.principalConfigured === false && rc.school?.principalName === SCHOOL_INFO_UNCONFIGURED, "Report card: unconfigured head shows the not-configured message");
    assert(rc.canConfigure === true, "Report card: admin gets the configure link");
    const rcT = await json(await reportCardGet(req(T_MATH, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(rcT.canConfigure === false, "Report card: teachers do not get the configure link");

    const put = await settingsPut(req(ADMIN, "/api/settings", "PUT", { ...g.settings, principalName: "Mrs. Nadia Hussain", principalTitle: "Principal" }));
    assert(put.status === 200, "Settings PUT: admin saves head of institution");
    const g2 = await json(await settingsGet(req(ADMIN, "/api/settings")));
    assert(g2.settings.principalName === "Mrs. Nadia Hussain" && g2.settings.principalTitle === "Principal", "Settings GET: head of institution persisted");
    const rc2 = await json(await reportCardGet(req(ADMIN, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(rc2.school.principalName === "Mrs. Nadia Hussain" && rc2.school.principalTitle === "Principal" && rc2.school.principalConfigured, "Report card shows the configured head and designation");
    const rcB = await json(await reportCardGet(req(ADMIN_B, `/api/print/report-card/${sB.id}`), sidParams(sB.id)));
    assert(rcB.school.principalName === "Head of B", "Head of institution is isolated per school");
    assert((await settingsPut(req(T_MATH, "/api/settings", "PUT", { principalName: "X" }))).status === 403, "Settings PUT: teachers cannot change the head");
    assert((await settingsPut(req(ADMIN, "/api/settings", "PUT", { principalName: "x".repeat(121) }))).status === 400, "Settings PUT: overlong head name rejected");
  }

  // ---------------------------------------------------------------- 2. exam creation / retrieval
  const created = await json(await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Mid-Term 2026", term: "Mid-Term", startDate: "2026-10-01", endDate: "2026-10-10" })));
  const EXAM = created.exam?.id as string;
  assert(Boolean(EXAM) && created.exam.session === YEAR, "Exam POST: created and tagged with the active session");
  assert((await examsPost(req(T_MATH, "/api/exams", "POST", { title: "X", startDate: "2026-10-01", endDate: "2026-10-02" }))).status === 403, "Exam POST: teachers cannot create exams");
  assert((await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Bad", startDate: "2026-10-05", endDate: "2026-10-01" }))).status === 400, "Exam POST: end before start rejected");
  {
    const g = await json(await examsGet(req(ADMIN, `/api/exams?examId=${EXAM}`)));
    assert(g.activeExam?.title === "Mid-Term 2026" && g.activeExam.schedules.length === 0, "Exam GET: saved exam retrieved again (as after refresh)");
    assert(Array.isArray(g.gradingScale) && g.gradingScale.length > 0, "Exam GET: returns the school grading scale for the preview");
  }

  // ---------------------------------------------------------------- 3. subject configuration
  const sched = (subjectId: string, classId: string, totalMarks: string, passingMarks: string, examId = EXAM) => ({
    examId, classId, subjectId, examDate: "2026-10-02", startTime: "09:00", endTime: "11:00", totalMarks, passingMarks,
  });
  const pMath = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "50", "20"))));
  const pEng = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(eng.id, c1.id, "100", "33"))));
  const MATH_SCH = pMath.schedule?.id as string;
  assert(pMath.success && pMath.schedule.totalMarks === 50 && pMath.schedule.subjectName === "Mathematics", "Schedule PATCH: max/passing marks and subject name stored");
  assert(pEng.success, "Schedule PATCH: second subject added");
  assert((await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "50", "60")))).status === 400, "Schedule PATCH: passing marks above max rejected");
  assert((await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(sci.id, c1.id, "50", "20")))).status === 404, "Schedule PATCH: subject of another class rejected");
  assert((await examsPatch(req(ADMIN_B, "/api/exams", "PATCH", sched(bMath.id, cB.id, "50", "20")))).status === 404, "Schedule PATCH: another school's exam rejected");
  {
    const g = await json(await examsGet(req(ADMIN, `/api/exams?examId=${EXAM}&rosters=one&scheduleId=${MATH_SCH}`)));
    const m = g.activeExam.schedules.find((s: any) => s.id === MATH_SCH);
    assert(m?.maxMarks === 50 && m.passingMarks === 20 && m.results.length === 3, "Schedule GET: configuration persisted and roster has the 3 enrolled students");
    assert(m.results.every((r: any) => r.marksObtained === null && r.recorded === false), "Roster: students without saved marks are 'not recorded', not 0");
  }

  // ---------------------------------------------------------------- 4. marks entry
  {
    const over = await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 45 }, { studentId: s2.id, marksObtained: 51 }] }));
    assert(over.status === 400, "Marks PUT: a mark above the maximum is rejected");
    assert((await getExamResultsServer(A, EXAM)).length === 0, "Marks PUT: a rejected submission saves nothing (all or nothing)");
    assert((await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: -1 }] }))).status === 400, "Marks PUT: negative marks rejected");
    assert((await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s4.id, marksObtained: 10 }] }))).status === 403, "Marks PUT: student of another class rejected");
    assert((await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 10 }, { studentId: s1.id, marksObtained: 11 }] }))).status === 400, "Marks PUT: duplicate student in one submission rejected");
    assert((await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, grade: "A+", studentMarks: [{ studentId: s1.id, marksObtained: 10 }] }))).status === 400, "Marks PUT: client-supplied grade rejected");

    const ok = await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [
      { studentId: s1.id, marksObtained: 45, remarks: "Excellent algebra" },
      { studentId: s2.id, marksObtained: null },
      { studentId: s3.id, marksObtained: 19.5 },
    ] }));
    const okJson = await json(ok);
    assert(ok.status === 200 && okJson.saved === 2 && okJson.cleared === 0, "Marks PUT: 2 marks saved, the blank one is not created");
    const stored = await getExamResultsServer(A, EXAM);
    const r1 = stored.find((r) => r.studentId === s1.id);
    const r3 = stored.find((r) => r.studentId === s3.id);
    assert(stored.length === 2 && !stored.some((r) => r.studentId === s2.id), "Stored: no result fabricated for the student left blank");
    assert(r1?.id === `${A}_${EXAM}_${s1.id}_${math.id}` && r1.subjectName === "Mathematics" && r1.totalMarks === 50 && r1.percentage === 90 && r1.grade === "A+" && r1.status === "PASS", "Stored: correct id, subject, max, percentage, grade, status");
    assert(r1?.academicYear === YEAR && r1.scheduleId === MATH_SCH && r1.classId === c1.id, "Stored: session, schedule and class recorded");
    assert(r3?.status === "FAIL", "Stored: 19.5/50 with passing 20 is a FAIL");
    const forged = await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s3.id, marksObtained: 19.5, grade: "A+", status: "PASS" }] }));
    const r3b = (await getExamResultsServer(A, EXAM)).find((r) => r.studentId === s3.id);
    assert(forged.status === 200 && r3b?.grade === "F" && r3b.status === "FAIL", "Marks PUT: grade/status sent per student are ignored; the server computes them");

    const g = await json(await examsGet(req(ADMIN, `/api/exams?examId=${EXAM}&rosters=one&scheduleId=${MATH_SCH}`)));
    const rows = g.activeExam.schedules.find((s: any) => s.id === MATH_SCH).results;
    const row1 = rows.find((r: any) => r.studentId === s1.id);
    const row2 = rows.find((r: any) => r.studentId === s2.id);
    assert(row1.marksObtained === 45 && row1.recorded && row1.remarks === "Excellent algebra" && row1.grade === "A+", "Marks GET after refresh: saved marks and remarks returned");
    assert(row2.marksObtained === null && !row2.recorded, "Marks GET after refresh: blank student still not recorded");
  }

  // ---------------------------------------------------------------- 5. editing / clearing / teacher scope
  {
    const createdAt = (await getExamResultsServer(A, EXAM)).find((r) => r.studentId === s1.id)!.createdAt;
    await new Promise((r) => setTimeout(r, 5));
    const edit = await examsPut(req(T_MATH, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 40 }] }));
    assert(edit.status === 200, "Marks PUT: the allocated subject teacher can correct marks");
    const after = (await getExamResultsServer(A, EXAM)).filter((r) => r.studentId === s1.id && r.subjectId === math.id);
    assert(after.length === 1 && after[0].obtainedMarks === 40 && after[0].percentage === 80, "Editing updates the same result (no duplicate)");
    assert(after[0].remarks === "Excellent algebra", "Editing without sending remarks keeps the saved remarks");
    assert(after[0].createdAt === createdAt && after[0].updatedAt !== createdAt, "Editing keeps createdAt and bumps updatedAt");

    assert((await examsPut(req(T_ENG, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 1 }] }))).status === 403, "Marks PUT: a teacher of another subject is blocked");
    assert((await examsPut(req(T_SCI, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 1 }] }))).status === 403, "Marks PUT: a teacher of another class is blocked");
    assert((await examsPut(req(ADMIN_B, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 1 }] }))).status === 404, "Marks PUT: another school's admin cannot reach this schedule");
    assert((await examsPut(req(STUDENT1, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 50 }] }))).status === 403, "Marks PUT: students cannot enter marks");
    assert((await examsGet(req(STUDENT1, "/api/exams"))).status === 403, "Exams GET: students cannot read the gradebook");

    const tg = await json(await examsGet(req(T_MATH, `/api/exams?examId=${EXAM}`)));
    assert(tg.activeExam.schedules.length === 1 && tg.activeExam.schedules[0].id === MATH_SCH, "Exams GET: a teacher sees only their own subject's schedule");

    const clear = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s3.id, marksObtained: null }] })));
    assert(clear.cleared === 1 && !(await getExamResultsServer(A, EXAM)).some((r) => r.studentId === s3.id), "Clearing a mark removes that one result");
  }

  // ---------------------------------------------------------------- 6. schedule changes with marks
  {
    assert((await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "30", "10")))).status === 409, "Schedule PATCH: max cannot drop below an already-recorded mark");
    const raised = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "80", "40"))));
    const r1 = (await getExamResultsServer(A, EXAM)).find((r) => r.studentId === s1.id)!;
    assert(raised.updated && raised.resultsRecomputed === 1, "Schedule PATCH: raising max re-grades recorded results");
    assert(r1.obtainedMarks === 40 && r1.totalMarks === 80 && r1.percentage === 50 && r1.status === "PASS", "Re-grading keeps obtained marks and recomputes %/status");
  }

  // ---------------------------------------------------------------- 7. second exam does not overwrite the first
  const exam2 = (await json(await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Final 2027", term: "Final", startDate: "2027-03-01", endDate: "2027-03-10" })))).exam.id as string;
  {
    const p = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "100", "33", exam2))));
    await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: p.schedule.id, studentMarks: [{ studentId: s1.id, marksObtained: 70 }] }));
    const first = (await getExamResultsServer(A, EXAM)).find((r) => r.studentId === s1.id)!;
    const second = (await getExamResultsServer(A, exam2)).find((r) => r.studentId === s1.id)!;
    assert(first.obtainedMarks === 40 && second.obtainedMarks === 70 && first.id !== second.id, "Results of different exams are separate documents");
  }

  // ---------------------------------------------------------------- 8. observations
  let OBS = "";
  {
    assert((await obsPost(req(ADMIN, "/api/observations", "POST", { studentId: s1.id, content: "" }))).status === 400, "Observation POST: empty text rejected");
    assert((await obsPost(req(ADMIN, "/api/observations", "POST", { studentId: s1.id, content: "x", category: "NOPE" }))).status === 400, "Observation POST: unknown category rejected");
    assert((await obsPost(req(ADMIN, "/api/observations", "POST", { studentId: s1.id, content: "x", examId: "exam-missing" }))).status === 404, "Observation POST: unknown exam rejected");
    assert((await obsPost(req(ADMIN_B, "/api/observations", "POST", { studentId: s1.id, content: "x" }))).status === 404, "Observation POST: another school's admin cannot write");
    assert((await obsPost(req(T_SCI, "/api/observations", "POST", { studentId: s1.id, content: "x" }))).status === 403, "Observation POST: teacher of another class blocked");

    const text = "Ali helps classmates with fractions and finishes homework on time.";
    const created = await obsPost(req(T_MATH, "/api/observations", "POST", {
      studentId: s1.id, title: "Helpful in class", category: "CONDUCT", content: text, sentiment: "POSITIVE", examId: EXAM,
    }));
    const cj = await json(created);
    OBS = cj.observation?.id;
    assert(created.status === 201 && cj.observation.title === "Helpful in class" && cj.observation.note === text, "Observation POST: title and written text saved as separate fields");
    assert(cj.observation.sentiment === "POSITIVE" && cj.observation.conductLabel === "Positive" && cj.observation.examId === EXAM, "Observation POST: conduct rating and exam stored");

    await obsPost(req(ADMIN, "/api/observations", "POST", { studentId: s1.id, content: "Punctual all term.", category: "ATTENDANCE" }));
    // A record in the old format: title merged into note, no title field.
    await saveStudentObservationServer({
      id: "obs-erx-legacy", schoolId: A, studentId: s1.id, teacherId: "tch-erx-math", teacherName: "Old", category: "ACADEMIC",
      note: "Quiz: scored full marks", sentiment: "NEUTRAL", createdAt: "2026-09-01T08:00:00.000Z",
    });

    const list = await json(await obsGet(req(T_MATH, `/api/observations?studentId=${s1.id}`)));
    const mine = list.observations?.find((o: any) => o.id === OBS);
    assert(list.observations?.length === 3 && mine?.note === text && mine.canEdit === true, "Observation GET (after refresh): the written text is returned in full");
    const legacy = list.observations.find((o: any) => o.id === "obs-erx-legacy");
    assert(legacy?.note === "Quiz: scored full marks" && legacy.title === "", "Legacy observation shows its full saved text");
    // A pre-studentName-field record must still resolve to the RIGHT student's name (from the
    // already-verified studentId on this exact request), never blank and never another
    // student's name copied in by mistake.
    assert(legacy?.studentName === s1.fullName, "Observation GET (per-student): a legacy record with no stored studentName resolves to this student's real name");
    assert(list.observations.find((o: any) => o.note === "Punctual all term.")?.canEdit === false, "Teachers cannot edit an admin's note (flag)");
    assert(list.observations.every((o: any) => o.studentId === s1.id), "Observation GET returns only this student's notes");
    assert((await obsGet(req(T_SCI, `/api/observations?studentId=${s1.id}`))).status === 403, "Observation GET: teacher of another class blocked");
    assert((await obsGet(req(ADMIN_B, `/api/observations?studentId=${s1.id}`))).status === 404, "Observation GET: another school blocked");
    assert((await obsGet(req(STUDENT1, `/api/observations?studentId=${s1.id}`))).status === 403, "Observation GET: students use their portal, not the management API");
    const s2List = await json(await obsGet(req(ADMIN, `/api/observations?studentId=${s2.id}`)));
    assert(s2List.observations.length === 0, "Observations are not attached to other students");

    const edited = await json(await obsPut(req(T_MATH, "/api/observations", "PUT", { id: OBS, content: text + " Leads group work." })));
    assert(edited.observation?.id === OBS && edited.observation.note.endsWith("Leads group work.") && edited.observation.title === "Helpful in class", "Observation PUT: author edits the text in place, title kept");
    const adminNoteId = list.observations.find((o: any) => o.note === "Punctual all term.").id;
    assert((await obsPut(req(T_MATH, "/api/observations", "PUT", { id: adminNoteId, content: "changed" }))).status === 403, "Observation PUT: teacher cannot edit someone else's note");
    assert((await obsPut(req(ADMIN_B, "/api/observations", "PUT", { id: OBS, content: "changed" }))).status === 404, "Observation PUT: another school cannot edit");

    const dossier = await json(await studentGet(req(ADMIN, `/api/students/${s1.id}`), idParams(s1.id)));
    const dObs = dossier.student.observations.find((o: any) => o.id === OBS);
    assert(dObs?.note.startsWith("Ali helps") && dObs.title === "Helpful in class" && dObs.examName === "Mid-Term 2026", "Student profile shows title, written text and exam of the observation");

    // Edit history: the correction above must not have erased what was originally written.
    const afterEdit = await json(await obsGet(req(T_MATH, `/api/observations?studentId=${s1.id}`)));
    const editedObs = afterEdit.observations.find((o: any) => o.id === OBS);
    assert(editedObs.editHistory.length === 1 && editedObs.editHistory[0].previousNote === text, "Observation PUT: the pre-edit text is preserved in edit history, not erased");
    assert(editedObs.editHistory[0].previousTitle === "Helpful in class" && editedObs.editHistory[0].byName, "Observation PUT: edit history records who made the correction");
    // A category/sentiment-only change (no text change) must not add a history entry.
    await obsPut(req(T_MATH, "/api/observations", "PUT", { id: OBS, sentiment: "NEUTRAL" }));
    const afterNonTextEdit = await json(await obsGet(req(T_MATH, `/api/observations?studentId=${s1.id}`)));
    assert(afterNonTextEdit.observations.find((o: any) => o.id === OBS).editHistory.length === 1, "Observation PUT: changing only category/sentiment does not add a history entry");

    // Admin school-wide search (the admin observations screen): no studentId, filterable.
    assert((await obsGet(req(T_MATH, "/api/observations"))).status === 400, "Observation GET (search): a teacher must still specify a studentId");
    const search = await json(await obsGet(req(ADMIN, "/api/observations")));
    assert(search.mode === "search" && search.observations.some((o: any) => o.id === OBS), "Observation GET (search): admin sees the school's observations without a studentId");
    const legacyInSearch = search.observations.find((o: any) => o.id === "obs-erx-legacy");
    assert(legacyInSearch?.studentName === s1.fullName, "Observation GET (search): the same legacy record resolves to the right name here too, via the roster batch lookup");
    const byClass = await json(await obsGet(req(ADMIN, `/api/observations?classId=${c1.id}`)));
    assert(byClass.observations.length > 0 && byClass.observations.every((o: any) => o.classId === c1.id), "Observation GET (search): classId filter narrows to that class");
    const byCategory = await json(await obsGet(req(ADMIN, "/api/observations?category=ATTENDANCE")));
    assert(byCategory.observations.length === 1 && byCategory.observations[0].category === "ATTENDANCE", "Observation GET (search): category filter narrows the results");
    const byText = await json(await obsGet(req(ADMIN, "/api/observations?q=Leads+group")));
    assert(byText.observations.some((o: any) => o.id === OBS), "Observation GET (search): free-text search matches the note body");
    const crossSchool = await json(await obsGet(req(ADMIN_B, "/api/observations")));
    assert(crossSchool.observations.every((o: any) => o.id !== OBS), "Observation GET (search): another school never sees this school's observations");

    // Delete (soft): ADMIN for any note, TEACHER only their own; gone from every normal read but
    // not actually destroyed. A dedicated note is created for this — adminNoteId ("Punctual all
    // term.") is still needed, intact, by the report-card test below.
    const toDeleteId = (await json(await obsPost(req(ADMIN, "/api/observations", "POST", { studentId: s1.id, content: "Scratch note for delete testing." })))).observation.id;
    assert((await obsDelete(req(T_SCI, `/api/observations?id=${toDeleteId}`, "DELETE"))).status === 403, "Observation DELETE: teacher of another class blocked");
    assert((await obsDelete(req(T_MATH, `/api/observations?id=${toDeleteId}`, "DELETE"))).status === 403, "Observation DELETE: a teacher cannot delete someone else's note");
    assert((await obsDelete(req(ADMIN_B, `/api/observations?id=${toDeleteId}`, "DELETE"))).status === 404, "Observation DELETE: another school cannot delete");
    const del = await obsDelete(req(ADMIN, `/api/observations?id=${toDeleteId}`, "DELETE"));
    assert(del.status === 200, "Observation DELETE: admin deletes a note");
    const afterDelete = await json(await obsGet(req(ADMIN, `/api/observations?studentId=${s1.id}`)));
    assert(!afterDelete.observations.some((o: any) => o.id === toDeleteId), "Observation DELETE: the deleted note no longer appears in the student's list");
    const afterDeleteSearch = await json(await obsGet(req(ADMIN, "/api/observations")));
    assert(!afterDeleteSearch.observations.some((o: any) => o.id === toDeleteId), "Observation DELETE: the deleted note no longer appears in the school-wide search");
    assert((await obsDelete(req(ADMIN, `/api/observations?id=${toDeleteId}`, "DELETE"))).status === 404, "Observation DELETE: deleting an already-deleted note is reported as not found, not silently repeated");
  }

  // ---------------------------------------------------------------- 9. report card = dossier = persisted marks
  {
    const rc = await json(await reportCardGet(req(ADMIN, `/api/print/report-card/${s1.id}?examId=${EXAM}`), sidParams(s1.id)));
    const sec = rc.exams?.[0];
    const mathRow = sec?.results.find((r: any) => r.subjectId === math.id);
    assert(rc.selectedExamId === EXAM && rc.exams.length === 1, "Report card ?examId= shows only that exam");
    assert(mathRow?.subjectName === "Mathematics" && mathRow.obtainedMarks === 40 && mathRow.totalMarks === 80 && mathRow.examDate === "2026-10-02", "Report card shows subject name, persisted marks, max and exam date");
    assert(sec.notRecorded.length === 1 && sec.notRecorded[0].subjectName === "English", "Report card lists the scheduled subject with no mark as not recorded");
    assert(sec.summary.totalMarks === 80 && sec.summary.obtainedMarks === 40 && sec.summary.percentage === 50, "Missing marks are excluded from totals, not counted as 0");
    assert(sec.summary.grade === gradeFor(50, DEFAULT_GRADING_SCALE).grade, "Overall grade uses the school's scale");
    assert(sec.observations.some((o: any) => o.id === OBS) && rc.observations.some((o: any) => o.note === "Punctual all term."), "Report card includes the exam's observation and general observations");
    assert(!rc.observations.some((o: any) => o.examId && o.examId !== EXAM), "Report card of one exam omits other exams' observations");

    const rcAll = await json(await reportCardGet(req(ADMIN, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    const dossier = await json(await studentGet(req(ADMIN, `/api/students/${s1.id}`), idParams(s1.id)));
    assert(rcAll.exams.length === 2 && rcAll.academics.totalMarks === 180 && rcAll.academics.obtainedMarks === 110, "Report card (all exams) totals = sum of persisted results");
    assert(
      dossier.stats.academics.totalMarks === rcAll.academics.totalMarks &&
      dossier.stats.academics.obtainedMarks === rcAll.academics.obtainedMarks &&
      dossier.stats.academics.percentage === rcAll.academics.percentage &&
      dossier.stats.academics.gpa === rcAll.academics.gpa,
      "Student profile and report card agree on totals, percentage and GPA"
    );
    const dMath = dossier.student.examResults.find((r: any) => r.examId === EXAM);
    assert(dMath?.examSchedule.subject.name === "Mathematics" && dMath.examSchedule.examDate === "2026-10-02" && dMath.status === "PASS", "Student profile shows subject name, real exam date and result status");
  }

  // ---------------------------------------------------------------- 10. students see only published, only their own
  {
    const before = await json(await reportCardGet(req(STUDENT1, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(before.results.length === 0 && before.exams.length === 0, "Student: unpublished exam results are hidden");
    assert(!before.observations.some((o: any) => o.examId === EXAM), "Student: observations of an unpublished exam are hidden");
    const pub = await examsPut(req(ADMIN, "/api/exams", "PUT", { examId: EXAM, status: "PUBLISHED" }));
    assert(pub.status === 200, "Exam PUT: admin publishes the exam");
    assert((await examsPut(req(T_MATH, "/api/exams", "PUT", { examId: EXAM, status: "UPCOMING" }))).status === 403, "Exam PUT: teachers cannot change exam status");

    // Finalized-results correction workflow: once published, a teacher's routine mark entry is a
    // correction to a result students/parents can already see — require admin, and audit it as a
    // correction distinctly from routine entry (Phase 2 of the bug-fix brief).
    const blockedEdit = await examsPut(req(T_MATH, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 46 }] }));
    assert(blockedEdit.status === 403, "Marks PUT: a teacher cannot edit marks of a published (finalized) exam");
    const beforeCorrection = await json(await examsGet(req(ADMIN, `/api/exams?examId=${EXAM}&rosters=one&scheduleId=${MATH_SCH}`)));
    const s1Before = beforeCorrection.activeExam.schedules.find((s: any) => s.id === MATH_SCH).results.find((r: any) => r.studentId === s1.id);
    assert(s1Before.marksObtained === 40, "Marks PUT: the blocked teacher edit left the published mark unchanged");
    const adminCorrection = await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: MATH_SCH, studentMarks: [{ studentId: s1.id, marksObtained: 46 }] }));
    assert(adminCorrection.status === 200, "Marks PUT: an admin can still correct marks of a published exam");
    const afterCorrection = await json(await examsGet(req(ADMIN, `/api/exams?examId=${EXAM}&rosters=one&scheduleId=${MATH_SCH}`)));
    const s1After = afterCorrection.activeExam.schedules.find((s: any) => s.id === MATH_SCH).results.find((r: any) => r.studentId === s1.id);
    assert(s1After.marksObtained === 46, "Marks PUT: the admin's correction to the published exam was saved");
    const logs = await getAuditLogsServer(A);
    assert(
      logs.some((l) => l.action === "CORRECT_PUBLISHED_EXAM_MARKS" && l.entityId === MATH_SCH),
      "Audit log: the post-publish correction is recorded distinctly from routine mark entry"
    );
    const after = await json(await reportCardGet(req(STUDENT1, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(after.results.length === 1 && after.results[0].examId === EXAM && after.exams[0].observations.some((o: any) => o.id === OBS), "Student: published exam results and its observation visible");
    const me = await json(await studentMeGet(req(STUDENT1, "/api/student/me?view=dashboard")));
    assert(me.student.examResults[0]?.examSchedule.subject.name === "Mathematics" && me.stats.academics.obtainedMarks === after.academics.obtainedMarks, "Student dashboard agrees with the report card");
    assert(me.student.observations.some((o: any) => o.id === OBS && o.note.startsWith("Ali helps")), "Student dashboard shows the written observation");
    assert((await reportCardGet(req(STUDENT2, `/api/print/report-card/${s1.id}`), sidParams(s1.id))).status === 403, "Student cannot open another student's report card");
    assert((await studentGet(req(STUDENT2, `/api/students/${s1.id}`), idParams(s1.id))).status === 403, "Student cannot open another student's profile");
    assert((await reportCardGet(req(T_SCI, `/api/print/report-card/${s1.id}`), sidParams(s1.id))).status === 403, "Teacher of another class cannot open the report card");
    assert((await reportCardGet(req(ADMIN_B, `/api/print/report-card/${s1.id}`), sidParams(s1.id))).status === 404, "Another school's admin cannot open the report card");
  }

  // ---------------------------------------------------------------- 11. edit exam details
  {
    const e = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", { examId: exam2, title: "Final Term 2027", startDate: "2027-03-02", endDate: "2027-03-12" })));
    assert(e.exam?.name === "Final Term 2027" && e.exam.startDate === "2027-03-02", "Exam PUT: title and dates edited");
    assert((await examsPut(req(ADMIN, "/api/exams", "PUT", { examId: exam2, startDate: "2027-04-01", endDate: "2027-03-01" }))).status === 400, "Exam PUT: invalid date range rejected");
  }

  // ---------------------------------------------------------------- 11b. result sheet attach/replace (orphan-cleanup fix)
  {
    const sheetA = "https://firebasestorage.googleapis.com/v0/b/demo.firebasestorage.app/o/schools%2Fschool-erx-a%2Fresult-cards%2Fsheet-a.pdf?alt=media&token=t1";
    const sheetB = "https://firebasestorage.googleapis.com/v0/b/demo.firebasestorage.app/o/schools%2Fschool-erx-a%2Fresult-cards%2Fsheet-b.pdf?alt=media&token=t2";
    const r1 = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", { examId: exam2, resultSheetUrl: sheetA })));
    assert(r1.exam?.resultSheetUrl === sheetA, "Exam PUT: result sheet attached");
    const r2 = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", { examId: exam2, resultSheetUrl: sheetB })));
    assert(r2.exam?.resultSheetUrl === sheetB, "Exam PUT: replacing the result sheet stores the new URL (old file's cleanup attempt never blocks the save)");
    const r3 = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", { examId: exam2, resultSheetUrl: "" })));
    assert(r3.exam?.resultSheetUrl === undefined, "Exam PUT: clearing the result sheet removes it (and attempts cleanup of the last file)");
    const withSheet = await json(await examsPost(req(ADMIN, "/api/exams", "POST", { title: "To delete with sheet", startDate: "2026-11-05", endDate: "2026-11-06", resultSheetUrl: sheetA })));
    assert(withSheet.exam?.resultSheetUrl === sheetA, "Exam POST: created with a result sheet already attached");
    assert((await examsDelete(req(ADMIN, `/api/exams?examId=${withSheet.exam.id}`, "DELETE"))).status === 200, "Exam DELETE: an exam with an attached result sheet deletes cleanly (cleanup attempt never blocks the delete)");
  }

  // ---------------------------------------------------------------- 11c. exam categories & admin-controlled teacher permissions
  {
    const monthly = await json(await examsPost(req(ADMIN, "/api/exams", "POST", { title: "October Monthly", category: "MONTHLY_TEST", startDate: "2026-10-05", endDate: "2026-10-05" })));
    assert(monthly.exam?.category === "MONTHLY_TEST", "Exam POST: category stored");
    const finalTerm = await json(await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Final Examination", category: "FINAL_TERM", startDate: "2027-05-01", endDate: "2027-05-10" })));
    assert(finalTerm.exam?.category === "FINAL_TERM", "Exam POST: a different category stored on a different exam");
    assert((await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Bad category", category: "NOT_A_CATEGORY", startDate: "2026-10-01", endDate: "2026-10-01" }))).status === 400, "Exam POST: an unknown category is rejected");

    const monthlySch = (await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "20", "10", monthly.exam.id))))).schedule.id as string;
    const finalSch = (await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", sched(math.id, c1.id, "100", "33", finalTerm.exam.id))))).schedule.id as string;

    // Defaults: Monthly Test is teacher-entry allowed; Final Term is read-only for teachers.
    const monthlyGet = await json(await examsGet(req(ADMIN, `/api/exams?examId=${monthly.exam.id}`)));
    assert(monthlyGet.activeExam.teacherMarksPermission === "ALLOWED", "Exam GET: Monthly Test defaults to teacher entry allowed");
    const finalGet = await json(await examsGet(req(ADMIN, `/api/exams?examId=${finalTerm.exam.id}`)));
    assert(finalGet.activeExam.teacherMarksPermission === "READ_ONLY", "Exam GET: Final Term defaults to read-only for teachers");

    // s3 is used here deliberately: by this point its only earlier mark (on a different exam)
    // was cleared back to "not recorded" (see "Clearing a mark removes that one result" above),
    // so it carries no result count that a later test in this file depends on — unlike s1/s2.
    assert((await examsPut(req(T_MATH, "/api/exams", "PUT", { examScheduleId: monthlySch, studentMarks: [{ studentId: s3.id, marksObtained: 18 }] }))).status === 200, "Marks PUT: a teacher can enter marks for a default-allowed category (Monthly Test)");
    const blockedFinal = await examsPut(req(T_MATH, "/api/exams", "PUT", { examScheduleId: finalSch, studentMarks: [{ studentId: s3.id, marksObtained: 90 }] }));
    assert(blockedFinal.status === 403, "Marks PUT: a teacher cannot enter marks for a default-read-only category (Final Term)");
    assert((await examsPut(req(ADMIN, "/api/exams", "PUT", { examScheduleId: finalSch, studentMarks: [{ studentId: s3.id, marksObtained: 90 }] }))).status === 200, "Marks PUT: an admin can always enter marks regardless of category permission");
    // Read access is never gated by this permission — only writes.
    assert((await examsGet(req(T_MATH, `/api/exams?examId=${finalTerm.exam.id}&rosters=one&scheduleId=${finalSch}`))).status === 200, "Exams GET: a teacher can still view a read-only-category exam's marks");

    // Admin reverses both defaults via Settings; the effect is immediate and server-enforced.
    const curSettings = (await json(await settingsGet(req(ADMIN, "/api/settings")))).settings;
    const flipped = await settingsPut(req(ADMIN, "/api/settings", "PUT", {
      ...curSettings,
      examCategoryPermissions: { ...curSettings.examCategoryPermissions, MONTHLY_TEST: "READ_ONLY", FINAL_TERM: "ALLOWED" },
    }));
    assert(flipped.status === 200, "Settings PUT: admin overrides the exam category permission defaults");
    assert((await examsPut(req(T_MATH, "/api/exams", "PUT", { examScheduleId: monthlySch, studentMarks: [{ studentId: s3.id, marksObtained: 15 }] }))).status === 403, "Marks PUT: Monthly Test is now read-only for teachers after the admin override");
    assert((await examsPut(req(T_MATH, "/api/exams", "PUT", { examScheduleId: finalSch, studentMarks: [{ studentId: s3.id, marksObtained: 80 }] }))).status === 200, "Marks PUT: Final Term now allows teacher entry after the admin override");

    // Another school's category-permission override never crosses the tenant boundary.
    const bSettings = (await json(await settingsGet(req(ADMIN_B, "/api/settings")))).settings;
    assert(bSettings.examCategoryPermissions.MONTHLY_TEST === "ALLOWED", "Settings: another school's category permissions are unaffected by school A's override");

    // Restore defaults so later assertions in this file see the documented out-of-the-box policy.
    await settingsPut(req(ADMIN, "/api/settings", "PUT", { ...curSettings, examCategoryPermissions: curSettings.examCategoryPermissions }));
  }

  // ---------------------------------------------------------------- 12. safe deletes
  {
    assert((await examsDelete(req(ADMIN, `/api/exams?examId=${EXAM}`, "DELETE"))).status === 409, "Exam DELETE: refused while marks are recorded");
    assert((await examsDelete(req(ADMIN, `/api/exams?scheduleId=${MATH_SCH}`, "DELETE"))).status === 409, "Schedule DELETE: refused while marks are recorded");
    const engSch = `sch-${EXAM}-${c1.id}-${eng.id}`;
    assert((await examsDelete(req(ADMIN, `/api/exams?scheduleId=${engSch}`, "DELETE"))).status === 200, "Schedule DELETE: a subject with no marks can be removed");
    const empty = (await json(await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Typo exam", startDate: "2026-11-01", endDate: "2026-11-02" })))).exam.id;
    assert((await examsDelete(req(T_MATH, `/api/exams?examId=${empty}`, "DELETE"))).status === 403, "Exam DELETE: teachers cannot delete");
    assert((await examsDelete(req(ADMIN, `/api/exams?examId=${empty}`, "DELETE"))).status === 200, "Exam DELETE: an exam without marks can be deleted");
    const list = await json(await examsGet(req(ADMIN, "/api/exams")));
    assert(!list.exams.some((e: any) => e.id === empty) && list.exams.some((e: any) => e.id === EXAM), "Deleted exam is gone; exams with marks remain");
    assert((await getExamResultsServer(A, EXAM)).length === 1, "Refused deletes left the recorded marks untouched");
  }

  // ---------------------------------------------------------------- 13. academic session separation
  {
    await updateSchoolSettingsServer({ ...settingsFor(A, OTHER_YEAR, "Mrs. Nadia Hussain") });
    const g = await json(await examsGet(req(ADMIN, "/api/exams")));
    const rc = await json(await reportCardGet(req(ADMIN, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(g.exams.length === 0 && rc.results.length === 0, "Switching session hides the previous session's exams and results");
    await updateSchoolSettingsServer({ ...settingsFor(A, YEAR, "Mrs. Nadia Hussain") });
    const back = await json(await reportCardGet(req(ADMIN, `/api/print/report-card/${s1.id}`), sidParams(s1.id)));
    assert(back.results.length === 2, "Switching back restores them unchanged");
  }

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
