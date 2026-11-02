import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import { parseJsonBody } from "@/lib/input-validation";
import {
  createAuditLogServer,
  getLessonPlansServer,
  getLessonPlanWeeksServer,
  getSchoolSettingsServer,
  saveLessonPlanWeekServer,
} from "@/lib/firebase/server-db";
import { LessonPlanWeekDoc } from "@/lib/firebase/types";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { DEFAULT_SCHOOL_TIMEZONE, zonedDateParts } from "@/lib/lesson-plan-schedule";
import { rangesOverlap, validateWeekInput, weekDocId } from "@/lib/lesson-plan-weeks";
import { getDefaultAcademicYear } from "@/lib/school-display";

export const dynamic = "force-dynamic";

const jsonError = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

const ACADEMIC_YEAR_RE = /^\d{4}-\d{4}$/;

/**
 * GET /api/lesson-plan-weeks (ADMIN): every custom week of this school, any year, with how many
 * lesson plans are filed under each — what the admin schedule screen shows.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const academicYear = new URL(req.url).searchParams.get("academicYear") || "";
    const [weeks, plans, settings] = await Promise.all([
      getLessonPlanWeeksServer(authUser.schoolId),
      getLessonPlansServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);
    const timezone = settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
    const today = zonedDateParts(timezone).date;
    const counts = new Map<string, number>();
    for (const p of plans) counts.set(p.weekId, (counts.get(p.weekId) || 0) + 1);

    const rows = weeks
      .filter((w) => !academicYear || w.academicYear === academicYear)
      .map((w) => ({
        id: w.id,
        weekId: w.weekId,
        label: w.label,
        academicYear: w.academicYear,
        startDate: w.startDate,
        endDate: w.endDate,
        planCount: counts.get(w.weekId) || 0,
        state: w.endDate < today ? "PAST" : w.startDate > today ? "UPCOMING" : "CURRENT",
        // Dates can only be edited while nothing has been filed under the week.
        datesEditable: (counts.get(w.weekId) || 0) === 0,
      }));
    return NextResponse.json({
      success: true,
      timezone,
      today,
      defaultAcademicYear: settings?.academicYear || getDefaultAcademicYear(),
      weeks: rows,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plan-weeks");
    if (busy) return busy;
    console.error("Lesson plan weeks GET error:", error?.message || error);
    return jsonError("Failed to load lesson plan weeks.", 500);
  }
}

const createSchema = z.object({
  label: z.unknown(),
  startDate: z.unknown(),
  endDate: z.unknown(),
  academicYear: z.string().trim().regex(ACADEMIC_YEAR_RE, "academicYear must look like 2026-2027.").optional(),
});

/**
 * POST /api/lesson-plan-weeks (ADMIN): define a week. Refused when it duplicates or overlaps
 * another custom week, or when lesson plans already exist for those dates under different week
 * dates (an existing plan is never re-dated, re-keyed or re-assigned). Naming a week that exactly
 * matches existing plans' dates is allowed — it only adds a label.
 */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const checked = validateWeekInput({ label: parsed.data.label, startDate: parsed.data.startDate, endDate: parsed.data.endDate });
    if (!checked.ok) return jsonError(checked.error, 400);
    const { label, startDate, endDate } = checked.value;

    const [existing, plans, settings] = await Promise.all([
      getLessonPlanWeeksServer(authUser.schoolId),
      getLessonPlansServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);

    const same = existing.find((w) => w.weekId === startDate);
    if (same) return jsonError(`A week starting on ${startDate} already exists ("${same.label}").`, 409);
    const overlapping = existing.find((w) => rangesOverlap(startDate, endDate, w.startDate, w.endDate));
    if (overlapping) {
      return jsonError(
        `These dates overlap the week "${overlapping.label}" (${overlapping.startDate} to ${overlapping.endDate}). Weeks cannot overlap.`,
        409
      );
    }
    const conflicting = plans.find(
      (p) => rangesOverlap(startDate, endDate, p.weekStartDate, p.weekEndDate) && (p.weekStartDate !== startDate || p.weekEndDate !== endDate)
    );
    if (conflicting) {
      return jsonError(
        `Lesson plans already exist for part of these dates (the week ${conflicting.weekStartDate} to ${conflicting.weekEndDate}). Existing plans are never re-dated, so choose dates that do not cut across them.`,
        409
      );
    }

    const now = new Date().toISOString();
    const week: LessonPlanWeekDoc = {
      id: weekDocId(authUser.schoolId, startDate),
      schoolId: authUser.schoolId,
      academicYear: parsed.data.academicYear || settings?.academicYear || getDefaultAcademicYear(),
      weekId: startDate,
      label,
      startDate,
      endDate,
      createdBy: authUser.uid,
      createdAt: now,
      updatedAt: now,
    };
    await saveLessonPlanWeekServer(week);
    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "CREATE_LESSON_PLAN_WEEK", "LESSON_PLAN_WEEK", week.id,
      `Created lesson-plan week "${label}" (${startDate} to ${endDate}, session ${week.academicYear}).`
    );
    return NextResponse.json({ success: true, week }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plan-weeks");
    if (busy) return busy;
    console.error("Lesson plan weeks POST error:", error?.message || error);
    return jsonError("Failed to create the week.", 500);
  }
}
