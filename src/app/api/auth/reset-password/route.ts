import { NextRequest, NextResponse } from "next/server";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import bcrypt from "bcryptjs";
import {
  getUserByIdServer,
  getUserByEmailServer,
  updateUserServer,
  revokeUserSessionsServer,
  createAuditLogServer,
  getPasswordResetTokenServer,
  checkPasswordResetToken,
  consumePasswordResetTokenServer,
  ConsumeResetTokenResult,
} from "@/lib/firebase/server-db";
import { confirmFirebasePasswordResetServer, setAuthPasswordServer } from "@/lib/firebase/auth-password";
import { BCRYPT_COST, checkPasswordPolicy, hashResetToken, looksLikeResetToken } from "@/lib/password-reset";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/rate-limiter";
import { getClientIp, rejectCrossSite } from "@/lib/request-security";
import { securityLog } from "@/lib/security-log";

/** Reset submissions per IP per 15 minutes (tokens are 256-bit; this caps abuse and noise). */
const RESET_MAX_ATTEMPTS = 10;
const RESET_WINDOW_SECONDS = 900;

export const dynamic = "force-dynamic";

const TOKEN_ERRORS: Record<Exclude<ConsumeResetTokenResult, "OK">, string> = {
  INVALID: "This password reset link is invalid. Please request a new link.",
  USED: "This password reset link has already been used. Please request a new link.",
  EXPIRED: "This password reset link has expired. Please request a new link.",
};

function tokenError(status: Exclude<ConsumeResetTokenResult, "OK">) {
  return NextResponse.json({ error: TOKEN_ERRORS[status], code: status }, { status: 400 });
}

