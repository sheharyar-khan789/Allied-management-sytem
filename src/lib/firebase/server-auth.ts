import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { UserRole } from "./types";
import { getUserByIdServer } from "./server-db";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret || secret.trim().length < 32) {
      throw new Error(
        "Critical Security Configuration Error: JWT_SECRET environment variable is missing or insecurely short in production (minimum 32 characters required). Refusing to sign or verify tokens."
      );
    }
    return new TextEncoder().encode(secret.trim());
  }

  // Non-production local development fallback only
  if (!secret || secret.trim().length === 0) {
    return new TextEncoder().encode("allied-school-dev-only-local-secret-key-32-chars-min");
  }

  return new TextEncoder().encode(secret.trim());
}

const SECRET_KEY = getJwtSecret();

export const SESSION_IDLE_SECONDS = 5 * 60;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_IDLE_SECONDS,
};

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: UserRole;
  schoolId: string;
  name: string;
  teacherId?: string;
  studentId?: string;
  studentIds?: string[];
  /**
   * Unix seconds of the original sign-in. Preserved across every sliding refresh (middleware,
   * /api/auth/me), so a password reset/change can invalidate sessions that were signed in
   * before it — `iat` alone can't do that because each refresh re-issues the token.
   */
  authAt?: number;
}

export async function createSessionCookieServer(payload: AuthenticatedUser): Promise<string> {
  const authAt = typeof payload.authAt === "number" ? payload.authAt : Math.floor(Date.now() / 1000);
  return new SignJWT({
    uid: payload.uid,
    email: payload.email,
    role: payload.role,
    schoolId: payload.schoolId,
    name: payload.name,
    teacherId: payload.teacherId,
    studentId: payload.studentId,
    studentIds: payload.studentIds,
    authAt,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_IDLE_SECONDS}s`)
    .sign(SECRET_KEY);
}

/**
 * True when the profile's `sessionsValidAfter` cutoff (set on password reset/change) is later
 * than the session's original sign-in. Fails closed if the profile can't be read.
 */
async function isSessionRevoked(uid: string, authAtSeconds: number | undefined): Promise<boolean> {
  try {
    const profile = await getUserByIdServer(uid);
    if (!profile?.sessionsValidAfter) return false;
    const cutoff = Date.parse(profile.sessionsValidAfter);
    if (Number.isNaN(cutoff)) return false;
    if (typeof authAtSeconds !== "number") return true;
    return authAtSeconds < Math.floor(cutoff / 1000);
  } catch (e) {
    console.error("Session revocation check failed:", e);
    return true;
  }
}

export async function getAuthenticatedUser(req?: NextRequest): Promise<AuthenticatedUser | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get("allied_session")?.value;
  } else {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get("allied_session")?.value;
    } catch {
      return null;
    }
  }

  if (!token) return null;

  let user: AuthenticatedUser & { iat?: number };
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY);
    user = payload as unknown as AuthenticatedUser & { iat?: number };
  } catch {
    return null;
  }

  if (!user.uid) return null;
  const authAt = typeof user.authAt === "number" ? user.authAt : user.iat;
  if (await isSessionRevoked(user.uid, authAt)) return null;
  return { ...user, authAt };
}

export async function requireAuth(
  req?: NextRequest,
  allowedRoles?: UserRole[]
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req);

  if (!user || !user.uid || !user.schoolId) {
    throw new Response(
      JSON.stringify({
        error: "Unauthorized: your session has expired or you are not signed in. Please sign in again.",
        sessionExpired: true,
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    throw new Response(
      JSON.stringify({ error: `Forbidden: User role ${user.role} is not authorized for this resource.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return user;
}
