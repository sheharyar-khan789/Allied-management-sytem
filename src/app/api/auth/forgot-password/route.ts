import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getUserByEmailServer, updateUserServer, getSchoolSettingsServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { createPasswordResetTokenServer } from "@/lib/firebase/server-auth";
import { sendPasswordResetEmail } from "@/lib/email-service";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";

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

  const GENERIC_SUCCESS_RESPONSE = {
    success: true,
    message: "If an account is associated with this email address, a password reset link has been dispatched.",
  };

  try {
    const user = await getUserByEmailServer(rawEmail);

    // Constant-time protection / prevent account enumeration:
    // If user does not exist, return generic success without revealing existence
    if (!user || user.status === "SUSPENDED" || user.status === "INACTIVE") {
      return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
    }

    // 1. Generate cryptographically signed single-use JWT token (15-minute expiry)
    const token = await createPasswordResetTokenServer({
      uid: user.uid,
      email: user.email,
      schoolId: user.schoolId,
    });

    // 2. Hash token for single-use database verification
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // 3. Store active token hash on user record
    await updateUserServer({
      ...user,
      resetTokenHash: tokenHash,
      resetTokenExpires: expiresAt,
    });

    // 4. Resolve production-ready reset URL
    const origin =
      req.headers.get("origin") ||
      (req.headers.get("host") ? `https://${req.headers.get("host")}` : null) ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const resetUrl = `${origin.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;

    // 5. Fetch school details for branded email
    const schoolSettings = await getSchoolSettingsServer(user.schoolId);
    const schoolName = schoolSettings?.schoolName || "Allied School Management System";

    // 6. Dispatch email via delivery abstraction
    await sendPasswordResetEmail({
      to: user.email,
      recipientName: user.name || "User",
      schoolName,
      resetUrl,
    });

    // 7. Audit log
    await createAuditLogServer(
      user.schoolId,
      user.uid,
      user.email,
      user.role,
      "FORGOT_PASSWORD_REQUEST",
      "AUTH",
      user.uid,
      `Password reset token generated and dispatched for ${user.email}.`
    );

    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  } catch (err: any) {
    console.error("Forgot password handler error:", err);
    // Return standard message even on unexpected internal error to prevent timing attacks
    return NextResponse.json(GENERIC_SUCCESS_RESPONSE);
  }
}
