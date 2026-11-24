/**
 * Teacher activation escape hatch (Task 1): a teacher created via the e-mailed set-password link
 * who never received/used it (most commonly: no email provider configured) is permanently stuck
 * in "Activation Pending" with zero credentials. PATCH /api/teachers/[id]/activation lets an
 * admin issue a temporary username + password directly, reusing the exact mechanism the
 * username-signup path already uses at creation time — without weakening mustChangePassword or
 * requireAuth. Runs against the in-memory store (no Firebase credentials loaded by tsx).
 */
import { NextRequest } from "next/server";
import { POST as teachersPost } from "../src/app/api/teachers/route";
import { PATCH as issueCredentialsPatch } from "../src/app/api/teachers/[id]/activation/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as resetPost } from "../src/app/api/auth/reset-password/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getAuditLogsServer,
  getPasswordResetTokenServer,
  getUserByEmailServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { hashResetToken } from "../src/lib/password-reset";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ cookie: token ? `allied_session=${token}` : "" , origin: "http://localhost:3000"});
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

/** Runs `fn` while capturing console.warn, returning the dev-console link it printed (if any). */
async function captureDevLink(fn: () => Promise<Response>): Promise<{ res: Response; link: string | null }> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    const res = await fn();
    const line = lines.find((l) => l.includes("/reset-password?token="));
    return { res, link: line ? /(https?:\/\/\S+)/.exec(line)![1] : null };
  } finally {
    console.warn = orig;
  }
}
const tokenFromLink = (link: string | null) => (link ? new URL(link).searchParams.get("token") || "" : "");

