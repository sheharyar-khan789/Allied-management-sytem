/**
 * Phase 5 — Exam & Results: class/section recognition correctness and the ability to add an
 * additional (not pre-registered) subject directly while managing an exam, via PATCH /api/exams.
 *
 * Part A exercises validateScheduleImportRows (exam-schedule-import.ts) directly — a pure
 * function, no server needed — covering the exact-match class resolution and a regression test
 * for a numericLevel-collision bug (a non-numeric class name like "Nursery" gets a synthetic
 * fallback numericLevel at creation time that could coincidentally equal a real numbered class's
 * level, previously making an exact, unambiguous label match both classes).
 *
 * Part B exercises the live PATCH /api/exams route: an admin adding a subject to an exam that was
 * never pre-created in Subject Allocation (previously only possible through the bulk date-sheet
 * import, never through the single "Add Subject" dialog).
 */
import { NextRequest } from "next/server";
import { PATCH as examsPatch, POST as examsPost, PUT as examsPut } from "../src/app/api/exams/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveSubjectServer,
  saveStudentServer,
  getSubjectByIdServer,
  getExamResultsServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, StudentDoc, SubjectDoc } from "../src/lib/firebase/types";
import { validateScheduleImportRows } from "../src/lib/exam-schedule-import";
import { summarizeResults, DEFAULT_GRADING_SCALE } from "../src/lib/exam-results";

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

