/**
 * Date validation utilities for employment dates and other calendar inputs.
 */

/**
 * Parses and validates a date string (YYYY-MM-DD or standard ISO date).
 * Ensures valid calendar year, month, and day without silent rollover.
 * Returns standardized YYYY-MM-DD string, or null if invalid.
 */
export function validateDateString(dateStr: unknown): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Construct UTC date and check for month/day rollover (e.g., Feb 31 -> Mar 3)
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Compares two YYYY-MM-DD date strings.
 * Returns true if dateA is strictly earlier than dateB.
 */
export function isDateBefore(dateA: string, dateB: string): boolean {
  return dateA < dateB;
}

/**
 * Today's date as YYYY-MM-DD in the browser's/server's LOCAL timezone. `toISOString()` is UTC,
 * which in Pakistan (UTC+5) still reports yesterday until 05:00 — so pages that defaulted to it
 * opened the attendance register on the wrong day early in the morning.
 */
export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Optional date field from a request body: undefined/null/"" -> null (not provided); a valid
 * calendar date -> normalized YYYY-MM-DD; anything else -> "INVALID".
 */
export function parseOptionalDate(value: unknown): string | null | "INVALID" {
  if (value === undefined || value === null || value === "") return null;
  return validateDateString(value) ?? "INVALID";
}

/** Formats a stored YYYY-MM-DD (or ISO timestamp) as e.g. "12 Apr 2009" without timezone shifts. */
export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = validateDateString(value);
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Today (UTC) plus one day, so a user ahead of UTC (e.g. Pakistan) entering "today" isn't treated as future. */
function latestAcceptableToday(now: number): string {
  return new Date(now + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

export type StudentDatesResult =
  | { ok: true; dob: string | null; admissionDate: string | null }
  | { ok: false; error: string };

/**
 * Server-side rules for student dates. Both are optional (existing records without them keep
 * working); when present they must be real calendar dates, the date of birth can't be in the
 * future, and admission can't precede birth.
 */
export function validateStudentDates(
  input: { dob?: unknown; admissionDate?: unknown },
  now: number = Date.now()
): StudentDatesResult {
  const dob = parseOptionalDate(input.dob);
  if (dob === "INVALID") return { ok: false, error: "Date of Birth is not a valid date (YYYY-MM-DD)." };
  const admissionDate = parseOptionalDate(input.admissionDate);
  if (admissionDate === "INVALID") return { ok: false, error: "Admission Date is not a valid date (YYYY-MM-DD)." };

  const latestToday = latestAcceptableToday(now);
  if (dob && dob > latestToday) return { ok: false, error: "Date of Birth cannot be in the future." };
  if (dob && admissionDate && admissionDate < dob) {
    return { ok: false, error: "Admission Date cannot be earlier than Date of Birth." };
  }
  return { ok: true, dob, admissionDate };
}
