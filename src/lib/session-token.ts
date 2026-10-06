import { jwtVerify, SignJWT, JWTPayload } from "jose";

/**
 * Session token signing/verification shared by middleware (edge runtime) and the route-level
 * requireAuth (node runtime). Only `jose` and Web APIs are used here so both runtimes can import it.
 */

export type SessionRole = "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";

export const SESSION_COOKIE_NAME = "allied_session";
/** Idle timeout: every authenticated request re-issues the token for this long. */
export const SESSION_IDLE_SECONDS = 5 * 60;
/**
 * Absolute lifetime measured from the original sign-in (`authAt`). The sliding idle refresh can
 * never extend a session past this, so a stolen cookie that is kept "warm" still dies.
 */
export const SESSION_ABSOLUTE_MAX_SECONDS = 12 * 60 * 60;

export const SESSION_JWT_ALG = "HS256";
export const SESSION_JWT_ISSUER = "allied-sms";
export const SESSION_JWT_AUDIENCE = "allied-sms-session";

const DEV_ONLY_FALLBACK_SECRET = "allied-school-dev-only-local-secret-key-32-chars-min";
export const MIN_JWT_SECRET_LENGTH = 32;

export interface SessionClaims {
  uid: string;
  email: string;
  role: SessionRole;
  schoolId: string;
  name: string;
  teacherId?: string;
  studentId?: string;
  studentIds?: string[];
  /** Original sign-in time (unix seconds); preserved across refreshes. */
  authAt?: number;
  /** Random per-sign-in id, used to revoke a single session on logout. */
  sid?: string;
  iat?: number;
}

type Env = Record<string, string | undefined>;

/**
 * True when this process is (or may be) talking to a real deployment: production builds, Vercel,
 * or any configured Firebase Admin credentials. In all of these the hardcoded development secret
 * must never be used, because anyone who reads the public source could forge sessions with it.
 */
export function isRealDeployment(env: Env = process.env): boolean {
  return (
    env.NODE_ENV === "production" ||
    Boolean(env.VERCEL) ||
    Boolean(env.FIREBASE_PRIVATE_KEY && env.FIREBASE_PRIVATE_KEY.trim()) ||
    Boolean(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_CLIENT_EMAIL.trim()) ||
    Boolean(env.GOOGLE_APPLICATION_CREDENTIALS && env.GOOGLE_APPLICATION_CREDENTIALS.trim())
  );
}

/**
 * Resolves the HMAC key. Read on every call (not cached at import) so a misconfiguration is
 * detected even if the environment changes after the module loads.
 */
export function getJwtSecretKey(env: Env = process.env): Uint8Array {
  const secret = (env.JWT_SECRET || "").trim();
  if (secret.length >= MIN_JWT_SECRET_LENGTH) return new TextEncoder().encode(secret);

  if (isRealDeployment(env)) {
    throw new Error(
      "Critical Security Configuration Error: JWT_SECRET is missing or shorter than 32 characters. " +
        "It is required in production and whenever real Firebase credentials are configured. Refusing to sign or verify sessions."
    );
  }
  if (secret.length > 0) {
    throw new Error("JWT_SECRET is set but shorter than 32 characters. Use a long random value (e.g. `openssl rand -base64 48`).");
  }
  // Local development / tests with the in-memory store only.
  return new TextEncoder().encode(DEV_ONLY_FALLBACK_SECRET);
}

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signSessionToken(claims: SessionClaims, env: Env = process.env): Promise<string> {
  const authAt = typeof claims.authAt === "number" ? claims.authAt : Math.floor(Date.now() / 1000);
  return new SignJWT({
    uid: claims.uid,
    email: claims.email,
    role: claims.role,
    schoolId: claims.schoolId,
    name: claims.name,
    teacherId: claims.teacherId,
    studentId: claims.studentId,
    studentIds: claims.studentIds,
    authAt,
    sid: claims.sid || randomSessionId(),
  })
    .setProtectedHeader({ alg: SESSION_JWT_ALG, typ: "JWT" })
    .setIssuer(SESSION_JWT_ISSUER)
    .setAudience(SESSION_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_IDLE_SECONDS}s`)
    .sign(getJwtSecretKey(env));
}

/**
 * Verifies signature (HS256 only — "none" and every other algorithm are rejected), expiry,
 * issuer and audience, then the absolute lifetime. Returns null for anything invalid.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  env: Env = process.env,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<(SessionClaims & JWTPayload) | null> {
  if (!token || token.length > 4096) return null;
  const key = getJwtSecretKey(env);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: [SESSION_JWT_ALG],
      issuer: SESSION_JWT_ISSUER,
      audience: SESSION_JWT_AUDIENCE,
    }));
  } catch {
    return null;
  }
  const claims = payload as unknown as SessionClaims & JWTPayload;
  if (!claims.uid || typeof claims.uid !== "string" || !claims.schoolId || !claims.role) return null;
  const authAt = typeof claims.authAt === "number" ? claims.authAt : claims.iat;
  if (typeof authAt !== "number") return null;
  if (nowSeconds - authAt > SESSION_ABSOLUTE_MAX_SECONDS) return null;
  return { ...claims, authAt };
}

export const SESSION_COOKIE_OPTIONS_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_IDLE_SECONDS,
};

export function sessionCookieOptions(env: Env = process.env) {
  return { ...SESSION_COOKIE_OPTIONS_BASE, secure: env.NODE_ENV === "production" };
}
