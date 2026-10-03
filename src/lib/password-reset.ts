import crypto from "crypto";

/** Lifetime of an emailed password reset link. */
export const RESET_TOKEN_TTL_MINUTES = 15;
export const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;

/** Lifetime of an account activation (first password) link sent when an admin creates an account. */
export const ACTIVATION_TOKEN_TTL_HOURS = 72;
export const ACTIVATION_TOKEN_TTL_MS = ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

/**
 * 256 bits from the OS CSPRNG, URL-safe. The raw token only ever exists in the emailed link;
 * the database stores its SHA-256 hash.
 */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Shape check before any database lookup (43 base64url chars for 32 random bytes). */
export function looksLikeResetToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  );
}

function normalizeBaseUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

export type BaseUrlResult = { ok: true; baseUrl: string } | { ok: false; reason: string };

/**
 * Resolves the public base URL used in reset links.
 *
 * Production never derives it from request headers: the Host/Origin of a forgot-password request
 * is attacker-controlled, and trusting it would let anyone make the server email a valid reset
 * token pointing at their own domain. Production uses NEXT_PUBLIC_APP_URL (or APP_URL), falling
 * back to the deployment's own production domain that Vercel injects
 * (VERCEL_PROJECT_PRODUCTION_URL), and refuses localhost.
 *
 * Development additionally accepts the request origin, then http://localhost:3000.
 */
export function resolveAppBaseUrl(
  request: { origin?: string | null; host?: string | null },
  env: Record<string, string | undefined> = process.env
): BaseUrlResult {
  const isProd = env.NODE_ENV === "production";
  const configured =
    normalizeBaseUrl(env.NEXT_PUBLIC_APP_URL) ||
    normalizeBaseUrl(env.APP_URL) ||
    normalizeBaseUrl(env.VERCEL_PROJECT_PRODUCTION_URL);

  if (isProd) {
    if (!configured) {
      return {
        ok: false,
        reason:
          "No public app URL configured. Set NEXT_PUBLIC_APP_URL to the production domain (e.g. https://school.example.com).",
      };
    }
    if (isLocalHost(configured.hostname)) {
      return { ok: false, reason: "NEXT_PUBLIC_APP_URL points at localhost in production." };
    }
    if (configured.protocol !== "https:") {
      return { ok: false, reason: "NEXT_PUBLIC_APP_URL must use https in production." };
    }
    return { ok: true, baseUrl: configured.origin };
  }

  if (configured) return { ok: true, baseUrl: configured.origin };
  const fromRequest =
    normalizeBaseUrl(request.origin) ||
    (request.host ? normalizeBaseUrl(`http://${request.host}`) : null);
  return { ok: true, baseUrl: fromRequest ? fromRequest.origin : "http://localhost:3000" };
}

export function buildResetUrl(baseUrl: string, token: string, purpose: "RESET" | "ACTIVATION" = "RESET"): string {
  const url = `${baseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  // Only picks the page wording; the server reads the real purpose from the stored token record.
  return purpose === "ACTIVATION" ? `${url}&purpose=activate` : url;
}
