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
    await adminAuth.updateUser(user.uid, { password: newPassword });
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
