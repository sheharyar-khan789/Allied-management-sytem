import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { UserProfile, UserRole } from "./types";
import { getUserByIdServer } from "./server-db";
import { hasAdminCredentials } from "./admin";
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_SECONDS as TOKEN_IDLE_SECONDS,
  signSessionToken,
  verifySessionToken,
} from "@/lib/session-token";
import { getClientIp, isCrossSiteStateChange } from "@/lib/request-security";
import { securityLog } from "@/lib/security-log";

export const SESSION_IDLE_SECONDS = TOKEN_IDLE_SECONDS;

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
  /** Random per-sign-in id; lets logout revoke exactly this session. */
  sid?: string;
}

export async function createSessionCookieServer(payload: AuthenticatedUser): Promise<string> {
  return signSessionToken(payload);
}

export type SessionCheckResult =
  | "OK"
  | "PROFILE_MISSING"
  | "INACTIVE"
  | "ROLE_CHANGED"
  | "SCHOOL_CHANGED"
  | "PASSWORD_CHANGED"
  | "LOGGED_OUT";

/**
 * Compares a verified session token against the live user profile. The token is a cache of the
 * profile; whenever the two disagree on anything authorization-relevant the session is rejected,
 * so disabling a user, changing their role/school, deleting them, resetting their password or
 * logging out takes effect on the very next request instead of when the token expires.
 *
 * `authoritativeStore` is true when profiles come from Firestore. The in-memory development store
 * doesn't hold every test identity, so there a missing profile is tolerated; with a real
 * database a session for a profile that no longer exists is always rejected.
 */
export function evaluateSessionAgainstProfile(
  session: Pick<AuthenticatedUser, "uid" | "role" | "schoolId" | "authAt" | "sid">,
  profile: UserProfile | null,
  authoritativeStore: boolean
): SessionCheckResult {
  if (!profile) return authoritativeStore ? "PROFILE_MISSING" : "OK";
  if (profile.status && profile.status !== "ACTIVE") return "INACTIVE";
  if (profile.role && profile.role !== session.role) return "ROLE_CHANGED";
  if (profile.schoolId && profile.schoolId !== session.schoolId) return "SCHOOL_CHANGED";
  if (profile.sessionsValidAfter) {
    const cutoff = Date.parse(profile.sessionsValidAfter);
    if (!Number.isNaN(cutoff)) {
      if (typeof session.authAt !== "number") return "PASSWORD_CHANGED";
      if (session.authAt < Math.floor(cutoff / 1000)) return "PASSWORD_CHANGED";
    }
  }
  if (session.sid && Array.isArray(profile.revokedSessionIds) && profile.revokedSessionIds.includes(session.sid)) {
    return "LOGGED_OUT";
  }
  return "OK";
}

/** Fails closed: if the profile can't be read, the session is treated as revoked. */
async function checkSession(user: AuthenticatedUser): Promise<SessionCheckResult> {
  try {
    const profile = await getUserByIdServer(user.uid);
    return evaluateSessionAgainstProfile(user, profile, hasAdminCredentials);
  } catch (e) {
    console.error("Session revocation check failed:", (e as Error)?.message || "error");
    return "PROFILE_MISSING";
  }
}

function routeOf(req?: NextRequest): string | undefined {
  try {
    return req ? new URL(req.url).pathname : undefined;
  } catch {
    return undefined;
  }
}

export async function getAuthenticatedUser(req?: NextRequest): Promise<AuthenticatedUser | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  } else {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      return null;
    }
  }

  if (!token) return null;

  // Throws (deliberately) when JWT_SECRET is missing/short in a real deployment.
  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const user: AuthenticatedUser = {
    uid: claims.uid,
    email: claims.email,
    role: claims.role,
    schoolId: claims.schoolId,
    name: claims.name,
    teacherId: claims.teacherId,
    studentId: claims.studentId,
    studentIds: claims.studentIds,
    authAt: claims.authAt,
    sid: claims.sid,
  };

  const check = await checkSession(user);
  if (check !== "OK") {
    securityLog("auth.session_revoked", {
      subject: user.uid,
      role: user.role,
      schoolId: user.schoolId,
      reason: check,
      route: routeOf(req),
    });
    return null;
  }
  return user;
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function requireAuth(
  req?: NextRequest,
  allowedRoles?: UserRole[]
): Promise<AuthenticatedUser> {
  // CSRF: enforced here as well as in middleware, so a middleware bypass can't skip it.
  if (req && isCrossSiteStateChange(req)) {
    securityLog("csrf.blocked", { ip: getClientIp(req.headers), route: routeOf(req), method: req.method, status: 403 });
    throw jsonError(403, { error: "Forbidden: cross-site request blocked." });
  }

  const user = await getAuthenticatedUser(req);

  if (!user || !user.uid || !user.schoolId) {
    throw jsonError(401, {
      error: "Unauthorized: your session has expired or you are not signed in. Please sign in again.",
      sessionExpired: true,
    });
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    securityLog("authz.forbidden", {
      subject: user.uid,
      role: user.role,
      schoolId: user.schoolId,
      route: routeOf(req),
      method: req?.method,
      status: 403,
      reason: "role",
    });
    throw jsonError(403, { error: `Forbidden: User role ${user.role} is not authorized for this resource.` });
  }

  return user;
}

/**
 * Re-authentication gate for sensitive ADMIN actions (payroll, fee changes, deleting students or
 * teachers, settings). Controlled by ADMIN_REAUTH_MAX_AGE_MINUTES: unset/0 = OFF (default).
 * When set, the admin must have signed in (password + 2FA if enabled) within that many minutes;
 * otherwise the request is refused with `reauthRequired: true` and they sign in again.
 */
export function requireRecentAuth(user: AuthenticatedUser, action: string, req?: NextRequest): void {
  const minutes = Number(process.env.ADMIN_REAUTH_MAX_AGE_MINUTES || 0);
  securityLog("admin.sensitive_action", {
    subject: user.uid,
    role: user.role,
    schoolId: user.schoolId,
    action,
    route: routeOf(req),
    method: req?.method,
  });
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const authAt = typeof user.authAt === "number" ? user.authAt : 0;
  const ageSeconds = Math.floor(Date.now() / 1000) - authAt;
  if (ageSeconds > minutes * 60) {
    securityLog("authz.reauth_required", { subject: user.uid, role: user.role, schoolId: user.schoolId, action, status: 401 });
    throw jsonError(401, {
      error: `For your security, please sign out and sign in again to ${action}. (Sensitive actions require a sign-in within the last ${minutes} minutes.)`,
      reauthRequired: true,
    });
  }
}
