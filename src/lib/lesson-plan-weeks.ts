import type { LessonPlanWeekDoc } from "@/lib/firebase/types";
import { validateDateString } from "@/lib/date-utils";
import {
  addDays,
  currentWeekId,
  submissionWindowFor,
  weekdayOf,
  zonedDateParts,
  type DayOfWeekName,
} from "@/lib/lesson-plan-schedule";

/**
 * The single source of lesson-plan weeks, used by the teacher form, the admin review page and
 * the API that validates a submission, so they can never disagree.
 *
 * Two kinds of week, one key:
 *  - STANDARD: any Monday–Sunday school week. Nothing is stored for it and there is no last one,
 *    so the schedule never "runs out" (the existing behavior, unchanged).
 *  - CUSTOM: an admin-defined range with its own label (`lessonPlanWeeks/…`). Its stable id is its
 *    start date — the same `weekId` key lesson plans are already filed under — so existing plans,
 *    their ids and their weekIds are never rewritten.
 * A standard week whose dates overlap a custom week is not offered (one schedule, no double
 * booking); history is protected separately by refusing to define a custom week over a period
 * that already holds plans with different dates (see the weeks API).
 */

/** Longest custom week, in days (start and end inclusive). */
export const MAX_WEEK_DAYS = 31;
/** How far back / ahead custom weeks are offered to teachers (the admin list always shows all). */
export const TEACHER_HORIZON_PAST_DAYS = 60;
export const TEACHER_HORIZON_FUTURE_DAYS = 180;

export interface WeekDay {
  date: string;
  dayOfWeek: DayOfWeekName;
}

export interface ResolvedWeek {
  weekId: string;
  label: string;
  startDate: string;
  endDate: string;
  kind: "STANDARD" | "CUSTOM";
  weekNumber?: number;
  status?: "ACTIVE" | "INACTIVE";
  order?: number;
  /** Plan days: every date of the week except Sundays (never a lesson-plan day). */
  days: WeekDay[];
}

export const standardWeekLabel = (weekId: string) => `Week of ${weekId}`;

/** Whole days from `a` to `b` (both YYYY-MM-DD), pure calendar arithmetic (leap years included). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function teachingDays(startDate: string, endDate: string): WeekDay[] {
  const out: WeekDay[] = [];
  const n = daysBetween(startDate, endDate);
  for (let i = 0; i <= n; i++) {
    const date = addDays(startDate, i);
    const dayOfWeek = weekdayOf(date);
    if (dayOfWeek !== "Sunday") out.push({ date, dayOfWeek });
  }
  return out;
}

export function standardWeek(weekId: string): ResolvedWeek {
  const endDate = addDays(weekId, 6);
  return { weekId, label: standardWeekLabel(weekId), startDate: weekId, endDate, kind: "STANDARD", days: teachingDays(weekId, endDate) };
}

export function customWeek(
  w: Pick<LessonPlanWeekDoc, "weekId" | "label" | "startDate" | "endDate"> & {
    weekNumber?: number;
    status?: "ACTIVE" | "INACTIVE";
    order?: number;
  }
): ResolvedWeek {
  return {
    weekId: w.weekId,
    label: w.label,
    startDate: w.startDate,
    endDate: w.endDate,
    kind: "CUSTOM",
    weekNumber: w.weekNumber,
    status: w.status ?? "ACTIVE",
    order: w.order,
    days: teachingDays(w.startDate, w.endDate),
  };
}

export type WeekResolution = { ok: true; week: ResolvedWeek } | { ok: false; error: string };

/** Resolves a weekId a teacher/admin names to a real week, or says exactly why it is not one. */
export function resolveWeek(weekId: string, customWeeks: LessonPlanWeekDoc[]): WeekResolution {
  if (validateDateString(weekId) !== weekId) return { ok: false, error: "weekId must be a valid YYYY-MM-DD date." };
  const custom = customWeeks.find((w) => w.weekId === weekId);
  if (custom) return { ok: true, week: customWeek(custom) };
  if (weekdayOf(weekId) !== "Monday") {
    return { ok: false, error: "This is not a scheduled week. Use a Monday that starts a school week, or ask an administrator to create the week." };
  }
  const std = standardWeek(weekId);
  const covering = customWeeks.find((w) => rangesOverlap(std.startDate, std.endDate, w.startDate, w.endDate));
  if (covering) {
    return {
      ok: false,
      error: `These dates are covered by the custom week "${covering.label}" (${covering.startDate} to ${covering.endDate}). Use that week instead.`,
    };
  }
  return { ok: true, week: std };
}

export interface WeekInput {
  label: unknown;
  startDate: unknown;
  endDate: unknown;
  weekNumber?: unknown;
  status?: unknown;
  order?: unknown;
}