async function run() {
  console.log("==================================================");
  console.log("TEACHER ACTIVATION ESCAPE HATCH");
  console.log("==================================================");

  const now = new Date().toISOString();
  const SCHOOL = "school-escape-a";
  await updateSchoolSettingsServer({
    id: SCHOOL, schoolId: SCHOOL, schoolName: "Escape Test School", campusName: "Main", motto: "", address: "",
    phone: "", email: `admin@${SCHOOL}.edu`, principalName: "P", academicYear: "2026-2027", gradingScale: [], updatedAt: now,
  });
  const ADMIN = await createSessionCookieServer({ uid: "uid-escape-admin", email: "admin@x.edu", role: "ADMIN", schoolId: SCHOOL, name: "Admin" });
  const TEACHER_SESSION = (uid: string) => createSessionCookieServer({ uid, email: `${uid}@x.edu`, role: "TEACHER", schoolId: SCHOOL, name: uid });

  // ======================================================================
  // 1. A teacher created via the e-mailed activation link (no username/temp password) — the
  //    exact "Activation Pending" state. Simulate the link never being delivered/used.
  // ======================================================================
  const pendingEmail = "pending.teacher@school-escape-a.edu";
  const createRes = await teachersPost(req(ADMIN, "http://x/api/teachers", "POST", {
    firstName: "Pending", lastName: "Teacher", email: pendingEmail, phone: "03001112222", joiningDate: "2026-01-01",
  }));
  const createJson = await json(createRes);
  assert(createRes.status === 201, "Teacher created via the e-mail activation path (no username supplied)");
  const pendingTeacherId = createJson.teacher.id;
  const pendingProfileBefore = await getUserByEmailServer(pendingEmail);
  assert(!pendingProfileBefore?.passwordHash, "Stuck account genuinely has no password hash — never completed activation");

  // ======================================================================
  // 2. The escape hatch: admin issues temporary credentials directly, independent of email.
  // ======================================================================
  const issueRes = await issueCredentialsPatch(
    req(ADMIN, `http://x/api/teachers/${pendingTeacherId}/activation`, "PATCH", { username: "pending.teacher" }),
    idParams(pendingTeacherId)
  );
  const issueJson = await json(issueRes);
  assert(issueRes.status === 200, "Admin issues temporary credentials for the stuck teacher");
  assert(
    issueJson.credentials?.username === "pending.teacher" &&
      typeof issueJson.credentials?.temporaryPassword === "string" &&
      issueJson.credentials.temporaryPassword.length >= 16 &&
      issueJson.credentials?.mustChangePassword === true,
    "Response returns a username, a strong one-time temporary password, and mustChangePassword=true"
  );

  // --- mustChangePassword / requireAuth gating is NOT weakened: the teacher CAN sign in, but
  //     is still forced through the password-change flow (this is the existing security control,
  //     unchanged — see src/lib/firebase/server-auth.ts). ---
  const loginWithTemp = await loginPost(req(null, "http://x/api/auth/login", "POST", {
    identifier: "pending.teacher", password: issueJson.credentials.temporaryPassword,
  }));
  const loginWithTempJson = await json(loginWithTemp);
  assert(loginWithTemp.status === 200, "Teacher can log in immediately with the admin-issued temporary password");
  assert(
    loginWithTempJson.redirectUrl === "/change-password" || loginWithTempJson.mustChangePassword === true,
    "Temp-password login is routed to change their password first — access is granted, not blocked by the policy"
  );

  const profileAfterIssue = await getUserByEmailServer(pendingEmail);
  assert(profileAfterIssue?.username === "pending.teacher" && profileAfterIssue?.mustChangePassword === true, "Login profile now carries the issued username and mustChangePassword flag");

  const logs = await getAuditLogsServer(SCHOOL, 10);
  assert(
    logs.some((l) => l.action === "ISSUE_TEACHER_TEMP_CREDENTIALS" && l.entityId === pendingTeacherId),
    "An audit log entry records the admin issuing temporary credentials"
  );

  // ======================================================================
  // 3. Guard rails: cannot be used against an already-active account; cross-school/role checks.
  // ======================================================================
  const reuseRes = await issueCredentialsPatch(
    req(ADMIN, `http://x/api/teachers/${pendingTeacherId}/activation`, "PATCH", { username: "something.else" }),
    idParams(pendingTeacherId)
  );
  assert(reuseRes.status === 409, "Cannot re-issue temporary credentials once the account has a password hash (already activated)");

  // A second, genuinely-activated teacher (sets their OWN password via the activation link) must
  // be rejected by the escape hatch — it only applies to accounts that never completed activation.
  const { res: activeCreateRes, link: activationLink } = await captureDevLink(() =>
    teachersPost(req(ADMIN, "http://x/api/teachers", "POST", {
      firstName: "Active", lastName: "Teacher", email: "active.teacher@school-escape-a.edu", phone: "03003334444", joiningDate: "2026-01-01",
    }))
  );
  const activeCreateJson = await json(activeCreateRes);
  const activeTeacherId = activeCreateJson.teacher.id;
  const activationToken = tokenFromLink(activationLink);
  await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: activationToken, newPassword: "ChosenByMe#2026" }));
  const alreadyActiveRes = await issueCredentialsPatch(
    req(ADMIN, `http://x/api/teachers/${activeTeacherId}/activation`, "PATCH", { username: "active.teacher" }),
    idParams(activeTeacherId)
  );
  assert(alreadyActiveRes.status === 409, "Escape hatch refuses an account that completed activation on their own");

  const ADMIN_OTHER_SCHOOL = await createSessionCookieServer({ uid: "uid-escape-admin-b", email: "admin@y.edu", role: "ADMIN", schoolId: "school-escape-b", name: "Admin B" });
  const crossSchoolRes = await issueCredentialsPatch(
    req(ADMIN_OTHER_SCHOOL, `http://x/api/teachers/${activeTeacherId}/activation`, "PATCH", { username: "hijack" }),
    idParams(activeTeacherId)
  );
  assert(crossSchoolRes.status === 404, "Another school's admin cannot issue credentials for this teacher");

  const TEACHER_SELF = await TEACHER_SESSION("uid-escape-self");
  const teacherCallRes = await issueCredentialsPatch(
    req(TEACHER_SELF, `http://x/api/teachers/${pendingTeacherId}/activation`, "PATCH", { username: "self.issued" }),
    idParams(pendingTeacherId)
  );
  assert(teacherCallRes.status === 403, "A teacher cannot issue credentials for themselves or anyone else (ADMIN-only route)");

  console.log("==================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
