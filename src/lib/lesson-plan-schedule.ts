import type { LessonPlanDoc } from "@/lib/firebase/types";

/**
 * ASD Weekly Lesson Plan scheduling: the school week, and the Saturday 24-hour submission
 * window/lock, all computed in the school's configured IANA timezone (never the server's own).
 *
 * Assumption (documented per the task spec, since the supplied template has no explicit
 * submission-day wording — it is a plain Class/Subject/Teacher calendar grid): a weekly plan
 * covers the school week of Monday through Sunday, and is prepared and submitted during the
 * Saturday immediately BEFORE that week starts (the standard "plan next week" pattern — Saturday
 * is also the template's last working-day column before Sunday). So for the week starting Monday
 * 2026-10-19, the submission window is Saturday 2026-10-17 00:00 through Sunday 2026-10-18 00:00,
 * school-timezone. After that instant the record locks for the teacher.
 */

export const DEFAULT_SCHOOL_TIMEZONE = "Asia/Karachi";

export const LESSON_PLAN_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
export type DayOfWeekName = (typeof DAY_NAMES)[number];

/** Teaching days this module builds a weekly plan for: Monday through Saturday (Sunday is off). */
export const LESSON_PLAN_TEACHING_DAYS: DayOfWeekName[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * The UTC-minutes offset of `timeZone` at the instant `date`. Positive east of UTC (e.g. +300 for
 * Asia/Karachi, UTC+5). Works for any IANA zone via Intl, including ones with DST — this samples
 * the actual offset in effect at `date`, not a fixed constant.
 */
function timeZoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return Math.round((asUTC - date.getTime()) / 60000);
}

/** The UTC instant of local 00:00:00 on `dateStr` (YYYY-MM-DD) in `timeZone`. */
export function zonedMidnightUTC(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // One correction pass: the offset at the guessed instant is within a day of the true offset
  // even across a DST transition, which is exact for every real IANA zone's maximum DST shift.
  const offset = timeZoneOffsetMinutes(timeZone, new Date(utcGuess));
  const corrected = utcGuess - offset * 60000;
  const offset2 = timeZoneOffsetMinutes(timeZone, new Date(corrected));
  return new Date(utcGuess - offset2 * 60000);
}

/** `now`'s local calendar date (YYYY-MM-DD) and weekday name in `timeZone`. */
export function zonedDateParts(timeZone: string, now: Date = new Date()): { date: string; weekday: DayOfWeekName } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  });
  const parts = dtf.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { date: ymd(Number(map.year), Number(map.month), Number(map.day)), weekday: map.weekday as DayOfWeekName };
}

/** Adds `days` (may be negative) to a YYYY-MM-DD date string, pure calendar arithmetic. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const WEEKDAY_INDEX: Record<DayOfWeekName, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export function weekdayOf(dateStr: string): DayOfWeekName {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The Monday (YYYY-MM-DD) of the school week containing `dateStr`. */
export function weekIdForDate(dateStr: string): string {
  const idx = WEEKDAY_INDEX[weekdayOf(dateStr)];
  const sinceMonday = idx === 0 ? 6 : idx - 1; // Sunday=0 is 6 days after that week's Monday.
  return addDays(dateStr, -sinceMonday);
}

/** The school week (Monday, YYYY-MM-DD) containing `now`, in `timeZone`. */
export function currentWeekId(timeZone: string, now: Date = new Date()): string {
  return weekIdForDate(zonedDateParts(timeZone, now).date);
}

/** The 7 calendar dates (Monday..Sunday) of the week starting `weekId`. */
export function weekDates(weekId: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekId, i));
}

export interface SubmissionWindow {
  /** Saturday 00:00:00 local, the week immediately before `weekId`'s Monday. */
  opensAt: string;
  /** 24h after opensAt — the lock instant. */
  closesAt: string;
}

/**
 * The Saturday submission window for the week starting `weekId` (a Monday): the Saturday two
 * days before it, for 24 hours, in `timeZone`. See the module doc for why "the Saturday before".
 */
export function submissionWindowFor(weekId: string, timeZone: string): SubmissionWindow {
  const saturday = addDays(weekId, -2);
  const opens = zonedMidnightUTC(saturday, timeZone);
  const closes = new Date(opens.getTime() + LESSON_PLAN_SUBMISSION_WINDOW_MS);
  return { opensAt: opens.toISOString(), closesAt: closes.toISOString() };
}

export function isWithinSubmissionWindow(weekId: string, timeZone: string, now: Date = new Date()): boolean {
  const w = submissionWindowFor(weekId, timeZone);
  const t = now.getTime();
  return t >= Date.parse(w.opensAt) && t < Date.parse(w.closesAt);
}

export type LessonPlanTeacherStatus = "DRAFT" | "SUBMITTED" | "LOCKED" | "LATE";

/**
 * Whether the record is locked for the TEACHER right now: once the submission window for its
 * week has closed, neither a draft nor a submitted plan can be changed by the teacher anymore,
 * submitted or not (admins may still correct it — see adminCorrections on LessonPlanDoc).
 */
export function isLessonPlanLockedForTeacher(
  doc: Pick<LessonPlanDoc, "submissionDeadline">,
  now: Date = new Date()
): boolean {
  const deadline = Date.parse(doc.submissionDeadline);
  if (Number.isNaN(deadline)) return true; // fail closed
  return now.getTime() >= deadline;
}

/** Teacher-facing status, derived (never stored) so a timezone change never rewrites history. */
export function lessonPlanStatus(
  doc: Pick<LessonPlanDoc, "submitted" | "submissionDeadline">,
  now: Date = new Date()
): LessonPlanTeacherStatus {
  const locked = isLessonPlanLockedForTeacher(doc, now);
  if (!locked) return doc.submitted ? "SUBMITTED" : "DRAFT";
  return doc.submitted ? "LOCKED" : "LATE";
}

/** Deterministic document id for the (school, teacher, class, subject, week) key — see LessonPlanDoc. */
export function lessonPlanDocId(
  schoolId: string,
  teacherId: string,
  classId: string,
  subjectId: string,
  weekId: string
): string {
  return `lp_${schoolId}_${teacherId}_${classId}_${subjectId}_${weekId}`;
}
