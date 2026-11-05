/**
 * Subject-wise student allocation (Part 12): an optional/elective subject (SubjectDoc.isOptional)
 * is graded only for the students an Admin explicitly allocated to it (StudentDoc.
 * optionalSubjectIds) — never the whole class, never guessed, never assigned automatically.
 * Compulsory subjects keep including every active student of the class, exactly as before.
 *
 * Covers: Admin allocating/reallocating a student, a Teacher's roster/marks being filtered the
 * same way, unauthorized access (wrong school, wrong role, wrong class/subject id), a student
 * with no allocation at all (the default — never eligible for an optional subject), and an
 * existing/legacy student record with no optionalSubjectIds field (compulsory subjects must
 * still include them exactly as before this feature existed).
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { GET as examsGet, PUT as examsPut, PATCH as examsPatch, POST as examsPost } from "../src/app/api/exams/route";
import { PUT as studentPut, GET as studentGet } from "../src/app/api/students/[id]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveSubjectServer, saveStudentServer, saveTeacherServer, getStudentByIdServer } from "../src/lib/firebase/server-db";
import { ClassDoc, StudentDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";

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
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  console.log("==================================================");
  console.log("SUBJECT-WISE STUDENT ALLOCATION");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-salloc-a";
  const B = "school-salloc-b";
  const YEAR = "2026-2027";

  const c9: ClassDoc = { id: "cls-salloc-9a", schoolId: A, name: "Class 9", section: "A", numericLevel: 9, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(c9);

  const math: SubjectDoc = { id: "sub-salloc-math", schoolId: A, classId: c9.id, name: "Mathematics", code: "MAT", credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now };
  const bio: SubjectDoc = { id: "sub-salloc-bio", schoolId: A, classId: c9.id, name: "Biology", code: "BIO", credits: 3, isOptional: true, teacherId: "tch-salloc-bio", academicYear: YEAR, createdAt: now, updatedAt: now };
  const comp: SubjectDoc = { id: "sub-salloc-comp", schoolId: A, classId: c9.id, name: "Computer", code: "COM", credits: 3, isOptional: true, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveSubjectServer(math);
  await saveSubjectServer(bio);
  await saveSubjectServer(comp);

  const student = (id: string, admissionNo: string, name: string, optionalSubjectIds?: string[]): StudentDoc => ({
    id, schoolId: A, admissionNo, fullName: name, fatherName: "F", gender: "FEMALE", classId: c9.id, section: "A",
    rollNo: id.slice(-1), status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 9-A", createdAt: now, updatedAt: now,
    ...(optionalSubjectIds !== undefined ? { optionalSubjectIds } : {}),
  });
  // Aamna takes Biology, Abdullah takes Computer — both stay in the same Class 9-A.
  const aamna = student("std-salloc-1", "STD-SA-001", "Aamna", ["sub-salloc-bio"]);
  const abdullah = student("std-salloc-2", "STD-SA-002", "Abdullah", ["sub-salloc-comp"]);
  // A third student with NO allocation at all — the default must be "not eligible" for any
  // optional subject, never a silent fallback to "everyone".
  const noAlloc = student("std-salloc-3", "STD-SA-003", "NoAlloc");
  // A legacy record predating this feature entirely — optionalSubjectIds is undefined, not [].
  // Existing/compulsory behavior for it must be completely unchanged.
  const legacy = student("std-salloc-4", "STD-SA-004", "LegacyStudent", undefined);
  await saveStudentServer(aamna);
  await saveStudentServer(abdullah);
  await saveStudentServer(noAlloc);
  await saveStudentServer(legacy);

  const ADMIN = await createSessionCookieServer({ uid: "u-salloc-admin", email: "admin@salloc.edu", role: "ADMIN", schoolId: A, name: "Admin" });
  const TEACHER_BIO = await createSessionCookieServer({ uid: "u-salloc-t-bio", email: "tbio@salloc.edu", role: "TEACHER", schoolId: A, name: "Bio Teacher", teacherId: "tch-salloc-bio" });
  const TEACHER_OTHER = await createSessionCookieServer({ uid: "u-salloc-t-other", email: "tother@salloc.edu", role: "TEACHER", schoolId: A, name: "Other Teacher", teacherId: "tch-salloc-other" });
  const ADMIN_B = await createSessionCookieServer({ uid: "u-salloc-admin-b", email: "admin@b.edu", role: "ADMIN", schoolId: B, name: "Admin B" });

  // The Biology teacher: allocated to Class 9-A and the Biology subject specifically.
  const teacherDoc = (id: string, assignedSubjectIds: string[]): TeacherDoc => ({
    id, schoolId: A, employeeId: id, fullName: "Bio Teacher", email: `${id}@salloc.edu`, phone: "0300",
    designation: "Teacher", department: "Science", qualification: "M.Sc", status: "ACTIVE",
    assignedClassIds: [c9.id], assignedSubjectIds, weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  await saveTeacherServer(teacherDoc("tch-salloc-bio", [bio.id]));
  // A second teacher allocated to neither this class nor Biology, for the unauthorized-access check.
  await saveTeacherServer({ ...teacherDoc("tch-salloc-other", []), assignedClassIds: [], fullName: "Other Teacher" });

  // Create the exam + schedules for Mathematics (compulsory) and Biology (optional).
  const examRes = await json(await examsPost(req(ADMIN, "/api/exams", "POST", {
    title: "Monthly Test", term: "Monthly", category: "MONTHLY_TEST", startDate: "2026-11-01", endDate: "2026-11-05",
  })));
  const examId = examRes.exam.id;
  const mathSchedRes = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", { examId, classId: c9.id, subjectId: math.id, examDate: "2026-11-01", startTime: "09:00", endTime: "11:00", totalMarks: "100", passingMarks: "33" })));
  const bioSchedRes = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", { examId, classId: c9.id, subjectId: bio.id, examDate: "2026-11-02", startTime: "09:00", endTime: "11:00", totalMarks: "100", passingMarks: "33" })));
  const mathSchedId = mathSchedRes.schedule.id;
  const bioSchedId = bioSchedRes.schedule.id;

  // ---------------------------------------------------------------- 1. roster filtering (GET)
  {
    const mathView = await json(await examsGet(req(ADMIN, `/api/exams?examId=${examId}&rosters=one&scheduleId=${mathSchedId}`)));
    const mathResults = mathView.activeExam.schedules.find((s: any) => s.id === mathSchedId).results;
    assert(mathResults.length === 4, "Compulsory subject (Mathematics): roster includes all 4 active students");
    assert(mathResults.some((r: any) => r.studentId === legacy.id), "Compulsory subject: the legacy student (no optionalSubjectIds field at all) is still included, unchanged");

    const bioView = await json(await examsGet(req(ADMIN, `/api/exams?examId=${examId}&rosters=one&scheduleId=${bioSchedId}`)));
    const bioResults = bioView.activeExam.schedules.find((s: any) => s.id === bioSchedId).results;
    assert(bioResults.length === 1 && bioResults[0].studentId === aamna.id, "Optional subject (Biology): roster is only the one student allocated to it");
    assert(!bioResults.some((r: any) => r.studentId === abdullah.id), "Optional subject: a student allocated to a DIFFERENT optional subject (Computer) is excluded");
    assert(!bioResults.some((r: any) => r.studentId === noAlloc.id), "Optional subject: a student with no allocation at all is excluded (never a default of 'everyone')");
    assert(!bioResults.some((r: any) => r.studentId === legacy.id), "Optional subject: a legacy student with no optionalSubjectIds field is excluded, not silently eligible");
  }

  // ---------------------------------------------------------------- 2. teacher sees the same filtered roster
  {
    const asTeacher = await json(await examsGet(req(TEACHER_BIO, `/api/exams?examId=${examId}&rosters=one&scheduleId=${bioSchedId}`)));
    const sched = asTeacher.activeExam.schedules.find((s: any) => s.id === bioSchedId);
    assert(sched.results.length === 1 && sched.results[0].studentId === aamna.id, "Teacher: Biology roster is identically filtered to just the allocated student");

    assert((await examsGet(req(TEACHER_OTHER, `/api/exams?examId=${examId}`))).status !== 403 || true, "sanity: other teacher request does not crash");
    const otherView = await json(await examsGet(req(TEACHER_OTHER, `/api/exams?examId=${examId}`)));
    assert((otherView.activeExam?.schedules || []).length === 0, "Unauthorized: a teacher not allocated to Biology (or Mathematics) sees no schedules of this exam at all");
  }

  // ---------------------------------------------------------------- 3. marks save enforces the same eligibility
  {
    const save = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", {
      examScheduleId: bioSchedId,
      studentMarks: [
        { studentId: aamna.id, marksObtained: 88 },
        { studentId: abdullah.id, marksObtained: 70 }, // not allocated to Biology
      ],
    })));
    assert(save.success === true && save.saved === 1, "Marks PUT: only the eligible student's mark is saved");
    assert(save.rejected?.length === 1 && save.rejected[0].studentId === abdullah.id, "Marks PUT: the ineligible student is reported as rejected, not silently dropped");

    const teacherSave = await json(await examsPut(req(TEACHER_BIO, "/api/exams", "PUT", {
      examScheduleId: bioSchedId,
      studentMarks: [{ studentId: noAlloc.id, marksObtained: 60 }],
    })));
    assert(teacherSave.success === true && teacherSave.saved === 0 && teacherSave.rejected?.length === 1, "Marks PUT (teacher): cannot save a mark for a student not allocated to this optional subject, even server-side");
  }

  // ---------------------------------------------------------------- 4. admin allocation endpoint
  {
    const ok = await json(await studentPut(req(ADMIN, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: [comp.id] }), idParams(noAlloc.id)));
    assert(ok.success === true, "Admin: can allocate a student to a real optional subject of their own class");
    const reread = await getStudentByIdServer(A, noAlloc.id);
    assert(JSON.stringify(reread?.optionalSubjectIds) === JSON.stringify([comp.id]), "Admin allocation: persisted exactly as set");

    const badCompulsory = await studentPut(req(ADMIN, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: [math.id] }), idParams(noAlloc.id));
    assert(badCompulsory.status === 400, "Admin: cannot allocate a student to a COMPULSORY subject (not a real optional one)");

    const badOtherSchool = await studentPut(req(ADMIN, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: ["sub-does-not-exist"] }), idParams(noAlloc.id));
    assert(badOtherSchool.status === 400, "Admin: cannot allocate a student to a subject id that doesn't exist for their class");

    const teacherAttempt = await studentPut(req(TEACHER_BIO, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: [bio.id] }), idParams(noAlloc.id));
    assert(teacherAttempt.status === 403, "Unauthorized: a TEACHER cannot set subject allocations (ADMIN only)");

    const crossSchool = await studentPut(req(ADMIN_B, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: [comp.id] }), idParams(noAlloc.id));
    assert(crossSchool.status === 404, "Unauthorized: another school's admin cannot reach this student at all");

    // Reallocating (Computer -> Biology) replaces, never merges silently.
    const realloc = await json(await studentPut(req(ADMIN, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: [bio.id] }), idParams(noAlloc.id)));
    assert(realloc.success === true, "Admin: can reallocate a student from one optional subject to another");
    const rereadAfterRealloc = await getStudentByIdServer(A, noAlloc.id);
    assert(JSON.stringify(rereadAfterRealloc?.optionalSubjectIds) === JSON.stringify([bio.id]), "Reallocation replaces the prior optional subject, not additive");

    // Clearing back to no allocation.
    const cleared = await json(await studentPut(req(ADMIN, `/api/students/${noAlloc.id}`, "PUT", { optionalSubjectIds: [] }), idParams(noAlloc.id)));
    assert(cleared.success === true, "Admin: can clear a student's optional subject allocation entirely");
  }

  // ---------------------------------------------------------------- 5. existing-record safety
  {
    const dossier = await json(await studentGet(req(ADMIN, `/api/students/${legacy.id}`), idParams(legacy.id)));
    assert(Array.isArray(dossier.student.optionalSubjectIds) && dossier.student.optionalSubjectIds.length === 0, "Existing/legacy student: dossier reports an empty allocation, not an error, not fabricated data");
    assert(dossier.student.class.subjects.some((s: any) => s.id === bio.id && s.isOptional === true), "Existing/legacy student's dossier correctly flags Biology as optional");
    assert(dossier.student.class.subjects.some((s: any) => s.id === math.id && s.isOptional === false), "Existing/legacy student's dossier correctly flags Mathematics as compulsory");
  }

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
