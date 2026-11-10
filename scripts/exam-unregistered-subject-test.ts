/**
 * Exam date-sheet import: unregistered/temporary subjects are accepted instead of rejected.
 * Covers: new-subject auto-creation (no teacher required), mixed registered+unregistered
 * batches, in-file duplicate protection for unregistered subjects, invalid rows never blocking
 * otherwise-valid rows, editing/teacher-assignment after upload, linking an unregistered
 * subject into an existing one, and that none of this disturbs already-registered subjects or
 * already-recorded marks. Runs against the in-memory store (tsx does not load .env.local).
 */
import { NextRequest } from "next/server";
import { POST as previewPost } from "../src/app/api/exams/schedule-import/route";
import { POST as examsPost } from "../src/app/api/exams/route";
import { PUT as subjectsPut } from "../src/app/api/subjects/route";
import { POST as subjectsLinkPost } from "../src/app/api/subjects/link/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  getSubjectByIdServer,
  getTeacherByIdServer,
  getExamSchedulesServer,
  getExamResultsServer,
  commitExamResultsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc, ExamResultDoc } from "../src/lib/firebase/types";
import { EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS } from "../src/lib/exam-schedule-import";

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

function uploadReq(token: string | null, content: string) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "schedule.csv");
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest("http://x/api/exams/schedule-import", { method: "POST", headers, body: fd });
}

