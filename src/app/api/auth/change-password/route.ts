import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  requireAuth,
  createSessionCookieServer,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/firebase/server-auth";
import { getUserByIdServer, updateUserServer } from "@/lib/firebase/server-db";
import { setAuthPasswordServer } from "@/lib/firebase/auth-password";
import { BCRYPT_COST, checkPasswordPolicy } from "@/lib/password-reset";
import { checkAuthRateLimit, recordAuthFailure, resetAuthRateLimit } from "@/lib/rate-limiter";
import { securityLog } from "@/lib/security-log";

/** Wrong current-password guesses allowed per account before a 15-minute cooldown. */
const CHANGE_MAX_FAILURES = 5;
const CHANGE_LOCK_SECONDS = 900;

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req);
    // A stolen session must not become an oracle for guessing the account's current password.
    const rateKey = `change-pwd:${authUser.uid}`;
    const rate = checkAuthRateLimit(rateKey, CHANGE_MAX_FAILURES, CHANGE_LOCK_SECONDS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Please wait ${Math.ceil(rate.resetInSeconds / 60)} minutes.` },
        { status: 429, headers: { "Retry-After": String(rate.resetInSeconds) } }
      );
    }
    let body: { currentPassword?: string; newPassword?: string; userId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
    }

    const currentPassword = (body.currentPassword || "").toString();
    const newPassword = (body.newPassword || "").toString();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required." },
        { status: 400 }
      );
    }

    const policyError = checkPasswordPolicy(newPassword, { email: authUser.email, name: authUser.name });
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current password." },
        { status: 400 }
      );
    }

    const profile = await getUserByIdServer(authUser.uid);
    if (!profile) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    let currentOk = false;
    if (profile.passwordHash) {
      currentOk = await bcrypt.compare(currentPassword, profile.passwordHash);
    }

    if (!currentOk) {
      const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
      const isDummyKey = !apiKey || apiKey.includes("Dummy") || apiKey.includes("AIzaSyDummy");
      if (apiKey && !isDummyKey) {
        try {
          const fbRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: authUser.email,
                password: currentPassword,
                returnSecureToken: false,
              }),
            }
          );
          // Only the Firebase account that IS this profile counts (see the login route).
          const fbData = await fbRes.json().catch(() => ({}));
          currentOk = fbRes.ok && fbData?.localId === authUser.uid;
        } catch {
          currentOk = false;
        }
      }
    }

    if (!currentOk) {
      recordAuthFailure(rateKey, CHANGE_MAX_FAILURES, CHANGE_LOCK_SECONDS);
      securityLog("auth.password_change_failed", { subject: authUser.uid, role: authUser.role, schoolId: authUser.schoolId });
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }
    resetAuthRateLimit(rateKey);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    try {
      await setAuthPasswordServer(profile, newPassword);
    } catch (authErr: any) {
      console.error("Failed to update authentication password:", authErr?.code || authErr?.message);
      return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
    }

    // Every session signed in before this moment (other devices/browsers) stops working;
    // the caller's own session is re-issued below with a fresh sign-in time.
    const changedAt = new Date();
    const { passwordHash: _omit, ...safeProfile } = profile;
    void _omit;
    await updateUserServer({
      ...safeProfile,
      passwordHash,
      sessionsValidAfter: changedAt.toISOString(),
    });

    const token = await createSessionCookieServer({
      uid: authUser.uid,
      email: authUser.email,
      role: authUser.role,
      schoolId: authUser.schoolId,
      name: authUser.name,
      teacherId: authUser.teacherId,
      studentId: authUser.studentId,
      studentIds: authUser.studentIds,
      authAt: Math.floor(changedAt.getTime() / 1000),
    });
    securityLog("auth.password_changed", { subject: authUser.uid, role: authUser.role, schoolId: authUser.schoolId });
    const response = NextResponse.json({ success: true });
    response.cookies.set("allied_session", token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Change password error:", (error as Error)?.message || "error");
    return NextResponse.json({ error: "Failed to change password." }, { status: 500 });
  }
}
