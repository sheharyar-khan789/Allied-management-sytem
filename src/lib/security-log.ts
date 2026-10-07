import crypto from "crypto";

/**
 * Structured security events: one JSON line per event on stdout, picked up by the host's log
 * drain (Vercel → Logs). No personal data and no secrets: emails / IPs / uids are reduced to a
 * short keyed hash so repeated attempts can be correlated without storing the raw value.
 * The per-school, human-readable trail stays in the existing Firestore audit log (/admin/audit).
 */

export type SecurityEvent =
  | "auth.login_failed"
  | "auth.login_locked"
  | "auth.login_succeeded"
  | "auth.mfa_failed"
  | "auth.session_revoked"
  | "auth.logout"
  | "auth.password_changed"
  | "auth.password_change_failed"
  | "auth.password_reset_completed"
  | "auth.reset_rate_limited"
  | "auth.reset_no_recipient"
  | "auth.register_rejected"
  | "auth.register_succeeded"
  | "authz.unauthenticated"
  | "authz.forbidden"
  | "authz.reauth_required"
  | "csrf.blocked"
  | "upload.rejected"
  | "admin.sensitive_action"
  | "server.error";

function pseudonymize(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const salt = process.env.SECURITY_LOG_SALT || process.env.JWT_SECRET || "allied-sms";
  return crypto.createHmac("sha256", salt).update(value.toLowerCase().trim()).digest("hex").slice(0, 16);
}

export interface SecurityLogFields {
  /** Raw identifier (email/uid); only its pseudonym is written. */
  subject?: string | null;
  ip?: string | null;
  role?: string;
  schoolId?: string;
  route?: string;
  method?: string;
  status?: number;
  reason?: string;
  action?: string;
}

export function securityLog(event: SecurityEvent, fields: SecurityLogFields = {}): void {
  try {
    const line = {
      type: "security",
      event,
      ts: new Date().toISOString(),
      subject: pseudonymize(fields.subject),
      ip: pseudonymize(fields.ip),
      role: fields.role,
      // A schoolId is an opaque tenant key, not personal data.
      schoolId: fields.schoolId,
      route: fields.route,
      method: fields.method,
      status: fields.status,
      reason: fields.reason ? String(fields.reason).slice(0, 120) : undefined,
      action: fields.action,
    };
    const out = JSON.stringify(line);
    if (event === "server.error") console.error(out);
    else if (process.env.SECURITY_LOG_SILENT !== "1") console.log(out);
  } catch {
    // logging must never break a request
  }
}
