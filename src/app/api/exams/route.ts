import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getExamsServer,
  saveExamServer,
  getExamSchedulesServer,
  getExamScheduleByIdServer,
  saveExamScheduleServer,
  getExamResultsServer,
  commitExamResultsServer,
  deleteExamServer,
  deleteExamScheduleServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer,
  getStudentsServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { ExamCategory, ExamDoc, ExamResultDoc, ExamScheduleDoc } from "@/lib/firebase/types";
import { assertTeacherOwnsClass, requireTeacherAllocation } from "@/lib/academic-access";
import { validateDateString } from "@/lib/date-utils";
import { z } from "zod";
import { idString, parseJsonBody, safeUrl } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import {
  computeSubjectResult,
  EXAM_CATEGORIES,
  resolveGradingScale,
  resolveTeacherMarksPermission,
  validateObtainedMarks,
} from "@/lib/exam-results";
import { deleteFileFromStorage, storagePathFromDownloadUrl } from "@/lib/storage";

const EXAM_STATUSES = ["UPCOMING", "ONGOING", "COMPLETED", "PUBLISHED"] as const;

const examUpdateSchema = z.union([
  // Exam cycle metadata (ADMIN only).
  z.object({
    examId: idString,
    examScheduleId: z.undefined().optional(),
    title: z.string().trim().min(1).max(160).optional(),
    term: z.string().trim().max(80).optional(),
    category: z.enum(EXAM_CATEGORIES as [ExamCategory, ...ExamCategory[]]).optional().nullable(),
    startDate: z.string().trim().max(10).optional(),
    endDate: z.string().trim().max(10).optional(),
    status: z.enum(EXAM_STATUSES).optional(),
    resultSheetUrl: safeUrl.optional().nullable(),
  }),
  // Marks entry for one schedule (ADMIN, or the TEACHER allocated that subject).
  // marksObtained null = "no mark recorded": an existing mark is removed, none is created.
  z.object({
    examScheduleId: idString,
    studentMarks: z
      .array(
        z.object({
          studentId: idString,
          marksObtained: z.number().finite().nullable(),
          remarks: z.string().trim().max(500).optional(),
          cardUrl: safeUrl.optional(),
        })
      )
      .max(1000),
  }),
]);

