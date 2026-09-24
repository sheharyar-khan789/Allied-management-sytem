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
