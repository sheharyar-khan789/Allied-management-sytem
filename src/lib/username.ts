/**
 * Teacher usernames: assigned by an admin, separate from the login e-mail address.
 *
 * Policy (one place, used by the API, the admin forms and the backfill script):
 *  - stored and compared lowercase; surrounding spaces ignored; never contains "@" (that is how
 *    the login form tells a username from an e-mail address);
 *  - 3 to 30 characters: letters, digits, "." "_" "-"; starts and ends with a letter or digit; no
 *    two separators in a row;
 *  - GLOBALLY unique across every school (a username alone must identify one account at login,
 *    so two schools can never share one);
 *  - a few reserved words are refused.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9]|[._-](?=[a-z0-9]))*$/;
const RESERVED = new Set([
  "admin", "administrator", "root", "system", "support", "teacher", "student", "parent",
  "principal", "null", "undefined", "api", "login", "logout", "test",
]);

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Returns an error message for an unusable username, or null when it is valid. */
export function validateUsername(value: unknown): string | null {
  if (typeof value !== "string") return "Username is required.";
  const u = normalizeUsername(value);
  if (!u) return "Username is required.";
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  }
  if (u.includes("@")) return "Username cannot be an email address (no @).";
  if (!USERNAME_RE.test(u)) {
    return "Username may contain only letters, numbers, dots, underscores and hyphens, and must start and end with a letter or number.";
  }
  if (RESERVED.has(u)) return "This username is reserved. Please choose another.";
  return null;
}

/** A starting suggestion from a person's name, e.g. "Muhammad Ali" -> "muhammad.ali". */
export function suggestUsername(fullName: string): string {
  const parts = String(fullName || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || "teacher";
  return base.slice(0, USERNAME_MAX);
}