async function run() {
  console.log("==================================================");
  console.log("PHASE 5 — EXAM CLASS RECOGNITION + ADDITIONAL SUBJECTS");
  console.log("==================================================");

  // =========================================================================
  // PART A — CLASS/SECTION RECOGNITION (pure function, no server)
  // =========================================================================

  // A1: "5-A" vs "15-A" — never cross-matched by substring.
  {
    const c5 = { id: "cls-p5-5a", name: "Class 5", section: "A", numericLevel: 5 };
    const c15 = { id: "cls-p5-15a", name: "Class 15", section: "A", numericLevel: 15 };
    const { rows } = validateScheduleImportRows(
      [
        { className: "5-A", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" },
        { className: "15-A", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" },
      ],
      { classes: [c5, c15], subjects: [] }
    );
    assert(rows[0].schedule?.classId === c5.id, 'Class recognition: "5-A" resolves only to Class 5-A, never Class 15-A');
    assert(rows[1].schedule?.classId === c15.id, 'Class recognition: "15-A" resolves only to Class 15-A, never Class 5-A');
  }

  // A2: regression — a non-numeric class name's synthetic numericLevel fallback must never
  // collide with a real numbered class's matching.
  {
    const nursery = { id: "cls-p5-nursery", name: "Nursery", section: "A", numericLevel: 1 }; // synthetic fallback level
    const class1 = { id: "cls-p5-1a", name: "Class 1", section: "A", numericLevel: 1 }; // genuinely level 1
    const { rows } = validateScheduleImportRows(
      [{ className: "1-A", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" }],
      { classes: [nursery, class1], subjects: [] }
    );
    assert(rows[0].status !== "INVALID", 'Class recognition: "1-A" is not rejected as ambiguous just because Nursery\'s synthetic numericLevel happens to also be 1');
    assert(rows[0].schedule?.classId === class1.id, 'Class recognition: "1-A" resolves to the real Class 1-A, never to Nursery');
  }
  {
    // Same scenario, reversed label: typing "Nursery-A" by name must still resolve to Nursery
    // itself (never confused with Class 1, since Nursery's name carries no digits at all).
    const nursery = { id: "cls-p5-nursery2", name: "Nursery", section: "A", numericLevel: 1 };
    const class1 = { id: "cls-p5-1a2", name: "Class 1", section: "A", numericLevel: 1 };
    const { rows } = validateScheduleImportRows(
      [{ className: "Nursery-A", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" }],
      { classes: [nursery, class1], subjects: [] }
    );
    assert(rows[0].schedule?.classId === nursery.id, 'Class recognition: "Nursery-A" resolves to Nursery, not Class 1 (no digit-based collision)');
  }

  // A3: multiple sections of the same grade are distinctly recognized.
  {
    const c9a = { id: "cls-p5-9a", name: "Class 9", section: "A", numericLevel: 9 };
    const c9b = { id: "cls-p5-9b", name: "Class 9", section: "B", numericLevel: 9 };
    const { rows } = validateScheduleImportRows(
      [
        { className: "9-A", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" },
        { className: "9-B", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" },
        { className: "Class 9 B", subjectName: "Science", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" },
      ],
      { classes: [c9a, c9b], subjects: [] }
    );
    assert(rows[0].schedule?.classId === c9a.id, "Class recognition: 9-A resolves to section A");
    assert(rows[1].schedule?.classId === c9b.id, "Class recognition: 9-B resolves to section B, not A");
    assert(rows[2].schedule?.classId === c9b.id, '"Class 9 B" (full name + space-separated section) also resolves correctly to section B');
  }

  // A4: a class added just now (simulating "newly added classes work automatically" — there is
  // no cache or hardcoded list involved; the function is handed the live classes array).
  {
    const freshlyAdded = { id: "cls-p5-fresh", name: "Class 21", section: "C", numericLevel: 21 };
    const { rows } = validateScheduleImportRows(
      [{ className: "21-C", subjectName: "Math", examDate: "2026-12-01", totalMarks: "100", passingMarks: "33" }],
      { classes: [freshlyAdded], subjects: [] }
    );
    assert(rows[0].schedule?.classId === freshlyAdded.id, "Class recognition: a brand-new class (never special-cased anywhere) is recognized immediately");
  }

  // =========================================================================
  // PART B — ADDITIONAL EXAM SUBJECTS (live PATCH /api/exams route)
  // =========================================================================

  const now = new Date().toISOString();
  const A = "school-p5-a";
  const YEAR = "2026-2027";
  await updateSchoolSettingsServer({
    id: A, schoolId: A, schoolName: "School P5", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@p5.edu", principalName: "Principal", academicYear: YEAR,
    gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
  } as any);

  const cls: ClassDoc = { id: "cls-p5-main", schoolId: A, name: "Class 6", section: "A", numericLevel: 6, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(cls);

  const math: SubjectDoc = { id: "sb-p5-math", schoolId: A, classId: cls.id, name: "Mathematics", code: "MAT", credits: 3, teacherId: "tch-p5-1", teacherName: "Mr. Ali", academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveSubjectServer(math);

  const student: StudentDoc = {
    id: "std-p5-1", schoolId: A, admissionNo: "P5-001", fullName: "Hassan Raza", fatherName: "F", gender: "MALE",
    classId: cls.id, section: "A", rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300",
    guardianRelation: "Father", monthlyFee: 2000, discount: 0, academicYear: YEAR, className: "Class 6-A", createdAt: now, updatedAt: now,
  };
  await saveStudentServer(student);

  const ADMIN = await createSessionCookieServer({ uid: "uid-p5-admin", email: "a@p5.edu", role: "ADMIN", schoolId: A, name: "a" });
  const TEACHER = await createSessionCookieServer({ uid: "uid-p5-teacher", email: "t@p5.edu", role: "TEACHER", schoolId: A, name: "t", teacherId: "tch-p5-1" });

  const examRes = await json(await examsPost(req(ADMIN, "/api/exams", "POST", {
    title: "Phase 5 Mid-Term", startDate: "2026-12-01", endDate: "2026-12-20",
  })));
  const examId = examRes.exam.id;

  // B1: adding an EXISTING subject via subjectId behaves exactly as before.
  const mathPatch = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", {
    examId, classId: cls.id, subjectId: math.id, examDate: "2026-12-05", startTime: "09:00", endTime: "10:00", totalMarks: "100", passingMarks: "33",
  })));
  assert(mathPatch.success && mathPatch.schedule.subjectId === math.id, "B1: adding a pre-registered subject by subjectId still works unchanged");
  assert(mathPatch.subjectUnregistered === false, "B1: a pre-registered subject is never reported as unregistered");

  // B2: adding a brand-new subject via subjectName (no subjectId) — the actual feature gap.
  const newSubjPatch = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", {
    examId, classId: cls.id, subjectName: "Special Aptitude Test", examDate: "2026-12-06", startTime: "09:00", endTime: "10:00", totalMarks: "50", passingMarks: "20",
  })));
  assert(newSubjPatch.success === true, "B2: PATCH accepts a brand-new subject name with no subjectId");
  assert(!!newSubjPatch.schedule?.subjectId, "B2: a real, stable subjectId is returned for the new subject (never blank)");
  assert(newSubjPatch.schedule?.subjectName === "Special Aptitude Test", "B2: the schedule carries the exact subject name typed by the admin");
  assert(newSubjPatch.subjectUnregistered === true, "B2: the response flags the new subject as unregistered, so the UI can surface it for later teacher assignment");
  const newSubjectId = newSubjPatch.schedule.subjectId;
  const createdSubject = await getSubjectByIdServer(A, newSubjectId);
  assert(
    !!createdSubject && createdSubject.unregisteredFromImport === true && createdSubject.teacherId == null,
    "B2: a real, permanent SubjectDoc was created, flagged unregistered, with no teacher required"
  );

  // B3: adding a subject whose name matches an existing one (case/whitespace variant) reuses it —
  // never creates a duplicate SubjectDoc.
  const dupPatch = await json(await examsPatch(req(ADMIN, "/api/exams", "PATCH", {
    examId, classId: cls.id, subjectName: "  mathematics  ", examDate: "2026-12-07", startTime: "09:00", endTime: "10:00", totalMarks: "100", passingMarks: "33",
  })));
  assert(dupPatch.schedule?.subjectId === math.id, "B3: a subjectName matching an existing subject (case/whitespace-insensitive) reuses it instead of creating a duplicate");
  assert(dupPatch.subjectUnregistered === false, "B3: the reused existing subject is not flagged unregistered");

  // B4: marks can be entered for the additional subject, and its totals/grade compute correctly.
  const marksRes = await json(await examsPut(req(ADMIN, "/api/exams", "PUT", {
    examScheduleId: newSubjPatch.schedule.id,
    studentMarks: [{ studentId: student.id, marksObtained: 45 }],
  })));
  assert(marksRes.success === true && marksRes.saved === 1, "B4: marks can be entered for the additional subject");

  // B5: the additional subject's result is included correctly in the student's overall totals,
  // alongside the pre-registered subject's own result, with no double-counting.
  await examsPut(req(ADMIN, "/api/exams", "PUT", {
    examScheduleId: mathPatch.schedule.id,
    studentMarks: [{ studentId: student.id, marksObtained: 80 }],
  }));
  const allResults = await getExamResultsServer(A, examId, cls.id, student.id, { allSessions: true });
  const studentResults = allResults.filter((r) => r.studentId === student.id);
  assert(studentResults.length === 2, "B5: exactly two results exist for this student in this exam (Mathematics + the additional subject), not merged or duplicated");
  const summary = summarizeResults(studentResults, DEFAULT_GRADING_SCALE);
  assert(summary.totalMarks === 100 + 50, "B5: overall total marks correctly sum both subjects (100 + 50 = 150)");
  assert(summary.obtainedMarks === 80 + 45, "B5: overall obtained marks correctly sum both subjects (80 + 45 = 125)");
  assert(Math.abs(summary.percentage - (125 / 150) * 100) < 0.1, "B5: overall percentage is computed correctly across both subjects");

  // B6: neither subjectId nor subjectName -> rejected, not silently skipped.
  const missingRes = await examsPatch(req(ADMIN, "/api/exams", "PATCH", {
    examId, classId: cls.id, examDate: "2026-12-08", startTime: "09:00", endTime: "10:00", totalMarks: "50", passingMarks: "20",
  }));
  assert(missingRes.status === 400, "B6: a schedule request with no subject at all (neither id nor name) is rejected");

  // B7: a stale/tampered subjectId that doesn't resolve, with no subjectName fallback, is a
  // genuine not-found — never silently creates an unrelated subject under a guessed name.
  const staleRes = await examsPatch(req(ADMIN, "/api/exams", "PATCH", {
    examId, classId: cls.id, subjectId: "sb-does-not-exist", examDate: "2026-12-09", startTime: "09:00", endTime: "10:00", totalMarks: "50", passingMarks: "20",
  }));
  assert(staleRes.status === 404, "B7: a subjectId that doesn't resolve to any real subject, with no subjectName given, is rejected as not-found");

  // B8: existing subject allocation (the pre-registered Mathematics subject) is completely
  // unaffected by all of the additional-subject activity above.
  const mathAfter = await getSubjectByIdServer(A, math.id);
  assert(
    mathAfter?.teacherId === math.teacherId && mathAfter?.name === "Mathematics" && !mathAfter?.unregisteredFromImport,
    "B8: the pre-existing registered subject's allocation (name, teacher, registration flag) is completely unchanged"
  );

  // B9: only ADMIN can add/manage exam subjects — a TEACHER is rejected server-side.
  const teacherRes = await examsPatch(req(TEACHER, "/api/exams", "PATCH", {
    examId, classId: cls.id, subjectName: "Teacher Attempt", examDate: "2026-12-10", startTime: "09:00", endTime: "10:00", totalMarks: "50", passingMarks: "20",
  }));
  assert(teacherRes.status === 403, "B9: a TEACHER cannot add or manage exam subjects — ADMIN only");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
