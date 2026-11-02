import { randomInt } from "node:crypto";
import { checkPasswordPolicy } from "@/lib/password-reset";

/**
 * Temporary password for a newly created account. Generated with the operating system's CSPRNG
 * (crypto.randomInt, which is unbiased), never derived from the name/email/username, never
 * hardcoded. It is shown once to the admin who created the account and is never stored, logged
 * or returned again; the account is flagged `mustChangePassword`, so it only ever opens the
 * "choose your own password" screen.
 *
 * 16 characters from an alphabet without look-alikes (no 0/O, 1/l/I) so it can be read out or
 * typed from a message; guaranteed to contain upper, lower, digit and symbol.
 */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%^&*?";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;
export const TEMP_PASSWORD_LENGTH = 16;

const pick = (chars: string) => chars[randomInt(chars.length)];

export function generateTemporaryPassword(context: { email?: string | null; name?: string | null } = {}): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
    while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(ALL));
    // Fisher–Yates with the same CSPRNG, so the guaranteed characters are not always first.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join("");
    // Must satisfy the same policy the user's own password will later be held to.
    if (checkPasswordPolicy(candidate, context) === null) return candidate;
  }
  throw new Error("Could not generate a temporary password that satisfies the password policy.");
}