export type WeekInputResult =
  | {
      ok: true;
      value: {
        label: string;
        startDate: string;
        endDate: string;
        weekNumber?: number;
        status: "ACTIVE" | "INACTIVE";
        order?: number;
      };
    }
  | { ok: false; error: string };

/** Validates what an admin typed. Dates are real calendar dates (Feb 29 only in leap years). */
export function validateWeekInput(input: WeekInput): WeekInputResult {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) return { ok: false, error: "Enter a name for the week." };
  if (label.length > 80) return { ok: false, error: "The week name can be at most 80 characters." };
  const startDate = typeof input.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate.trim()) ? validateDateString(input.startDate) : null;
  const endDate = typeof input.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate.trim()) ? validateDateString(input.endDate) : null;
  if (!startDate) return { ok: false, error: "Start date is not a valid date (YYYY-MM-DD)." };
  if (!endDate) return { ok: false, error: "End date is not a valid date (YYYY-MM-DD)." };
  if (startDate >= endDate) return { ok: false, error: "The start date must be before the end date." };
  if (daysBetween(startDate, endDate) + 1 > MAX_WEEK_DAYS) {
    return { ok: false, error: `A week can span at most ${MAX_WEEK_DAYS} days.` };
  }
  if (teachingDays(startDate, endDate).length === 0) return { ok: false, error: "The week must include at least one teaching day (not only Sundays)." };

  let weekNumber: number | undefined;
  if (input.weekNumber !== undefined && input.weekNumber !== null && input.weekNumber !== "") {
    const parsedNum = Number(input.weekNumber);
    if (!Number.isInteger(parsedNum) || parsedNum <= 0 || parsedNum > 999) {
      return { ok: false, error: "Week number must be a positive integer between 1 and 999." };
    }
    weekNumber = parsedNum;
  }

  let status: "ACTIVE" | "INACTIVE" = "ACTIVE";
  if (input.status !== undefined && input.status !== null) {
    const s = String(input.status).toUpperCase().trim();
    if (s === "INACTIVE") {
      status = "INACTIVE";
    } else if (s === "ACTIVE") {
      status = "ACTIVE";
    } else {
      return { ok: false, error: "Status must be either ACTIVE or INACTIVE." };
    }
  }

  let order: number | undefined;
  if (input.order !== undefined && input.order !== null && input.order !== "") {
    const o = Number(input.order);
    if (Number.isInteger(o)) order = o;
  }

  return { ok: true, value: { label, startDate, endDate, weekNumber, status, order } };
}

export const weekDocId = (schoolId: string, startDate: string) => `lpw_${schoolId}_${startDate}`;

export interface ScheduleEntry extends ResolvedWeek {
  submissionWindow: { opensAt: string; closesAt: string };
  academicYear?: string;
}

/**
 * The weeks the submission form offers: the standard weeks around now (as before) minus any that
 * a custom week covers, plus the custom weeks inside the horizon. Sorted by start date.
 */
export function buildWeekSchedule(
  customWeeks: LessonPlanWeekDoc[],
  timezone: string,
  now: Date = new Date()
): { weeks: ScheduleEntry[]; defaultWeekId: string } {
  const today = zonedDateParts(timezone, now).date;
  const nextStandard = addDays(currentWeekId(timezone, now), 7);
  const entries: ScheduleEntry[] = [];
  const withWindow = (w: ResolvedWeek, academicYear?: string): ScheduleEntry => ({
    ...w,
    submissionWindow: submissionWindowFor(w.weekId, timezone),
    ...(academicYear ? { academicYear } : {}),
  });

  for (let i = 0; i < 8; i++) {
    const std = standardWeek(addDays(nextStandard, (i - 5) * 7));
    if (customWeeks.some((c) => rangesOverlap(std.startDate, std.endDate, c.startDate, c.endDate))) continue;
    entries.push(withWindow(std));
  }
  const from = addDays(today, -TEACHER_HORIZON_PAST_DAYS);
  const to = addDays(today, TEACHER_HORIZON_FUTURE_DAYS);
  for (const c of customWeeks) {
    // Only active custom weeks appear in the active schedule for new submissions
    if (c.status === "INACTIVE") continue;
    if (c.endDate >= from && c.startDate <= to) entries.push(withWindow(customWeek(c), c.academicYear));
  }
  entries.sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Default: a week whose submission window is open right now, else the next week to start,
  // else the next standard week (the previous behavior).
  const t = now.getTime();
  const open = entries.find((e) => t >= Date.parse(e.submissionWindow.opensAt) && t < Date.parse(e.submissionWindow.closesAt));
  const upcoming = entries.find((e) => e.startDate > today);
  const defaultWeekId = open?.weekId || upcoming?.weekId || nextStandard;
  return { weeks: entries, defaultWeekId };
}
