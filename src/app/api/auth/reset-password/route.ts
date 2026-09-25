import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getUserByIdServer, updateUserServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { verifyPasswordResetTokenServer } from "@/lib/firebase/server-auth";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

function isValidPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request payload." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = (body.token || "").toString().trim();
  const newPassword = (body.newPassword || body.password || "").toString();

  if (!token) {
    return NextResponse.json(
      { error: "Password reset token is required." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!newPassword || !isValidPassword(newPassword)) {
    return NextResponse.json(
      { error: "New password must be between 8 and 128 characters in length." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // 1. Verify token signature, purpose, and expiration
    const payload = await verifyPasswordResetTokenServer(token);
    if (!payload || !payload.uid) {
      return NextResponse.json(
        { error: "Invalid or expired password reset link. Please request a new link." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch user profile
    const user = await getUserByIdServer(payload.uid);
    if (!user) {
      return NextResponse.json(
        { error: "Account associated with this reset link was not found." },
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Verify single-use token hash against stored active hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (
      !user.resetTokenHash ||
      user.resetTokenHash !== tokenHash ||
      !user.resetTokenExpires ||
      new Date(user.resetTokenExpires).getTime() < Date.now()
    ) {
      return NextResponse.json(
        { error: "This password reset link has already been used or has expired. Please request a new link." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Hash new password for Firestore local auth fallback
    const passwordHash = bcrypt.hashSync(newPassword, 10);

    // 5. Update Firebase Auth if live admin credentials exist
    if (hasAdminCredentials) {
      try {
        await adminAuth.updateUser(user.uid, { password: newPassword });
      } catch (authErr) {
        console.error("Firebase Admin updateUser failed during password reset:", authErr);
        // Continue to update local hash so the user can still authenticate via bcrypt fallback
      }
    }

    // 6. Invalidate reset token and save updated password hash to Firestore
    const { resetTokenHash: _rth, resetTokenExpires: _rte, ...cleanProfile } = user;
    void _rth;
    void _rte;

    await updateUserServer({
      ...cleanProfile,
      passwordHash,
    });

    // 7. Audit log
    await createAuditLogServer(
      user.schoolId,
      user.uid,
      user.email,
      user.role,
      "PASSWORD_RESET_COMPLETED",
      "AUTH",
      user.uid,
      `Password successfully reset for ${user.email}.`
    );

    return NextResponse.json({
      success: true,
      message: "Your password has been reset successfully. You can now log in with your new password.",
    });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
