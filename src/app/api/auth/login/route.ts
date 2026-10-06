import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmailServer, createAuditLogServer, updateUserServer } from "@/lib/firebase/server-db";
import { createSessionCookieServer, AuthenticatedUser, SESSION_COOKIE_OPTIONS } from "@/lib/firebase/server-auth";
import { dashboardPathForRole } from "@/lib/role-home";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { checkAuthRateLimit, recordAuthFailure, resetAuthRateLimit } from "@/lib/rate-limiter";
import { getClientIp } from "@/lib/request-security";
import { isRealDeployment } from "@/lib/session-token";
import { securityLog } from "@/lib/security-log";
import { isAdminMfaEnabled, verifyTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

/** Per-IP: 10 failures / 5 min. Per-account: 5 failures / 15 min, then a 15-minute lockout. */
const IP_MAX_FAILURES = 10;
const IP_WINDOW_SECONDS = 300;
export const ACCOUNT_MAX_FAILURES = 5;
export const ACCOUNT_LOCK_SECONDS = 900;

/**
 * A bcrypt hash of random bytes. Compared against when an account has no stored hash so the
 * response time doesn't reveal whether the email exists.
 */
const DUMMY_BCRYPT_HASH = "$2b$12$xQ7a8MMrUJkJfP.XdzZBPOBsLDNlTC8/Xv6RFJZGMkDEO/aemAkJq";

/**
 * Demo credentials from the README, accepted ONLY for local development against the in-memory
 * store: never in production, on Vercel, or when any real Firebase credential is configured.
 */
const DEV_CREDENTIALS: Record<string, string> = {
  "admin@alliedschool.edu": "AdminSecure2025#",
  "teacher@alliedschool.edu": "TeacherSecure2025#",
  "student@alliedschool.edu": "StudentSecure2025#",
  "parent@alliedschool.edu": "ParentSecure2025#",
};

function devLoginAllowed(): boolean {
  return !isRealDeployment() && !hasAdminCredentials;
}

const json = (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Content-Type": "application/json", ...headers } });

const INVALID_CREDENTIALS = "Invalid email or password.";

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req.headers);
  const ipKey = clientIp;

  const ipCheck = checkAuthRateLimit(ipKey, IP_MAX_FAILURES, IP_WINDOW_SECONDS);
  if (!ipCheck.allowed) {
    securityLog("auth.login_locked", { ip: clientIp, reason: "ip", status: 429 });
    return json(
      { error: `Too many login attempts. Please wait ${Math.ceil(ipCheck.resetInSeconds / 60)} minutes before trying again.` },
      429,
      { "Retry-After": String(ipCheck.resetInSeconds) }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON request payload." }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON request payload." }, 400);

  const identifier = (body.identifier || body.email || "").toString().trim().toLowerCase().slice(0, 254);
  const password = (body.password || "").toString().slice(0, 256);
  const idToken = (body.idToken || "").toString().slice(0, 4096);
  const totpCode = (body.totpCode || "").toString().trim().slice(0, 10);

  if (!identifier || (!password && !idToken)) {
    return json({ error: "Email address and password are required." }, 400);
  }

  // Per-account lockout (independent of IP, so a distributed guess against one account stops too).
  const accountKey = `login-acct:${identifier}`;
  const accountCheck = checkAuthRateLimit(accountKey, ACCOUNT_MAX_FAILURES, ACCOUNT_LOCK_SECONDS);
  if (!accountCheck.allowed) {
    securityLog("auth.login_locked", { subject: identifier, ip: clientIp, reason: "account", status: 429 });
    return json(
      {
        error: `Too many failed sign-in attempts for this account. Please wait ${Math.ceil(
          accountCheck.resetInSeconds / 60
        )} minutes, or use "Forgot password".`,
      },
      429,
      { "Retry-After": String(accountCheck.resetInSeconds) }
    );
  }

  const fail = (reason: string, message = INVALID_CREDENTIALS, status = 401) => {
    recordAuthFailure(ipKey, IP_MAX_FAILURES, IP_WINDOW_SECONDS);
    recordAuthFailure(accountKey, ACCOUNT_MAX_FAILURES, ACCOUNT_LOCK_SECONDS);
    securityLog("auth.login_failed", { subject: identifier, ip: clientIp, reason, status });
    return json({ error: message }, status);
  };

  try {
    // Who proved what. A Firebase Auth success only counts if the Firebase uid is the uid of the
    // profile this email maps to: Firebase accepts public self-sign-up with the web API key, so
    // "some Firebase account with this email exists" is NOT proof of being this school user.
    let firebaseUid: string | null = null;
    let devAuthenticated = false;
    let firebaseRejected = false;

    // 1. Firebase ID token from the browser SDK.
    if (idToken && hasAdminCredentials) {
      try {
        // checkRevoked: an ID token minted before a password reset/change (which revokes refresh
        // tokens) must not be able to open a new session.
        const decoded = await adminAuth.verifyIdToken(idToken, true);
        if (decoded.email?.toLowerCase().trim() === identifier) firebaseUid = decoded.uid;
      } catch {
        // fall through to password verification
      }
    }

    // 2. Password via Firebase Auth REST.
    if (!firebaseUid && password) {
      const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
      const isDummyKey = !apiKey || apiKey.includes("Dummy");

      if (apiKey && !isDummyKey) {
        try {
          const fbRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: identifier, password, returnSecureToken: true }),
            }
          );
          const fbData = await fbRes.json().catch(() => ({}));
          if (fbRes.ok && typeof fbData?.localId === "string") {
            firebaseUid = fbData.localId;
          } else {
            const msg = String(fbData?.error?.message || "");
            if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|USER_DISABLED|TOO_MANY_ATTEMPTS/.test(msg)) {
              firebaseRejected = true;
            }
          }
        } catch (fetchErr) {
          console.error("Firebase Auth REST API connection error:", (fetchErr as Error)?.message || "network error");
        }
      }

      // 3. Local development only: demo credentials against the in-memory store.
      if (!firebaseUid && devLoginAllowed() && DEV_CREDENTIALS[identifier]) {
        if (DEV_CREDENTIALS[identifier] === password) devAuthenticated = true;
        else return fail("bad_password");
      }
    }

    if (firebaseRejected) return fail("bad_password");

    // Profile lookup (also needed to bind the Firebase uid). If the database is unavailable and
    // nothing has proven the credentials yet, the answer is the same 401 as a wrong password.
    let user: Awaited<ReturnType<typeof getUserByEmailServer>> = null;
    try {
      user = await getUserByEmailServer(identifier);
    } catch (lookupErr) {
      if (!firebaseUid && !devAuthenticated) return fail("lookup_unavailable");
      throw lookupErr;
    }

    // Firebase account with role/school custom claims but no Firestore profile yet: provision it.
    if (!user && firebaseUid && hasAdminCredentials) {
      try {
        const fbUserRecord = await adminAuth.getUser(firebaseUid);
        // Role and tenant come ONLY from server-set custom claims (register / students / teachers /
        // link-parent all call setCustomUserClaims). Self-signed-up accounts have none.
        const claimedRole = fbUserRecord.customClaims?.role as AuthenticatedUser["role"] | undefined;
        const claimedSchoolId = fbUserRecord.customClaims?.schoolId as string | undefined;
        const VALID_ROLES: AuthenticatedUser["role"][] = ["ADMIN", "TEACHER", "STUDENT", "PARENT"];
        if (claimedRole && VALID_ROLES.includes(claimedRole) && claimedSchoolId && fbUserRecord.email?.toLowerCase() === identifier) {
          user = {
            uid: fbUserRecord.uid,
            email: identifier,
            name: fbUserRecord.displayName || identifier.split("@")[0],
            role: claimedRole,
            schoolId: claimedSchoolId,
            teacherId: (fbUserRecord.customClaims?.teacherId as string | undefined) || undefined,
            studentId: (fbUserRecord.customClaims?.studentId as string | undefined) || undefined,
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const { adminDb } = await import("@/lib/firebase/admin");
          await adminDb.collection("users").doc(fbUserRecord.uid).set(user, { merge: true });
        }
      } catch (adminErr) {
        console.warn("Could not auto-provision user from Firebase Auth:", (adminErr as Error)?.message || "error");
      }
    }

    let isAuthenticated = devAuthenticated && !!user;
    if (!isAuthenticated && firebaseUid && user && user.uid === firebaseUid) isAuthenticated = true;

    // 4. The app's own bcrypt hash (accounts created without Firebase Auth, or a Firebase account
    //    whose uid doesn't match the profile). Always runs a compare so timing doesn't reveal
    //    whether the email exists.
    if (!isAuthenticated && password) {
      const hash = user?.passwordHash || DUMMY_BCRYPT_HASH;
      const ok = await bcrypt.compare(password, hash);
      if (ok && user?.passwordHash) isAuthenticated = true;
    }

    if (!isAuthenticated) {
      if (firebaseUid && user && user.uid !== firebaseUid) {
        securityLog("auth.login_failed", { subject: identifier, ip: clientIp, reason: "firebase_uid_mismatch" });
      }
      return fail("bad_credentials", "Invalid email or password. Please verify your credentials.");
    }

    if (!user) {
      // Deliberately generic: credentials were valid somewhere, but no school profile exists.
      return fail("no_profile", "This account is not set up for access. Please contact your administrator.");
    }

    if (user.status === "INACTIVE" || user.status === "SUSPENDED") {
      securityLog("auth.login_failed", { subject: identifier, ip: clientIp, reason: "inactive", status: 403 });
      return json({ error: "Account is inactive or suspended. Please contact administrator." }, 403);
    }

    if (!user.schoolId) {
      return json({ error: "User account is not linked to a school." }, 403);
    }

    // Optional TOTP second factor for administrators (ADMIN_MFA_ENABLED=true and enrolled).
    if (user.role === "ADMIN" && isAdminMfaEnabled() && user.mfaEnabled && user.mfaSecret) {
      if (!totpCode) {
        return json({ mfaRequired: true, error: "Enter the 6-digit code from your authenticator app." }, 401);
      }
      const step = verifyTotp(user.mfaSecret, totpCode, { lastUsedStep: user.mfaLastUsedStep });
      if (step === null) {
        securityLog("auth.mfa_failed", { subject: identifier, ip: clientIp, role: user.role, schoolId: user.schoolId });
        recordAuthFailure(accountKey, ACCOUNT_MAX_FAILURES, ACCOUNT_LOCK_SECONDS);
        recordAuthFailure(ipKey, IP_MAX_FAILURES, IP_WINDOW_SECONDS);
        return json({ mfaRequired: true, error: "Invalid or expired authentication code." }, 401);
      }
      await updateUserServer({ ...user, mfaLastUsedStep: step });
    }

    resetAuthRateLimit(ipKey);
    resetAuthRateLimit(accountKey);

    const sessionData: AuthenticatedUser = {
      uid: user.uid,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      name: user.name,
      teacherId: user.teacherId,
      studentId: user.studentId,
      studentIds: user.studentIds,
    };

    const token = await createSessionCookieServer(sessionData);

    try {
      await createAuditLogServer(
        sessionData.schoolId,
        user.uid,
        user.email,
        user.role,
        "LOGIN",
        "AUTH",
        user.uid,
        `User successfully logged in with role ${user.role}.`
      );
    } catch (auditErr) {
      console.warn("Audit log creation during login skipped:", (auditErr as Error)?.message || "error");
    }
    securityLog("auth.login_succeeded", { subject: user.uid, ip: clientIp, role: user.role, schoolId: user.schoolId });

    const response = NextResponse.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        role: user.role,
        schoolId: sessionData.schoolId,
        name: user.name,
      },
      redirectUrl: dashboardPathForRole(user.role),
    });

    response.cookies.set("allied_session", token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error: any) {
    console.error("Login route error:", error?.message || "error");
    securityLog("server.error", { route: "/api/auth/login", status: 500 });
    return json({ error: "Authentication service error. Please try again." }, 500);
  }
}
