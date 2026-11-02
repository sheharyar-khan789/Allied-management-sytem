/**
 * Teacher usernames, temporary passwords, forced password change, the reset-link page fix and
 * custom lesson-plan weeks. Runs against the in-memory store with synthetic data only: no Firebase
 * project is touched, so it can NOT prove Firestore/Firebase Auth behavior (see the final report).
 */
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET as teachersGet, POST as teachersPost } from "../src/app/api/teachers/route";
import { PUT as teacherPut, DELETE as teacherDelete } from "../src/app/api/teachers/[id]/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { GET as meGet } from "../src/app/api/auth/me/route";
import { POST as changePasswordPost } from "../src/app/api/auth/change-password/route";
import { POST as forgotPost } from "../src/app/api/auth/forgot-password/route";
import { GET as resetGet, POST as resetPost } from "../src/app/api/auth/reset-password/route";
import { GET as optionsGet } from "../src/app/api/lesson-plans/options/route";
import { GET as plansGet, POST as plansSave } from "../src/app/api/lesson-plans/route";
import { GET as summaryGet } from "../src/app/api/lesson-plans/summary/route";
import { GET as weeksGet, POST as weeksPost } from "../src/app/api/lesson-plan-weeks/route";
import { PUT as weekPut, DELETE as weekDelete } from "../src/app/api/lesson-plan-weeks/[id]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getUserByEmailServer,
  getUserByIdServer,
  getUsernameRecordServer,
  saveClassServer,
  saveSubjectServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc } from "../src/lib/firebase/types";
import { normalizeUsername, suggestUsername, validateUsername } from "../src/lib/username";
import { generateTemporaryPassword, TEMP_PASSWORD_LENGTH } from "../src/lib/temp-password";
import { checkPasswordPolicy } from "../src/lib/password-reset";
import { DEFAULT_SCHOOL_TIMEZONE, addDays, weekdayOf, zonedDateParts } from "../src/lib/lesson-plan-schedule";
import { buildWeekSchedule, resolveWeek, validateWeekInput, teachingDays, daysBetween } from "../src/lib/lesson-plan-weeks";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) { console.log(`[PASS] ${name}`); passed++; } else { console.error(`[FAIL] ${name}`); failed++; }
}

let ip = 1;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.66.${Math.floor(ip / 250)}.${ip++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieOf = (res: Response) => /allied_session=([^;]+)/.exec(res.headers.get("set-cookie") || "")?.[1] || null;

async function captureLink(fn: () => Promise<Response>): Promise<{ res: Response; link: string | null; to: string | null }> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    const res = await fn();
    const m = /link for (\S+): (https?:\/\/\S+)/.exec(lines.find((l) => l.includes("/reset-password?token=")) || "");
    return { res, link: m ? m[2] : null, to: m ? m[1] : null };
  } finally {
    console.warn = orig;
  }
}

