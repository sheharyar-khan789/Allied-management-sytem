import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { UserProfile, UserRole } from "./types";
import { getSessionProfileServer, getUserByIdServer } from "./server-db";
import {
  isServiceUnavailableError,
  logFirestoreOutage,
  serviceBusyResponse,
  ServiceUnavailableError,
} from "./firestore-errors";
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
  /**
   * Read from the LIVE profile on every request (never carried in the session token, so it can
   * not go stale or be forged): the account still has an admin-issued temporary password and may
   * only reach the change-password screen. See requireAuth / requirePageRole.
   */
  mustChangePassword?: boolean;
}

/** The only API routes a user who must change their password may still call. */
export const PASSWORD_CHANGE_EXEMPT_ROUTES = new Set(["/api/auth/change-password", "/api/auth/logout"]);

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

/**
 * Fails closed: if the profile can't be read, the session is not accepted. When the reason is that
 * Firestore is out of quota / unreachable, a ServiceUnavailableError is thrown (→ HTTP 503 and an
 * error page) instead of treating the session as revoked: answering "signed out" there sent the
 * user from /admin back to /login, where the still-valid cookie bounced them to /admin again.
 *
 * The profile comes from getSessionProfileServer (cached up to 30s per instance; every user write
 * drops it immediately in the instance that made it). Revocation by password change/reset,
 * logout, role or school change, deactivation or deletion is therefore enforced on the next
 * request in that instance and within 30 seconds on any other instance.
 */
async function checkSession(user: AuthenticatedUser): Promise<{ result: SessionCheckResult; mustChangePassword: boolean }> {
  try {
    const profile = await getSessionProfileServer(user.schoolId, user.uid);
    const result = evaluateSessionAgainstProfile(user, profile, hasAdminCredentials);
    let mustChangePassword = profile?.mustChangePassword === true;
    // The profile may come from a per-instance cache (up to 30s old). A cached "must change" is
    // confirmed against the database before it is enforced, so a teacher who has just replaced the
    // temporary password is never sent back to the change screen by an instance that has not yet
    // noticed. Only accounts that still owe a change pay this one extra read.
    if (result === "OK" && mustChangePassword) {
      const fresh = await getUserByIdServer(user.uid);
      mustChangePassword = fresh ? fresh.mustChangePassword === true : true;
    }
    return { result, mustChangePassword };
  } catch (e) {
    if (isServiceUnavailableError(e)) {
      logFirestoreOutage("session check", e);
      // SECURITY: restored to match this function's own doc comment above ("fails closed") —
      // a prior edit had this unconditionally `return "OK"`, which meant a revoked/suspended
      // account, or a session invalidated by a password change elsewhere, kept working for as
      // long as this one read kept failing. Throwing here is caught by each role layout
      // (ServiceBusyNotice) and shown as a recoverable "service busy" page instead.
      throw new ServiceUnavailableError(e);
    }
    // An unexpected (non-outage) failure: do not assume the session is still good. This is the
    // same fail-closed default the Firestore-authoritative branch above already uses for "no
    // profile found at all".
    console.error("Session revocation check failed:", (e as Error)?.message || "error");
    return { result: "PROFILE_MISSING", mustChangePassword: false };
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
  if (check.result !== "OK") {
    securityLog("auth.session_revoked", {
      subject: user.uid,
      role: user.role,
      schoolId: user.schoolId,
      reason: check.result,
      route: routeOf(req),
    });
    return null;
  }
  if (check.mustChangePassword) user.mustChangePassword = true;
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

  let user: AuthenticatedUser | null = null;
  try {
    user = await getAuthenticatedUser(req);
  } catch (e) {
    if (e instanceof ServiceUnavailableError) {
      // SECURITY: a prior edit here re-trusted the raw JWT claims directly on a confirmed
      // Firestore outage, bypassing checkSession's revocation check entirely (a revoked/
      // suspended account, or one whose password changed elsewhere, would keep working for as
      // long as the outage lasted). Explicitly declined when asked: this must fail closed, the
      // same way the page-layout boundary (ServiceBusyNotice) does — a 503 the caller/route
      // handler turns into its own "service busy" response, never a bypassed auth check.
      logFirestoreOutage("requireAuth", e);
      throw serviceBusyResponse();
    }
    throw e;
  }

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

  // A temporary password only opens the "choose your own password" step. Enforced here, on the
  // server, for every API route — a direct request to a teacher API (or a typed dashboard URL,
  // see requirePageRole) cannot bypass the screen the browser would have shown.
  if (user.mustChangePassword && !PASSWORD_CHANGE_EXEMPT_ROUTES.has(routeOf(req) || "")) {
    securityLog("authz.forbidden", {
      subject: user.uid,
      role: user.role,
      schoolId: user.schoolId,
      route: routeOf(req),
      method: req?.method,
      status: 403,
      reason: "password_change_required",
    });
    throw jsonError(403, {
      error: "You must change your temporary password before continuing.",
      code: "PASSWORD_CHANGE_REQUIRED",
      mustChangePassword: true,
    });
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
