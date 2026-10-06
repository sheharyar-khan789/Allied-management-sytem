import { NextRequest, NextResponse } from "next/server";
import { getUserByEmailServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { sendPasswordSetupLink } from "@/lib/account-email";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/rate-limiter";
import { getClientIp, rejectCrossSite } from "@/lib/request-security";
import { securityLog } from "@/lib/security-log";

/** Reset emails per address per hour; beyond this the request is silently dropped (same response). */
const PER_EMAIL_MAX = 5;
const PER_EMAIL_WINDOW_SECONDS = 3600;

export const dynamic = "force-dynamic";

const GENERIC_SUCCESS_RESPONSE = {
  success: true,
  message: "If an account is associated with this email address, a password reset link has been dispatched.",
};

export async function POST(req: NextRequest) {
  const csrfBlocked = rejectCrossSite(req);
  if (csrfBlocked) return csrfBlocked;
  // Extract client IP for rate limiting
  const clientIp = getClientIp(req.headers);

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

  const rawEmail = (body?.email || body?.identifier || "").toString().trim().toLowerCase().slice(0, 254);

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

  // Per-address limit stops mail-bombing one inbox from many IPs. The response stays identical
  // so it can't be used to learn whether the address exists.
  const emailKey = `forgot-email:${rawEmail}`;
  if (!checkAuthRateLimit(emailKey, PER_EMAIL_MAX, PER_EMAIL_WINDOW_SECONDS).allowed) {
    securityLog("auth.reset_rate_limited", { subject: rawEmail, ip: clientIp, reason: "per_email" });
    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  }
  recordAuthFailure(emailKey, PER_EMAIL_MAX, PER_EMAIL_WINDOW_SECONDS);

  try {
    const user = await getUserByEmailServer(rawEmail);

    // Prevent account enumeration: unknown/inactive accounts get the same response.
    if (!user || user.status === "SUSPENDED" || user.status === "INACTIVE") {
      return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
    }

    const delivery = await sendPasswordSetupLink(user, "RESET", {
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
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
