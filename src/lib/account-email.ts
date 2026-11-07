import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
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
 * Accurately distinguishes between:
 *  - PROVIDER_ACCEPTED (Resend/SMTP confirmed acceptance)
 *  - DELIVERY_UNCONFIRMED (Firebase Auth accepted the request, but does not provide inbox delivery receipts)
 *  - DELIVERY_FAILED (Provider rejected or delivery error)
 *  - NOT_CONFIGURED (No email provider configured)
 *  - DEV_CONSOLE (Development mode console output)
 */
export async function sendPasswordSetupLink(
  user: Pick<UserProfile, "uid" | "email" | "name" | "schoolId">,
  purpose: PasswordLinkPurpose,
  request: { origin?: string | null; host?: string | null },
  env: Env = process.env,
  deliverTo?: { email: string; name?: string }
): Promise<EmailDeliveryResult> {
  let authoritativeEmail = (deliverTo?.email || user.email || "").toLowerCase().trim();
  if (!deliverTo && hasAdminCredentials && user.uid) {
    try {
      const authUser = await adminAuth.getUser(user.uid);
      if (authUser.email) {
        authoritativeEmail = authUser.email.toLowerCase().trim();
      }
    } catch {}
  }
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
      email: authoritativeEmail,
      schoolId: user.schoolId,
      expiresAt: new Date(nowMs + (purpose === "ACTIVATION" ? ACTIVATION_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS)).toISOString(),
      usedAt: null,
      createdAt: new Date(nowMs).toISOString(),
    });
    return buildResetUrl(baseUrl, token, purpose);
  };
  const sendAppEmail = async (baseUrl: string) =>
    sendPasswordResetEmail(
      {
        to: authoritativeEmail,
        recipientName: deliverTo?.name || user.name || "User",
        ...(deliverTo ? { accountLabel: `the student account of ${user.name || "your child"} (sign-in: ${user.email})` } : {}),
        schoolName,
        resetUrl: await issueLink(baseUrl),
        purpose,
      },
      env
    );

  // 1. First priority: App-configured email provider (Resend or SMTP)
  if (base.ok && appProviders.length > 0) {
    const result = await sendAppEmail(base.baseUrl);
    if (result.delivered) return result;
    failures.push(result.message);
  }

  // 2. Second priority: Firebase Authentication built-in mailer
  // When used, we accurately flag deliveryStatus as DELIVERY_UNCONFIRMED because Firebase
  // does not expose webhook or final delivery tracking to recipients.
  if (hasAdminCredentials && !deliverTo) {
    const outcome = await sendViaFirebaseAuth(authoritativeEmail, base.ok ? `${base.baseUrl}/login` : null, env);
    if (outcome.ok) {
      return {
        delivered: true,
        deliveryStatus: "DELIVERY_UNCONFIRMED",
        mode: "firebase",
        message: `${purpose === "ACTIVATION" ? "Account activation" : "Password reset"} request processed. Email delivery cannot be confirmed by Firebase Authentication. Please advise the teacher to check inbox and spam folders.`,
        detailedStatus: "Firebase Authentication accepted the password reset request. Because Firebase does not provide delivery receipts or bounce tracking, final inbox arrival cannot be confirmed.",
        canRetry: true,
      };
    }
    failures.push(outcome.error || "Firebase Auth failed");
    console.error(`[PASSWORD RESET EMAIL] ${outcome.error}`);
  }

  // 3. Dev-only fallback
  if (base.ok && appProviders.length === 0 && env.NODE_ENV !== "production") {
    return sendAppEmail(base.baseUrl);
  }

  return {
    delivered: false,
    deliveryStatus: appProviders.length > 0 ? "DELIVERY_FAILED" : "NOT_CONFIGURED",
    mode: appProviders.length > 0 ? appProviders[appProviders.length - 1] : "not-configured",
    canRetry: appProviders.length > 0,
    message: failures.join(" | ") || "No email delivery channel is available or configured.",
    detailedStatus: "All available delivery channels failed or are not configured.",
  };
}