async function run() {
  console.log("==================================================");
  console.log("TEACHER USERNAMES / TEMP PASSWORD / RESET / LESSON WEEKS");
  console.log("==================================================");
  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const A = "school-tu-a";
  const B = "school-tu-b";
  for (const id of [A, B]) {
    await updateSchoolSettingsServer({
      id, schoolId: id, schoolName: `School ${id}`, campusName: "", motto: "", address: "", phone: "", email: `a@${id}.test`,
      principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    });
  }
  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.test`, role, schoolId, name: uid, ...extra });
  const ADMIN_A = await session("uid-tu-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-tu-admin-b", "ADMIN", B);

  // ------------------------------------------------------------ username policy
  assert(validateUsername("ali.teacher01") === null, "Username: ali.teacher01 is valid");
  assert(validateUsername("  Ali.Teacher01 ") === null && normalizeUsername("  Ali.Teacher01 ") === "ali.teacher01", "Username: trimmed and normalized to lowercase");
  for (const bad of ["ab", "x".repeat(31), "has space", "a@b.com", ".start", "end.", "dou..ble", "-lead", "UPPER!", "admin", "ali/teacher"]) {
    assert(validateUsername(bad) !== null, `Username: rejects "${bad.slice(0, 12)}"`);
  }
  assert(validateUsername("") !== null && validateUsername(undefined) !== null && validateUsername(42) !== null, "Username: empty/undefined/non-string rejected");
  assert(validateUsername(suggestUsername("Muhammad Ali")) === null && suggestUsername("Muhammad Ali") === "muhammad.ali", "Username: suggestion from a name is valid");

  // ------------------------------------------------------------ temporary password
  const samples = Array.from({ length: 300 }, () => generateTemporaryPassword({ email: "ali.personal@example.com", name: "Muhammad Ali" }));
  assert(samples.every((p) => p.length === TEMP_PASSWORD_LENGTH), "Temp password: always 16 characters");
  assert(samples.every((p) => /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[!@#$%^&*?]/.test(p)), "Temp password: always has upper, lower, digit and symbol");
  assert(new Set(samples).size === samples.length, "Temp password: 300 samples, no repeats");
  assert(samples.every((p) => !/[0OIl1]/.test(p)), "Temp password: no look-alike characters");
  assert(samples.every((p) => checkPasswordPolicy(p, { email: "ali.personal@example.com", name: "Muhammad Ali" }) === null), "Temp password: satisfies the password policy");

  // ------------------------------------------------------------ A: admin creates a teacher with username
  const create = (token: string, over: Record<string, unknown> = {}) =>
    teachersPost(req(token, "/api/teachers", "POST", {
      firstName: "Muhammad", lastName: "Ali", email: "ali.personal@example.com", phone: "03001234567",
      joiningDate: "2026-08-01", username: "Ali.Teacher01", ...over,
    }));
  const c1 = await create(ADMIN_A);
  const c1j = await json(c1);
  assert(c1.status === 201 && c1j.credentials?.username === "ali.teacher01" && typeof c1j.credentials?.temporaryPassword === "string", "Create: 201 with username (normalized) and a temporary password");
  assert((c1.headers.get("cache-control") || "").includes("no-store"), "Create: credentials response is not cacheable");
  assert(c1j.activation === null, "Create: no activation e-mail is sent for a username account (nothing carries a password)");
  const TEMP = c1j.credentials.temporaryPassword as string;
  const TID = c1j.teacher.id as string;
  const UID = c1j.teacher.userId as string;
  const profile = await getUserByIdServer(UID);
  assert(profile?.username === "ali.teacher01" && profile.mustChangePassword === true && profile.email === "ali.personal@example.com", "Create: profile has username, e-mail kept separate, mustChangePassword set");
  assert(!JSON.stringify(profile).includes(TEMP) && !JSON.stringify(c1j.teacher).includes(TEMP), "Create: the temporary password is not stored in the profile or teacher record");
  assert(Boolean(profile?.passwordHash) && !String(profile?.passwordHash).includes(TEMP), "Create (dev store): only a bcrypt hash exists, never the plaintext");
  const list1 = await json(await teachersGet(req(ADMIN_A, "/api/teachers")));
  const row = list1.teachers.find((t: any) => t.id === TID);
  assert(row?.username === "ali.teacher01" && row.email === "ali.personal@example.com" && row.activationStatus === "temporary", "List: shows name, username, e-mail and 'temporary' status");
  assert(!JSON.stringify(list1).includes(TEMP), "List: never returns the temporary password");
  const claim = await getUsernameRecordServer("ali.teacher01");
  assert(claim?.uid === UID && claim.schoolId === A && claim.teacherId === TID, "Create: username claim record is bound to this account and school");

  // ------------------------------------------------------------ Q/R: duplicates and tenancy
  const dupSame = await create(ADMIN_A, { email: "other1@example.com", username: "ali.teacher01" });
  assert(dupSame.status === 409, "Duplicate: same username rejected (409)");
  const dupCase = await create(ADMIN_A, { email: "other2@example.com", username: "ALI.TEACHER01" });
  assert(dupCase.status === 409, "Duplicate: different letter case is the same username (409)");
  const dupOtherSchool = await create(ADMIN_B, { email: "other3@example.com", username: "ali.teacher01" });
  assert(dupOtherSchool.status === 409, "Duplicate: another school cannot take the same username (globally unique)");
  assert((await create(ADMIN_A, { email: "other4@example.com", username: "a" })).status === 400, "Invalid username rejected (400) with a message");
  assert((await create(ADMIN_A, { email: "other5@example.com", username: "x@y.com" })).status === 400, "A username cannot be an e-mail address");
  const dupEmail = await create(ADMIN_A, { username: "fresh.name01" });
  assert(dupEmail.status === 409, "Duplicate e-mail still rejected");
  assert((await getUsernameRecordServer("fresh.name01")) === null, "Failed registration leaves no username claimed (no orphan lock)");
  const teacherToken = await session("uid-tu-plain-teacher", "TEACHER", A, { teacherId: "tch-none" });
  assert((await create(teacherToken, { email: "x6@example.com", username: "nope.user1" })).status === 403, "Only an admin can register teachers");

  // ------------------------------------------------------------ B-C: login with username + temporary password
  const login = (identifier: string, password: string, role = "teacher") =>
    loginPost(req(null, "/api/auth/login", "POST", { identifier, password, role }));
  const l1 = await login("ali.teacher01", TEMP);
  const l1j = await json(l1);
  const TOKEN = cookieOf(l1);
  assert(l1.status === 200 && l1j.mustChangePassword === true && l1j.redirectUrl === "/change-password" && Boolean(TOKEN), "Login by username + temp password: 200, forced to /change-password, session issued");
  assert(JSON.stringify(l1j).includes("ali.personal@example.com") === true && l1j.user?.uid === UID, "Login response carries the signed-in user's own e-mail (authenticated), nothing else leaks");
  const lUpper = await login("ALI.TEACHER01", TEMP);
  assert(lUpper.status === 200, "Login: username is case-insensitive");
  const lEmail = await login("ali.personal@example.com", TEMP);
  assert(lEmail.status === 200 && (await json(lEmail)).mustChangePassword === true, "Login by e-mail with the temp password also forces the change");
  const wrongPw = await login("ali.teacher01", "WrongPassword#123");
  const unknownUser = await login("no.such.person", "WrongPassword#123");
  const wj = await json(wrongPw), uj = await json(unknownUser);
  assert(wrongPw.status === 401 && unknownUser.status === 401 && wj.error === uj.error, "Login: wrong password and unknown username give the same status and message (no enumeration)");
  assert(!JSON.stringify(uj).includes("@") && !JSON.stringify(wj).includes("ali.personal"), "Login errors never reveal an e-mail address");
  assert((await login("ali.teacher01", TEMP, "admin")).status === 401, "Login: a teacher's credentials on the Admin tab are refused");
  for (let i = 0; i < 6; i++) await login("lockout.target", "bad-password-1");
  assert((await login("lockout.target", "bad-password-1")).status === 429, "Login: repeated failures for one username are rate limited (429)");

  // ------------------------------------------------------------ D-F: forced change is enforced server-side
  const me = await meGet(req(TOKEN, "/api/auth/me"));
  const mej = await json(me);
  assert(me.status === 200 && mej.user?.mustChangePassword === true && !("passwordHash" in (mej.user || {})), "/api/auth/me works and reports mustChangePassword (no password hash)");
  const blocked = await optionsGet(req(TOKEN, "/api/lesson-plans/options"));
  const bj = await json(blocked);
  assert(blocked.status === 403 && bj.code === "PASSWORD_CHANGE_REQUIRED", "Teacher API is refused with PASSWORD_CHANGE_REQUIRED until the password is changed");
  assert((await teachersGet(req(TOKEN, "/api/teachers"))).status === 403, "Other APIs are refused too (not only the teacher ones)");
  const badCurrent = await changePasswordPost(req(TOKEN, "/api/auth/change-password", "POST", { currentPassword: "not-the-temp-pass", newPassword: "A-Brand-New-Passw0rd!" }));
  assert(badCurrent.status === 401, "Change: wrong temporary password rejected");
  const weak = await changePasswordPost(req(TOKEN, "/api/auth/change-password", "POST", { currentPassword: TEMP, newPassword: "password123" }));
  assert(weak.status === 400, "Change: a weak/common new password rejected");
  const same = await changePasswordPost(req(TOKEN, "/api/auth/change-password", "POST", { currentPassword: TEMP, newPassword: TEMP }));
  assert(same.status === 400, "Change: new password must differ from the temporary one");
  assert((await getUserByIdServer(UID))?.mustChangePassword === true, "Failed changes do not clear the requirement");
  const NEWPW = "A-Brand-New-Passw0rd!";
  const ok = await changePasswordPost(req(TOKEN, "/api/auth/change-password", "POST", { currentPassword: TEMP, newPassword: NEWPW }));
  const NEWTOKEN = cookieOf(ok);
  assert(ok.status === 200 && Boolean(NEWTOKEN), "Change: succeeds and re-issues the session");
  const after = await getUserByIdServer(UID);
  assert(after?.mustChangePassword === false && after.uid === UID && after.teacherId === TID && after.schoolId === A && after.username === "ali.teacher01", "After change: requirement cleared; uid, teacher link, school and username intact");
  const afterOpts = await optionsGet(req(NEWTOKEN, "/api/lesson-plans/options"));
  if (afterOpts.status !== 200) console.error("DEBUG after-change options:", afterOpts.status, JSON.stringify(await json(afterOpts)).slice(0, 300));
  assert(afterOpts.status === 200, "After change: the teacher APIs open");
  assert((await optionsGet(req(TOKEN, "/api/lesson-plans/options"))).status === 401, "The old session (before the change) no longer works");
  const l2 = await login("ali.teacher01", NEWPW);
  const l2j = await json(l2);
  assert(l2.status === 200 && !l2j.mustChangePassword && l2j.redirectUrl === "/teacher", "Login again with username + new password: straight to the teacher dashboard");
  assert((await login("ali.teacher01", TEMP)).status === 401, "The temporary password no longer works");
  assert((await teachersGet(req(NEWTOKEN, "/api/teachers"))).status === 403, "A teacher still cannot use admin APIs");

  // ------------------------------------------------------------ H-J: reset link flow
  const forgotU = await captureLink(() => forgotPost(req(null, "/api/auth/forgot-password", "POST", { email: "ali.teacher01" })));
  const forgotE = await captureLink(() => forgotPost(req(null, "/api/auth/forgot-password", "POST", { email: "ali.personal@example.com" })));
  const forgotX = await captureLink(() => forgotPost(req(null, "/api/auth/forgot-password", "POST", { email: "no.such.person" })));
  const fj = [await json(forgotU.res), await json(forgotE.res), await json(forgotX.res)];
  assert(forgotU.res.status === 200 && forgotE.res.status === 200 && forgotX.res.status === 200 && fj[0].message === fj[2].message, "Forgot password: username, e-mail and unknown username get the same generic answer");
  assert(forgotU.to === "ali.personal@example.com" && forgotE.to === "ali.personal@example.com" && forgotX.link === null, "Forgot password by username: the link goes to the teacher's own e-mail only");
  const token = forgotE.link ? new URL(forgotE.link).searchParams.get("token") || "" : "";
  const g1 = await resetGet(req(null, `/api/auth/reset-password?token=${token}`));
  const g1j = await json(g1);
  assert(g1.status === 200 && g1j.valid === true, "Reset link: validation answers immediately with valid:true");
  assert((await json(await resetGet(req(null, "/api/auth/reset-password?token=nope")))).valid === false, "Reset link: a bad token answers valid:false (never hangs)");
  assert((await resetGet(req(null, "/api/auth/reset-password"))).status === 400, "Reset link: a missing token answers 400");
  assert((await resetPost(req(null, "/api/auth/reset-password", "POST", { token, newPassword: "short" }))).status === 400, "Reset: a short password is rejected");
  const RESETPW = "Reset-Via-Link-Passw0rd#";
  const r1 = await resetPost(req(null, "/api/auth/reset-password", "POST", { token, newPassword: RESETPW }));
  assert(r1.status === 200 && (await json(r1)).success === true, "Reset: the password is updated");
  const r2 = await resetPost(req(null, "/api/auth/reset-password", "POST", { token, newPassword: "Another-Passw0rd#2" }));
  assert(r2.status === 400 && (await json(r2)).code === "USED", "Reset: the link can be used only once ('already used')");
  assert((await json(await resetGet(req(null, `/api/auth/reset-password?token=${token}`)))).code === "USED", "Reset: validating a used link says 'USED'");
  const afterResetLogin = await login("ali.teacher01", RESETPW);
  assert(afterResetLogin.status === 200 && (await login("ali.teacher01", NEWPW)).status === 401, "Reset: the new password works by username, the old one does not");
  assert((await optionsGet(req(NEWTOKEN, "/api/lesson-plans/options"))).status === 401, "Reset: sessions signed in before the reset are ended");
  const TEACHER_SESSION = cookieOf(afterResetLogin) as string;

  // ------------------------------------------------------------ P: existing teachers
  const legacy = await create(ADMIN_A, { email: "legacy.teacher@example.com", firstName: "Legacy", lastName: "Teacher", username: undefined });
  const lj = await json(legacy);
  assert(legacy.status === 201 && !lj.credentials && lj.activation !== undefined, "Existing flow unchanged: no username means an activation link and no temporary password");
  const LEG = lj.teacher;
  const legProfile = await getUserByIdServer(LEG.userId);
  assert(!legProfile?.username && !legProfile?.mustChangePassword, "Existing-style teacher: no username, no forced password change");
  const assign = await teacherPut(req(ADMIN_A, `/api/teachers/${LEG.id}`, "PUT", { username: "legacy.teacher1" }), idParams(LEG.id));
  assert(assign.status === 200, "Admin can assign a username to an existing teacher");
  const legAfter = await getUserByIdServer(LEG.userId);
  assert(legAfter?.username === "legacy.teacher1" && legAfter.email === "legacy.teacher@example.com" && legAfter.uid === LEG.userId && !legAfter.mustChangePassword, "Assigned: e-mail and uid untouched, no forced password change");
  assert((await teacherPut(req(ADMIN_A, `/api/teachers/${LEG.id}`, "PUT", { username: "ali.teacher01" }), idParams(LEG.id))).status === 409, "Assigning a taken username is refused");
  assert((await teacherPut(req(ADMIN_B, `/api/teachers/${LEG.id}`, "PUT", { username: "b.cannot.touch" }), idParams(LEG.id))).status === 404, "Another school's admin cannot reach this teacher");
  assert((await teacherPut(req(TEACHER_SESSION, `/api/teachers/${LEG.id}`, "PUT", { username: "teacher.self1" }), idParams(LEG.id))).status === 403, "A teacher cannot set usernames");
  const rename = await teacherPut(req(ADMIN_A, `/api/teachers/${LEG.id}`, "PUT", { username: "legacy.renamed" }), idParams(LEG.id));
  assert(rename.status === 200 && (await getUsernameRecordServer("legacy.teacher1")) === null && (await getUsernameRecordServer("legacy.renamed"))?.uid === LEG.userId, "Changing a username frees the old one and claims the new one");
  assert((await teacherPut(req(ADMIN_A, `/api/teachers/${LEG.id}`, "PUT", { username: "bad name!" }), idParams(LEG.id))).status === 400, "An invalid username on edit is rejected");
  const del = await teacherDelete(req(ADMIN_A, `/api/teachers/${LEG.id}`, "DELETE"), idParams(LEG.id));
  assert(del.status === 200 && (await getUsernameRecordServer("legacy.renamed")) === null, "Deleting a teacher frees the username for reuse");
  assert((await getUserByEmailServer("ali.personal@example.com"))?.uid === UID, "The other teacher's account is untouched");

  // ------------------------------------------------------------ K-R: custom lesson-plan weeks
  const tz = DEFAULT_SCHOOL_TIMEZONE;
  const today = zonedDateParts(tz).date;
  const cls: ClassDoc = { id: "cls-tu-1", schoolId: A, name: "Class 5", section: "A", numericLevel: 5, capacity: 30, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(cls);
  const subj: SubjectDoc = { id: "sb-tu-1", schoolId: A, classId: cls.id, name: "Mathematics", code: "MATH", teacherId: TID, credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveSubjectServer(subj);
  const TEACHER = TEACHER_SESSION;
  const saveWeek = (token: string, body: unknown) => weeksPost(req(token, "/api/lesson-plan-weeks", "POST", body));
  const savePlan = (token: string, body: unknown) => plansSave(req(token, "/api/lesson-plans", "POST", body));
  const mondayAfter = (d: string) => { let x = addDays(d, 1); while (weekdayOf(x) !== "Monday") x = addDays(x, 1); return x; };

  // pure rules: validation, leap years, year boundaries
  const okIn = (startDate: string, endDate: string, label = "Week") => validateWeekInput({ label, startDate, endDate });
  assert(okIn("2028-02-27", "2028-03-02").ok && teachingDays("2028-02-27", "2028-03-02").some((d) => d.date === "2028-02-29"), "Dates: 29 Feb 2028 (leap year) is a real day inside a week");
  assert(!okIn("2027-02-27", "2027-02-29").ok && !okIn("2027-02-29", "2027-03-03").ok, "Dates: 29 Feb 2027 does not exist and is rejected");
  const boundary = teachingDays("2026-12-28", "2027-01-03");
  assert(boundary[0].date === "2026-12-28" && boundary[boundary.length - 1].date === "2027-01-02" && boundary.length === 6, "Dates: a week across the new year runs Mon 28 Dec 2026 to Sat 2 Jan 2027 (Sunday skipped)");
  assert(daysBetween("2028-02-28", "2028-03-01") === 2 && daysBetween("2027-02-28", "2027-03-01") === 1, "Dates: leap-year day arithmetic is exact");
  assert(!okIn("2026-10-05", "2026-10-05").ok && !okIn("2026-10-06", "2026-10-05").ok, "Validation: start must be before end");
  assert(!okIn("2026-10-01", "2026-11-05").ok && okIn("2026-10-01", "2026-10-31").ok, "Validation: a week spans at most 31 days");
  assert(!okIn("2026-10-05", "2026-10-11", "  ").ok && !okIn("10/05/2026", "2026-10-11").ok, "Validation: a name and ISO dates are required");
  const sampleCustom = [{ id: "x", schoolId: A, academicYear: YEAR, weekId: "2031-03-03", label: "Far", startDate: "2031-03-03", endDate: "2031-03-09", createdBy: "u", createdAt: now, updatedAt: now }];
  assert(resolveWeek("2031-03-03", sampleCustom).ok && resolveWeek("2035-06-04", []).ok && !resolveWeek("2035-06-05", []).ok, "Resolve: custom week, any future Monday (no last week), and a random weekday is refused");
  const nextMon = mondayAfter(today);
  const sched = buildWeekSchedule([{ ...sampleCustom[0], weekId: nextMon, startDate: nextMon, endDate: addDays(nextMon, 6), label: "Covers next Monday" }], tz);
  assert(sched.weeks.filter((w) => w.startDate === nextMon).length === 1 && sched.weeks.find((w) => w.startDate === nextMon)?.kind === "CUSTOM", "Schedule: a standard week covered by a custom week is replaced, not duplicated");

  // a historical standard-week draft that must survive everything below
  const histMonday = addDays(nextMon, 21);
  const hist = await savePlan(TEACHER, { classId: cls.id, subjectId: subj.id, weekId: histMonday, days: [{ date: histMonday, content: "Keep me" }], action: "SAVE_DRAFT" });
  assert(hist.status === 201, "Existing behavior: a standard Monday week still accepts a plan");

  // admin creates a week that opens its submission window now
  const start = addDays(today, 1);
  const end = addDays(today, 9);
  const w1 = await saveWeek(ADMIN_A, { label: "Winter block 1", startDate: start, endDate: end });
  const w1j = await json(w1);
  const W1 = w1j.week;
  assert(w1.status === 201 && W1?.weekId === start && W1.academicYear === YEAR, "Weeks: admin creates a custom week (stable id = start date, session defaults to the active one)");
  assert((await saveWeek(TEACHER, { label: "Nope", startDate: addDays(today, 40), endDate: addDays(today, 46) })).status === 403, "Weeks: a teacher cannot create weeks");
  assert((await saveWeek(ADMIN_A, { label: "Dup", startDate: start, endDate: addDays(start, 3) })).status === 409, "Weeks: the same start date is refused (duplicate)");
  assert((await saveWeek(ADMIN_A, { label: "Overlap", startDate: addDays(start, 4), endDate: addDays(start, 12) })).status === 409, "Weeks: an overlapping range is refused");
  assert((await saveWeek(ADMIN_A, { label: "Bad", startDate: addDays(today, 60), endDate: addDays(today, 50) })).status === 400, "Weeks: end before start is refused");
  assert((await saveWeek(ADMIN_A, { label: "Leap?", startDate: "2027-02-29", endDate: "2027-03-05" })).status === 400, "Weeks: a non-existent date is refused");
  assert((await saveWeek(ADMIN_A, { label: "", startDate: addDays(today, 60), endDate: addDays(today, 66) })).status === 400, "Weeks: an empty name is refused");
  assert((await saveWeek(ADMIN_A, { label: "Over a historical plan", startDate: addDays(histMonday, -2), endDate: addDays(histMonday, 8) })).status === 409, "Weeks: cannot be defined across existing plans with different dates (history protected)");
  const named = await saveWeek(ADMIN_A, { label: "Named historical week", startDate: histMonday, endDate: addDays(histMonday, 6) });
  assert(named.status === 201, "Weeks: a week with exactly the dates of existing plans may be named");
  const far = await saveWeek(ADMIN_A, { label: "Term 1 2031", startDate: "2031-03-03", endDate: "2031-03-09", academicYear: "2031-2032" });
  assert(far.status === 201, "Weeks: a week far beyond 2027 can be created (no hardcoded final week or year)");
  const adminList = await json(await weeksGet(req(ADMIN_A, "/api/lesson-plan-weeks")));
  const rowW1 = adminList.weeks.find((w: any) => w.weekId === start);
  const rowHist = adminList.weeks.find((w: any) => w.weekId === histMonday);
  assert(rowW1?.planCount === 0 && rowW1.datesEditable === true && rowHist?.planCount === 1 && rowHist.datesEditable === false, "Weeks: admin list shows each week's plan count and whether its dates can change");
  assert(adminList.weeks.some((w: any) => w.weekId === "2031-03-03" && w.academicYear === "2031-2032"), "Weeks: future-session weeks are listed for the admin");
  assert((await weeksGet(req(TEACHER, "/api/lesson-plan-weeks"))).status === 403, "Weeks: teachers cannot use the management list");

  // one schedule for the teacher form and the admin review page
  const tOpt = await json(await optionsGet(req(TEACHER, "/api/lesson-plans/options")));
  const aOpt = await json(await optionsGet(req(ADMIN_A, "/api/lesson-plans/options")));
  const tw = tOpt.weeks.find((w: any) => w.weekId === start);
  assert(tw?.kind === "CUSTOM" && tw.label === "Winter block 1" && tw.endDate === end && tw.days.length === teachingDays(start, end).length, "Schedule: the new week appears in the teacher form with its label, dates and teaching days");
  assert(JSON.stringify(tOpt.weeks.map((w: any) => w.weekId)) === JSON.stringify(aOpt.weeks.map((w: any) => w.weekId)) && tOpt.defaultWeekId === aOpt.defaultWeekId, "Schedule: teacher form and admin review use the identical list");
  assert(tOpt.defaultWeekId === start, "Schedule: the form opens on the week whose submission window is open");
  assert(!tOpt.weeks.some((w: any) => w.weekId === "2031-03-03"), "Schedule: a far-future week is not offered to teachers yet (but exists)");

  // teacher submits to the custom week; admin reviews it
  const days = tw.days.map((d: any) => ({ date: d.date, content: `Lesson for ${d.date}` }));
  const sub = await savePlan(TEACHER, { classId: cls.id, subjectId: subj.id, weekId: start, days, action: "SUBMIT" });
  const subJson = await json(sub);
  assert(sub.status === 201 && subJson.plan?.weekEndDate === end && subJson.plan.days.length === days.length && subJson.plan.status === "SUBMITTED", "Submit: the teacher submits a plan for the custom week (all its teaching days, real start/end)");
  assert((await savePlan(TEACHER, { classId: cls.id, subjectId: subj.id, weekId: start, days: [{ date: addDays(end, 3), content: "x" }], action: "SAVE_DRAFT" })).status === 400, "Submit: a date outside the week is refused");
  let insideMonday = start;
  while (weekdayOf(insideMonday) !== "Monday") insideMonday = addDays(insideMonday, 1);
  if (insideMonday !== start && insideMonday <= end) {
    const covered = await savePlan(TEACHER, { classId: cls.id, subjectId: subj.id, weekId: insideMonday, days: [{ date: insideMonday, content: "x" }], action: "SAVE_DRAFT" });
    assert(covered.status === 400 && /custom week/i.test((await json(covered)).error), "Submit: a standard Monday inside the custom week is refused ('use the custom week')");
  }
  const notAWeek = addDays(nextMon, 2);
  assert((await savePlan(TEACHER, { classId: cls.id, subjectId: subj.id, weekId: notAWeek, days: [{ date: notAWeek, content: "x" }], action: "SAVE_DRAFT" })).status === 400, "Submit: a date that starts no week is not accepted");
  const review = await json(await summaryGet(req(ADMIN_A, `/api/lesson-plans/summary?weekId=${start}`)));
  assert(review.success && review.rows.some((r: any) => r.subjectId === subj.id && /SUBMITTED/.test(String(r.status))), "Review: the admin sees the submission for the custom week");
  const adminPlans = await json(await plansGet(req(ADMIN_A, `/api/lesson-plans?weekId=${start}`)));
  assert(adminPlans.plans.length === 1 && adminPlans.plans[0].teacherId === TID, "Review: the admin can open that submission");
  const histAgain = await json(await plansGet(req(TEACHER, `/api/lesson-plans?classId=${cls.id}&subjectId=${subj.id}&weekId=${histMonday}`)));
  assert(histAgain.plans.length === 1 && histAgain.plans[0].days[0].content === "Keep me" && histAgain.plans[0].weekEndDate === addDays(histMonday, 6), "History: the earlier plan is untouched and still opens");

  // safe edits
  const renamed = await weekPut(req(ADMIN_A, `/api/lesson-plan-weeks/${W1.id}`, "PUT", { label: "Winter block (renamed)" }), idParams(W1.id));
  assert(renamed.status === 200 && (await json(renamed)).week.weekId === start, "Edit: a week can be renamed; its key does not change");
  assert((await weekPut(req(ADMIN_A, `/api/lesson-plan-weeks/${W1.id}`, "PUT", { endDate: addDays(end, 1) }), idParams(W1.id))).status === 409, "Edit: dates cannot change once plans are filed under the week");
  assert((await weekDelete(req(ADMIN_A, `/api/lesson-plan-weeks/${W1.id}`, "DELETE"), idParams(W1.id))).status === 409, "Delete: a week with plans cannot be removed");
  const farRow = (await json(await weeksGet(req(ADMIN_A, "/api/lesson-plan-weeks")))).weeks.find((w: any) => w.weekId === "2031-03-03");
  const redate = await weekPut(req(ADMIN_A, `/api/lesson-plan-weeks/${farRow.id}`, "PUT", { startDate: "2031-03-10", endDate: "2031-03-16" }), idParams(farRow.id));
  assert(redate.status === 200 && (await json(redate)).week.weekId === "2031-03-10", "Edit: an unused week can be re-dated (its key follows the start date)");
  const afterRedate = (await json(await weeksGet(req(ADMIN_A, "/api/lesson-plan-weeks")))).weeks;
  assert(!afterRedate.some((w: any) => w.weekId === "2031-03-03") && afterRedate.some((w: any) => w.weekId === "2031-03-10"), "Edit: re-dating leaves no stale copy behind");
  const farRow2 = afterRedate.find((w: any) => w.weekId === "2031-03-10");
  assert((await weekDelete(req(ADMIN_A, `/api/lesson-plan-weeks/${farRow2.id}`, "DELETE"), idParams(farRow2.id))).status === 200, "Delete: an unused week can be removed");

  // tenant isolation
  const bList = await json(await weeksGet(req(ADMIN_B, "/api/lesson-plan-weeks")));
  assert(bList.weeks.length === 0, "Tenancy: another school sees none of these weeks");
  assert((await weekPut(req(ADMIN_B, `/api/lesson-plan-weeks/${W1.id}`, "PUT", { label: "hijack" }), idParams(W1.id))).status === 404 && (await weekDelete(req(ADMIN_B, `/api/lesson-plan-weeks/${W1.id}`, "DELETE"), idParams(W1.id))).status === 404, "Tenancy: another school's admin cannot edit or remove them");
  assert((await saveWeek(ADMIN_B, { label: "B's own", startDate: start, endDate: end })).status === 201, "Tenancy: another school may define its own week on the same dates");
  assert((await json(await weeksGet(req(ADMIN_A, "/api/lesson-plan-weeks")))).weeks.find((w: any) => w.weekId === start)?.label === "Winter block (renamed)", "Tenancy: ...without touching this school's week");
  const teacherB = await session("uid-tu-b-teacher", "TEACHER", B, { teacherId: "tch-b" });
  assert((await savePlan(teacherB, { classId: cls.id, subjectId: subj.id, weekId: start, days: [{ date: start, content: "x" }], action: "SAVE_DRAFT" })).status >= 400, "Tenancy: a teacher of another school cannot file plans against this school's class");

  // ------------------------------------------------------------ the reset-link page fix (source regression)
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  for (const rel of ["src/app/reset-password/layout.tsx", "src/app/change-password/layout.tsx", "src/app/register-institution-x7k2p/layout.tsx", "src/app/login/layout.tsx"]) {
    assert(/export const dynamic = "force-dynamic"/.test(read(rel)), `Reset-link fix: ${rel} renders per request (so scripts get the CSP nonce)`);
  }
  const resetPage = read("src/app/reset-password/page.tsx");
  assert(!/validatedRef/.test(resetPage) && /signal: submitController\.signal/.test(resetPage), "Reset page: no stuck-validation guard; submit has a timeout");
  assert(/"\/change-password"/.test(read("src/middleware.ts")), "Middleware: /change-password is covered (nonce + session)");

  console.log("");
  return finish();
}

function finish() {
  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
