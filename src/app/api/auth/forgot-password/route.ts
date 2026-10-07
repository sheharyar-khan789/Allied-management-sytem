import { NextRequest, NextResponse } from "next/server";
import { getUserByEmailServer, createAuditLogServer, getStudentByIdServer, getStudentByUserIdServer } from "@/lib/firebase/server-db";
import { sendPasswordSetupLink } from "@/lib/account-email";
import { UserProfile } from "@/lib/firebase/types";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/rate-limiter";
import { getClientIp, rejectCrossSite } from "@/lib/request-security";
import { securityLog } from "@/lib/security-log";

/** Reset emails per address per hour; beyond this the request is silently dropped (same response). */
const PER_EMAIL_MAX = 5;
const PER_EMAIL_WINDOW_SECONDS = 3600;

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where a reset link for `user` can actually be read. Staff and parents sign in with their own
 * email address, so it goes there. A STUDENT signs in with an address the system generated at
 * enrolment (student.<first>.<last>@<school domain>) — no mailbox exists behind it, so every
 * student reset link was sent to a dead (or, on a shared domain, somebody else's) inbox and the
 * flow could never complete. A student's link goes to the guardian email the admin recorded on
 * the student record instead; with none on file nothing is sent (and the response is unchanged).
 */
async function resolveResetRecipient(
  user: UserProfile
): Promise<{ ok: true; deliverTo?: { email: string; name?: string } } | { ok: false; reason: string }> {
  if (user.role !== "STUDENT") return { ok: true };
  const student = user.studentId
    ? await getStudentByIdServer(user.schoolId, user.studentId)
    : await getStudentByUserIdServer(user.schoolId, user.uid);
  if (!student || student.schoolId !== user.schoolId) return { ok: false, reason: "student record not found" };
  const guardianEmail = (student.guardianEmail || "").trim().toLowerCase();
  if (!guardianEmail || !EMAIL_RE.test(guardianEmail) || guardianEmail === user.email.toLowerCase()) {
    return { ok: false, reason: "no guardian email on the student record" };
  }
  return { ok: true, deliverTo: { email: guardianEmail, name: student.guardianName || undefined } };
}

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

    const recipient = await resolveResetRecipient(user);
    if (!recipient.ok) {
      securityLog("auth.reset_no_recipient", { subject: user.uid, role: user.role, schoolId: user.schoolId, reason: recipient.reason });
      await createAuditLogServer(
        user.schoolId, user.uid, user.email, user.role,
        "PASSWORD_RESET_EMAIL_FAILED", "AUTH", user.uid,
        `Password reset for ${user.email} was NOT sent: ${recipient.reason}. Add a guardian email to the student record.`
      );
      return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
    }

    const delivery = await sendPasswordSetupLink(
      user,
      "RESET",
      { origin: req.headers.get("origin"), host: req.headers.get("host") },
      process.env,
      recipient.deliverTo
    );

    await createAuditLogServer(
      user.schoolId,
      user.uid,
      user.email,
      user.role,
      delivery.delivered ? "FORGOT_PASSWORD_REQUEST" : "PASSWORD_RESET_EMAIL_FAILED",
      "AUTH",
      user.uid,
      delivery.delivered
        ? `Password reset link for ${user.email} emailed to ${recipient.deliverTo ? "the guardian email on file" : user.email} via ${delivery.mode}.`
        : `Password reset email to ${user.email} was NOT delivered (${delivery.mode}): ${delivery.message}`
    );

    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  } catch (err: any) {
    console.error("Forgot password handler error:", err?.message || err);
    // Same response on internal errors to avoid revealing account existence.
    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  }
}
