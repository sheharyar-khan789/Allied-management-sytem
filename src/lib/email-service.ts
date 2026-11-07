import nodemailer from "nodemailer";
import { ACTIVATION_TOKEN_TTL_HOURS, RESET_TOKEN_TTL_MINUTES } from "./password-reset";
import { identityToolkitSignal } from "./firebase/auth-password";

/** RESET: user-requested password reset. ACTIVATION: first password for an admin-created account. */
export type PasswordLinkPurpose = "RESET" | "ACTIVATION";

export interface SendPasswordResetOptions {
  to: string;
  recipientName?: string;
  schoolName?: string;
  resetUrl: string;
  purpose?: PasswordLinkPurpose;
  /** Set when the recipient is not the account holder (a guardian receiving a student's link). */
  accountLabel?: string;
  correlationId?: string;
}

export type EmailProvider = "resend" | "smtp";

export type DeliveryStatusCode =
  | "RESET_REQUEST_ACCEPTED"
  | "PROVIDER_ACCEPTED"
  | "DELIVERY_CONFIRMED"
  | "DELIVERY_UNCONFIRMED"
  | "DELIVERY_FAILED"
  | "NOT_CONFIGURED"
  | "DEV_CONSOLE";

export interface EmailDeliveryResult {
  /** True only when a provider or Firebase accepted the message. */
  delivered: boolean;
  deliveryStatus: DeliveryStatusCode;
  mode: EmailProvider | "firebase" | "dev-console" | "not-configured";
  /** The provider's own id for the accepted message (Resend returns one), for tracing delivery. */
  providerMessageId?: string;
  /** Safe for logs/audit: never contains the reset URL, token or credentials. */
  message: string;
  detailedStatus?: string;
  canRetry?: boolean;
  correlationId?: string;
}

export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

export interface EmailOperationLog {
  correlationId: string;
  teacherUid?: string;
  schoolId?: string;
  maskedEmail: string;
  purpose: string;
  mode: string;
  status: DeliveryStatusCode;
  attempts?: number;
  messageId?: string;
  error?: string;
  timestamp?: string;
}

