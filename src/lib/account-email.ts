import { hasAdminCredentials } from "@/lib/firebase/admin";
import { getSchoolSettingsServer, savePasswordResetTokenServer } from "@/lib/firebase/server-db";
import { UserProfile } from "@/lib/firebase/types";
import {
  EmailDeliveryResult,
  getEmailConfigStatus,
  PasswordLinkPurpose,
  sendPasswordResetEmail,
  sendViaFirebaseAuth,
} from "@/lib/email-service";
import {
  ACTIVATION_TOKEN_TTL_MS,
  buildResetUrl,
  generateResetToken,
  resolveAppBaseUrl,
  RESET_TOKEN_TTL_MS,
} from "@/lib/password-reset";

type Env = Record<string, string | undefined>;

/**
 * Emails `user` a link to choose a password — a reset they asked for, or the activation of an
 * account an admin just created. No password ever leaves the server; the user sets their own.
 *
 * Delivery order:
 *  1. The app's own email (Resend/SMTP) carrying a single-use link to /reset-password; only the
 *     token's SHA-256 hash is stored.
 *  2. Firebase Authentication's built-in password email for the user's Firebase Auth account.
 *     This is what makes the flow work when no Resend/SMTP provider is configured — previously
 *     production silently sent nothing in that case.
 *  3. Local development only: the link is printed to the dev console.
 */
export async function sendPasswordSetupLink(
  user: Pick<UserProfile, "uid" | "email" | "name" | "schoolId">,
  purpose: PasswordLinkPurpose,
  request: { origin?: string | null; host?: string | null },
  env: Env = process.env
): Promise<EmailDeliveryResult> {
  const base = resolveAppBaseUrl(request, env);
  const failures: string[] = base.ok ? [] : [base.reason];
  const appProviders = getEmailConfigStatus(env).providers;

  const settings = await getSchoolSettingsServer(user.schoolId);
  const schoolName = settings?.schoolName || "Allied School Management System";

  const issueLink = async (baseUrl: string) => {
    const { token, tokenHash } = generateResetToken();
    const nowMs = Date.now();
    await savePasswordResetTokenServer({
      id: tokenHash,
      purpose,
      uid: user.uid,
      email: user.email,
      schoolId: user.schoolId,
      expiresAt: new Date(nowMs + (purpose === "ACTIVATION" ? ACTIVATION_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS)).toISOString(),
      usedAt: null,
      createdAt: new Date(nowMs).toISOString(),
    });
    return buildResetUrl(baseUrl, token, purpose);
  };
  const sendAppEmail = async (baseUrl: string) =>
    sendPasswordResetEmail(
      { to: user.email, recipientName: user.name || "User", schoolName, resetUrl: await issueLink(baseUrl), purpose },
      env
    );

  if (base.ok && appProviders.length > 0) {
    const result = await sendAppEmail(base.baseUrl);
    if (result.delivered) return result;
    failures.push(result.message);
  }

  if (hasAdminCredentials) {
    const error = await sendViaFirebaseAuth(user.email, base.ok ? `${base.baseUrl}/login` : null, env);
    if (!error) {
      return {
        delivered: true,
        mode: "firebase",
        message: `${purpose === "ACTIVATION" ? "Account activation" : "Password reset"} email sent by Firebase Authentication.`,
      };
    }
    failures.push(error);
    console.error(`[PASSWORD RESET EMAIL] ${error}`);
  }

  if (base.ok && appProviders.length === 0 && env.NODE_ENV !== "production") {
    return sendAppEmail(base.baseUrl);
  }

  return { delivered: false, mode: "not-configured", message: failures.join(" | ") || "No delivery channel available." };
}
