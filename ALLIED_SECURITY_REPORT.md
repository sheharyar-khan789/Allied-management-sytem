# Allied School Management System — Security Audit & Hardening Report

| | |
|---|---|
| Date | 2026-10-06 |
| Branch | `security-hardening` (from `fix/teacher-access-timetable-activation` @ `2efca51`) — local only, not pushed |
| Final code commit | `cc0237a` |
| Scope | Items 1–34 of the "Complete Security Audit & Hardening" brief |
| Environment | Local machine, in-memory test store and Firebase emulators only. No real Firebase project, production data or deployment was touched. `.env.local` and `*firebase-adminsdk*.json` files were never opened. |

## 1. Executive summary

The application's server-side security model is now consistent: every API route and every portal
layout re-verifies the session on the server (HS256-pinned JWT, issuer/audience, 12-hour absolute
lifetime) **and** re-checks it against the live user profile, so disabling a user, changing their
role or school, resetting their password or logging out takes effect on the very next request.
Tenant (`schoolId`), role, teacher, parent and student scoping are enforced from the token and live
data, never from the request body. Client writes to Firestore are denied everywhere, and no client
can read user profiles (password hashes, 2FA secrets).

The audit found and fixed several serious issues in the original code (section 4), the most
important being: a shared default student password published in the repository; login accepting
any Firebase account with a matching email; Firestore rules that exposed every user's password
hash to school admins and teachers; and teacher salary records readable by students and parents.
During this resumed session one more High issue was found in the earlier hardening work itself
(a user could read their own TOTP secret through Firestore, which would have defeated admin 2FA)
and fixed before release.

All test suites pass (section 7): 111/111 security regression tests (16 new in this session),
all existing suites, 9/9 Firestore/Storage rules tests on the emulator, typecheck, lint
(0 errors) and a clean production build whose client bundle contains no secrets.

**What remains is mostly production configuration that only the owner can do** (section 9):
the GitHub repository is **public**; the home folder is itself a git repository pointing at that
public repository while service-account keys sit unprotected in Downloads; backups are not
configured; existing student accounts created with the old default password must be reset; and
rate limiting needs a host-level complement.