function splitName(fullName: string) {
  const parts = (fullName || "").trim().split(/\s+/);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Deterministic id of one student's result in one subject of one exam (one doc, never duplicated). */
const resultIdFor = (schoolId: string, examId: string, studentId: string, subjectId: string) =>
  `${schoolId}_${examId}_${studentId}_${subjectId}`;

/** Results recorded against a schedule: by scheduleId, or (older records) by exam+class+subject. */
async function resultsForSchedule(schoolId: string, schedule: ExamScheduleDoc): Promise<ExamResultDoc[]> {
  const results = await getExamResultsServer(schoolId, schedule.examId, schedule.classId, undefined, { allSessions: true });
  return results.filter((r) => r.scheduleId === schedule.id || r.subjectId === schedule.subjectId);
}

export async function GET(req: NextRequest) {
  try {
    // Only ADMIN/TEACHER ever call this route from the UI (admin/exams, teacher/gradebook).
    // It previously accepted any authenticated role and returned every class's full roster
    // and marks with no filtering — a STUDENT or PARENT session could call it directly and
    // read other students' grades. Restricted to the roles that actually use it.
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const examId = searchParams.get("examId");
    // rosters=one: build the roster + marks only for `scheduleId` (default: the first schedule);
    // the other schedules come back with results: null and are fetched when selected. Without
    // it (older clients) every schedule's roster is built, as before.
    const oneRoster = searchParams.get("rosters") === "one";
    const requestedScheduleId = searchParams.get("scheduleId");

    // A TEACHER only ever sees schedules/results for subjects allocated to them — resolved
    // from the authenticated session, never from a client-supplied value. Fails closed.
    const allocation = authUser.role === "TEACHER" ? await requireTeacherAllocation(authUser) : null;

    const [exams, settings] = await Promise.all([
      getExamsServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);
    const gradingScale = resolveGradingScale(settings);

    const activeExam = examId ? exams.find((e) => e.id === examId) : exams[0];
    if (examId && !activeExam) return jsonError("Exam not found for this school.", 404);

    const realSchedules = activeExam
      ? await getExamSchedulesServer(authUser.schoolId, activeExam.id)
      : [];

    const visibleSchedules = (allocation
      ? realSchedules.filter((s) => allocation.subjectIds.has(s.subjectId) && allocation.classIds.has(s.classId))
      : realSchedules
    ).sort((a, b) => (a.examDate || "").localeCompare(b.examDate || "") || (a.startTime || "").localeCompare(b.startTime || ""));

    const [classes, subjects] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
    ]);

    // A class's roster and marks are read once and shared by all of its subject schedules.
    const classData = new Map<string, ReturnType<typeof loadClassData>>();
    const loadClassData = (classId: string) =>
      Promise.all([
        getStudentsServer(authUser.schoolId, classId, undefined, undefined, "ACTIVE"),
        getExamResultsServer(authUser.schoolId, activeExam!.id, classId, undefined, { allSessions: true }),
      ]);
    const classDataFor = (classId: string) => {
      let p = classData.get(classId);
      if (!p) classData.set(classId, (p = loadClassData(classId)));
      return p;
    };
    const rosterScheduleId = oneRoster
      ? (visibleSchedules.find((s) => s.id === requestedScheduleId) || visibleSchedules[0])?.id
      : null;

    const schedulesFormatted = await Promise.all(
      visibleSchedules.map(async (sched) => {
        const cls = classes.find((c) => c.id === sched.classId);
        const subject = subjects.find((s) => s.id === sched.subjectId);
        const header = {
          id: sched.id,
          examDate: sched.examDate,
          startTime: sched.startTime,
          endTime: sched.endTime,
          roomNo: sched.roomNo || "",
          maxMarks: sched.totalMarks,
          passingMarks: sched.passingMarks,
          classId: sched.classId,
          subjectId: sched.subjectId,
          class: cls ? { id: cls.id, name: cls.name, section: cls.section } : null,
          subject: subject
            ? { id: subject.id, name: subject.name, code: subject.code }
            : { id: sched.subjectId, name: sched.subjectName || "Subject removed", code: "" },
        };
        if (oneRoster && sched.id !== rosterScheduleId) return { ...header, results: null };

        const [classStudents, existingResults] = await classDataFor(sched.classId);
        const resultsByStudent = new Map(
          existingResults
            .filter((r) => r.scheduleId === sched.id || r.subjectId === sched.subjectId)
            .map((r) => [r.studentId, r])
        );

        const results = classStudents
          .slice()
          .sort((a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true }))
          .map((st) => {
            const existing = resultsByStudent.get(st.id);
            const { firstName, lastName } = splitName(st.fullName);
            return {
              studentId: st.id,
              student: {
                firstName,
                lastName,
                fullName: st.fullName,
                rollNumber: st.rollNo,
                admissionNumber: st.admissionNo,
              },
              // A student with no saved mark is "not recorded" (null), never a silent 0.
              recorded: Boolean(existing),
              marksObtained: existing ? existing.obtainedMarks : null,
              maxMarks: sched.totalMarks,
              percentage: existing ? existing.percentage : null,
              grade: existing?.grade ?? null,
              gpa: typeof existing?.gpa === "number" ? existing.gpa : null,
              status: existing?.status ?? null,
              remarks: existing?.remarks ?? "",
              cardUrl: existing?.cardUrl || undefined,
              updatedAt: existing?.updatedAt || null,
            };
          });

        return { ...header, results };
      })
    );

    const formatExam = (e: ExamDoc) => ({
      id: e.id,
      title: e.name,
      term: e.term,
      category: e.category || undefined,
      session: e.session,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      resultSheetUrl: e.resultSheetUrl || undefined,
      // Resolved so the UI can show/disable marks entry correctly without a second request —
      // the actual enforcement is still server-side in PUT (marks), this is display only.
      teacherMarksPermission: resolveTeacherMarksPermission(e.category, settings),
    });

    return NextResponse.json({
      success: true,
      exams: exams.map((e) => ({
        ...formatExam(e),
        schedulesCount: e.id === activeExam?.id ? schedulesFormatted.length : undefined,
      })),
      activeExam: activeExam ? { ...formatExam(activeExam), schedules: schedulesFormatted } : null,
      gradingScale,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/exams");
    if (busy) return busy;
    console.error("Exams GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve examination records." },
      { status: 500 }
    );
  }
}

