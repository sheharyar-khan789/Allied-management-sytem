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
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || "";
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    const statusFilter = (searchParams.get("status") || "").toUpperCase().trim();
    const sortBy = searchParams.get("sortBy") || "startDate";
    const sortOrder = searchParams.get("sortOrder") === "desc" ? -1 : 1;

    const [weeks, plans, settings] = await Promise.all([
      getLessonPlanWeeksServer(authUser.schoolId),
      getLessonPlansServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);
    const timezone = settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
    const today = zonedDateParts(timezone).date;
    const counts = new Map<string, number>();
    for (const p of plans) counts.set(p.weekId, (counts.get(p.weekId) || 0) + 1);

    let rows = weeks
      .filter((w) => !academicYear || w.academicYear === academicYear)
      .filter((w) => {
        if (!statusFilter || statusFilter === "ALL") return true;
        const s = (w.status ?? "ACTIVE");
        return s === statusFilter;
      })
      .filter((w) => {
        if (!search) return true;
        const matchLabel = w.label.toLowerCase().includes(search);
        const matchNum = w.weekNumber !== undefined && String(w.weekNumber).includes(search);
        return matchLabel || matchNum;
      })
      .map((w) => ({
        id: w.id,
        weekId: w.weekId,
        label: w.label,
        weekNumber: w.weekNumber ?? null,
        status: (w.status ?? "ACTIVE") as "ACTIVE" | "INACTIVE",
        order: w.order ?? null,
        academicYear: w.academicYear,
        startDate: w.startDate,
        endDate: w.endDate,
        planCount: counts.get(w.weekId) || 0,
        state: w.endDate < today ? "PAST" : w.startDate > today ? "UPCOMING" : "CURRENT",
        // Dates can only be edited while nothing has been filed under the week.
        datesEditable: (counts.get(w.weekId) || 0) === 0,
      }));

    rows.sort((a, b) => {
      if (sortBy === "weekNumber") {
        const numA = a.weekNumber ?? 999999;
        const numB = b.weekNumber ?? 999999;
        return (numA - numB) * sortOrder || a.startDate.localeCompare(b.startDate);
      }
      if (sortBy === "label") {
        return a.label.localeCompare(b.label) * sortOrder;
      }
      if (sortBy === "order") {
        const ordA = a.order ?? 999999;
        const ordB = b.order ?? 999999;
        return (ordA - ordB) * sortOrder || a.startDate.localeCompare(b.startDate);
      }
      // default: startDate
      return a.startDate.localeCompare(b.startDate) * sortOrder;
    });

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
  weekNumber: z.unknown().optional(),
  status: z.unknown().optional(),
  order: z.unknown().optional(),
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
    const checked = validateWeekInput({
      label: parsed.data.label,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      weekNumber: parsed.data.weekNumber,
      status: parsed.data.status,
      order: parsed.data.order,
    });
    if (!checked.ok) return jsonError(checked.error, 400);
    const { label, startDate, endDate, weekNumber, status, order } = checked.value;

    const [existing, plans, settings] = await Promise.all([
      getLessonPlanWeeksServer(authUser.schoolId),
      getLessonPlansServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);
    const sessionYear = parsed.data.academicYear || settings?.academicYear || getDefaultAcademicYear();

    if (weekNumber !== undefined) {
      const duplicateNum = existing.find(
        (w) => w.academicYear === sessionYear && w.weekNumber === weekNumber
      );
      if (duplicateNum) {
        return jsonError(
          `Week number ${weekNumber} is already used by "${duplicateNum.label}" in session ${sessionYear}. Week numbers must be unique within an academic session.`,
          409
        );
      }
    }

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
      academicYear: sessionYear,
      weekId: startDate,
      label,
      ...(weekNumber !== undefined ? { weekNumber } : {}),
      startDate,
      endDate,
      status: status || "ACTIVE",
      ...(order !== undefined ? { order } : {}),
      createdBy: authUser.uid,
      createdAt: now,
      updatedAt: now,
    };
    await saveLessonPlanWeekServer(week);
    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "CREATE_LESSON_PLAN_WEEK", "LESSON_PLAN_WEEK", week.id,
      `Created lesson-plan week "${label}" (Week ${weekNumber ?? "—"}, ${startDate} to ${endDate}, status ${week.status}, session ${week.academicYear}).`
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
