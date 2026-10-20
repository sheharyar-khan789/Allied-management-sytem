/**
 * Academic-year ("YYYY-YYYY") and calendar-year option logic shared by every selector and by
 * server-side validation. Options are generated from the reference date rather than listed by
 * hand, so no screen silently stops offering next year's session once the calendar moves on.
 *
 * Offering a year is NOT creating it: nothing here writes sessions or records. A session only
 * exists once an admin saves it as the active session in Settings / the header selector.
 *
 * Pure helpers only (safe in client and server code).
 */

/**
 * Month (0-indexed) a new academic year starts in when no session is configured. Only used to
 * pick a sensible *default*; a school's real session is always the configured one.
 */
export const ACADEMIC_YEAR_START_MONTH = 6; // July

/** How far either side of "now" selectors reach by default. */
export const DEFAULT_PAST_YEARS = 5;
export const DEFAULT_FUTURE_YEARS = 15;

const ACADEMIC_YEAR_RE = /^(\d{4})-(\d{4})$/;

export function academicYearLabel(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

/** Start year of the academic year `date` falls in. */
export function academicYearStartFor(date: Date = new Date(), startMonth = ACADEMIC_YEAR_START_MONTH): number {
  return date.getMonth() >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
}

export function currentAcademicYear(date: Date = new Date()): string {
  return academicYearLabel(academicYearStartFor(date));
}

/** Start year of a "YYYY-YYYY" label, or null when the label is not a valid session. */
export function parseAcademicYear(value: string | null | undefined): number | null {
  const m = ACADEMIC_YEAR_RE.exec((value || "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return end === start + 1 && start >= 1900 && start <= 9998 ? start : null;
}

/** A session label is "YYYY-YYYY" with consecutive years (e.g. 2031-2032, never 2031-2035). */
export function isValidAcademicYear(value: string | null | undefined): boolean {
  return parseAcademicYear(value) !== null;
}

export interface YearOptionsConfig {
  referenceDate?: Date;
  pastYears?: number;
  futureYears?: number;
  /** Values that must always be selectable even when outside the window (e.g. the configured
   * active session, or the session of a historical record being viewed). Invalid ones are ignored. */
  include?: (string | number | null | undefined)[];
}

/**
 * Academic-year options, oldest first: `pastYears` before the current session through
 * `futureYears` after it, plus any `include` session outside that window.
 */
export function academicYearOptions(config: YearOptionsConfig = {}): string[] {
  const { referenceDate = new Date(), pastYears = DEFAULT_PAST_YEARS, futureYears = DEFAULT_FUTURE_YEARS, include = [] } = config;
  const current = academicYearStartFor(referenceDate);
  const starts = new Set<number>();
  for (let y = current - pastYears; y <= current + futureYears; y++) starts.add(y);
  for (const v of include) {
    const start = typeof v === "number" ? v : parseAcademicYear(v);
    if (start !== null && Number.isInteger(start)) starts.add(start);
  }
  return Array.from(starts).sort((a, b) => a - b).map(academicYearLabel);
}

/** Calendar-year options (fees, payroll), oldest first, with any `include` year added. */
export function calendarYearOptions(config: YearOptionsConfig = {}): number[] {
  const { referenceDate = new Date(), pastYears = DEFAULT_PAST_YEARS, futureYears = DEFAULT_FUTURE_YEARS, include = [] } = config;
  const current = referenceDate.getFullYear();
  const years = new Set<number>();
  for (let y = current - pastYears; y <= current + futureYears; y++) years.add(y);
  for (const v of include) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(n) && n >= 1900 && n <= 9999) years.add(n);
  }
  return Array.from(years).sort((a, b) => a - b);
}
