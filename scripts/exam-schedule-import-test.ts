/**
 * Exam schedule bulk CSV import (`/api/exams/schedule-import` preview, committed through the
 * existing `POST /api/exams` `schedules` array): header mapping, class/subject name matching
 * (never ambiguous, never guessed), default 09:00/11:00 start/end times with explicit overrides
 * honoured, marks validation, duplicate class+subject detection within one file, and the exam +
 * all its schedules being created together.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { POST as previewPost } from "../src/app/api/exams/schedule-import/route";
import { POST as examsPost } from "../src/app/api/exams/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveSubjectServer, getExamSchedulesServer, getExamsServer } from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc } from "../src/lib/firebase/types";
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

function uploadReq(token: string | null, content: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "schedule.csv");
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
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
  console.log("EXAM SCHEDULE BULK IMPORT");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-eimp-a";
  const B = "school-eimp-b";
  const YEAR = "2026-2027";

  const cls = (id: string, schoolId: string, name: string, section: string, numericLevel: number): ClassDoc => ({
    id, schoolId, name, section, numericLevel, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const c9a = cls("cls-eimp-9a", A, "Class 9", "A", 9);
  const c10a = cls("cls-eimp-10a", A, "Class 10", "A", 10);
  const cB = cls("cls-eimp-b", B, "Class 9", "A", 9);
  await saveClassServer(c9a);
  await saveClassServer(c10a);
  await saveClassServer(cB);

  const subj = (id: string, schoolId: string, classId: string, name: string): SubjectDoc => ({
    id, schoolId, classId, name, code: name.slice(0, 3).toUpperCase(), credits: 1, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const math9 = subj("sub-eimp-math9", A, c9a.id, "Mathematics");
  const eng9 = subj("sub-eimp-eng9", A, c9a.id, "English");
  const sci9 = subj("sub-eimp-sci9", A, c9a.id, "Science");
  const math10 = subj("sub-eimp-math10", A, c10a.id, "Mathematics");
  const eng10 = subj("sub-eimp-eng10", A, c10a.id, "English");
  await saveSubjectServer(math9);
  await saveSubjectServer(eng9);
  await saveSubjectServer(sci9);
  await saveSubjectServer(math10);
  await saveSubjectServer(eng10);

  const ADMIN = await createSessionCookieServer({ uid: "u-eimp-admin", email: "admin@eimp.edu", role: "ADMIN", schoolId: A, name: "Admin" });
  const TEACHER = await createSessionCookieServer({ uid: "u-eimp-teacher", email: "t@eimp.edu", role: "TEACHER", schoolId: A, name: "Teacher", teacherId: "tch-eimp-1" });
  const ADMIN_B = await createSessionCookieServer({ uid: "u-eimp-admin-b", email: "admin@b.edu", role: "ADMIN", schoolId: B, name: "Admin B" });

  // ---------------------------------------------------------------- 1. template headers + required columns
  {
    const missing = await previewPost(uploadReq(ADMIN, csvOf([["Class", "Subject Name"], ["9-A", "Mathematics"]])));
    assert(missing.status === 400, "Preview: missing required columns (Exam Date, Total Marks, Passing Marks) rejected");
    assert(EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS.length === 7, "Template header has all 7 columns");
  }

  // ---------------------------------------------------------------- 2. class/subject matching
  {
    const csv = csvOf([
      EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS,
      ["9-A", "Mathematics", "2026-12-01", "", "", "100", "33"], // valid, default times
      ["9-A", "English", "2026-12-02", "11:00 AM", "1:00 PM", "80", "30"], // valid, explicit AM/PM times
      ["9-Z", "Mathematics", "2026-12-03", "", "", "100", "33"], // unknown class
      ["9-A", "Biology", "2026-12-04", "", "", "100", "33"], // unknown subject for that class
      ["Class 9", "Science", "2026-12-05", "", "", "80", "30"], // "Class 9" alone, a subject not used by any other row here so it's not a duplicate
    ]);
    const res = await previewPost(uploadReq(ADMIN, csv));
    const body = await json(res);
    assert(res.status === 200 && body.success, "Preview: parses a valid file");
    const rows = body.rows;
    assert(rows[0].status === "VALID" && rows[0].schedule.startTime === "09:00" && rows[0].schedule.endTime === "11:00", "Preview: blank times default to 09:00-11:00");
    assert(rows[1].status === "VALID" && rows[1].schedule.startTime === "11:00" && rows[1].schedule.endTime === "13:00", "Preview: explicit AM/PM times are honoured and normalised to 24h");
    assert(rows[2].status === "INVALID" && rows[2].errors.some((e: string) => /no class found/i.test(e)), "Preview: unknown class reported, never guessed");
    assert(rows[3].status === "INVALID" && rows[3].errors.some((e: string) => /no subject/i.test(e)), "Preview: unknown subject for that class reported");
    assert(rows[4].status === "VALID" && rows[4].schedule.classId === c9a.id, "Preview: 'Class 9' alone resolves to the one matching class/section");
  }

  // ---------------------------------------------------------------- 3. marks + duplicate + time validation
  {
    const csv = csvOf([
      EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS,
      ["9-A", "Mathematics", "2026-12-01", "", "", "100", "33"],
      ["9-A", "Mathematics", "2026-12-06", "", "", "100", "33"], // duplicate class+subject within this file
      ["9-A", "English", "2026-12-02", "", "", "", "30"], // missing total marks
      ["10-A", "Mathematics", "2026-12-02", "", "", "50", "60"], // passing > total (distinct class+subject)
      ["10-A", "English", "2026-12-02", "14:00", "13:00", "100", "33"], // end before start (distinct class+subject)
    ]);
    const res = await previewPost(uploadReq(ADMIN, csv));
    const body = await json(res);
    const rows = body.rows;
    assert(rows[0].status === "VALID", "Preview: first occurrence of Class 9-A Mathematics is valid");
    assert(rows[1].status === "DUPLICATE", "Preview: second occurrence of the same class+subject in one file is a duplicate");
    assert(rows[2].status === "INVALID" && rows[2].errors.some((e: string) => /total marks/i.test(e)), "Preview: missing Total Marks rejected");
    assert(rows[3].status === "INVALID" && rows[3].errors.some((e: string) => /passing marks/i.test(e)), "Preview: Passing Marks exceeding Total Marks rejected");
    assert(rows[4].status === "INVALID" && rows[4].errors.some((e: string) => /ending time/i.test(e)), "Preview: Ending Time before Starting Time rejected");
  }

  // ---------------------------------------------------------------- 4. tenancy + role
  {
    const csv = csvOf([EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS, ["9-A", "Mathematics", "2026-12-01", "", "", "100", "33"]]);
    assert((await previewPost(uploadReq(TEACHER, csv))).status === 403, "Preview: a teacher cannot bulk-import exam schedules");
    const bRes = await previewPost(uploadReq(ADMIN_B, csv));
    const bBody = await json(bRes);
    assert(bBody.rows[0].status === "INVALID", "Preview: school A's class/subject is not visible to school B's admin");
  }

  // ---------------------------------------------------------------- 5. end-to-end: preview -> commit creates exam + schedules
  {
    const csv = csvOf([
      EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS,
      ["9-A", "Mathematics", "2026-12-10", "", "", "100", "33"],
      ["9-A", "English", "2026-12-11", "11:30", "13:00", "80", "30"],
      ["10-A", "Mathematics", "2026-12-12", "", "", "100", "40"],
    ]);
    const previewRes = await previewPost(uploadReq(ADMIN, csv, { examStartDate: "2026-12-01", examEndDate: "2026-12-20" }));
    const previewBody = await json(previewRes);
    assert(previewBody.summary.valid === 3, "Preview: all 3 rows of the end-to-end file are valid");

    const schedules = previewBody.rows.map((r: any) => ({
      classId: r.schedule.classId,
      subjectId: r.schedule.subjectId,
      examDate: r.schedule.examDate,
      startTime: r.schedule.startTime,
      endTime: r.schedule.endTime,
      totalMarks: r.schedule.totalMarks,
      passingMarks: r.schedule.passingMarks,
    }));
    const commitRes = await examsPost(req(ADMIN, "/api/exams", "POST", {
      title: "First Term Examination 2026",
      term: "First Term",
      category: "FIRST_TERM",
      startDate: "2026-12-01",
      endDate: "2026-12-20",
      schedules,
    }));
    const commitBody = await json(commitRes);
    assert(commitRes.status === 201 && commitBody.schedulesCreated === 3, "Commit: the exam and all 3 schedules are created in one call");

    const examId = commitBody.exam.id;
    const savedSchedules = await getExamSchedulesServer(A, examId);
    assert(savedSchedules.length === 3, "Commit: 3 real exam schedules were written");
    const mathSched = savedSchedules.find((s) => s.subjectId === math9.id);
    assert(mathSched?.examDate === "2026-12-10" && mathSched.startTime === "09:00" && mathSched.totalMarks === 100, "Commit: Mathematics 9-A schedule stored with defaulted times");
    const engSched = savedSchedules.find((s) => s.subjectId === eng9.id);
    assert(engSched?.startTime === "11:30" && engSched.endTime === "13:00", "Commit: English 9-A schedule stored with its explicit alternate times");

    const exams = await getExamsServer(A);
    assert(exams.some((e) => e.id === examId && e.name === "First Term Examination 2026" && e.category === "FIRST_TERM"), "Commit: the exam itself carries the title/category from the details step");
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
