import type { TeacherAttendanceDoc, TeacherAttendanceStatus } from "./firebase/types";
import { addDays, weekdayOf, weekIdForDate, zonedDateParts, DEFAULT_SCHOOL_TIMEZONE } from "./lesson-plan-schedule";

/**
 * Teacher Attendance (Phase 11): a separate module from student attendance, with its own
 * working-day/weekly-leave rules, computed entirely in the school's configured timezone
 * (defaults to Asia/Karachi — see DEFAULT_SCHOOL_TIMEZONE in lesson-plan-schedule.ts, the same
 * zoned-date machinery the lesson-plan module already relies on for the same reason).
 *
 * The computation is a pure function over the school's real saved records plus its working-day
 * configuration (holidays) — nothing here writes to the database or invents a record that
 * doesn't exist. A working day with no saved record is treated as ABSENT (a no-show that was
 * never pre-approved as leave); this is a display-time classification, not a Firestore write.
 */

export { DEFAULT_SCHOOL_TIMEZONE };

/** Sunday is always non-working, matching LESSON_PLAN_TEACHING_DAYS (Mon-Sat school week). */
export function isWorkingDay(dateStr: string, holidays: readonly string[] = []): boolean {
  if (weekdayOf(dateStr) === "Sunday") return false;
  if (holidays.includes(dateStr)) return false;
  return true;
}

/** Every working day in [startDate, endDate] inclusive, in order. */
export function workingDaysInRange(startDate: string, endDate: string, holidays: readonly string[] = []): string[] {
  const out: string[] = [];
  let cursor = startDate;
  // Calendar-date comparison is safe here: both are YYYY-MM-DD strings, which sort lexically
  // the same as chronologically.
  while (cursor <= endDate) {
    if (isWorkingDay(cursor, holidays)) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** The first and last calendar date of `year`-`month` (1-12), as YYYY-MM-DD. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${pad(month)}-${pad(daysInMonth)}`;
  return { start, end };
}

export interface DayResult {
  date: string;
  status: TeacherAttendanceStatus;
  /** Present when a record for this date actually exists in Firestore. */
  recorded: boolean;
  /** True when a saved LEAVE record was downgraded to ABSENT by the weekly-leave cap. */
  weeklyLeaveCapApplied?: boolean;
  record?: TeacherAttendanceDoc;
}

/**
 * Classifies every working day in [startDate, endDate] for one teacher, applying (in order):
 *  1. A saved PRESENT record always wins (biometric-present precedence over any absence default
 *     or a later-dated correction race — the actual check-in is ground truth).
 *  2. A saved LEAVE record counts as LEAVE only for the first such day, in date order, within
 *     its own Mon-Sat school week; a second (or later) LEAVE day in the same week counts as
 *     ABSENT instead (the weekly leave policy — one allowed leave day per week).
 *  3. A saved ABSENT record counts as ABSENT.
 *  4. No record at all on a working day counts as ABSENT (never fabricated as present or leave).
 * Deterministic: the same records always produce the same result, independent of call order or
 * how many times it runs (no mutation, no counters carried outside this one call).
 */
export function classifyTeacherDays(
  startDate: string,
  endDate: string,
  records: readonly TeacherAttendanceDoc[],
  holidays: readonly string[] = []
): DayResult[] {
  const byDate = new Map<string, TeacherAttendanceDoc>();
  for (const r of records) byDate.set(r.date, r);

  const workingDays = workingDaysInRange(startDate, endDate, holidays);
  const leaveUsedByWeek = new Set<string>();
  const results: DayResult[] = [];

  for (const date of workingDays) {
    const record = byDate.get(date);
    if (record?.status === "PRESENT") {
      results.push({ date, status: "PRESENT", recorded: true, record });
      continue;
    }
    if (record?.status === "LEAVE") {
      const weekId = weekIdForDate(date);
      if (!leaveUsedByWeek.has(weekId)) {
        leaveUsedByWeek.add(weekId);
        results.push({ date, status: "LEAVE", recorded: true, record });
      } else {
        results.push({ date, status: "ABSENT", recorded: true, record, weeklyLeaveCapApplied: true });
      }
      continue;
    }
    if (record?.status === "ABSENT") {
      results.push({ date, status: "ABSENT", recorded: true, record });
      continue;
    }
    results.push({ date, status: "ABSENT", recorded: false });
  }

  return results;
}

export interface MonthlySummary {
  workingDays: number;
  present: number;
  leave: number;
  absent: number;
  /** Of `absent`, how many were a saved LEAVE day downgraded by the weekly cap (informational —
   *  still counted in `absent`, never double-counted). */
  weeklyLeaveCapApplied: number;
}

export function summarizeTeacherDays(days: readonly DayResult[]): MonthlySummary {
  return {
    workingDays: days.length,
    present: days.filter((d) => d.status === "PRESENT").length,
    leave: days.filter((d) => d.status === "LEAVE").length,
    absent: days.filter((d) => d.status === "ABSENT").length,
    weeklyLeaveCapApplied: days.filter((d) => d.weeklyLeaveCapApplied).length,
  };
}

/** Deterministic Firestore document id for one teacher's one day's attendance. */
export function teacherAttendanceIdFor(schoolId: string, teacherId: string, date: string): string {
  return `${schoolId}_${teacherId}_${date}`;
}

/** Today's date (YYYY-MM-DD) in the school's configured timezone — never the server's own. */
export function todayInSchoolTimezone(timezone: string = DEFAULT_SCHOOL_TIMEZONE, now: Date = new Date()): string {
  return zonedDateParts(timezone, now).date;
}