export function logEmailOperation(entry: EmailOperationLog): void {
  const line = {
    type: "email_operation",
    timestamp: entry.timestamp || new Date().toISOString(),
    correlationId: entry.correlationId,
    teacherUid: entry.teacherUid,
    schoolId: entry.schoolId,
    recipient: entry.maskedEmail,
    purpose: entry.purpose,
    mode: entry.mode,
    status: entry.status,
    attempts: entry.attempts || 1,
    ...(entry.messageId ? { messageId: entry.messageId } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
  console.log(`[EMAIL_OPERATIONAL_LOG] ${JSON.stringify(line)}`);
}

type Env = Record<string, string | undefined>;

function has(env: Env, name: string): boolean {
  return Boolean(env[name] && env[name]!.trim());
}

/**
 * Which email providers are fully configured. Names only — values are never returned.
 *
 * Resend:  RESEND_API_KEY + EMAIL_FROM (a sender on a domain verified in Resend)
 * SMTP:    SMTP_HOST + SMTP_USER + SMTP_PASS (+ optional SMTP_PORT, SMTP_SECURE, EMAIL_FROM)
 */
export function getEmailConfigStatus(env: Env = process.env): {
  providers: EmailProvider[];
  missingForResend: string[];
  missingForSmtp: string[];
} {
  const missingForResend = ["RESEND_API_KEY", "EMAIL_FROM"].filter((n) => !has(env, n));
  const missingForSmtp = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((n) => !has(env, n));
  const providers: EmailProvider[] = [];
  if (missingForResend.length === 0) providers.push("resend");
  if (missingForSmtp.length === 0) providers.push("smtp");
  return { providers, missingForResend, missingForSmtp };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds standard, clean HTML template for the password reset email.
 */
function linkLifetimeText(purpose: PasswordLinkPurpose): string {
  return purpose === "ACTIVATION" ? `${ACTIVATION_TOKEN_TTL_HOURS} hours` : `${RESET_TOKEN_TTL_MINUTES} minutes`;
}

export function buildPasswordResetHtml({
  accountLabel,
  recipientName = "Allied School User",
  schoolName = "Allied School",
  resetUrl,
  purpose = "RESET",
}: {
  recipientName?: string;
  schoolName?: string;
  resetUrl: string;
  purpose?: PasswordLinkPurpose;
  accountLabel?: string;
}): string {
  const name = escapeHtml(recipientName);
  const school = escapeHtml(schoolName);
  const url = escapeHtml(resetUrl);
  const activation = purpose === "ACTIVATION";
  const heading = activation ? "Activate Your Account" : "Password Reset Request";
  const intro = activation
    ? `An account has been created for you on the ${school} portal. Click the button below to choose your password and activate your account:`
    : `We received a request to reset the password for ${accountLabel ? escapeHtml(accountLabel) : "your account"} on the ${school} portal. Click the button below to choose a new password:`;
  const button = activation ? "Set Your Password" : "Reset Password";
  const ignore = activation
    ? "If you were not expecting this account, you can ignore this email; no password will be set."
    : "If you did not request this reset, you can safely ignore this email. Your password will not change.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #002b49; padding: 28px 32px; color: #ffffff; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0 0; font-size: 13px; color: #93c5fd; }
    .body { padding: 32px; }
    .body h2 { margin: 0 0 16px 0; font-size: 18px; color: #0f172a; }
    .body p { margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569; }
    .button-container { text-align: center; margin: 28px 0; }
    .button { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.2); }
    .notice { background: #f8fafc; border-left: 4px solid #0284c7; padding: 12px 16px; margin: 24px 0; border-radius: 0 6px 6px 0; font-size: 13px; color: #334155; }
    .url-fallback { word-break: break-all; font-size: 12px; color: #64748b; background: #f1f5f9; padding: 10px; border-radius: 6px; }
    .footer { padding: 24px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${school}</h1>
      <p>Management System &amp; Academic Portal</p>
    </div>
    <div class="body">
      <h2>${heading}</h2>
      <p>Hello ${name},</p>
      <p>${intro}</p>
      <div class="button-container">
        <a href="${url}" class="button" target="_blank" rel="noopener noreferrer">${button}</a>
      </div>
      <div class="notice">
        <strong>Important Security Notice:</strong>
        <ul style="margin: 6px 0 0 0; padding-left: 20px;">
          <li>This link is valid for <strong>${linkLifetimeText(purpose)}</strong>.</li>
          <li>For your security, it can be used <strong>only once</strong>.</li>
          <li>${ignore}</li>
        </ul>
      </div>
      <p style="font-size: 12px; color: #64748b; margin-top: 24px;">If the button above does not work, copy and paste this link into your web browser:</p>
      <div class="url-fallback">${url}</div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${school}. All rights reserved.</p>
      <p>This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

/** Resend send with controlled 1x retry on transient errors (429, 5xx, network error). */
async function sendViaResend(
  env: Env,
  msg: { to: string; subject: string; html: string; text: string }
): Promise<{ id?: string; attempts: number } | { error: string; attempts: number; canRetry: boolean }> {
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM!.trim(),
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
      if (res.ok) {
        return { id: typeof data.id === "string" ? data.id : undefined, attempts };
      }

      const isTransient = res.status === 429 || res.status >= 500;
      const errorMsg = `Resend rejected the message (HTTP ${res.status}${data.name ? `, ${data.name}` : ""}${data.message ? `: ${data.message}` : ""})`;

      if (!isTransient || attempts >= maxAttempts) {
        return { error: errorMsg, attempts, canRetry: isTransient };
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      const isAbort = err?.name === "AbortError";
      const errorMsg = isAbort
        ? "Resend API connection timed out (10s)."
        : `Could not reach Resend API: ${err?.message || "network error"}`;

      if (attempts >= maxAttempts) {
        return { error: errorMsg, attempts, canRetry: true };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { error: "Resend delivery failed after retries.", attempts, canRetry: true };
}

async function sendViaSmtp(
  env: Env,
  msg: { to: string; subject: string; html: string; text: string }
): Promise<{ success: boolean; attempts: number; error?: string; canRetry?: boolean }> {
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const port = Number(env.SMTP_PORT) || 587;
      const secure = env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === "true" : port === 465;
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST!.trim(),
        port,
        secure,
        auth: { user: env.SMTP_USER!.trim(), pass: env.SMTP_PASS! },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      const from = has(env, "EMAIL_FROM") ? env.EMAIL_FROM!.trim() : env.SMTP_USER!.trim();
      const info = await transport.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });

      if (info.rejected && info.rejected.length > 0) {
        return { success: false, attempts, error: "SMTP server rejected the recipient address.", canRetry: false };
      }
      return { success: true, attempts };
    } catch (err: any) {
      const e = err as { code?: string; responseCode?: number; message?: string };
      const isTransient = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ESOCKETTIMEDOUT"].includes(e.code || "");
      const errorMsg = `SMTP delivery failed (${e.code || "error"}${e.responseCode ? ` ${e.responseCode}` : ""}): ${e.message || "network error"}`;

      if (!isTransient || attempts >= maxAttempts) {
        return { success: false, attempts, error: errorMsg, canRetry: isTransient };
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  return { success: false, attempts, error: "SMTP connection failed after retries.", canRetry: true };
}

/**
 * Sends Firebase Authentication's own password email (accounts:sendOobCode, PASSWORD_RESET) for
 * an existing Firebase Auth account.
 * Note: Firebase Identity Toolkit accepts and queues the job, but does NOT provide inbox delivery confirmation.
 */
export async function sendViaFirebaseAuth(
  email: string,
  continueUrl: string | null,
  env: Env = process.env
): Promise<{ ok: boolean; error?: string; canRetry?: boolean }> {
  const apiKey = (env.NEXT_PUBLIC_FIREBASE_API_KEY || env.FIREBASE_API_KEY || "").trim();
  if (!apiKey || apiKey.includes("Dummy")) {
    return { ok: false, error: "Firebase Web API key is not configured.", canRetry: false };
  }

  const send = async (withContinueUrl: boolean) => {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        ...(withContinueUrl && continueUrl ? { continueUrl } : {}),
      }),
      signal: identityToolkitSignal(),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return String(data?.error?.message || `HTTP ${res.status}`);
  };

  try {
    let error = await send(true);
    if (error && continueUrl && /UNAUTHORIZED_DOMAIN|INVALID_CONTINUE_URI|MISSING_CONTINUE_URI/.test(error)) {
      error = await send(false);
    }
    if (error) {
      const isTransient = /TOO_MANY_ATTEMPTS|INTERNAL_ERROR|QUOTA_EXCEEDED/.test(error);
      return { ok: false, error: `Firebase Auth did not send the email (${error})`, canRetry: isTransient };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Could not reach Firebase Auth: ${err?.message || "network error"}`, canRetry: true };
  }
}

export function headerSafe(value: string): string {
  return String(value).replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

/**
 * Sends the password reset / account activation email through the configured provider(s):
 * Resend first, then SMTP. Reports `delivered: true` only when a provider actually accepted the
 * message. Never logs the link in production.
 */
export async function sendPasswordResetEmail(
  options: SendPasswordResetOptions,
  env: Env = process.env
): Promise<EmailDeliveryResult> {
  const { to, recipientName = "User", schoolName = "Allied School", resetUrl, purpose = "RESET", accountLabel, correlationId } = options;
  const activation = purpose === "ACTIVATION";
  const corrId = correlationId || `eml_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const subject = headerSafe(activation ? `Activate your ${schoolName} account` : `Reset your ${schoolName} password`);
  const html = buildPasswordResetHtml({ recipientName, schoolName, resetUrl, purpose, accountLabel });
  const text = activation
    ? `Account Activation - ${schoolName}\n\nHello ${recipientName},\n\nAn account has been created for you. Use the following secure link to choose your password and activate it:\n\n${resetUrl}\n\nThis link is single-use and will expire in ${linkLifetimeText(purpose)}.\n\nIf you were not expecting this account, please ignore this email.`
    : `Password Reset Request - ${schoolName}\n\nHello ${recipientName},\n\nA password reset was requested for ${accountLabel || "your account"}. Please use the following secure link to set your new password:\n\n${resetUrl}\n\nThis link is single-use and will expire in ${linkLifetimeText(purpose)}.\n\nIf you did not request this, please ignore this email.`;
  const msg = { to: headerSafe(to), subject, html, text };

  const { providers, missingForResend, missingForSmtp } = getEmailConfigStatus(env);
  const failures: string[] = [];

  for (const provider of providers) {
    if (provider === "resend") {
      const outcome = await sendViaResend(env, msg);
      if (!("error" in outcome)) {
        const providerMessageId = outcome.id;
        return {
          delivered: true,
          deliveryStatus: "PROVIDER_ACCEPTED",
          mode: "resend",
          correlationId: corrId,
          ...(providerMessageId ? { providerMessageId } : {}),
          message: `${activation ? "Account activation" : "Password reset"} email accepted by Resend${providerMessageId ? ` (id ${providerMessageId})` : ""}.`,
          detailedStatus: "Email provider accepted message for dispatch.",
        };
      } else {
        failures.push(outcome.error);
        console.error(`[PASSWORD RESET EMAIL] ${outcome.error}`);
      }
    } else if (provider === "smtp") {
      const outcome = await sendViaSmtp(env, msg);
      if (outcome.success) {
        return {
          delivered: true,
          deliveryStatus: "PROVIDER_ACCEPTED",
          mode: "smtp",
          correlationId: corrId,
          message: `${activation ? "Account activation" : "Password reset"} email accepted by SMTP server.`,
          detailedStatus: "SMTP server accepted message for dispatch.",
        };
      }
      failures.push(outcome.error || "SMTP failed");
      console.error(`[PASSWORD RESET EMAIL] ${outcome.error}`);
    }
  }

  if (providers.length > 0) {
    return {
      delivered: false,
      deliveryStatus: "DELIVERY_FAILED",
      mode: providers[providers.length - 1],
      canRetry: true,
      correlationId: corrId,
      message: failures.join(" | "),
      detailedStatus: "All configured email providers failed to deliver the message.",
    };
  }

  const configHint =
    `No email provider configured. Set either RESEND_API_KEY + EMAIL_FROM (missing: ${missingForResend.join(", ")}) ` +
    `or SMTP_HOST + SMTP_USER + SMTP_PASS (missing: ${missingForSmtp.join(", ")}).`;

  if (env.NODE_ENV !== "production") {
    console.warn(`[PASSWORD RESET EMAIL] ${configHint}`);
    console.warn(`[PASSWORD RESET EMAIL] DEV ONLY — ${activation ? "activation" : "reset"} link for ${to}: ${resetUrl}`);
    return {
      delivered: false,
      deliveryStatus: "DEV_CONSOLE",
      mode: "dev-console",
      correlationId: corrId,
      message: configHint,
      detailedStatus: "Development mode: link output to dev console.",
    };
  }

  console.error(`[PASSWORD RESET EMAIL] NOT SENT. ${configHint}`);
  return {
    delivered: false,
    deliveryStatus: "NOT_CONFIGURED",
    mode: "not-configured",
    canRetry: false,
    correlationId: corrId,
    message: configHint,
    detailedStatus: "No email provider configured in production.",
  };
}