function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("EXAM IMPORT: UNREGISTERED / TEMPORARY SUBJECTS");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-unreg-a";
  const B = "school-unreg-b";
  const YEAR = "2026-2027";

  const c9a: ClassDoc = { id: "cls-unreg-9a", schoolId: A, name: "Class 9", section: "A", numericLevel: 9, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(c9a);

  const math9: SubjectDoc = { id: "sub-unreg-math9", schoolId: A, classId: c9a.id, name: "Mathematics", code: "MAT", credits: 3, teacherId: "tch-unreg-1", teacherName: "Mr. Khan", academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveSubjectServer(math9);
  // Registered, but never scheduled in the exam built below — the clean target for linking.
  const civics9: SubjectDoc = { id: "sub-unreg-civics9", schoolId: A, classId: c9a.id, name: "Civics", code: "CIV", credits: 2, teacherId: null, teacherName: "Unassigned", academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveSubjectServer(civics9);

  const teacher: TeacherDoc = {
    id: "tch-unreg-1", schoolId: A, employeeId: "EMP-1", fullName: "Mr. Khan", email: "khan@unreg.edu", phone: "0300", designation: "Teacher", department: "Science", qualification: "MSc", status: "ACTIVE", assignedClassIds: [c9a.id], assignedSubjectIds: [math9.id], weeklyLoad: 10, createdAt: now, updatedAt: now,
  };
  await saveTeacherServer(teacher);

  const ADMIN = await createSessionCookieServer({ uid: "u-unreg-admin", email: "admin@unreg.edu", role: "ADMIN", schoolId: A, name: "Admin" });
  const TEACHER_TOKEN = await createSessionCookieServer({ uid: "u-unreg-teacher", email: "t@unreg.edu", role: "TEACHER", schoolId: A, name: "Teacher", teacherId: teacher.id });
  const ADMIN_B = await createSessionCookieServer({ uid: "u-unreg-admin-b", email: "admin@b.edu", role: "ADMIN", schoolId: B, name: "Admin B" });

  // A real, pre-existing result for the registered subject — must survive every step untouched.
  const preExistingResult: ExamResultDoc = {
    id: `${A}_exam-preexisting_std-1_${math9.id}`,
    schoolId: A, examId: "exam-preexisting", studentId: "std-1", studentName: "Pre-existing Student", classId: c9a.id,
    subjectId: math9.id, subjectName: math9.name, obtainedMarks: 88, totalMarks: 100, percentage: 88, grade: "A", gpa: 3.7, status: "PASS",
    evaluatedBy: "u-unreg-admin", createdAt: now, updatedAt: now,
  };
  await commitExamResultsServer(A, [preExistingResult]);

  // ---------------------------------------------------------------- 1-6: mixed batch (registered + unregistered + genuinely invalid)
  let examId = "";
  let scheduleIds: { math: string; special: string; drama: string } | null = null;
  {
    const csv = csvOf([
      EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS,
      ["9-A", "Mathematics", "2026-12-01", "", "", "100", "33"], // registered subject
      ["9-A", "Special Aptitude Test", "2026-12-02", "", "", "50", "20"], // unregistered/temporary, no teacher
      ["9-A", "Drama", "2026-12-03", "", "", "60", "25"], // another unregistered subject
      ["9-A", "Drama", "2026-12-04", "", "", "60", "25"], // duplicate unregistered subject in the same file
      ["9-A", "Music", "", "", "", "60", "25"], // genuinely invalid: missing exam date
    ]);
    const previewRes = await previewPost(uploadReq(ADMIN, csv));
    const previewBody = await json(previewRes);
    const rows = previewBody.rows;

    assert(rows[0].status === "VALID" && rows[0].schedule.subjectId === math9.id, "1. Existing registered subject stays VALID and keeps its real subjectId");
    assert(rows[1].status === "WARNING" && rows[1].schedule.subjectId === "" && rows[1].schedule.subjectName === "Special Aptitude Test", "2+3. Unregistered/temporary subject is a WARNING, importable, no teacher required");
    assert(rows[2].status === "WARNING" && rows[2].schedule.subjectName === "Drama", "5. A second, different unregistered subject in the same file is independently accepted");
    assert(rows[3].status === "DUPLICATE", "14. A second row for the SAME unregistered subject in one file is caught as a duplicate, not silently created twice");
    assert(rows[4].status === "INVALID" && rows[4].errors.some((e: string) => /exam date/i.test(e)), "7a. A genuinely invalid row (missing exam date) is still rejected on its own merits");

    // Only the importable rows (VALID/WARNING, excluding the duplicate) are sent — exactly what
    // the real UI does (ExamScheduleImportModal only sends rows the admin left checked).
    const schedules = [rows[0], rows[1], rows[2]].map((r: any) => ({
      classId: r.schedule.classId,
      subjectId: r.schedule.subjectId || undefined,
      subjectName: r.schedule.subjectName,
      examDate: r.schedule.examDate,
      startTime: r.schedule.startTime,
      endTime: r.schedule.endTime,
      totalMarks: r.schedule.totalMarks,
      passingMarks: r.schedule.passingMarks,
    }));

    const commitRes = await examsPost(req(ADMIN, "/api/exams", "POST", {
      title: "Mixed Subjects Exam", startDate: "2026-12-01", endDate: "2026-12-20", schedules,
    }));
    const commitBody = await json(commitRes);
    assert(commitRes.status === 201 && commitBody.schedulesCreated === 3, "6+7b. Valid rows are accepted together even though one other row in the same upload had a genuine error");
    examId = commitBody.exam.id;

    const savedSchedules = await getExamSchedulesServer(A, examId);
    const mathSched = savedSchedules.find((s) => s.subjectId === math9.id);
    const specialSched = savedSchedules.find((s) => s.subjectName === "Special Aptitude Test");
    const dramaSched = savedSchedules.find((s) => s.subjectName === "Drama");
    assert(!!mathSched && !!specialSched && !!dramaSched, "Commit: all three schedules (one registered, two unregistered) were written");
    scheduleIds = { math: mathSched!.id, special: specialSched!.id, drama: dramaSched!.id };

    assert(!!specialSched!.subjectId && specialSched!.subjectId !== "", "Unregistered schedule references a real, stable subjectId (never blank) once committed");
    const specialSubject = await getSubjectByIdServer(A, specialSched!.subjectId);
    assert(
      !!specialSubject && specialSubject.unregisteredFromImport === true && specialSubject.teacherId == null && specialSubject.name === "Special Aptitude Test",
      "8. Subject name preserved exactly; auto-created subject is flagged unregistered with no teacher assigned"
    );

    const dramaSubject = await getSubjectByIdServer(A, dramaSched!.subjectId);
    assert(dramaSubject?.id !== specialSubject?.id, "Two different unregistered subject names create two distinct subject records, never merged by accident");

    // 12+13: the pre-existing registered subject and its historical result are untouched.
    const mathAfter = await getSubjectByIdServer(A, math9.id);
    assert(
      mathAfter?.teacherId === math9.teacherId && mathAfter?.name === math9.name && !mathAfter?.unregisteredFromImport,
      "12. Existing (already registered) subject allocation is completely unchanged"
    );
    const resultsAfter = await getExamResultsServer(A, undefined, undefined, undefined, { allSessions: true });
    const stillThere = resultsAfter.find((r) => r.id === preExistingResult.id);
    assert(stillThere?.obtainedMarks === 88 && stillThere?.grade === "A", "13. Pre-existing exam result remains exactly as it was, untouched by the import");
  }

  // ---------------------------------------------------------------- 9-10: admin can edit name + assign a teacher later
  let specialSubjectId = "";
  {
    const specialId = scheduleIds!.special; // not used directly; re-derive subjectId via schedule
    const schedules = await getExamSchedulesServer(A, examId);
    const specialSched = schedules.find((s) => s.id === specialId)!;
    specialSubjectId = specialSched.subjectId;
    const putRes = await subjectsPut(req(ADMIN, "/api/subjects", "PUT", {
      id: specialSched.subjectId,
      name: "Aptitude & Reasoning Test",
      teacherId: teacher.id,
    }));
    const putBody = await json(putRes);
    assert(putRes.status === 200, "9+10. Admin can edit an unregistered subject's name and assign a teacher in one update");

    const updatedSubject = await getSubjectByIdServer(A, specialSched.subjectId);
    assert(
      updatedSubject?.name === "Aptitude & Reasoning Test" && updatedSubject?.teacherId === teacher.id && updatedSubject?.unregisteredFromImport === false,
      "9+10. Rename + teacher assignment persisted and the subject is no longer flagged unregistered (it's now \"registered\")"
    );
    const teacherAfter = await getTeacherByIdServer(A, teacher.id);
    assert(teacherAfter?.assignedSubjectIds.includes(specialSched.subjectId), "10. Two-way sync: the teacher's own assigned-subjects list now includes it too");
  }

  // ---------------------------------------------------------------- 11: link an unregistered subject into an existing one
  {
    // Linking INTO a subject that already has its own schedule in the same exam must be refused
    // (merging two schedules into one would silently pick a winner) — checked first so the happy
    // path below is proven against a target that has no conflicting schedule.
    const schedules = await getExamSchedulesServer(A, examId);
    const dramaSched = schedules.find((s) => s.id === scheduleIds!.drama)!;
    const dramaSubjectId = dramaSched.subjectId;

    const conflictRes = await subjectsLinkPost(req(ADMIN, "/api/subjects/link", "POST", { subjectId: dramaSubjectId, targetSubjectId: math9.id }));
    assert(conflictRes.status === 409, "11a. Linking into a subject that already has its own schedule in the same exam is refused, not silently merged");

    // civics9 is registered but has no schedule anywhere yet — a clean target.
    const linkRes = await subjectsLinkPost(req(ADMIN, "/api/subjects/link", "POST", { subjectId: dramaSubjectId, targetSubjectId: civics9.id }));
    const linkBody = await json(linkRes);
    assert(linkRes.status === 200 && linkBody.mergedSchedules === 1, "11. Linking an unregistered subject into an existing one succeeds and reports the migrated schedule");

    const afterSchedules = await getExamSchedulesServer(A, examId);
    assert(!afterSchedules.some((s) => s.id === dramaSched.id), "11. The old schedule under the unregistered subject's id no longer exists");
    const migratedSched = afterSchedules.find((s) => s.subjectId === civics9.id && s.examDate === dramaSched.examDate);
    assert(!!migratedSched && migratedSched.totalMarks === dramaSched.totalMarks, "11. A new schedule exists under the target subject, carrying over the same exam details");
    const deletedSubject = await getSubjectByIdServer(A, dramaSubjectId);
    assert(deletedSubject === null, "11. The now-empty unregistered subject itself was removed, not left as an orphan");
  }

  // ---------------------------------------------------------------- linking safety rails
  {
    // Cannot link a subject that already has recorded marks.
    const schedules = await getExamSchedulesServer(A, examId);
    const mathSched = schedules.find((s) => s.subjectId === math9.id && s.examDate === "2026-12-01")!;
    await commitExamResultsServer(A, [{
      id: `${A}_${examId}_std-2_${math9.id}`, schoolId: A, examId, studentId: "std-2", classId: c9a.id, subjectId: math9.id,
      scheduleId: mathSched.id, obtainedMarks: 70, totalMarks: 100, percentage: 70, grade: "B", gpa: 3.0, status: "PASS",
      evaluatedBy: "u-unreg-admin", createdAt: now, updatedAt: now,
    }]);
    // math9 is a real registered subject (never flagged unregistered) -> link must be refused regardless of results.
    const blockedRes = await subjectsLinkPost(req(ADMIN, "/api/subjects/link", "POST", { subjectId: math9.id, targetSubjectId: specialSubjectId }));
    assert(blockedRes.status === 400, "Linking safety: a real registered subject (not unregistered-from-import) can never be used as the source");

    // Cross-school: school B cannot touch school A's subjects at all.
    const crossRes = await subjectsLinkPost(req(ADMIN_B, "/api/subjects/link", "POST", { subjectId: math9.id, targetSubjectId: math9.id + "-x" }));
    assert(crossRes.status === 404, "15. Cross-school subject access via the link endpoint is rejected (404, not found for that school)");
  }

  // ---------------------------------------------------------------- 16: unauthorized users
  {
    const teacherPreviewRes = await previewPost(uploadReq(TEACHER_TOKEN, csvOf([EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS, ["9-A", "Mathematics", "2026-12-01", "", "", "100", "33"]])));
    assert(teacherPreviewRes.status === 403, "16. A teacher cannot upload/preview an exam date sheet");

    const teacherLinkRes = await subjectsLinkPost(req(TEACHER_TOKEN, "/api/subjects/link", "POST", { subjectId: math9.id, targetSubjectId: math9.id }));
    assert(teacherLinkRes.status === 403, "16. A teacher cannot link/modify subject records");

    const anonRes = await subjectsLinkPost(req(null, "/api/subjects/link", "POST", { subjectId: math9.id, targetSubjectId: math9.id }));
    assert(anonRes.status === 401, "16. An unauthenticated request is rejected");
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
