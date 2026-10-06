import { adminAuth, hasAdminCredentials } from "./admin";
import { UserProfile } from "./types";

/**
 * Sets the password on the user's Firebase Auth account and revokes its refresh tokens.
 *
 * /api/auth/login checks Firebase Auth first and returns 401 as soon as Firebase rejects the
 * password, so the Firebase password — not only the Firestore bcrypt hash — must be the one that
 * changes. Previously a failed Firebase update was logged and ignored, which left the OLD password
 * working and the NEW one rejected. Any failure now aborts the reset instead.
 *
 * A profile without a Firebase Auth account (e.g. created while the app ran without Admin
 * credentials) gets one with the same uid, email and role claims.
 */
export async function setAuthPasswordServer(user: UserProfile, newPassword: string): Promise<void> {
  if (!hasAdminCredentials) return;

  try {
    // Only reachable through a link sent to this address, so it also proves the email.
    await adminAuth.updateUser(user.uid, { password: newPassword, emailVerified: true });
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw err;
    await adminAuth.createUser({
      uid: user.uid,
      email: user.email,
      emailVerified: true,
      password: newPassword,
      displayName: user.name,
      disabled: false,
    });
    await adminAuth.setCustomUserClaims(user.uid, {
      role: user.role,
      schoolId: user.schoolId,
      ...(user.teacherId ? { teacherId: user.teacherId } : {}),
      ...(user.studentId ? { studentId: user.studentId } : {}),
    });
  }

  await adminAuth.revokeRefreshTokens(user.uid);
}

export type ConfirmFirebaseResetResult =
  | { ok: true; email: string }
  | { ok: false; status: "INVALID" | "EXPIRED" };

/**
 * Completes a reset started by Firebase Authentication's own password email: Firebase checks the
 * single-use action code (`oobCode`) and sets the new password (accounts:resetPassword).
 */
export async function confirmFirebasePasswordResetServer(
  oobCode: string,
  newPassword: string,
  env: Record<string, string | undefined> = process.env
): Promise<ConfirmFirebaseResetResult> {
  const apiKey = (env.NEXT_PUBLIC_FIREBASE_API_KEY || env.FIREBASE_API_KEY || "").trim();
  if (!apiKey || !/^[A-Za-z0-9_-]{10,}$/.test(oobCode)) return { ok: false, status: "INVALID" };

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oobCode, newPassword }),
  });
  const data = (await res.json().catch(() => ({}))) as { email?: string; error?: { message?: string } };
  if (res.ok && data.email) return { ok: true, email: data.email.toLowerCase().trim() };

  const message = String(data?.error?.message || "");
  if (message.startsWith("EXPIRED_OOB_CODE")) return { ok: false, status: "EXPIRED" };
  if (message.startsWith("INVALID_OOB_CODE") || message.startsWith("USER_DISABLED") || message.startsWith("EMAIL_NOT_FOUND")) {
    return { ok: false, status: "INVALID" };
  }
  throw new Error(`Firebase resetPassword failed: ${message || `HTTP ${res.status}`}`);
}

/**
 * Verifies an account's current password: the app's bcrypt hash first, then Firebase Auth —
 * accepted only if the Firebase account that matches is this exact profile (same uid).
 */
export async function verifyAccountPasswordServer(
  user: Pick<UserProfile, "uid" | "email" | "passwordHash">,
  password: string,
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  if (!password) return false;
  if (user.passwordHash) {
    const bcrypt = (await import("bcryptjs")).default;
    if (await bcrypt.compare(password, user.passwordHash)) return true;
  }
  const apiKey = (env.NEXT_PUBLIC_FIREBASE_API_KEY || env.FIREBASE_API_KEY || "").trim();
  if (!apiKey || apiKey.includes("Dummy")) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, password, returnSecureToken: false }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { localId?: string };
    return res.ok && data.localId === user.uid;
  } catch {
    return false;
  }
}
