import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { createAuditLogServer, deleteUserFieldsServer, getUserByIdServer, updateUserServer } from "@/lib/firebase/server-db";
import { verifyAccountPasswordServer } from "@/lib/firebase/auth-password";
import { generateTotpSecret, isAdminMfaEnabled, otpauthUri, verifyTotp } from "@/lib/totp";
import { checkAuthRateLimit, recordAuthFailure, resetAuthRateLimit } from "@/lib/rate-limiter";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";

const MFA_MAX_FAILURES = 5;
const MFA_LOCK_SECONDS = 900;

/**
 * Admin TOTP two-factor enrollment. Available only when ADMIN_MFA_ENABLED=true.
 *   GET                              -> { featureEnabled, enrolled }
 *   POST { action: "setup" }         -> new pending secret + otpauth:// URI (not active yet)
 *   POST { action: "enable", code, password } -> activates the pending secret after one valid code
 *                                       and the current password (a stolen session alone can't
 *                                       enrol an attacker's authenticator and lock the admin out)
 *   POST { action: "disable", code, password } -> turns it off (needs a current code AND password)
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const profile = await getUserByIdServer(authUser.uid);
    return NextResponse.json({ featureEnabled: isAdminMfaEnabled(), enrolled: Boolean(profile?.mfaEnabled) });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Failed to read two-factor status." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    if (!isAdminMfaEnabled()) {
      return NextResponse.json({ error: "Two-factor authentication is not enabled on this deployment." }, { status: 404 });
    }
    const body = (await req.json().catch(() => null)) as { action?: string; code?: string; password?: string } | null;
    const action = body?.action;
    const profile = await getUserByIdServer(authUser.uid);
    if (!profile) return NextResponse.json({ error: "User profile not found." }, { status: 404 });

    const rateKey = `mfa:${authUser.uid}`;
    if (action !== "setup" && !checkAuthRateLimit(rateKey, MFA_MAX_FAILURES, MFA_LOCK_SECONDS).allowed) {
      return NextResponse.json({ error: "Too many attempts. Please wait 15 minutes." }, { status: 429 });
    }

    if (action === "setup") {
      if (profile.mfaEnabled) {
        return NextResponse.json({ error: "Two-factor authentication is already enabled." }, { status: 409 });
      }
      const secret = generateTotpSecret();
      await updateUserServer({ ...profile, mfaPendingSecret: secret });
      // Returned once to the signed-in admin so they can add it to an authenticator app.
      return NextResponse.json({ secret, otpauthUri: otpauthUri(secret, profile.email) });
    }

    if (action === "enable") {
      if (!profile.mfaPendingSecret) {
        return NextResponse.json({ error: "Start setup first." }, { status: 400 });
      }
      const step = verifyTotp(profile.mfaPendingSecret, body?.code);
      const passwordOk = typeof body?.password === "string" && (await verifyAccountPasswordServer(profile, body.password));
      if (step === null || !passwordOk) {
        recordAuthFailure(rateKey, MFA_MAX_FAILURES, MFA_LOCK_SECONDS);
        securityLog("auth.mfa_failed", { subject: authUser.uid, role: authUser.role, schoolId: authUser.schoolId, reason: "enable" });
        return NextResponse.json(
          { error: step === null ? "That code is not valid. Check the time on your phone and try again." : "Your current password is required." },
          { status: 400 }
        );
      }
      resetAuthRateLimit(rateKey);
      const { mfaPendingSecret, ...rest } = profile;
      await updateUserServer({ ...rest, mfaEnabled: true, mfaSecret: mfaPendingSecret, mfaLastUsedStep: step });
      await deleteUserFieldsServer(authUser.uid, ["mfaPendingSecret"]);
      await createAuditLogServer(authUser.schoolId, authUser.uid, authUser.email, authUser.role, "MFA_ENABLED", "AUTH", authUser.uid, "Two-factor authentication enabled.");
      return NextResponse.json({ success: true, enrolled: true });
    }

    if (action === "disable") {
      if (!profile.mfaEnabled || !profile.mfaSecret) {
        return NextResponse.json({ error: "Two-factor authentication is not enabled." }, { status: 400 });
      }
      const step = verifyTotp(profile.mfaSecret, body?.code, { lastUsedStep: profile.mfaLastUsedStep });
      const passwordOk = typeof body?.password === "string" && (await verifyAccountPasswordServer(profile, body.password));
      if (step === null || !passwordOk) {
        recordAuthFailure(rateKey, MFA_MAX_FAILURES, MFA_LOCK_SECONDS);
        securityLog("auth.mfa_failed", { subject: authUser.uid, role: authUser.role, schoolId: authUser.schoolId, reason: "disable" });
        return NextResponse.json({ error: "A valid code and your current password are required." }, { status: 400 });
      }
      resetAuthRateLimit(rateKey);
      // Merge writes keep omitted fields, so the secret is explicitly deleted.
      await deleteUserFieldsServer(authUser.uid, ["mfaSecret", "mfaPendingSecret", "mfaLastUsedStep"]);
      await updateUserServer({ ...profile, mfaEnabled: false, mfaSecret: undefined, mfaPendingSecret: undefined, mfaLastUsedStep: undefined });
      await createAuditLogServer(authUser.schoolId, authUser.uid, authUser.email, authUser.role, "MFA_DISABLED", "AUTH", authUser.uid, "Two-factor authentication disabled.");
      return NextResponse.json({ success: true, enrolled: false });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("MFA route error:", (error as Error)?.message || "error");
    return NextResponse.json({ error: "Two-factor request failed." }, { status: 500 });
  }
}
