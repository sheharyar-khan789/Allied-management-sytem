/**
 * Phase 6 (admin view of which teachers can open a student), Phase 9 (student login IDs and safe
 * email changes) and Phase 10 (bulk student password resets). Runs against the in-memory store
 * like the other suites: no Firebase project is touched, so the Authentication-provider side
 * (adminAuth.updateUser) is NOT exercised here — see the notes in the completion report.
 */
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  allocateCounterValueServer,
  getStudentByIdServer,
  getUserByIdServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
  getAuditLogsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";
import { POST as studentsPost } from "../src/app/api/students/route";
import { GET as accessGet } from "../src/app/api/students/[id]/teacher-access/route";
import { PUT as loginEmailPut } from "../src/app/api/students/[id]/login-email/route";
import { POST as passwordsPost, TEMPORARY_STUDENT_PASSWORD } from "../src/app/api/students/passwords/route";
import { GET as settingsGet, PUT as settingsPut } from "../src/app/api/settings/route";
import { allocateStudentLoginEmail, formatStudentLoginEmail, resolveLoginConfig } from "../src/lib/student-login-id";

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

let ip = 1;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.77.${Math.floor(ip / 250)}.${ip++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  console.log("==================================================");
  console.log("STUDENT ACCOUNTS: TEACHER ACCESS / LOGIN IDS / PASSWORDS");
  console.log("==================================================");
  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const A = "school-sa-a";
  const B = "school-sa-b";
  for (const schoolId of [A, B]) {
    await updateSchoolSettingsServer({
      id: schoolId, schoolId, schoolName: schoolId, campusName: "Main", motto: "", address: "", phone: "",
      email: `office@${schoolId}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    });
  }
  const cls = (id: string, schoolId: string, name: string, section: string, classTeacherId: string | null): ClassDoc => ({
    id, schoolId, name, section, numericLevel: 1, capacity: 30, roomNo: "", classTeacherId, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const c1 = cls("cls-sa-1a", A, "Grade 1", "A", "tch-sa-incharge");
  const c2 = cls("cls-sa-1b", A, "Grade 1", "B", null);
  const cB = cls("cls-sa-b1", B, "Grade 1", "A", null);
  for (const c of [c1, c2, cB]) await saveClassServer(c);
  const subj = (id: string, classId: string, name: string, teacherId: string | null, schoolId = A): SubjectDoc => ({
    id, schoolId, classId, name, code: id.toUpperCase(), teacherId, credits: 1, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  await saveSubjectServer(subj("sb-sa-math", c1.id, "Maths", "tch-sa-math"));
  await saveSubjectServer(subj("sb-sa-eng-b", c2.id, "English", "tch-sa-other"));
  const teacher = (id: string, name: string, classIds: string[], schoolId = A): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@a.edu`, phone: "", designation: "Teacher",
    department: "", qualification: "", status: "ACTIVE", assignedClassIds: classIds, assignedSubjectIds: [], weeklyLoad: 1, createdAt: now, updatedAt: now,
  });
  for (const t of [
    teacher("tch-sa-incharge", "Ina Charge", []),
    teacher("tch-sa-math", "Maya Thomas", []),
    teacher("tch-sa-granted", "Gina Grant", [c1.id]),
    teacher("tch-sa-other", "Olive Other", []),
    teacher("tch-sa-none", "Nora None", []),
  ]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra });
  const ADMIN = await session("uid-sa-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-sa-admin-b", "ADMIN", B);
  const T_MATH = await session("uid-sa-math", "TEACHER", A, { teacherId: "tch-sa-math" });

  const base = { gender: "Male", guardianName: "Guardian", guardianPhone: "03001112222", guardianRelation: "Father" };
  const enrol = async (token: string, body: Record<string, unknown>) => json(await studentsPost(req(token, "http://x/api/students", "POST", body)));

  // ======================================================================
  // Phase 9 — login IDs
  // ======================================================================
  const cfg = resolveLoginConfig({ studentLoginPrefix: "ASD", studentLoginCampus: "Campus" });
  assert(formatStudentLoginEmail(cfg, 7, "School.EDU") === "asdcampus007@school.edu", "Login ID format: prefix + campus + zero-padded sequence on the school's domain, lowercase");

  const s1 = await enrol(ADMIN, { ...base, classId: c1.id, firstName: "Ali", lastName: "Raza" });
  const s2 = await enrol(ADMIN, { ...base, classId: c1.id, firstName: "Omar", lastName: "Tariq" });
  const s3 = await enrol(ADMIN, { ...base, classId: c2.id, firstName: "Zain", lastName: "Ali" });
  const emails = [s1, s2, s3].map((s) => s.student?.email || s.student?.loginEmail);
  assert(emails.every(Boolean), "Enrolment returns each student's login email");
  assert(emails[0] === "asdcampus001@school-sa-a.edu" && emails[1] === "asdcampus002@school-sa-a.edu" && emails[2] === "asdcampus003@school-sa-a.edu",
    `Enrolments get sequential IDs 001, 002, 003 on the school's own domain (${emails.join(", ")})`);
  assert(!emails.some((e) => /@gmail\.com$/.test(String(e))), "Generated logins never use a public mail provider the school does not control");

  // Concurrency: 12 simultaneous allocations all differ
  const parallel = await Promise.all(Array.from({ length: 12 }, () => allocateStudentLoginEmail(A, "school-sa-a.edu", cfg, async () => false)));
  assert(new Set(parallel.map((p) => p.email)).size === 12, "12 concurrent allocations produce 12 distinct login IDs");
  const seqs = parallel.map((p) => p.sequence).sort((x, y) => x - y);
  assert(seqs[0] === 4 && seqs[11] === 15, "…and they are consecutive, continuing after the existing IDs (never restarting)");

  // Collision with a manually assigned address is skipped, not reused or failed.
  const nextSeq = await allocateCounterValueServer(`${A}__studentLogin`, 1); // 16 consumed; peek the pattern
  const collision = await allocateStudentLoginEmail(A, "school-sa-a.edu", cfg, async (e) => e === formatStudentLoginEmail(cfg, nextSeq + 1, "school-sa-a.edu"));
  assert(collision.sequence === nextSeq + 2, "A manually assigned address that already holds the next number is skipped");

  // Deleted students' numbers are never handed out again (counter only moves forward).
  const after = await allocateCounterValueServer(`${A}__studentLogin`, 1);
  assert(after > collision.sequence, "Numbers only ever move forward (a freed number is not re-issued)");

  // Another school has its own independent sequence.
  const b1 = await enrol(ADMIN_B, { ...base, classId: cB.id, firstName: "Bea", lastName: "Khan" });
  assert((b1.student?.email || b1.student?.loginEmail) === "asdcampus001@school-sa-b.edu", "Another school starts at 001 on its own domain (independent counters)");

  // Settings: configure prefix/campus, raise (never lower) the sequence.
  const put = async (body: unknown) => json(await settingsPut(req(ADMIN, "http://x/api/settings", "PUT", body)));
  const configured = await put({ studentLoginPrefix: "ALD", studentLoginCampus: "North", studentLoginNextSequence: 500 });
  assert(configured.settings?.studentLogin?.prefix === "ald" && configured.settings?.studentLogin?.campus === "north", "Admin can configure prefix and campus (stored as safe lowercase tokens)");
  assert(configured.settings?.studentLogin?.nextSequence === 500, "Admin can raise the next sequence number");
  const lowered = await put({ studentLoginNextSequence: 10 });
  assert(lowered.settings?.studentLogin?.nextSequence === 500, "…but cannot lower it (would re-issue numbers)");
  const s4 = await enrol(ADMIN, { ...base, classId: c1.id, firstName: "Hana", lastName: "Shah" });
  assert((s4.student?.email || s4.student?.loginEmail) === "aldnorth500@school-sa-a.edu", "New enrolments follow the configured pattern and sequence");
  const read = await json(await settingsGet(req(ADMIN, "http://x/api/settings")));
  assert(read.settings?.studentLogin?.preview === "aldnorth501@school-sa-a.edu", "Settings page can show a preview of the next ID");
  const teacherPut = await settingsPut(req(await session("uid-sa-t", "TEACHER", A, { teacherId: "tch-sa-math" }), "http://x/api/settings", "PUT", { studentLoginPrefix: "x" }));
  assert(teacherPut.status === 403, "A teacher cannot change the login ID configuration");

  // ======================================================================
  // Phase 9 — safe email change
  // ======================================================================
  const id1 = s1.student.id as string;
  const before = await getStudentByIdServer(A, id1);
  const uidBefore = before!.userId;
  const change = async (token: string, id: string, email: unknown) => loginEmailPut(req(token, `http://x/api/students/${id}/login-email`, "PUT", { email }), idParams(id));
  const ok = await change(ADMIN, id1, "Ali.Raza@School-SA-A.edu");
  assert(ok.status === 200, "Admin can change a student's login email");
  const afterStudent = await getStudentByIdServer(A, id1);
  const afterUser = await getUserByIdServer(uidBefore!);
  assert(afterStudent?.id === id1 && afterStudent?.userId === uidBefore, "Same internal student id and login uid after the change");
  assert(afterStudent?.email === "ali.raza@school-sa-a.edu" && afterUser?.email === "ali.raza@school-sa-a.edu", "Email is normalised and updated on both the student record and the login profile");
  assert(afterStudent?.admissionNo === before?.admissionNo && afterStudent?.classId === before?.classId && afterUser?.studentId === id1, "Admission number, class and links are untouched");
  assert((await change(ADMIN, s2.student.id, "ali.raza@school-sa-a.edu")).status === 409, "An address already used by another account is refused");
  assert((await change(ADMIN, id1, "not-an-email")).status === 400, "An invalid address is refused");
  assert((await change(ADMIN_B, id1, "x@school-sa-b.edu")).status === 404, "Another school's admin cannot change this student's login");
  assert((await change(T_MATH, id1, "t@school-sa-a.edu")).status === 403, "A teacher cannot change a student's login");
  const logs = await getAuditLogsServer(A);
  assert(logs.some((l: any) => l.action === "CHANGE_STUDENT_LOGIN_EMAIL" && l.entityId === id1), "The change is audited");

  // ======================================================================
  // Phase 6 — which teachers can access a student
  // ======================================================================
  const access = await json(await accessGet(req(ADMIN, `http://x/api/students/${id1}/teacher-access`), idParams(id1)));
  const names = (access.teachers || []).map((t: any) => t.teacherId).sort();
  assert(names.join(",") === "tch-sa-granted,tch-sa-incharge,tch-sa-math", `Grade 1-A student: incharge, subject teacher and admin-granted teacher can open them (${names.join(",")})`);
  assert(!names.includes("tch-sa-other") && !names.includes("tch-sa-none"), "A teacher of another class and an unassigned teacher cannot");
  const kinds = Object.fromEntries((access.teachers || []).map((t: any) => [t.teacherId, t.reasons.map((r: any) => r.kind).join("+")]));
  assert(kinds["tch-sa-incharge"] === "INCHARGE" && kinds["tch-sa-math"] === "SUBJECT" && kinds["tch-sa-granted"] === "ASSIGNED_CLASS", "Each entry says why (incharge / subject / granted)");
  const accessB = await json(await accessGet(req(ADMIN, `http://x/api/students/${s3.student.id}/teacher-access`), idParams(s3.student.id)));
  assert((accessB.teachers || []).map((t: any) => t.teacherId).join(",") === "tch-sa-other", "Grade 1-B student is visible only to its own subject teacher");
  assert((await accessGet(req(ADMIN_B, `http://x/api/students/${id1}/teacher-access`), idParams(id1))).status === 404, "Another school's admin gets 404");
  assert((await accessGet(req(T_MATH, `http://x/api/students/${id1}/teacher-access`), idParams(id1))).status === 403, "A teacher cannot use the admin access view");

  // ======================================================================
  // Phase 10 — passwords
  // ======================================================================
  const reset = (token: string, body: unknown) => passwordsPost(req(token, "http://x/api/students/passwords", "POST", body));
  const r1 = await json(await reset(ADMIN, { students: [id1, s2.student.id], mode: "random" }));
  assert(r1.updated === 2 && r1.failed === 0, "Random reset updates both selected students");
  const p1 = r1.outcomes.find((o: any) => o.studentId === id1)?.password as string;
  const p2 = r1.outcomes.find((o: any) => o.studentId === s2.student.id)?.password as string;
  assert(p1 && p2 && p1 !== p2 && p1.length >= 16, "Each student gets a different, long random password, returned once");
  const prof1 = await getUserByIdServer(uidBefore!);
  assert(!!prof1?.passwordHash && prof1.passwordHash !== p1 && (await bcrypt.compare(p1, prof1.passwordHash)), "Only a bcrypt hash is stored — never the password");
  assert(JSON.stringify(await getStudentByIdServer(A, id1)).indexOf(p1) === -1, "The password is not stored on the student record");
  const logs2 = JSON.stringify(await getAuditLogsServer(A));
  assert(logs2.includes("RESET_STUDENT_PASSWORD") && !logs2.includes(p1) && !logs2.includes(p2), "Audit log records who/what/when but contains no password");

  const tempRefused = await reset(ADMIN, { students: [id1], mode: "temporary" });
  assert(tempRefused.status === 400, "The shared temporary password is refused without explicit confirmation");
  const tempOk = await json(await reset(ADMIN, { students: [id1], mode: "temporary", confirmTemporary: true }));
  assert(tempOk.updated === 1 && !tempOk.outcomes[0].password && tempOk.warnings.length === 1, "…and with confirmation it applies, warns, and does not echo the password");
  const prof1b = await getUserByIdServer(uidBefore!);
  assert(await bcrypt.compare(TEMPORARY_STUDENT_PASSWORD, prof1b!.passwordHash!), "Temporary password is stored only as a hash");

  const mixed = await json(await reset(ADMIN, { students: [id1, "std_missing", s3.student.id], mode: "random" }));
  assert(mixed.updated === 2 && mixed.failed === 1 && mixed.failedStudentIds[0] === "std_missing", "Partial failure: the unknown student is reported failed, the others still updated");
  assert(mixed.success === false, "…and the overall result is not reported as a success");
  const cross = await json(await reset(ADMIN_B, { students: [id1], mode: "random" }));
  assert(cross.updated === 0 && cross.failed === 1, "Another school's admin cannot reset this student (school scope enforced)");
  assert((await reset(T_MATH, { students: [id1] })).status === 403, "A teacher cannot reset student passwords");
  assert((await reset(ADMIN, { students: [] })).status === 400, "An empty selection is refused");
  assert((await reset(ADMIN, { students: Array.from({ length: 101 }, (_, i) => `std_${i}`) })).status === 400, "More than 100 per request is refused (send in chunks)");

  console.log(`\nSTUDENT ACCOUNTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