## 2. Items 1–34 — final status

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Next.js 15.5.27, no middleware-only auth | DONE | `next` / `eslint-config-next` 15.5.27 installed. All 30 non-public API routes call `requireAuth` with roles; 5 public auth routes do their own checks; role layouts call `requirePageRole` (`src/lib/page-auth.ts`); tests 40a/40b |
| 2 | npm audit / outdated / patches | DONE | Section 6. 22 → 19 advisories, none fixable without a major upgrade, none reachable at runtime. `patches/jwks-rsa+4.1.0.patch` reviewed |
| 3 | Passwords | DONE | bcrypt cost 12 (`BCRYPT_COST`), policy ≥ 10 chars + common-password denylist + no email/name (`checkPasswordPolicy`), dummy-hash compare for unknown emails, generic messages; tests 23, 25 |
| 4 | JWT | DONE | `src/lib/session-token.ts`: HS256 only, `iss`/`aud`, 5-min idle + 12-h absolute, secret ≥ 32 chars, hard-fail in production / Vercel / with real Firebase credentials; revocation on logout (`sid`), password change/reset, disable, role/school change, deletion; tests 18–21 |
| 5 | Cookies | DONE | `allied_session`: HttpOnly, Secure in production, SameSite=Lax, Path=/, Max-Age 300 s; absolute max enforced on refresh. `__Host-` prefix considered and not adopted (requires Secure, breaks http://localhost development) |
| 6 | Brute force | DONE | Login: 10 failures/5 min per IP **and** 5 failures/15-min lockout per account; reset, change-password, register, 2FA rate limited; tests 13, 22, 24. In-memory per instance → see R4 |
| 7 | Password reset | DONE | Random token, SHA-256 hashed at rest, 15-min TTL (activation 72 h), single use, never logged, link built only from `NEXT_PUBLIC_APP_URL` in production (https, non-localhost); all sessions revoked after reset/change |
| 8 | Registration | DONE | `SCHOOL_REGISTRATION_SECRET` (≥ 16 chars) compared in constant time, **single-use** (atomic consume), rate limited, existing users can't be re-registered; Firebase accounts created server-side so public self-sign-up can be disabled; tests 17, 26 |
| 9 | Admin 2FA + re-auth | DONE (flags default OFF) | TOTP (RFC 6238, no new dependency) behind `ADMIN_MFA_ENABLED`; enrol needs code **and** current password (test 44); disable needs code + password; replay guard. `ADMIN_REAUTH_MAX_AGE_MINUTES` gates payroll, fees, deletes, settings (test 37) |
| 10 | Server-side auth everywhere | DONE | See item 1; `schoolId` always from the token |
| 11 | IDOR / scoping | DONE | Tests 9, 27a–d (cross-school), 28a–d (teacher/parent/student), plus the existing teacher-scoping (13) and teacher-access (83) suites. Parent links re-derived from live data on every request (`src/lib/parent-access.ts`) |
| 12 | Mass assignment | DONE | `findForbiddenFields` rejects server-controlled fields (role, schoolId, uid, studentIds, parentUserIds, paidAmount, lock/audit fields…); strict zod schemas; no route spreads the request body into a document; tests 29a–h, 41a, 41e |
| 13 | Attendance lock / session isolation | DONE | Lock enforced in `/api/attendance`, original `createdAt` preserved; `test:session-lock` 40/40; lock flags cannot be submitted (41a) |
| 14 | Input validation | DONE | zod on announcements, exams, fees, payroll, settings, students, attendance, classes, subjects; explicit type/length checks on auth, 2FA, observations, timetable (41i), teachers; tests 41a–i |
| 15 | Uploads / import / export | DONE | Content sniffed by magic bytes (PNG/JPEG/WebP/PDF only), size checked before buffering, server-generated names and extension, path `schools/{token schoolId}/…`; formula neutralisation on CSV import and export; tests 30a–d, 35 |
| 16 | XSS / print pages | DONE | No `dangerouslySetInnerHTML`; stored URLs must be https (no `javascript:`); email HTML escaped; print routes serve server data behind access checks; nonce CSP |
| 17 | Email | DONE | SMTP/Resend credentials only from env, never logged; reset tokens never logged in production; CR/LF stripped from header values (test 45); nodemailer 10.0.15 (header/SMTP-injection advisories fixed) |
| 18 | Rules review | DONE | Default deny, no client writes, tenant isolation, teacher/student/parent scoping; **no client reads of `users/*`**. Storage: same-school read, no client writes. Note R3 (download-token URLs bypass Storage rules) |
| 19 | Rules tests | DONE — EXECUTED | 9/9 passed on the Firestore + Storage emulators (project `demo-allied-rules-test`). Also in CI (`.github/workflows/security.yml`) |
| 20 | Indexes | DONE — no change | 8 composite indexes; server queries use equality filters only (no `orderBy`) |
| 21 | Security headers | DONE | Nonce CSP with `strict-dynamic` on all middleware routes + baseline CSP elsewhere, HSTS (production), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, `poweredByHeader: false`, `no-store` on `/api/*`; test 32 |
| 22 | CSRF | DONE | Origin / Sec-Fetch-Site check in middleware, in `requireAuth`, and (this session) inside the 5 public auth routes; trusted origins = request origin + `NEXT_PUBLIC_APP_URL` + `CSRF_TRUSTED_ORIGINS`; tests 31a–d, 42, 43 |
| 23 | CORS | DONE | No `Access-Control-Allow-*` header anywhere → browsers block cross-origin reads |
| 24 | Errors | DONE | Generic 500 bodies; details only in server logs; test 39 |
| 25 | Security logging / audit immutability | DONE | `src/lib/security-log.ts`: one JSON line per event, emails/IPs/uids HMAC-pseudonymised; audit log has create/read code paths only and rules deny client writes |
| 26 | Secret scan | DONE | Working tree, all 15 commits / 347 blobs, and the built client bundle (canary method) — no real secrets; 8337320, 6f22e14, 2f1fbe3 contain placeholders only (section 5) |
| 27 | .gitignore / nested folder | DONE | Covers `.env*` (except `.env.example`), `*adminsdk*.json`, service-account/credential JSON, `*.pem`, `*.key`, `*.p12`, `*.pfx`. Nested folder: see section 5 |
| 28 | Repository visibility | DONE (reported) | **Public** (GitHub API, read-only). See R1, R2 |
| 29 | Backups, retention, export | DONE (documented) | Backups **not configured** by the repository; retention and export notes in section 8 |
| 30 | Children's data | DONE (documented) | Section 8 |
| 31 | Incident response | DONE | `SECURITY_INCIDENT_RESPONSE.md` |
| 32 | Regression tests | DONE | `scripts/security-regression-test.ts`: 26 assertions at `2efca51` → 95 passing at the resumed checkpoint → 111 passing now (no existing assertion weakened; 38a made stricter, see section 7) |
| 33 | Run all tests + build | DONE | Section 7 |
| 34 | This report | DONE | |

## 3. Security matrix

| Area | Tested | Result | Evidence |
|---|---|---|---|
| Session token (alg, iss/aud, expiry, absolute max) | Yes | Pass | security 18a–e |
| Production secret hard-fail | Yes | Pass | security 10, 19 |
| Session revocation (logout, disable, role/school change, password change) | Yes | Pass | security 20, 21, 34; fix-phase |
| Brute force (IP + account), reset/register limits | Yes | Pass | security 13, 22, 24, 17 |
| User enumeration | Yes | Pass | security 25 |
| Registration protection | Yes | Pass | security 17a–b, 26 |
| Admin 2FA (login + enrolment) | Yes | Pass | security 36a–c, 44 |
| Re-authentication for sensitive actions | Yes | Pass | security 37 |
| Cross-school IDOR | Yes | Pass | security 9, 27a–d; teacher-scoping |
| Teacher / parent / student scoping | Yes | Pass | security 28a–d; teacher-scoping 13/13; teacher-access 83/83 |
| Mass assignment / validation | Yes | Pass | security 29a–h, 41a–i |
| Attendance lock / session isolation | Yes | Pass | session-lock 40/40, fix-phase 84/84 |
| Server-side page guards (middleware bypass) | Yes | Pass | security 40a–b, 31c |
| Upload validation | Yes | Pass | security 30a–d |
| CSV formula injection | Yes | Pass | security 35a–b |
| CSRF (API, auth routes, trusted origins) | Yes | Pass | security 31a–d, 42, 43 |
| Security headers / CSP | Yes | Pass | security 12, 32a–d |
| Error leakage | Yes | Pass | security 39 |
| Email header injection | Yes | Pass | security 45 |
| Firestore / Storage rules | Yes (emulator) | Pass 9/9 | `tests/rules/firestore-storage.rules.test.mjs` |
| Client never reads profiles | Yes | Pass | security 38a, 46; rules test "users" |
| Secrets in history / bundle | Yes | Pass | Section 5 |
| Backups | No (console setting) | Not configured in repo | R6 |
| Host rate limiting / WAF | No (host setting) | Not verifiable | R4 |

## 4. Findings register

Severity: Critical / High / Medium / Low / Informational. "Before" state verified at commit `2efca51`.

### 4.1 Fixed

| ID | Sev. | Issue | Evidence (before) | Area | Action | Remaining risk |
|---|---|---|---|---|---|---|
| F1 | Critical | Every enrolled/imported student got the same password `Student@123`, published in this public repository, with predictable login emails → anyone could sign in as any student | `2efca51:src/app/api/students/route.ts:183`, `…/import/route.ts:233` | Auth / child data | Unique random initial password per student, shown once to the admin | **Accounts created before this fix still have it → R5** |
| F2 | High | Login accepted any Firebase account whose **email** matched, without binding to the profile's uid; with Firebase public self-sign-up enabled, an attacker could create a Firebase account for a school email that had none and take over that profile | `2efca51:src/app/api/auth/login/route.ts:60–105` | Auth | Firebase success counts only if `uid` = profile uid; bcrypt fallback; registration and parent linking create accounts server-side | Disable public self-sign-up in the Firebase console (P5) |
| F3 | High | Firestore rules let school admins **and teachers** read every user profile in the school, including bcrypt password hashes | `2efca51:firestore.rules` users block | Rules | No client reads of `users/*` at all | None known |
| F4 | High | (found this session, in the earlier hardening) Owner-read of `users/{uid}` exposed the user's own `mfaSecret`: anyone with an admin's password could read the TOTP secret via the Firebase client SDK and bypass 2FA | Checkpoint `5becc7c` rules + `auth-context.tsx` `getDoc(users/uid)` | Rules / 2FA | Rule `allow read: if false`; browser takes the sanitised profile from `/api/auth/me` | None known |
| F5 | Medium | Teacher records (salary, personal contact) readable by every same-school user incl. students and parents | `2efca51:firestore.rules` teachers block | Rules | Admins, or the teacher themself only | — |
| F6 | Medium | Logout, disabling, role/school change and deletion did not revoke existing sessions (only password change did) | `2efca51:src/app/api/auth/logout/route.ts` (cookie delete only) | Sessions | Live-profile check on every request; per-session revocation id (`sid`) | Max 5 min idle / 12 h absolute even if a check is skipped |
| F7 | Medium | Development fallback JWT secret (public in the repo) used whenever `NODE_ENV` ≠ production, even with real Firebase credentials configured → forgeable sessions on such a deployment | `2efca51:src/middleware.ts:8–21` | Sessions | Refused in production, on Vercel, or with any real credential | — |
| F8 | Medium | Registration secret compared with `!==` (timing), reusable without limit | `2efca51:src/app/api/auth/register/route.ts:59–60` | Registration | Constant-time, single-use, rate limited, no re-registration of existing users | — |
| F9 | Medium | Brute-force limit per IP only (no per-account lockout) | `2efca51` login `checkAuthRateLimit(clientIp)` | Auth | Added per-account lockout | In-memory per instance → R4 |
| F10 | Medium | Upload trusted the client-declared MIME type (HTML/SVG storable as "image") | `2efca51:src/app/api/upload/route.ts:41` | Uploads | Magic-byte sniffing, stored type = detected type | Files served on the Firebase Storage domain (separate origin) |
| F11 | Medium | Parent linking adopted a pre-existing Firebase account for the guardian email with whatever password its creator set → creator gets the child's records | `git diff 2efca51 -- src/lib/link-parent.ts` | Child data | Password replaced, sessions revoked, credentials only to the admin | — |
| F12 | Medium | Mass assignment / weak validation (schoolId, parentUserIds, paidAmount, NaN amounts, negative salaries, `javascript:` URLs, unbounded attendance/class/subject/timetable fields) | Tests 29a–h, 41a–i fail against the old handlers | API | Server-controlled field rejection + strict schemas | — |
| F13 | Medium | Archiving/deleting a student left their login active | `syncLoginActive` added | Child data | Login set INACTIVE + Firebase user disabled | — |
| F14 | Medium | nodemailer 7.0.13: SMTP command / header injection, addressparser DoS, file-access bypass advisories | `npm audit` | Dependencies | 10.0.15 (justified major upgrade, API used is unchanged) | — |
| F15 | Low | CSV import/export formula injection | no neutralisation at `2efca51` | Import/export | Strip on import, apostrophe-prefix on export | — |
| F16 | Low | bcrypt cost 10; weaker password minimum | `2efca51` `hashSync(…, 10)` | Passwords | Cost 12, 10-char policy + denylist | Import uses cost 6 for 120-bit random initial passwords only (justified in code) |
| F17 | Low | JWT verification without pinned algorithm / issuer / audience (jose already rejects `none` with an HMAC key) | `2efca51:src/lib/firebase/server-auth.ts:112` | Sessions | HS256 + iss/aud pinned | — |
| F18 | Low | Role layouts used any valid session without checking the role (only school counts exposed, only if middleware were bypassed) | `src/app/admin/layout.tsx` before `c9992c4` | Authorization | `requirePageRole` in all role layouts | — |
| F19 | Low | Public auth endpoints relied on middleware alone for CSRF; `CSRF_TRUSTED_ORIGINS` replaced instead of extended `NEXT_PUBLIC_APP_URL` | checkpoint `5becc7c` | CSRF | In-route check; origins merged | — |
| F20 | Low | 2FA enrolment possible with a stolen session alone (attacker enrols own authenticator) | checkpoint `5becc7c` `mfa/route.ts` | 2FA | Current password required to enable | — |
| F21 | Low | Email header values not stripped of CR/LF | `email-service.ts` | Email | `headerSafe()` | — |
| F22 | Info | Next.js 15.5.25 (Sept-2026 security release fixed in 15.5.27); `X-Powered-By` header sent | package.json | Framework | 15.5.27; header disabled | — |
| F23 | Info | Rules tests could not run on Node ≥ 22 (`node --test tests/rules/` directory argument) | first emulator run | CI | Explicit file path in `package.json` and CI | — |

### 4.2 Open (require owner action or a design decision)

| ID | Sev. | Issue | Evidence | Action for the owner | Remaining risk until done |
|---|---|---|---|---|---|
| R1 | High | The home folder `C:\Users\sheharyar` is a git repository whose `origin` is the **public** GitHub repo (branch `2026-09-07-n9dm`). Nothing there ignores the `*-firebase-adminsdk-*.json` keys in Downloads (5 projects, incl. `allied-school-system-cdcd2-…`), `.claude.json`, AppData, etc. Today it tracks only 2 files (a submodule pointer and a `package-lock.json`); no secret was found on the remote branch | `git -C ~ remote -v`, `git -C ~ ls-files` (2 files), `git check-ignore` | Remove the home-folder repository (`C:\Users\sheharyar\.git`) once you confirm it holds nothing you need, delete the remote branch `2026-09-07-n9dm` if unwanted, and move service-account keys out of Downloads (or delete them — production keys belong only in the host's environment variables) | One `git add -A && git push` from the home folder would publish private keys |
| R2 | Medium | GitHub repository is **public**: full source (registration page path, rules, security design, dev-only demo credentials) is visible | GitHub API `visibility: public` | Make it private unless open source is intended | Attackers can study the code; no secrets are in it |
| R3 | Medium | Uploaded files (student photos, documents, receipts) are served via Firebase download-token URLs: anyone holding a link can open it; `storage.rules` do not apply to token URLs | `src/lib/storage.ts` (download-token URL) | Design decision: serve files through an authenticated API route or short-lived signed URLs | Leaked links (forwarded, logged) expose children's documents |
| R4 | Medium | Rate limiting is in-memory per serverless instance | `src/lib/rate-limiter.ts` | Enable host rate limiting / WAF for `/api/auth/*` | Distributed guessing across instances is slowed, not stopped (bcrypt cost 12, lockouts still apply per instance) |
| R5 | Medium | Student accounts created before F1 still have `Student@123` | F1 | Before go-live, reset initial passwords for all existing student logins (admin re-issue) or force a reset; do not reuse the old value | Account takeover of those students |
| R6 | Medium | No backup / point-in-time recovery configured by the repository | No backup code/config | See P3 | Data loss on error or attack |
| R7 | Low | Deleting a student removes only the `students` document; attendance, fees, results, observations and uploaded files remain | `deleteStudentServer` | Decide a retention period and deletion procedure (section 8) | Data kept longer than needed |
| R8 | Low | 19 npm advisories without a non-major fix, none reachable at runtime | Section 6 | Re-check after Next 16 / Tailwind 4 / Firebase JS updates | Build/dev-time tooling only |
| R9 | Info | Admin 2FA and re-authentication are OFF until configured | `.env.example` | P4 | — |
| R10 | Info | Nested folder `Allied-management-sytem/` is a separate clone of the GitHub repo (`main` @ `cd6c35a`, 2026-09-23), git-ignored, no secret files, **no uncommitted or unpushed work** | `git status`, `git log origin/main..main` | Safe to delete when you choose (not deleted) | Confusion only; excluded from typecheck (`tsconfig.json`) |

## 5. Secrets & repository hygiene

- **Working tree:** only `.env.example` is tracked. Ignored and present: `.env.local`, `.next/`,
  `Allied-management-sytem/`, `tsconfig.tsbuildinfo` (names only; `.env.local` never opened).
- **Git history:** all 15 commits, 347 unique blobs scanned for private-key blocks, service-account
  JSON, Google API keys, Resend / GitHub / Slack / Stripe tokens and `JWT_SECRET` /
  `SMTP_PASS` / `FIREBASE_PRIVATE_KEY` / `SCHOOL_REGISTRATION_SECRET` / `RESEND_API_KEY` /
  `SECURITY_LOG_SALT` assignments. Every hit is a placeholder: in 8337320, 6f22e14, 2f1fbe3 (and
  the other commits) `FIREBASE_PRIVATE_KEY` contains a 25-character "YOUR…" body between the BEGIN/END
  markers (a real key body is ~1,600 base64 characters), `JWT_SECRET` is "replace…", the Resend key
  is a commented `re_x…` example, and the Firebase web-key fallback in `config.ts` contains "Dummy".
  **No real secret was ever committed.**
- **Client bundle:** production build with fake canary values for every server secret;
  `.next/static` (104 files) contains none of the canaries, no private-key marker, none of the
  server env-variable names and no `mfaSecret`. (One hit for the word `passwordHash` is inside
  Google's Firebase Auth SDK, not application data.)
- **Service-account keys on disk (names only):** `Downloads/allied-school-system-cdcd2-firebase-adminsdk-fbsvc-940352ef44.json`
  (this project), plus keys of other projects (aureon-watches, pakistan-bill-counter ×2,
  sadiq-pearl-marquee ×2, trendora ×2). See R1 / P1.
- **.gitignore:** covers `.env`, `.env.*` (except `.env.example`), `*adminsdk*.json`,
  `*service-account*.json`, `*serviceAccount*.json`, `*credentials*.json`, `*.pem`, `*.key`,
  `*.p12`, `*.pfx`.

## 6. Dependencies

| Package | Before | After | Notes |
|---|---|---|---|
| next | 15.5.25 (installed) | **15.5.27** | Latest 15.5.x; no major upgrade |
| eslint-config-next | 15.2.1 (installed) | **15.5.27** | Matches Next |
| nodemailer | 7.0.13 | **10.0.15** | Major upgrade required: advisories up to ≤ 10.0.5 (SMTP command / header injection, TLS validation in OAuth2 fetch, file-access bypass, addressparser DoS). Only `createTransport` + `sendMail({from,to,subject,html,text})` are used, unchanged across versions |
| brace-expansion, source-map-js, others | — | patched | `npm audit fix` (no `--force`) |
| jwks-rsa | 4.1.0 | 4.1.0 + patch | `patches/jwks-rsa+4.1.0.patch` makes `require('jose')` lazy (ESM load-order fix). No change to verification logic; still needed while 4.1.0 is used |

`npm audit` after: 19 (14 high, 5 moderate), 0 critical — every remaining "fix" is a semver-major
change (several are downgrades):

| Advisory path | Severity | Reachable at runtime? | Why not fixed |
|---|---|---|---|
| `@grpc/grpc-js` 1.9.16 via `firebase` → `@firebase/firestore` (`~1.9.0`) | High | No — advisory concerns gRPC **server** certificate handling; the browser SDK uses WebChannel; firebase-admin uses 1.14.5 (fixed) | Pinned by the Firebase JS SDK |
| `postcss` 8.4.31 inside `next` | High/Moderate | No — build-time processing of the app's own CSS; top-level postcss is 8.5.28 (fixed) | Next 16 only |
| `tailwindcss` 3.4.19 → braces / micromatch / chokidar / postcss-selector-parser | High/Moderate | No — build-time, patterns from config | Tailwind 4 only |
| `eslint-config-next` → `@next/eslint-plugin-next` → fast-glob | High | No — lint only | Next 16 only |
| `patch-package` → find-yarn-workspace-root → micromatch | High | No — install time | Downgrade only |
| `uuid` < 11.1.1 via firebase-admin → gaxios | Moderate | No — affects v3/v5/v6 with `buf`; gaxios uses v4 | Pinned upstream |

`npm outdated` (wanted = within range): @types/node 22.20.2→22.20.5, autoprefixer 10.5.6→10.6.1,
firebase-admin 14.4.0→14.5.0, lucide-react 1.45.0→1.52.0, postcss 8.5.28→8.5.29,
tailwind-merge 3.6.0→3.7.0, tsx 4.23.13→4.23.15. Majors available but not adopted: next 16,
eslint 10, tailwindcss 4, typescript 7, zod 4.

## 7. Test results (exact, final commit `cc0237a`)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0, no errors |
| `npm run lint` | exit 0 — 0 errors, 21 warnings (all pre-existing: `react-hooks/exhaustive-deps`, `no-img-element`, Google-font notices) |
| `npm test` | 30/30 (p0) · 84 passed 0 failed (fix-phase) · 83 passed 0 failed (teacher-access) |
| `npm run test:security` | **111 passed, 0 failed** |
| `npm run test:p0` | 30/30 |
| `npm run test:phase3` | 22 passed, 0 failed |
| `npm run test:session-lock` | 40 passed, 0 failed |
| `npm run test:fix-phase` | 84 passed, 0 failed |
| `npm run test:teacher-scoping` | 13 passed, 0 failed |
| `npm run test:teacher-access` | 83 passed, 0 failed |
| Rules tests (Firestore + Storage emulators, JDK 25, firebase-tools 14, project `demo-allied-rules-test`) | **9 passed, 0 failed** (rules unchanged since the run) |
| `npm run build` | exit 0 — compiled, types + lint checked, 43/43 pages generated |

How the build was run: in a detached git worktree of the same commit (no `.env.local`, because
`next build` would otherwise auto-load real credentials) with `FIREBASE_PROJECT_ID=demo-allied-build`,
placeholder public Firebase values and canary secrets. The app's own production fail-fast checks
require those variables to exist. Only warnings: `jose` CompressionStream notices for the
edge runtime (JWE code paths, unused).

Test changes: 16 new assertions this session (40a–b, 41a–i, 42–46). One existing assertion,
**38a**, was changed because the security expectation became stricter: it asserted "a profile is
readable only by its owner"; it now asserts "no client can read any profile, not even its own"
(F4). The rules test for users was changed the same way (owner read now `assertFails`). No test
was weakened or removed.

## 8. Backups, retention and children's data

- **Backups:** not configured by this repository, and Firestore console settings cannot be verified
  from here. Treat as **not configured** until the owner enables point-in-time recovery and/or
  scheduled backups (P3). Uploaded files in Cloud Storage need separate protection (object
  versioning or bucket backup).
- **Retention / deletion:** archiving (ALUMNI/EXPELLED/INACTIVE) keeps records and disables the
  login; deleting a student removes the student document only (R7). The school should decide how
  long records of students who leave are kept and then remove related attendance, fees, results,
  observations and files.
- **Who can export data:** only admins (print/"Export audit log" is `window.print()`; the bulk
  import modal offers a CSV of newly created logins once). API responses are `no-store`.
- **Minimum data / access:** parents see only children linked to them (re-checked on every
  request); students only themselves; teachers only allocated classes/subjects. Security logs
  contain no names, emails or IPs (keyed hashes only); no student data in URLs beyond opaque ids.
- **Legal:** the system processes children's personal data in Pakistan. The owner's lawyer should
  confirm obligations under PECA 2016 and any applicable data-protection rules (consent, retention,
  breach notification). This report does not provide legal text.

## 9. REQUIRES PRODUCTION CONFIGURATION

| # | Item | What to do |
|---|---|---|
| P1 | **Key rotation** | Rotate the Firebase service-account key for this project (a copy sits in plaintext in Downloads and the home folder is a public-remote git repo): Google Cloud → IAM → Service accounts → Keys → add new, set `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL` on the host, redeploy, **delete the old key and the downloaded JSON**. Set a fresh `JWT_SECRET` (≥ 32 random chars), `SECURITY_LOG_SALT`, SMTP/Resend credentials. Steps: `SECURITY_INCIDENT_RESPONSE.md` §4 |
| P2 | Repository hygiene | R1 (home-folder repository), R2 (make the repository private), delete nested clone when convenient |
| P3 | Backups | Enable Firestore PITR and scheduled backups; Storage object versioning; test a restore into a staging project |
| P4 | Admin 2FA | Set `ADMIN_MFA_ENABLED=true`, have every admin enrol (Settings → Two-factor); optionally `ADMIN_REAUTH_MAX_AGE_MINUTES=30` |
| P5 | Firebase console | Disable Email/Password **public sign-up** (accounts are created server-side); restrict the web API key (HTTP referrers + APIs); keep App Check optional key if used |
| P6 | Host WAF / rate limits | Rate-limit `/api/auth/*` (login, forgot/reset password, register, mfa) at the host/edge; enable bot protection |
| P7 | Billing alerts | Google Cloud budget alerts for Firestore/Storage/Auth and host spend caps (abuse can cost money) |
| P8 | Domain & email DNS | `NEXT_PUBLIC_APP_URL` = the real https domain (reset links only use it); SPF, DKIM and DMARC for the sending domain (`EMAIL_FROM`) |
| P9 | Existing student passwords | Reset all student logins created before F1 (R5) |
| P10 | Registration secret | Set `SCHOOL_REGISTRATION_SECRET` only while registering a school, then remove it |
| P11 | Incident contacts | Fill in the contact table in `SECURITY_INCIDENT_RESPONSE.md` |

## 10. Changes made (commits on `security-hardening`, local only)

| Commit | Summary |
|---|---|
| `5becc7c` | Checkpoint of the earlier session's hardening (session-token, revocation, CSRF, logging, 2FA, registration, uploads, validation, rules, headers, tests, CI) |
| `c8e9ecc` | Dependencies: next / eslint-config-next 15.5.27, nodemailer 10.0.15, in-range audit fixes, lockfile regenerated |
| `c9992c4` | Authorization: `requirePageRole` in role layouts; strict schemas for attendance / classes / subjects |
| `96f878a` | Auth: no client profile reads (2FA-secret exposure), in-route CSRF on auth endpoints, password to enrol 2FA, trusted-origin merge; nested clone excluded from typecheck |
| `2a55080` | Email header CR/LF stripping |
| `bfd184a` | Rules tests runnable on Node ≥ 22 (package script + CI) |
| `9d4a6de` | `SECURITY_INCIDENT_RESPONSE.md` |
| `28a4f2d` | Regression tests 40–46 |
| `cc0237a` | Timetable free-text length limits (+ test 41i) |
| (this file) | `ALLIED_SECURITY_REPORT.md` |

## 11. Files changed (vs `2efca51`)

Added: `.github/workflows/security.yml`, `SECURITY_INCIDENT_RESPONSE.md`, `ALLIED_SECURITY_REPORT.md`,
`src/app/api/auth/mfa/route.ts`, `src/components/AdminTwoFactorCard.tsx`, `src/lib/account-status.ts`,
`src/lib/input-validation.ts`, `src/lib/page-auth.ts`, `src/lib/request-security.ts`,
`src/lib/security-log.ts`, `src/lib/session-token.ts`, `src/lib/totp.ts`,
`tests/rules/firestore-storage.rules.test.mjs`.

Modified: `.env.example`, `.gitignore`, `firestore.rules`, `next.config.ts`, `package.json`,
`package-lock.json`, `tsconfig.json`, `scripts/security-regression-test.ts`,
`src/middleware.ts`, layouts (`src/app/{admin,teacher,student,parent}/layout.tsx`),
pages (`src/app/admin/settings`, `login`, `reset-password`, `student/profile`),
API routes (`attendance`, `auth/{change-password,forgot-password,login,logout,me,register,reset-password}`,
`classes`, `exams`, `fees`, `observations`, `payroll`, `settings`, `students`, `students/[id]`,
`students/import`, `subjects`, `teachers`, `teachers/[id]`, `timetable`, `upload`),
components (`StudentImportModal`), libraries (`email-service`, `firebase/{auth-context,auth-password,server-auth,server-db,types}`,
`link-parent`, `password-reset`, `rate-limiter`, `spreadsheet-parser`, `storage`).
