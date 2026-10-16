import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import { parseJsonBody, idString } from "@/lib/input-validation";
import {
  getLessonPlansServer,
  getLessonPlanByIdServer,
  saveLessonPlanServer,
  getClassByIdServer,
  getSchoolSettingsServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { LessonPlanDayEntry, LessonPlanDoc } from "@/lib/firebase/types";
import { assertTeacherCanAccessLessonPlan, resolveAuthenticatedTeacher } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  LESSON_PLAN_TEACHING_DAYS,
  isLessonPlanLockedForTeacher,
  isWithinSubmissionWindow,
  lessonPlanDocId,
  lessonPlanStatus,
  submissionWindowFor,
  weekDates,
  weekdayOf,
} from "@/lib/lesson-plan-schedule";

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

async function schoolTimezone(schoolId: string): Promise<string> {
  const settings = await getSchoolSettingsServer(schoolId);
  return settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
}

export function toLessonPlanView(doc: LessonPlanDoc, now: Date = new Date()) {
  const status = lessonPlanStatus(doc, now);
  const locked = isLessonPlanLockedForTeacher(doc, now);
  return {
    id: doc.id,
    schoolId: doc.schoolId,
    academicYear: doc.academicYear,
    teacherId: doc.teacherId,
    teacherName: doc.teacherName,
    classId: doc.classId,
    className: doc.className,
    subjectId: doc.subjectId,
    subjectName: doc.subjectName,
    weekId: doc.weekId,
    weekStartDate: doc.weekStartDate,
    weekEndDate: doc.weekEndDate,
    days: doc.days,
    submitted: doc.submitted,
    submittedAt: doc.submittedAt || null,
    submissionDeadline: doc.submissionDeadline,
    status,
    editableByTeacher: !locked,
    hasAdminCorrections: Boolean(doc.adminCorrections && doc.adminCorrections.length > 0),
    adminCorrections: doc.adminCorrections || [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdByName: doc.createdByName,
  };
}

/**
 * GET /api/lesson-plans — list. A TEACHER always sees only their own records (a teacherId query
 * param from a TEACHER caller is ignored, never trusted). An ADMIN may filter by any of
 * teacherId/classId/subjectId/weekId/academicYear.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);

    let teacherId: string | undefined;
    if (authUser.role === "TEACHER") {
      const teacher = await resolveAuthenticatedTeacher(authUser);
      if (!teacher) return jsonError("Your account is not linked to a teacher profile in this school.", 403);
      teacherId = teacher.id;
    } else {
      teacherId = searchParams.get("teacherId") || undefined;
    }

    const plans = await getLessonPlansServer(authUser.schoolId, {
      teacherId,
      classId: searchParams.get("classId") || undefined,
      subjectId: searchParams.get("subjectId") || undefined,
      weekId: searchParams.get("weekId") || undefined,
      academicYear: searchParams.get("academicYear") || undefined,
    });

    const now = new Date();
    return NextResponse.json({ success: true, plans: plans.map((p) => toLessonPlanView(p, now)) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans");
    if (busy) return busy;
    console.error("Lesson plans GET error:", error);
    return jsonError("Failed to load lesson plans.", 500);
  }
}

const dayEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Each day entry needs a YYYY-MM-DD date."),
  content: z.string().trim().max(4000).optional().default(""),
  isNonTeachingDay: z.boolean().optional(),
});

const saveSchema = z.object({
  classId: idString,
  subjectId: idString,
  weekId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekId must be a YYYY-MM-DD Monday date."),
  days: z.array(dayEntrySchema).min(1).max(7),
  action: z.enum(["SAVE_DRAFT", "SUBMIT"]),
});

/**
 * POST /api/lesson-plans — create or edit the single weekly record for
 * (caller's teacher, classId, subjectId, weekId) — upserted by its deterministic id, so this is
 * also how an existing draft/submission is edited. TEACHER only; admin corrections to an already
 * locked record go through POST /api/lesson-plans/[id]/correct instead, to keep that path
 * separately audited.
 */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["TEACHER"]);
    const parsed = await parseJsonBody(req, saveSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    if (weekdayOf(body.weekId) !== "Monday") {
      return jsonError("weekId must be the Monday that starts the school week.", 400);
    }

    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher) return jsonError("Your account is not linked to a teacher profile in this school.", 403);

    const { subject } = await assertTeacherCanAccessLessonPlan(authUser, body.classId, body.subjectId);
    const classDoc = await getClassByIdServer(authUser.schoolId, body.classId);
    if (!classDoc) return jsonError("Class not found for this school.", 404);

    const tz = await schoolTimezone(authUser.schoolId);
    const window = submissionWindowFor(body.weekId, tz);
    const now = new Date();

    const id = lessonPlanDocId(authUser.schoolId, teacher.id, body.classId, body.subjectId, body.weekId);

    // Validate every submitted date actually belongs to this week and is a teaching day
    // (Monday-Saturday — Sunday is never a lesson-plan day), and de-duplicate by date.
    const validDates = new Set(weekDates(body.weekId).filter((d) => weekdayOf(d) !== "Sunday"));
    const byDate = new Map<string, LessonPlanDayEntry>();
    for (const d of body.days) {
      if (!validDates.has(d.date)) {
        return jsonError(`${d.date} is not a teaching day of the week starting ${body.weekId}.`, 400);
      }
      byDate.set(d.date, {
        date: d.date,
        dayOfWeek: weekdayOf(d.date),
        content: d.content || "",
        ...(d.isNonTeachingDay ? { isNonTeachingDay: true } : {}),
      });
    }
    const days = LESSON_PLAN_TEACHING_DAYS
      .map((_, i) => weekDates(body.weekId)[i])
      .filter((d) => validDates.has(d))
      .map((d) => byDate.get(d) || { date: d, dayOfWeek: weekdayOf(d), content: "" });

    if (body.action === "SUBMIT" && !isWithinSubmissionWindow(body.weekId, tz, now)) {
      return jsonError(
        `This week's plan can only be submitted during its Saturday submission window (${window.opensAt} to ${window.closesAt}).`,
        403
      );
    }

    // Read once up front to carry forward identity/submission state that an edit must not
    // reset: the original creator/createdAt, and — unless this save IS the submit action — an
    // already-submitted plan's submitted/submittedAt. Otherwise a teacher using "Save Draft" to
    // tweak wording after submitting would silently revert their plan to DRAFT and lose the
    // original submission timestamp. The lock itself is still re-checked transactionally below.
    const existing = await getLessonPlanByIdServer(authUser.schoolId, id);

    let lockedResponse: Response | null = null;
    let wasAlreadySubmitted = false;
    try {
      await saveLessonPlanServer(
        {
          id,
          schoolId: authUser.schoolId,
          academicYear: classDoc.academicYear,
          teacherId: teacher.id,
          teacherName: teacher.fullName,
          classId: body.classId,
          className: `${classDoc.name} ${classDoc.section}`.trim(),
          subjectId: body.subjectId,
          subjectName: subject.name,
          weekId: body.weekId,
          weekStartDate: body.weekId,
          weekEndDate: weekDates(body.weekId)[6],
          days,
          submitted: body.action === "SUBMIT" ? true : Boolean(existing?.submitted),
          submittedAt: body.action === "SUBMIT" ? now.toISOString() : (existing?.submittedAt ?? null),
          // Stamped once, on first creation, and kept from then on (see LessonPlanDoc) — a later
          // change to the school's timezone setting must not retroactively move this record's
          // deadline.
          submissionDeadline: existing?.submissionDeadline || window.closesAt,
          createdBy: existing?.createdBy || authUser.uid,
          createdByName: existing?.createdByName || authUser.name,
          createdAt: existing?.createdAt || now.toISOString(),
          updatedAt: now.toISOString(),
          updatedBy: authUser.uid,
        },
        (current) => {
          // Re-checked inside the write transaction (not just before it) so two concurrent saves
          // of the same week can't race past the lock check together.
          if (current) {
            if (isLessonPlanLockedForTeacher(current, now)) {
              lockedResponse = jsonError(
                "This week's lesson plan is locked and can no longer be changed. Contact an administrator for a correction.",
                403
              );
              throw new Error("LOCKED");
            }
            wasAlreadySubmitted = current.submitted;
          } else if (now.getTime() >= Date.parse(window.closesAt)) {
            // No draft was ever started, and this week's window has already closed.
            lockedResponse = jsonError(
              "This week's submission window has already closed; a new plan can no longer be started for it.",
              403
            );
            throw new Error("LOCKED");
          }
        }
      );
    } catch (e: any) {
      if (lockedResponse) return lockedResponse;
      throw e;
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      body.action === "SUBMIT" ? "SUBMIT_LESSON_PLAN" : "SAVE_LESSON_PLAN_DRAFT",
      "LESSON_PLAN",
      id,
      `${body.action === "SUBMIT" ? "Submitted" : "Saved a draft of"} the week of ${body.weekId} lesson plan for ${subject.name} / ${classDoc.name} ${classDoc.section}` +
        (wasAlreadySubmitted && body.action === "SUBMIT" ? " (re-submission before the deadline)." : ".")
    );

    const saved = await getLessonPlanByIdServer(authUser.schoolId, id);
    return NextResponse.json({ success: true, plan: saved ? toLessonPlanView(saved, now) : null }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans");
    if (busy) return busy;
    console.error("Lesson plans POST error:", error);
    return jsonError("Failed to save the lesson plan.", 500);
  }
}
