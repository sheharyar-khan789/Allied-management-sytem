import { NextRequest, NextResponse } from "next/server";
import {
  getUserByEmailServer,
  getSchoolSettingsServer,
  createAuditLogServer,
  savePasswordResetTokenServer,
} from "@/lib/firebase/server-db";
import { sendPasswordResetEmail } from "@/lib/email-service";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/rate-limiter";
import {
  buildResetUrl,
  generateResetToken,
  resolveAppBaseUrl,
  RESET_TOKEN_TTL_MS,
} from "@/lib/password-reset";

export const dynamic = "force-dynamic";

const GENERIC_SUCCESS_RESPONSE = {
  success: true,
  message: "If an account is associated with this email address, a password reset link has been dispatched.",
};

export async function POST(req: NextRequest) {
  // Extract client IP for rate limiting
  const forwarded = req.headers.get("x-forwarded-for");
  const clientIp = forwarded ? forwarded.split(",")[0].trim() : (req.headers.get("x-real-ip") || "127.0.0.1");

  // Rate limit: max 5 forgot-password requests per 15 minutes per IP
  const rateKey = `forgot-pwd:${clientIp}`;
  const rateCheck = checkAuthRateLimit(rateKey, 5, 900);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: `Too many password reset requests. Please wait ${Math.ceil(rateCheck.resetInSeconds / 60)} minutes before trying again.` },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateCheck.resetInSeconds),
          "Content-Type": "application/json",
        },
      }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request payload." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const rawEmail = (body.email || body.identifier || "").toString().trim().toLowerCase();

  // Basic email syntax validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!rawEmail || !emailRegex.test(rawEmail)) {
    return NextResponse.json(
      { error: "A valid email address is required." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Record this attempt against rate limiter
  recordAuthFailure(rateKey, 5, 900);

  try {
    const user = await getUserByEmailServer(rawEmail);

    // Prevent account enumeration: unknown/inactive accounts get the same response.
    if (!user || user.status === "SUSPENDED" || user.status === "INACTIVE") {
      return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
    }

    const base = resolveAppBaseUrl({
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
    });
    if (!base.ok) {
      console.error(`[PASSWORD RESET] Not sent — ${base.reason}`);
      await createAuditLogServer(
        user.schoolId, user.uid, user.email, user.role,
        "PASSWORD_RESET_EMAIL_FAILED", "AUTH", user.uid,
        `Password reset requested but not sent: ${base.reason}`
      );
      return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
    }

    // 256-bit random token; only its SHA-256 hash is stored. Issuing a new one deletes any
    // earlier tokens for this user, so only the latest emailed link works.
    const { token, tokenHash } = generateResetToken();
    const nowMs = Date.now();
    await savePasswordResetTokenServer({
      id: tokenHash,
      uid: user.uid,
      email: user.email,
      schoolId: user.schoolId,
      expiresAt: new Date(nowMs + RESET_TOKEN_TTL_MS).toISOString(),
      usedAt: null,
      createdAt: new Date(nowMs).toISOString(),
    });

    const schoolSettings = await getSchoolSettingsServer(user.schoolId);
    const schoolName = schoolSettings?.schoolName || "Allied School Management System";

    // Always sent to the email stored on the matched account profile.
    const delivery = await sendPasswordResetEmail({
      to: user.email,
      recipientName: user.name || "User",
      schoolName,
      resetUrl: buildResetUrl(base.baseUrl, token),
    });

    await createAuditLogServer(
      user.schoolId,
      user.uid,
      user.email,
      user.role,
      delivery.delivered ? "FORGOT_PASSWORD_REQUEST" : "PASSWORD_RESET_EMAIL_FAILED",
      "AUTH",
      user.uid,
      delivery.delivered
        ? `Password reset link emailed to ${user.email} via ${delivery.mode}.`
        : `Password reset email to ${user.email} was NOT delivered (${delivery.mode}): ${delivery.message}`
    );

    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  } catch (err: any) {
    console.error("Forgot password handler error:", err?.message || err);
    // Same response on internal errors to avoid revealing account existence.
    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  }
}
