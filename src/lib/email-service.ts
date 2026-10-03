import nodemailer from "nodemailer";
import { ACTIVATION_TOKEN_TTL_HOURS, RESET_TOKEN_TTL_MINUTES } from "./password-reset";

/** RESET: user-requested password reset. ACTIVATION: first password for an admin-created account. */
export type PasswordLinkPurpose = "RESET" | "ACTIVATION";

export interface SendPasswordResetOptions {
  to: string;
  recipientName?: string;
  schoolName?: string;
  resetUrl: string;
  purpose?: PasswordLinkPurpose;
}

export type EmailProvider = "resend" | "smtp";

export interface EmailDeliveryResult {
  /** True only when a real provider accepted the message. */
  delivered: boolean;
  mode: EmailProvider | "firebase" | "dev-console" | "not-configured";
  /** Safe for logs/audit: never contains the reset URL, token or credentials. */
  message: string;
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
  recipientName = "Allied School User",
  schoolName = "Allied School",
  resetUrl,
  purpose = "RESET",
}: {
  recipientName?: string;
  schoolName?: string;
  resetUrl: string;
  purpose?: PasswordLinkPurpose;
}): string {
  const name = escapeHtml(recipientName);
  const school = escapeHtml(schoolName);
  const url = escapeHtml(resetUrl);
  const activation = purpose === "ACTIVATION";
  const heading = activation ? "Activate Your Account" : "Password Reset Request";
  const intro = activation
    ? `An account has been created for you on the ${school} portal. Click the button below to choose your password and activate your account:`
    : `We received a request to reset the password for your account on the ${school} portal. Click the button below to choose a new password:`;
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

async function sendViaResend(env: Env, msg: { to: string; subject: string; html: string; text: string }): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM!.trim(), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
    // Resend's error body describes config problems (e.g. unverified sender domain); it never
    // echoes the message body, so it is safe to log.
    return `Resend rejected the message (HTTP ${res.status}${data.name ? `, ${data.name}` : ""}${data.message ? `: ${data.message}` : ""})`;
  } catch (err) {
    return `Could not reach Resend API: ${(err as Error)?.message || "network error"}`;
  }
}

async function sendViaSmtp(env: Env, msg: { to: string; subject: string; html: string; text: string }): Promise<string | null> {
  try {
    const port = Number(env.SMTP_PORT) || 587;
    const secure = env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === "true" : port === 465;
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST!.trim(),
      port,
      secure,
      auth: { user: env.SMTP_USER!.trim(), pass: env.SMTP_PASS! },
    });
    const from = has(env, "EMAIL_FROM") ? env.EMAIL_FROM!.trim() : env.SMTP_USER!.trim();
    const info = await transport.sendMail({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    if (info.rejected && info.rejected.length > 0) return "SMTP server rejected the recipient.";
    return null;
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    return `SMTP delivery failed (${e.code || "error"}${e.responseCode ? ` ${e.responseCode}` : ""})`;
  }
}

/**
 * Sends Firebase Authentication's own password email (accounts:sendOobCode, PASSWORD_RESET) for
 * an existing Firebase Auth account. Firebase delivers it from its built-in mailer, so it works
 * with no Resend/SMTP configured; the link opens Firebase's password action page (or this app's
 * /reset-password if the project's email template action URL points there) and `continueUrl`
 * brings the user back to the login page. Returns null on success, otherwise a log-safe reason.
 */
export async function sendViaFirebaseAuth(email: string, continueUrl: string | null, env: Env = process.env): Promise<string | null> {
  const apiKey = (env.NEXT_PUBLIC_FIREBASE_API_KEY || env.FIREBASE_API_KEY || "").trim();
  if (!apiKey || apiKey.includes("Dummy")) return "Firebase Web API key is not configured.";

  const send = async (withContinueUrl: boolean) => {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        ...(withContinueUrl && continueUrl ? { continueUrl } : {}),
      }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return String(data?.error?.message || `HTTP ${res.status}`);
  };

  try {
    let error = await send(true);
    // The app domain may not be in the project's Authorized domains yet; the email itself
    // still works without a continue URL.
    if (error && continueUrl && /UNAUTHORIZED_DOMAIN|INVALID_CONTINUE_URI|MISSING_CONTINUE_URI/.test(error)) {
      error = await send(false);
    }
    return error ? `Firebase Auth did not send the email (${error})` : null;
  } catch (err) {
    return `Could not reach Firebase Auth: ${(err as Error)?.message || "network error"}`;
  }
}

/**
 * Sends the password reset / account activation email through the configured provider(s):
 * Resend first, then SMTP. Reports `delivered: true` only when a provider actually accepted the
 * message. Never logs the link in production; with no provider configured in local development
 * the link is printed to the dev console so the flow can still be exercised.
 */
export async function sendPasswordResetEmail(
  options: SendPasswordResetOptions,
  env: Env = process.env
): Promise<EmailDeliveryResult> {
  const { to, recipientName = "User", schoolName = "Allied School", resetUrl, purpose = "RESET" } = options;
  const activation = purpose === "ACTIVATION";
  const subject = activation ? `Activate your ${schoolName} account` : `Reset your ${schoolName} password`;
  const html = buildPasswordResetHtml({ recipientName, schoolName, resetUrl, purpose });
  const text = activation
    ? `Account Activation - ${schoolName}\n\nHello ${recipientName},\n\nAn account has been created for you. Use the following secure link to choose your password and activate it:\n\n${resetUrl}\n\nThis link is single-use and will expire in ${linkLifetimeText(purpose)}.\n\nIf you were not expecting this account, please ignore this email.`
    : `Password Reset Request - ${schoolName}\n\nHello ${recipientName},\n\nA password reset was requested for your account. Please use the following secure link to set your new password:\n\n${resetUrl}\n\nThis link is single-use and will expire in ${linkLifetimeText(purpose)}.\n\nIf you did not request this, please ignore this email.`;
  const msg = { to, subject, html, text };

  const { providers, missingForResend, missingForSmtp } = getEmailConfigStatus(env);
  const failures: string[] = [];

  for (const provider of providers) {
    const error = provider === "resend" ? await sendViaResend(env, msg) : await sendViaSmtp(env, msg);
    if (!error) {
      return { delivered: true, mode: provider, message: `${activation ? "Account activation" : "Password reset"} email accepted by ${provider}.` };
    }
    failures.push(error);
    console.error(`[PASSWORD RESET EMAIL] ${error}`);
  }

  if (providers.length > 0) {
    return { delivered: false, mode: providers[providers.length - 1], message: failures.join(" | ") };
  }

  const configHint =
    `No email provider configured. Set either RESEND_API_KEY + EMAIL_FROM (missing: ${missingForResend.join(", ")}) ` +
    `or SMTP_HOST + SMTP_USER + SMTP_PASS (missing: ${missingForSmtp.join(", ")}).`;

  if (env.NODE_ENV !== "production") {
    console.warn(`[PASSWORD RESET EMAIL] ${configHint}`);
    console.warn(`[PASSWORD RESET EMAIL] DEV ONLY — ${activation ? "activation" : "reset"} link for ${to}: ${resetUrl}`);
    return { delivered: false, mode: "dev-console", message: configHint };
  }

  console.error(`[PASSWORD RESET EMAIL] NOT SENT. ${configHint}`);
  return { delivered: false, mode: "not-configured", message: configHint };
}
