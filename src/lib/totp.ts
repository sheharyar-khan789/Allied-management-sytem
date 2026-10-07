import crypto from "crypto";

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits) — the variant every authenticator app
 * (Google Authenticator, Microsoft Authenticator, Authy, 1Password) supports. No dependency.
 *
 * Admin two-factor is OFF unless ADMIN_MFA_ENABLED=true. See /api/auth/mfa and the login route.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function isAdminMfaEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.ADMIN_MFA_ENABLED || "").trim().toLowerCase() === "true";
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 secret.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit random secret, base32 encoded. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpAt(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) %
    10 ** TOTP_DIGITS;
  return code.toString().padStart(TOTP_DIGITS, "0");
}

export function currentStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Verifies a code within ±1 step of clock drift. Returns the matched step (so the caller can
 * store it and refuse replays of the same or an older code), or null.
 */
export function verifyTotp(
  secretBase32: string,
  code: unknown,
  opts: { nowMs?: number; lastUsedStep?: number } = {}
): number | null {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return null;
  const candidate = Buffer.from(code.trim());
  const now = currentStep(opts.nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (typeof opts.lastUsedStep === "number" && step <= opts.lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)) return step;
  }
  return null;
}

export function otpauthUri(secretBase32: string, accountEmail: string, issuer = "Allied School"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
