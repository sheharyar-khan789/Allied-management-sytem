# Security Incident Response — Allied School Management System

This runbook is for the school operator / system administrator. It uses only mechanisms that exist in
this codebase and in the Firebase / Google Cloud / hosting consoles. Fill in the contact table before
going live. Never paste secret values into tickets, chat, email or this file.

## 0. Contacts (fill in before go-live)

| Role | Name | How to reach |
|---|---|---|
| Incident lead (decides, coordinates) | _to be filled_ | _to be filled_ |
| Technical owner (hosting, Firebase project) | _to be filled_ | _to be filled_ |
| School principal / data owner | _to be filled_ | _to be filled_ |
| Legal adviser (data-protection / PECA 2016 questions) | _to be filled_ | _to be filled_ |

## 1. First 30 minutes

1. **Write down** what was seen, when, by whom (timestamps in UTC). Keep a running log.
2. **Preserve evidence before changing anything**:
   - Hosting logs: filter for `"type":"security"` lines (events such as `auth.login_failed`,
     `auth.login_locked`, `authz.forbidden`, `csrf.blocked`, `admin.sensitive_action`,
     `server.error`). Emails, uids and IPs in these lines are keyed hashes (HMAC with
     `SECURITY_LOG_SALT`), so they can be correlated without exposing personal data.
   - The per-school audit trail: **Admin → Audit** (Firestore `auditLogs`, no client can edit or
     delete it).
   - Firebase console → Authentication → users (sign-in times), and Google Cloud → Logging.
   - Export/screenshot what you need; logs on most hosts expire.
3. **Contain** using the steps below (sections 2–4), starting with the narrowest that stops the harm.
4. **Do not** delete accounts or data while investigating — disable them instead.

## 2. Revoke sessions

Sessions are HS256 JWTs (cookie `allied_session`, 5-minute idle, 12-hour absolute maximum). Every API
route and portal layout re-checks the token against the live user profile on every request.

| Scope | How | Effect |
|---|---|---|
| One user, all devices | Have the user (or an admin on their behalf) reset the password via "Forgot password"; or set `sessionsValidAfter` on `users/{uid}` to the current ISO time in the Firestore console | All sessions signed in before that time are rejected on the next request |
| One user, block entirely | Set `status` to `INACTIVE` on `users/{uid}` **and** disable the user in Firebase Authentication | Next request is rejected; new sign-ins refused |
| One student | Admin → Students → set status to ALUMNI/EXPELLED or delete | The linked login is set INACTIVE and the Firebase Auth user is disabled (`src/lib/account-status.ts`) |
| **Everyone** | Rotate `JWT_SECRET` (section 4) and redeploy | Every existing session becomes invalid immediately; all users must sign in again |

## 3. Compromised ADMIN account

1. Firebase console → Authentication → find the admin → **Disable account**.
2. Firestore → `users/{uid}` → set `status` = `INACTIVE` (takes effect on the next request).
3. If two-factor is enabled for the account and the authenticator may be compromised: delete the
   fields `mfaSecret`, `mfaLastUsedStep` and set `mfaEnabled` = `false`; the admin re-enrols after
   recovery (Settings → Two-factor, needs code + password).
4. Review **Admin → Audit** and the security log lines for that account's actions (fees, payroll,
   student/teacher deletions, settings, role changes) since the suspected time.
5. Re-enable only after: password reset by the real owner, 2FA re-enrolled, and the review is done.
6. If another admin account is needed during recovery, do not reuse the compromised email.

## 4. Rotate secrets

Rotate the secret in its provider first, update the hosting environment variable, redeploy, then
revoke the old value. Never commit a value; `.gitignore` covers `.env*` and key files.

| Secret (env name) | Where to rotate | Notes |
|---|---|---|
| `JWT_SECRET` | Generate a new random value (≥ 32 chars, e.g. `openssl rand -base64 48`) | Logs everyone out. The app refuses to start sessions in production if it is missing/short |
| `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` (service account) | Google Cloud console → IAM & Admin → Service accounts → the Firebase Admin SDK account → Keys → **Add key**, update env, redeploy, then **delete the old key** | Also delete any downloaded `*-firebase-adminsdk-*.json` copies from local disks once the new key is in the host's environment |
| `SMTP_PASS` / `SMTP_USER` | Your mail provider's console | |
| `RESEND_API_KEY` | Resend dashboard → API keys | |
| `SCHOOL_REGISTRATION_SECRET` | New random value (≥ 16 chars), or remove it entirely when no new school is being registered | Each value can register only one institution |
| `SECURITY_LOG_SALT` | New random value | Old and new log hashes will no longer correlate; note the rotation time |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Not a secret (shipped to browsers). If abused, restrict it in Google Cloud → APIs & Services → Credentials (HTTP referrer + API restrictions) | Keep Firebase Auth public self-sign-up disabled (registration creates accounts server-side) |

## 5. Restore data

**Backups are not configured by this repository.** Before go-live, the operator must enable one of:

- Firestore **Point-in-time recovery** (PITR, last 7 days) — Google Cloud console → Firestore →
  Disaster recovery; and/or
- **Scheduled backups** (Firestore → Disaster recovery → backup schedules), or scheduled
  `gcloud firestore export` to a Cloud Storage bucket in the same region with restricted access.

Restore procedure (once configured):

1. Decide the restore point (just before the incident, from the audit trail/logs).
2. Restore into a **new** database / staging project first; never overwrite production blindly.
3. Verify a sample (students, fees, attendance of one class) with the school.
4. Switch over or copy back the affected collections; record exactly what was restored.
5. Uploaded files (Cloud Storage) are not covered by Firestore backups: enable object versioning or a
   bucket backup if documents/photos must be recoverable.

## 6. Children's personal data

The system holds children's names, class records, attendance, results, fees, guardian contacts and
uploaded documents. If personal data may have been accessed or altered without authorisation:

1. Record which schools (tenants), which records, what time range, and how (evidence from section 1).
2. Inform the school principal / data owner immediately.
3. Ask the legal adviser about notification duties (Pakistan's PECA 2016 and any other law that
   applies). This document does not give legal advice and does not state legal deadlines.
4. Communicate to parents only with the school's approval and through the school's normal channels.

## 7. After the incident

- Write a short post-incident note: timeline, root cause, data affected, actions, what changes.
- Add or update a regression test for the root cause (`scripts/security-regression-test.ts`).
- Re-check the "REQUIRES PRODUCTION CONFIGURATION" list in `ALLIED_SECURITY_REPORT.md`.
