import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
  getUserByIdServer,
  createAuditLogServer,
  getPasswordResetTokenServer,
  checkPasswordResetToken,
  consumePasswordResetTokenServer,
  ConsumeResetTokenResult,
} from "@/lib/firebase/server-db";
import { setAuthPasswordServer } from "@/lib/firebase/auth-password";
import { hashResetToken, isValidPassword, looksLikeResetToken } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

const TOKEN_ERRORS: Record<Exclude<ConsumeResetTokenResult, "OK">, string> = {
  INVALID: "This password reset link is invalid. Please request a new link.",
  USED: "This password reset link has already been used. Please request a new link.",
  EXPIRED: "This password reset link has expired. Please request a new link.",
};

function tokenError(status: Exclude<ConsumeResetTokenResult, "OK">) {
  return NextResponse.json({ error: TOKEN_ERRORS[status], code: status }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
  }

  const token = (body.token || "").toString().trim();
  const newPassword = (body.newPassword || body.password || "").toString();

  if (!token) {
    return NextResponse.json({ error: "Password reset token is required." }, { status: 400 });
  }

  if (!isValidPassword(newPassword)) {
    return NextResponse.json(
      { error: "New password must be between 8 and 128 characters in length." },
      { status: 400 }
    );
  }

  if (!looksLikeResetToken(token)) return tokenError("INVALID");

  try {
    const tokenHash = hashResetToken(token);
    const record = await getPasswordResetTokenServer(tokenHash);
    const status = checkPasswordResetToken(record);
    if (status !== "OK") return tokenError(status);

    const user = await getUserByIdServer(record!.uid);
    // The link is bound to the account and the email it was sent to.
    if (!user || user.email.toLowerCase() !== record!.email.toLowerCase()) return tokenError("INVALID");
    if (user.status === "SUSPENDED" || user.status === "INACTIVE") return tokenError("INVALID");

    // Firebase Auth first: if it fails, nothing is consumed and the link stays usable.
    await setAuthPasswordServer(user, newPassword);

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    const consumed = await consumePasswordResetTokenServer(tokenHash, user.uid, passwordHash);
    if (consumed !== "OK") return tokenError(consumed);

    await createAuditLogServer(
      user.schoolId,
      user.uid,
      user.email,
      user.role,
      "PASSWORD_RESET_COMPLETED",
      "AUTH",
      user.uid,
      `Password reset completed for ${user.email}; existing sessions revoked.`
    );

    return NextResponse.json({
      success: true,
      message: "Your password has been reset successfully. You can now log in with your new password.",
    });
  } catch (error: any) {
    console.error("Reset password error:", error?.code || error?.message || error);
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500 }
    );
  }
}