/** Validated max/passing marks of a schedule; an error string when they are invalid. */
function resolveScheduleMarks(totalMarks: unknown, passingMarks: unknown): { total: number; passing: number } | string {
  const total = totalMarks === undefined || totalMarks === "" ? 100 : Number(totalMarks);
  const passing = passingMarks === undefined || passingMarks === "" ? 33 : Number(passingMarks);
  if (!Number.isFinite(total) || total <= 0 || total > 100_000) return "Maximum marks must be a positive number.";
  if (!Number.isFinite(passing) || passing < 0) return "Passing marks must be zero or more.";
  if (passing > total) return "Passing marks cannot be greater than maximum marks.";
  return { total, passing };
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { title, term, category, startDate, endDate, schedules, resultSheetUrl } = body;

    if (!title || typeof title !== "string" || !title.trim() || !startDate || !endDate) {
      return jsonError("Title, start date, and end date are required.", 400);
    }
    if (title.length > 160 || (term !== undefined && (typeof term !== "string" || term.length > 80))) {
      return jsonError("Title max 160 and term max 80 characters.", 400);
    }
    if (category !== undefined && category !== null && category !== "" && !EXAM_CATEGORIES.includes(category)) {
      return jsonError(`category must be one of: ${EXAM_CATEGORIES.join(", ")}.`, 400);
    }
    if (resultSheetUrl && !safeUrl.safeParse(resultSheetUrl).success) {
      return jsonError("resultSheetUrl must be an https:// URL.", 400);
    }
    // Strict calendar validation: `new Date()` silently rolls 2026-02-31 over to March 3rd.
    const examStart = validateDateString(startDate);
    const examEnd = validateDateString(endDate);
    if (!examStart || !examEnd) {
      return jsonError("startDate/endDate must be valid dates.", 400);
    }
    if (examEnd < examStart) {
      return jsonError("endDate cannot be before startDate.", 400);
    }

    const settings = await getSchoolSettingsServer(authUser.schoolId);
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const examId = `exam-${uniqueSuffix}`;
    const now = new Date().toISOString();
    const examDoc: ExamDoc = {
      id: examId,
      schoolId: authUser.schoolId,
      name: title.trim(),
      term: (term && term.trim()) || "Mid-Term",
      ...(category ? { category: category as ExamCategory } : {}),
      session: settings?.academicYear || new Date().getFullYear().toString(),
      startDate: examStart,
      endDate: examEnd,
      status: "UPCOMING",
      resultSheetUrl: resultSheetUrl ? String(resultSheetUrl) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    await saveExamServer(examDoc);

    // Optionally create real exam schedules (subject/class/date/time/marks) at the same time.
    let createdSchedules = 0;
    if (Array.isArray(schedules) && schedules.length > 0) {
      const [classes, subjects] = await Promise.all([
        getClassesServer(authUser.schoolId),
        getSubjectsServer(authUser.schoolId),
      ]);
      for (const s of schedules) {
        if (!s?.classId || !s?.subjectId || !s?.examDate || !s?.startTime || !s?.endTime) continue;
        const scheduleDate = validateDateString(s.examDate);
        if (!scheduleDate) continue;
        const marks = resolveScheduleMarks(s.totalMarks, s.passingMarks);
        if (typeof marks === "string") continue;
        const classOk = classes.some((c) => c.id === s.classId);
        const subject = subjects.find((sub) => sub.id === s.subjectId && sub.classId === s.classId);
        if (!classOk || !subject) continue; // never trust client-supplied class/subject ownership blindly
        const scheduleDoc: ExamScheduleDoc = {
          id: `sch-${examId}-${s.classId}-${s.subjectId}`,
          schoolId: authUser.schoolId,
          examId,
          classId: s.classId,
          subjectId: s.subjectId,
          subjectName: subject.name,
          examDate: scheduleDate,
          startTime: s.startTime,
          endTime: s.endTime,
          totalMarks: marks.total,
          passingMarks: marks.passing,
          roomNo: s.roomNo || undefined,
          createdAt: now,
        };
        await saveExamScheduleServer(scheduleDoc);
        createdSchedules += 1;
      }
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_EXAM",
      "EXAM",
      examId,
      `Created examination cycle "${examDoc.name}" with ${createdSchedules} subject schedule(s).`
    );

    return NextResponse.json({ success: true, exam: examDoc, schedulesCreated: createdSchedules }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/exams");
    if (busy) return busy;
    console.error("Exam POST error:", error);
    return NextResponse.json({ error: "Failed to create exam cycle." }, { status: 500 });
  }
}

/**
 * Adds a subject schedule to an exam, or updates it (one schedule per exam+class+subject; the id
 * is deterministic). When marks are already recorded and the maximum/passing marks change, the
 * derived percentage/grade/pass-fail of those results are recomputed from their unchanged
 * obtained marks — and a new maximum below an already-recorded mark is refused.
 */
export async function PATCH(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { examId, classId, subjectId, examDate, startTime, endTime, totalMarks, passingMarks, roomNo } = body;

    if (!examId || !classId || !subjectId || !examDate || !startTime || !endTime) {
      return jsonError("examId, classId, subjectId, examDate, startTime, and endTime are required.", 400);
    }
    const cleanExamDate = validateDateString(examDate);
    if (!cleanExamDate) {
      return jsonError("examDate is not a valid date.", 400);
    }
    if (endTime <= startTime) {
      return jsonError("endTime must be after startTime.", 400);
    }
    const marks = resolveScheduleMarks(totalMarks, passingMarks);
    if (typeof marks === "string") return jsonError(marks, 400);

    const [exams, classes, subjects, settings] = await Promise.all([
      getExamsServer(authUser.schoolId),
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);
    if (!exams.some((e) => e.id === examId)) {
      return jsonError("Exam not found for this school.", 404);
    }
    const classOk = classes.some((c) => c.id === classId);
    const subject = subjects.find((s) => s.id === subjectId && s.classId === classId);
    if (!classOk || !subject) {
      return jsonError("Class or subject not found for this school.", 404);
    }

    const scheduleId = `sch-${examId}-${classId}-${subjectId}`;
    const previous = await getExamScheduleByIdServer(authUser.schoolId, scheduleId);
    const now = new Date().toISOString();
    const scheduleDoc: ExamScheduleDoc = {
      id: scheduleId,
      schoolId: authUser.schoolId,
      examId,
      classId,
      subjectId,
      subjectName: subject.name,
      examDate: cleanExamDate,
      startTime,
      endTime,
      totalMarks: marks.total,
      passingMarks: marks.passing,
      roomNo: roomNo || undefined,
      createdAt: previous?.createdAt || now,
      ...(previous ? { updatedAt: now } : {}),
    };

    let recomputed = 0;
    if (previous && (previous.totalMarks !== marks.total || previous.passingMarks !== marks.passing)) {
      const existing = await resultsForSchedule(authUser.schoolId, previous);
      const tooHigh = existing.find((r) => r.obtainedMarks > marks.total);
      if (tooHigh) {
        return jsonError(
          `Maximum marks cannot be lowered to ${marks.total}: ${tooHigh.studentName || "a student"} already has ${tooHigh.obtainedMarks} recorded. Correct that mark first.`,
          409
        );
      }
      const scale = resolveGradingScale(settings);
      const updated = existing.map((r) => ({
        ...r,
        totalMarks: marks.total,
        ...computeSubjectResult(r.obtainedMarks, marks.total, marks.passing, scale),
        updatedAt: now,
      }));
      if (updated.length > 0) {
        await commitExamResultsServer(authUser.schoolId, updated);
        recomputed = updated.length;
      }
    }
    await saveExamScheduleServer(scheduleDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      previous ? "UPDATE_EXAM_SCHEDULE" : "CREATE_EXAM_SCHEDULE",
      "EXAM_SCHEDULE",
      scheduleDoc.id,
      previous
        ? `Updated ${subject.name} schedule of exam ${examId} (max ${marks.total}, passing ${marks.passing}); ${recomputed} recorded result(s) re-graded.`
        : `Added ${subject.name} schedule to exam ${examId} for class ${classId}.`
    );

    return NextResponse.json(
      { success: true, schedule: scheduleDoc, updated: Boolean(previous), resultsRecomputed: recomputed },
      { status: previous ? 200 : 201 }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/exams");
    if (busy) return busy;
    console.error("Exam schedule PATCH error:", error);
    return NextResponse.json({ error: "Failed to save exam schedule." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    // obtained/percentage/grade/gpa/status/evaluatedBy of a result are always computed here.
    const parsed = await parseJsonBody(req, examUpdateSchema, ["percentage", "grade", "gpa", "totalMarks", "teacherId"]);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as any;

    // Exam cycle details (title, term, dates, status, result sheet) — ADMIN only.
    if (body.examId && !body.examScheduleId) {
      if (authUser.role !== "ADMIN") {
        return jsonError("Only administrators can update exam cycle details.", 403);
      }
      const exams = await getExamsServer(authUser.schoolId);
      const targetExam = exams.find((e) => e.id === body.examId);
      if (!targetExam) {
        return jsonError("Exam not found.", 404);
      }
      const updated: ExamDoc = { ...targetExam };
      if (body.resultSheetUrl !== undefined) {
        updated.resultSheetUrl = body.resultSheetUrl ? String(body.resultSheetUrl) : undefined;
        // Being replaced or cleared: delete the file it used to point to so it doesn't become
        // an orphan in Storage (same convention as timetable image re-imports). Best-effort —
        // a delete failure here must never block saving the exam's new state.
        if (targetExam.resultSheetUrl && targetExam.resultSheetUrl !== updated.resultSheetUrl) {
          const oldPath = storagePathFromDownloadUrl(targetExam.resultSheetUrl, authUser.schoolId);
          if (oldPath) await deleteFileFromStorage(oldPath, authUser.schoolId);
        }
      }
      if (body.title) updated.name = String(body.title);
      if (body.term !== undefined && body.term) updated.term = String(body.term);
      if (body.category !== undefined) updated.category = body.category ? (body.category as ExamCategory) : undefined;
      if (body.startDate !== undefined) {
        const d = validateDateString(body.startDate);
        if (!d) return jsonError("startDate must be a valid date.", 400);
        updated.startDate = d;
      }
      if (body.endDate !== undefined) {
        const d = validateDateString(body.endDate);
        if (!d) return jsonError("endDate must be a valid date.", 400);
        updated.endDate = d;
      }
      if (updated.endDate < updated.startDate) return jsonError("endDate cannot be before startDate.", 400);
      if (body.status) updated.status = body.status;
      await saveExamServer(updated);
      await createAuditLogServer(
        authUser.schoolId,
        authUser.uid,
        authUser.email,
        authUser.role,
        "UPDATE_EXAM",
        "EXAM",
        updated.id,
        targetExam.status !== updated.status
          ? `Exam "${updated.name}" status changed from ${targetExam.status} to ${updated.status}.`
          : `Updated details of exam "${updated.name}".`
      );
      return NextResponse.json({ success: true, exam: updated });
    }

    const { examScheduleId, studentMarks } = body as {
      examScheduleId: string;
      studentMarks: { studentId: string; marksObtained: number | null; remarks?: string; cardUrl?: string }[];
    };

    // The schedule (and therefore its real examId/classId/subjectId/totalMarks) is looked up
    // server-side by id and verified to belong to this school and to an exam of the active session.
    const schedule = await getExamScheduleByIdServer(authUser.schoolId, examScheduleId);
    const exam = schedule ? (await getExamsServer(authUser.schoolId)).find((e) => e.id === schedule.examId) : undefined;
    if (!schedule || !exam) {
      return jsonError("Exam schedule not found for this school.", 404);
    }

    // A TEACHER may only submit marks for a class in their allocation...
    await assertTeacherOwnsClass(authUser, schedule.classId);
    // ...and only for a subject allocated to them, not any subject of that class.
    if (authUser.role === "TEACHER") {
      const allocation = await requireTeacherAllocation(authUser);
      if (!allocation.subjectIds.has(schedule.subjectId)) {
        return jsonError("Forbidden: this subject is not allocated to you.", 403);
      }
    }

    const settings = await getSchoolSettingsServer(authUser.schoolId);

    // PUBLISHED means these results are already visible to students and parents — a teacher
    // editing them from that point on is a correction to a finalized record, not routine entry.
    // Require ADMIN for it, same as every other finalized-exam change (status, result sheet),
    // so it's a deliberate, auditable action rather than something a teacher can do silently.
    const isCorrectionAfterPublish = exam.status === "PUBLISHED";
    if (isCorrectionAfterPublish && authUser.role !== "ADMIN") {
      return jsonError(
        "This exam has been published; its marks are finalized. Ask an administrator to make corrections.",
        403
      );
    }

    // Admin-controlled per-category permission (Monthly/Weekly/First Term/Second Term/Midterm/
    // Final Term) — e.g. Final Term defaults to read-only for teachers. Checked server-side so a
    // direct request can't bypass a disabled button in the UI. ADMIN is never restricted by this.
    if (authUser.role === "TEACHER" && resolveTeacherMarksPermission(exam.category, settings) === "READ_ONLY") {
      return jsonError(
        `Teachers cannot enter marks for ${exam.category ? exam.category.replace(/_/g, " ").toLowerCase() : "this"} exams. Ask an administrator.`,
        403
      );
    }

    // Verify every graded student actually belongs to this school and to the schedule's class.
    const classStudents = await getStudentsServer(authUser.schoolId, schedule.classId);
    const studentsById = new Map(classStudents.map((s) => [s.id, s]));
    const seen = new Set<string>();
    for (const sm of studentMarks) {
      if (!studentsById.has(sm.studentId)) {
        return jsonError("One or more students do not belong to this exam schedule's class.", 403);
      }
      if (seen.has(sm.studentId)) return jsonError("A student appears more than once in this submission.", 400);
      seen.add(sm.studentId);
    }

    // Marks above the configured maximum (or negative) are rejected, not silently clamped.
    const totalMarks = schedule.totalMarks;
    for (const sm of studentMarks) {
      if (sm.marksObtained === null) continue;
      const problem = validateObtainedMarks(sm.marksObtained, totalMarks);
      if (problem) {
        const name = studentsById.get(sm.studentId)?.fullName || sm.studentId;
        return jsonError(`${name}: ${problem}`, 400);
      }
    }

    const [subjects, existingResults] = await Promise.all([
      getSubjectsServer(authUser.schoolId),
      resultsForSchedule(authUser.schoolId, schedule),
    ]);
    const gradingScale = resolveGradingScale(settings);
    const subjectName = subjects.find((s) => s.id === schedule.subjectId)?.name || schedule.subjectName;
    const existingById = new Map(existingResults.map((r) => [r.id, r]));
    const now = new Date().toISOString();

    const upserts: ExamResultDoc[] = [];
    const deleteIds: string[] = [];
    for (const sm of studentMarks) {
      const id = resultIdFor(authUser.schoolId, schedule.examId, sm.studentId, schedule.subjectId);
      const existing = existingById.get(id);
      if (sm.marksObtained === null) {
        if (existing) deleteIds.push(id);
        continue;
      }
      const student = studentsById.get(sm.studentId)!;
      upserts.push({
        id,
        schoolId: authUser.schoolId,
        examId: schedule.examId,
        studentId: sm.studentId,
        studentName: student.fullName,
        rollNo: student.rollNo,
        classId: schedule.classId,
        subjectId: schedule.subjectId,
        subjectName,
        scheduleId: schedule.id,
        obtainedMarks: sm.marksObtained,
        totalMarks,
        ...computeSubjectResult(sm.marksObtained, totalMarks, schedule.passingMarks, gradingScale),
        // Remarks/card are only changed when sent: a client that doesn't send them (the teacher
        // grid used not to) no longer wipes what was saved before.
        remarks: sm.remarks !== undefined ? sm.remarks : existing?.remarks || "",
        cardUrl: sm.cardUrl !== undefined ? sm.cardUrl || undefined : existing?.cardUrl,
        evaluatedBy: authUser.uid,
        academicYear: existing?.academicYear || exam.session || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
    }

    const { written, deleted } = await commitExamResultsServer(authUser.schoolId, upserts, deleteIds);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      isCorrectionAfterPublish ? "CORRECT_PUBLISHED_EXAM_MARKS" : "ENTER_EXAM_MARKS",
      "EXAM_RESULT",
      examScheduleId,
      isCorrectionAfterPublish
        ? `Corrected marks for ${subjectName || schedule.subjectId} in the published exam "${exam.name}" (${written} saved, ${deleted} cleared) — already-published results were changed.`
        : `Recorded marks for ${subjectName || schedule.subjectId} in "${exam.name}" (${written} saved, ${deleted} cleared).`
    );

    return NextResponse.json({
      success: true,
      saved: written,
      cleared: deleted,
      message: `Saved ${written} mark(s)${deleted ? ` and cleared ${deleted}` : ""} for ${subjectName || "this subject"}.`,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/exams");
    if (busy) return busy;
    console.error("Marks entry error:", error);
    return NextResponse.json({ error: "Failed to record exam marks. Nothing was saved." }, { status: 500 });
  }
}

/**
 * ?examId= removes an exam with its schedules; ?scheduleId= removes one subject schedule.
 * Both are refused while any marks are recorded for it, so a delete never destroys results.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const examId = searchParams.get("examId");
    const scheduleId = searchParams.get("scheduleId");

    if (scheduleId) {
      const schedule = await getExamScheduleByIdServer(authUser.schoolId, scheduleId);
      if (!schedule) return jsonError("Exam schedule not found for this school.", 404);
      const recorded = await resultsForSchedule(authUser.schoolId, schedule);
      if (recorded.length > 0) {
        return jsonError(`This subject already has ${recorded.length} recorded mark(s); clear them before removing it.`, 409);
      }
      await deleteExamScheduleServer(authUser.schoolId, scheduleId);
      await createAuditLogServer(
        authUser.schoolId, authUser.uid, authUser.email, authUser.role,
        "DELETE_EXAM_SCHEDULE", "EXAM_SCHEDULE", scheduleId,
        `Removed ${schedule.subjectName || schedule.subjectId} schedule from exam ${schedule.examId}.`
      );
      return NextResponse.json({ success: true });
    }

    if (examId) {
      const exam = (await getExamsServer(authUser.schoolId, { allSessions: true })).find((e) => e.id === examId);
      if (!exam) return jsonError("Exam not found for this school.", 404);
      const recorded = await getExamResultsServer(authUser.schoolId, examId, undefined, undefined, { allSessions: true });
      if (recorded.length > 0) {
        return jsonError(`"${exam.name}" already has ${recorded.length} recorded mark(s) and cannot be deleted.`, 409);
      }
      await deleteExamServer(authUser.schoolId, examId);
      if (exam.resultSheetUrl) {
        const oldPath = storagePathFromDownloadUrl(exam.resultSheetUrl, authUser.schoolId);
        if (oldPath) await deleteFileFromStorage(oldPath, authUser.schoolId);
      }
      await createAuditLogServer(
        authUser.schoolId, authUser.uid, authUser.email, authUser.role,
        "DELETE_EXAM", "EXAM", examId, `Deleted exam "${exam.name}" (no marks were recorded).`
      );
      return NextResponse.json({ success: true });
    }

    return jsonError("examId or scheduleId is required.", 400);
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/exams");
    if (busy) return busy;
    console.error("Exam DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete." }, { status: 500 });
  }
}