/**
 * GET /api/auth/reset-password?token=… OR ?oobCode=…
 *
 * Pre-validates the link before the password form is shown. Returning a clear
 * `{ valid: false, code, error }` response is what allows the client to show an
 * appropriate "link expired / already used / invalid" state immediately, rather than
 * staying on an endless loading screen. Does NOT consume or change the token.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = (searchParams.get("token") || "").trim();
  const oobCode = (searchParams.get("oobCode") || "").trim();

  if (!token && !oobCode) {
    return NextResponse.json({ valid: false, code: "MISSING", error: "No token or oobCode provided." }, { status: 400 });
  }

  try {
    // Firebase oobCode path: probe by attempting a verifyPasswordResetCode. This does NOT consume it.
    if (!token && oobCode) {
      const { verifyFirebasePasswordResetCodeServer } = await import("@/lib/firebase/auth-password");
      const result = await verifyFirebasePasswordResetCodeServer(oobCode);
      if (!result.ok) {
        return NextResponse.json({ valid: false, code: result.status, error: TOKEN_ERRORS[result.status as Exclude<ConsumeResetTokenResult, "OK">] || "This link is invalid or has expired." }, { status: 400 });
      }
      return NextResponse.json({ valid: true, email: result.email, purpose: "RESET" });
    }

    // App token path
    if (!looksLikeResetToken(token)) {
      return NextResponse.json({ valid: false, code: "INVALID", error: TOKEN_ERRORS.INVALID }, { status: 400 });
    }
    const tokenHash = hashResetToken(token);
    const record = await getPasswordResetTokenServer(tokenHash);
    const status = checkPasswordResetToken(record);
    if (status !== "OK") {
      return NextResponse.json({ valid: false, code: status, error: TOKEN_ERRORS[status] }, { status: 400 });
    }
    const user = await getUserByIdServer(record!.uid);
    // record.uid (bound to the token hash at creation) already uniquely and authoritatively
    // identifies the account — record.email is only the delivery address, which is deliberately
    // the guardian's email for a STUDENT with no real mailbox (resolveResetRecipient), not the
    // account's own sign-in email. Comparing them would reject every legitimate student reset.
    if (!user) {
      return NextResponse.json({ valid: false, code: "INVALID", error: TOKEN_ERRORS.INVALID }, { status: 400 });
    }
    if (user.status === "SUSPENDED" || user.status === "INACTIVE") {
      return NextResponse.json({ valid: false, code: "INVALID", error: "This account is inactive. Please contact your administrator." }, { status: 400 });
    }
    return NextResponse.json({ valid: true, email: user.email, purpose: record!.purpose || "RESET" });
  } catch (error: any) {
    const busy = serviceBusyResponseFor(error, "GET /api/auth/reset-password");
    if (busy) return busy;
    console.error("Reset password validation error:", error?.code || error?.message || error);
    return NextResponse.json({ valid: false, code: "SERVER_ERROR", error: "Validation failed. Please try again." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const csrfBlocked = rejectCrossSite(req);
  if (csrfBlocked) return csrfBlocked;
  const clientIp = getClientIp(req.headers);
  const rateKey = `reset-pwd:${clientIp}`;
  const rate = checkAuthRateLimit(rateKey, RESET_MAX_ATTEMPTS, RESET_WINDOW_SECONDS);
  if (!rate.allowed) {
    securityLog("auth.reset_rate_limited", { ip: clientIp, status: 429 });
    return NextResponse.json(
      { error: `Too many password reset attempts. Please wait ${Math.ceil(rate.resetInSeconds / 60)} minutes.` },
      { status: 429, headers: { "Retry-After": String(rate.resetInSeconds) } }
    );
  }
  recordAuthFailure(rateKey, RESET_MAX_ATTEMPTS, RESET_WINDOW_SECONDS);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  const token = (body.token || "").toString().trim();
  const oobCode = (body.oobCode || "").toString().trim();
  const newPassword = (body.newPassword || body.password || "").toString();

  if (!token && !oobCode) {
    return NextResponse.json({ error: "Password reset token is required." }, { status: 400 });
  }

  const basicPolicyError = checkPasswordPolicy(newPassword);
  if (basicPolicyError) {
    return NextResponse.json({ error: basicPolicyError }, { status: 400 });
  }

  // A Firebase Authentication action code (the link from Firebase's own password email, when the
  // project's email action URL points at this page). Firebase verifies the single-use code and
  // sets the password; this app then mirrors it and signs out existing sessions.
  if (!token) {
    try {
      const confirmed = await confirmFirebasePasswordResetServer(oobCode, newPassword);
      if (!confirmed.ok) return tokenError(confirmed.status);
      const user = await getUserByEmailServer(confirmed.email);
      if (user) {
        const nowIso = new Date().toISOString();
        await updateUserServer({ ...user, passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST) });
        await revokeUserSessionsServer(user.uid, nowIso);
        await createAuditLogServer(
          user.schoolId, user.uid, user.email, user.role,
          "PASSWORD_RESET_COMPLETED", "AUTH", user.uid,
          `Password set for ${user.email} via Firebase action link; existing sessions revoked.`
        );
      }
      return NextResponse.json({
        success: true,
        message: "Your password has been set successfully. You can now log in with your new password.",
      });
    } catch (error: any) {
      const busy = serviceBusyResponseFor(error, "/api/auth/reset-password");
      if (busy) return busy;
      console.error("Reset password (action code) error:", error?.code || error?.message || error);
      return NextResponse.json({ error: "Failed to reset password. Please try again." }, { status: 500 });
    }
  }

  if (!looksLikeResetToken(token)) return tokenError("INVALID");

  try {
    const tokenHash = hashResetToken(token);
    const record = await getPasswordResetTokenServer(tokenHash);
    const status = checkPasswordResetToken(record);
    if (status !== "OK") return tokenError(status);

    const user = await getUserByIdServer(record!.uid);
    // record.uid (bound to the token hash at creation) already uniquely and authoritatively
    // identifies the account — record.email is only the delivery address, which is deliberately
    // the guardian's email for a STUDENT with no real mailbox (resolveResetRecipient), not the
    // account's own sign-in email. Comparing them would reject every legitimate student reset.
    if (!user) return tokenError("INVALID");
    if (user.status === "SUSPENDED" || user.status === "INACTIVE") return tokenError("INVALID");
    const policyError = checkPasswordPolicy(newPassword, { email: user.email, name: user.name });
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });

    // Firebase Auth first: if it fails, nothing is consumed and the link stays usable.
    await setAuthPasswordServer(user, newPassword);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const consumed = await consumePasswordResetTokenServer(tokenHash, user.uid, passwordHash);
    if (consumed !== "OK") return tokenError(consumed);

    const activation = record!.purpose === "ACTIVATION";
    securityLog("auth.password_reset_completed", { subject: user.uid, role: user.role, schoolId: user.schoolId, reason: record!.purpose || "RESET" });
    await createAuditLogServer(
      user.schoolId,
      user.uid,
      user.email,
      user.role,
      activation ? "ACCOUNT_ACTIVATED" : "PASSWORD_RESET_COMPLETED",
      "AUTH",
      user.uid,
      activation
        ? `Account activated: ${user.email} set their own password.`
        : `Password reset completed for ${user.email}; existing sessions revoked.`
    );

    return NextResponse.json({
      success: true,
      message: activation
        ? "Your password has been set and your account is active. You can now log in."
        : "Your password has been reset successfully. You can now log in with your new password.",
    });
  } catch (error: any) {
    const busy = serviceBusyResponseFor(error, "/api/auth/reset-password");
    if (busy) return busy;
    console.error("Reset password error:", error?.code || error?.message || error);
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500 }
    );
  }
}
