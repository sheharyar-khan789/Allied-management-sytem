import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import { parseJsonBody } from "@/lib/input-validation";
import {
  createAuditLogServer,
  deleteLessonPlanWeekServer,
  getLessonPlansServer,
  getLessonPlanWeeksServer,
  saveLessonPlanWeekServer,
} from "@/lib/firebase/server-db";
import { LessonPlanWeekDoc } from "@/lib/firebase/types";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { rangesOverlap, validateWeekInput, weekDocId } from "@/lib/lesson-plan-weeks";

export const dynamic = "force-dynamic";

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

const updateSchema = z.object({
  label: z.unknown().optional(),
  startDate: z.unknown().optional(),
  endDate: z.unknown().optional(),
  weekNumber: z.unknown().optional(),
  status: z.unknown().optional(),
  order: z.unknown().optional(),
  academicYear: z.string().trim().regex(/^\d{4}-\d{4}$/, "academicYear must look like 2026-2027.").optional(),
});

/**
 * PUT /api/lesson-plan-weeks/[id] (ADMIN). The name and session can always be changed. The dates
 * can only change while no lesson plan is filed under the week, because plans are keyed by the
 * week's start date and are never re-keyed or re-dated.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, updateSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const weeks = await getLessonPlanWeeksServer(authUser.schoolId);
    const current = weeks.find((w) => w.id === id);
    if (!current) return jsonError("Week not found.", 404);

    const checked = validateWeekInput({
      label: body.label !== undefined ? body.label : current.label,
      startDate: body.startDate !== undefined ? body.startDate : current.startDate,
      endDate: body.endDate !== undefined ? body.endDate : current.endDate,
      weekNumber: body.weekNumber !== undefined ? body.weekNumber : current.weekNumber,
      status: body.status !== undefined ? body.status : (current.status ?? "ACTIVE"),
      order: body.order !== undefined ? body.order : current.order,
    });
    if (!checked.ok) return jsonError(checked.error, 400);
    const { label, startDate, endDate, weekNumber, status, order } = checked.value;
    const datesChanged = startDate !== current.startDate || endDate !== current.endDate;

    const targetSession = body.academicYear || current.academicYear;
    if (weekNumber !== undefined) {
      const duplicateNum = weeks.find(
        (w) => w.id !== current.id && w.academicYear === targetSession && w.weekNumber === weekNumber
      );
      if (duplicateNum) {
        return jsonError(
          `Week number ${weekNumber} is already used by "${duplicateNum.label}" in session ${targetSession}. Week numbers must be unique within an academic session.`,
          409
        );
      }
    }

    const plans = await getLessonPlansServer(authUser.schoolId);
    if (datesChanged) {
      if (plans.some((p) => p.weekId === current.weekId)) {
        return jsonError("Lesson plans are already filed under this week, so its dates can no longer be changed. You can still rename it.", 409);
      }
      const others = weeks.filter((w) => w.id !== current.id);
      const overlapping = others.find((w) => rangesOverlap(startDate, endDate, w.startDate, w.endDate));
      if (overlapping) {
        return jsonError(`These dates overlap the week "${overlapping.label}" (${overlapping.startDate} to ${overlapping.endDate}).`, 409);
      }
      const conflicting = plans.find((p) => rangesOverlap(startDate, endDate, p.weekStartDate, p.weekEndDate));
      if (conflicting) {
        return jsonError(`Lesson plans already exist for part of these dates (the week ${conflicting.weekStartDate} to ${conflicting.weekEndDate}).`, 409);
      }
    }

    const now = new Date().toISOString();
    const nextId = datesChanged ? weekDocId(authUser.schoolId, startDate) : current.id;
    const updated: LessonPlanWeekDoc = {
      ...current,
      id: nextId,
      weekId: startDate,
      label,
      ...(weekNumber !== undefined ? { weekNumber } : {}),
      startDate,
      endDate,
      status,
      ...(order !== undefined ? { order } : {}),
      academicYear: targetSession,
      updatedAt: now,
      updatedBy: authUser.uid,
    };
    // Write the new document first, then drop the old one, so a failure never loses the week.
    await saveLessonPlanWeekServer(updated);
    if (nextId !== current.id) await deleteLessonPlanWeekServer(authUser.schoolId, current.id);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "UPDATE_LESSON_PLAN_WEEK", "LESSON_PLAN_WEEK", nextId,
      `Updated lesson-plan week "${label}" (Week ${weekNumber ?? "—"}, ${startDate} to ${endDate}, status ${status}).`
    );
    return NextResponse.json({ success: true, week: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plan-weeks/[id]");
    if (busy) return busy;
    console.error("Lesson plan week PUT error:", error?.message || error);
    return jsonError("Failed to update the week.", 500);
  }
}

/** DELETE /api/lesson-plan-weeks/[id] (ADMIN): only a week with no lesson plans filed under it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const weeks = await getLessonPlanWeeksServer(authUser.schoolId);
    const current = weeks.find((w) => w.id === id);
    if (!current) return jsonError("Week not found.", 404);
    const plans = await getLessonPlansServer(authUser.schoolId, { weekId: current.weekId, includeDeleted: true });
    if (plans.length > 0) {
      return jsonError("Lesson plans are filed under this week, so it cannot be removed.", 409);
    }
    await deleteLessonPlanWeekServer(authUser.schoolId, id);
    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "DELETE_LESSON_PLAN_WEEK", "LESSON_PLAN_WEEK", id,
      `Removed lesson-plan week "${current.label}" (${current.startDate} to ${current.endDate}); it had no plans.`
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plan-weeks/[id]");
    if (busy) return busy;
    console.error("Lesson plan week DELETE error:", error?.message || error);
    return jsonError("Failed to remove the week.", 500);
  }
}
