// Firestore + Storage security rules tests. Run against the local emulators only — never a
// real project:
//   npm i --no-save firebase-tools @firebase/rules-unit-testing
//   npm run test:rules
// (CI: .github/workflows/security.yml)
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { ref, getBytes, uploadString } from "firebase/storage";

const PROJECT_ID = "demo-allied-rules-test"; // "demo-" prefix: the emulator never touches a real project
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
    storage: { rules: fs.readFileSync("storage.rules", "utf8") },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const users = {
      adminA: { role: "ADMIN", schoolId: "A", email: "admin@a.edu", passwordHash: "$2b$12$x" },
      teacherA: { role: "TEACHER", schoolId: "A", email: "t@a.edu", teacherId: "tch-a" },
      teacher2A: { role: "TEACHER", schoolId: "A", email: "t2@a.edu", teacherId: "tch-a2" },
      studentA: { role: "STUDENT", schoolId: "A", email: "s@a.edu", studentId: "std-a" },
      parentA: { role: "PARENT", schoolId: "A", email: "p@a.edu" },
      adminB: { role: "ADMIN", schoolId: "B", email: "admin@b.edu" },
    };
    for (const [uid, data] of Object.entries(users)) await setDoc(doc(db, "users", uid), { uid, ...data });
    await setDoc(doc(db, "students", "std-a"), { id: "std-a", schoolId: "A", classId: "cls-a", userId: "studentA", parentUserIds: ["parentA"] });
    await setDoc(doc(db, "students", "std-a2"), { id: "std-a2", schoolId: "A", classId: "cls-a", userId: "x" });
    await setDoc(doc(db, "teachers", "tch-a"), { id: "tch-a", schoolId: "A", baseSalary: 90000 });
    await setDoc(doc(db, "feeChallans", "ch-a"), { id: "ch-a", schoolId: "A", studentId: "std-a" });
    await setDoc(doc(db, "payments", "pay-a"), { id: "pay-a", schoolId: "A", studentId: "std-a", challanId: "ch-a" });
    await setDoc(doc(db, "voucherAdjustments", "vadj-a"), { id: "vadj-a", schoolId: "A", paymentId: "pay-a" });
    await setDoc(doc(db, "payrollRecords", "pay-a"), { id: "pay-a", schoolId: "A", teacherId: "tch-a" });
    await setDoc(doc(db, "auditLogs", "log-a"), { id: "log-a", schoolId: "A" });
    await setDoc(doc(db, "passwordResetTokens", "h"), { uid: "adminA" });
    await setDoc(doc(db, "studentObservations", "obs-a"), { id: "obs-a", schoolId: "A", studentId: "std-a2" });
    // Class cls-a: incharge tch-a; tch-a2 only teaches a subject there.
    await setDoc(doc(db, "classes", "cls-a"), { id: "cls-a", schoolId: "A", classTeacherId: "tch-a" });
    await setDoc(doc(db, "subjects", "sub-a-math"), { id: "sub-a-math", schoolId: "A", classId: "cls-a", teacherId: "tch-a2" });
    await setDoc(doc(db, "attendance", "att-daily"), { id: "att-daily", schoolId: "A", classId: "cls-a", studentId: "std-a2" });
    await setDoc(doc(db, "attendance", "att-math"), { id: "att-math", schoolId: "A", classId: "cls-a", subjectId: "sub-a-math", studentId: "std-a2" });
    await setDoc(doc(db, "studentFeeLedgers", "A_std-a_2026"), { id: "A_std-a_2026", schoolId: "A", studentId: "std-a" });
    await setDoc(doc(db, "studentCharges", "chg-a"), { id: "chg-a", schoolId: "A", studentId: "std-a" });
    // A VOID challan (admin-corrected duplicate, see DELETE /api/fees/challans/[id]) — same
    // collection/rule as any other challan; status is just a data value to the rules, never a
    // special case, so the same read/write expectations as ch-a must hold for it too.
    await setDoc(doc(db, "feeChallans", "ch-a-void"), { id: "ch-a-void", schoolId: "A", studentId: "std-a", status: "VOID", totalExpected: 0, paidAmount: 0, balanceAmount: 0 });
    // Teacher Observations: tch-a has one open note and one Admin/Principal-only private note.
    await setDoc(doc(db, "teacherObservations", "obs-open"), { id: "obs-open", schoolId: "A", teacherId: "tch-a" });
    await setDoc(doc(db, "teacherObservations", "obs-private"), { id: "obs-private", schoolId: "A", teacherId: "tch-a", isPrivate: true });
    // Coordinator Observation Submission: tch-a2 submitted a draft ABOUT tch-a. Opposite scoping
    // from teacherObservations above — the SUBJECT (tch-a) must never read this, only the
    // SUBMITTER (tch-a2).
    await setDoc(doc(db, "teacherObservationSubmissions", "sub-a"), { id: "sub-a", schoolId: "A", teacherId: "tch-a", submittedByTeacherId: "tch-a2", status: "PENDING" });
    // Server-only: login-username uniqueness locks and admin-defined lesson-plan weeks.
    await setDoc(doc(db, "usernames", "ali.teacher01"), { id: "ali.teacher01", username: "ali.teacher01", uid: "tch-a", schoolId: "A" });
    await setDoc(doc(db, "lessonPlanWeeks", "lpw_A_2026-12-24"), { id: "lpw_A_2026-12-24", schoolId: "A", weekId: "2026-12-24" });
  });
});

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();

test("default deny: unauthenticated users read nothing", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "students", "std-a")));
  await assertFails(getDoc(doc(db, "users", "adminA")));
});

test("users: no client can read any profile, not even its own (password hash, 2FA secret)", async () => {
  await assertFails(getDoc(doc(as("teacherA"), "users", "teacherA")));
  await assertFails(getDoc(doc(as("adminA"), "users", "adminA")));
  await assertFails(getDoc(doc(as("teacherA"), "users", "adminA")));
  await assertFails(getDoc(doc(as("adminA"), "users", "teacherA")));
  await assertFails(getDoc(doc(as("adminB"), "users", "adminA")));
});

test("no client writes anywhere (all writes go through the API)", async () => {
  await assertFails(setDoc(doc(as("adminA"), "students", "std-new"), { schoolId: "A" }));
  await assertFails(setDoc(doc(as("adminA"), "users", "adminA"), { role: "ADMIN", schoolId: "B" }));
  await assertFails(deleteDoc(doc(as("adminA"), "auditLogs", "log-a")));
  await assertFails(setDoc(doc(as("adminA"), "auditLogs", "log-a"), { tampered: true }));
});

test("tenant isolation: school B admin cannot read school A records", async () => {
  await assertFails(getDoc(doc(as("adminB"), "students", "std-a")));
  await assertFails(getDoc(doc(as("adminB"), "feeChallans", "ch-a")));
  await assertFails(getDoc(doc(as("adminB"), "auditLogs", "log-a")));
  await assertSucceeds(getDoc(doc(as("adminA"), "students", "std-a")));
});

test("teachers: no direct student/observation reads (API applies class scoping)", async () => {
  await assertFails(getDoc(doc(as("teacherA"), "students", "std-a2")));
  await assertFails(getDoc(doc(as("teacherA"), "studentObservations", "obs-a")));
});

test("teacher records (salary): admin or the teacher themself only", async () => {
  await assertSucceeds(getDoc(doc(as("adminA"), "teachers", "tch-a")));
  await assertSucceeds(getDoc(doc(as("teacherA"), "teachers", "tch-a")));
  await assertFails(getDoc(doc(as("teacher2A"), "teachers", "tch-a")));
  await assertFails(getDoc(doc(as("studentA"), "teachers", "tch-a")));
  await assertFails(getDoc(doc(as("parentA"), "teachers", "tch-a")));
});

test("students/parents: only their own child's records", async () => {
  await assertSucceeds(getDoc(doc(as("studentA"), "students", "std-a")));
  await assertFails(getDoc(doc(as("studentA"), "students", "std-a2")));
  await assertSucceeds(getDoc(doc(as("parentA"), "students", "std-a")));
  await assertFails(getDoc(doc(as("parentA"), "students", "std-a2")));
  await assertSucceeds(getDoc(doc(as("parentA"), "feeChallans", "ch-a")));
});

test("vouchers (payments) and their adjustments: admin (same school) or the paying student/parent only, never a teacher, never written directly", async () => {
  await assertSucceeds(getDoc(doc(as("adminA"), "payments", "pay-a")));
  await assertSucceeds(getDoc(doc(as("studentA"), "payments", "pay-a")));
  await assertSucceeds(getDoc(doc(as("parentA"), "payments", "pay-a")));
  await assertFails(getDoc(doc(as("teacherA"), "payments", "pay-a")));
  await assertFails(getDoc(doc(as("adminB"), "payments", "pay-a")));
  await assertFails(setDoc(doc(as("adminA"), "payments", "pay-a"), { amount: 999999 }));

  // The reversal/adjustment audit trail is admin-only — a parent sees the voucher's own
  // voucherStatus field (via the payments rule above), never the correction records themselves.
  await assertSucceeds(getDoc(doc(as("adminA"), "voucherAdjustments", "vadj-a")));
  await assertFails(getDoc(doc(as("studentA"), "voucherAdjustments", "vadj-a")));
  await assertFails(getDoc(doc(as("parentA"), "voucherAdjustments", "vadj-a")));
  await assertFails(getDoc(doc(as("teacherA"), "voucherAdjustments", "vadj-a")));
  await assertFails(getDoc(doc(as("adminB"), "voucherAdjustments", "vadj-a")));
  await assertFails(setDoc(doc(as("adminA"), "voucherAdjustments", "vadj-a"), { amount: 0 }));
});

test("server-only collections are never readable by clients", async () => {
  await assertFails(getDoc(doc(as("adminA"), "payrollRecords", "pay-a")));
  await assertFails(getDoc(doc(as("adminA"), "passwordResetTokens", "h")));
  await assertFails(getDoc(doc(as("studentA"), "studentFeeLedgers", "A_std-a_2026")));
  await assertFails(getDoc(doc(as("parentA"), "studentCharges", "chg-a")));
});

test("usernames and lessonPlanWeeks: no client can read or write them, in any school or role", async () => {
  // A readable usernames collection would let anyone enumerate login names; a writable one would
  // let a client claim/steal them. Both are reached only through the server API.
  for (const who of ["adminA", "adminB", "teacherA", "studentA", "parentA"]) {
    await assertFails(getDoc(doc(as(who), "usernames", "ali.teacher01")));
    await assertFails(setDoc(doc(as(who), "usernames", "stolen.name"), { uid: who, schoolId: "A" }));
    await assertFails(getDoc(doc(as(who), "lessonPlanWeeks", "lpw_A_2026-12-24")));
    await assertFails(setDoc(doc(as(who), "lessonPlanWeeks", "lpw_A_2027-01-04"), { schoolId: "A" }));
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "usernames", "ali.teacher01")));
});

test("attendance: only the class incharge teacher, never a subject teacher", async () => {
  await assertSucceeds(getDoc(doc(as("teacherA"), "attendance", "att-daily")));
  await assertSucceeds(getDoc(doc(as("teacherA"), "attendance", "att-math")));
  // tch-a2 teaches Mathematics in cls-a — that grants no attendance access, even to the Math register.
  await assertFails(getDoc(doc(as("teacher2A"), "attendance", "att-daily")));
  await assertFails(getDoc(doc(as("teacher2A"), "attendance", "att-math")));
  await assertFails(getDoc(doc(as("adminB"), "attendance", "att-daily")));
  await assertSucceeds(getDoc(doc(as("adminA"), "attendance", "att-daily")));
});

test("storage: same-school read only, no client writes", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadString(ref(ctx.storage(), "schools/A/profile-photos/p.png"), "x");
  });
  const storageAs = (uid, schoolId) => env.authenticatedContext(uid, { schoolId }).storage();
  await assertSucceeds(getBytes(ref(storageAs("adminA", "A"), "schools/A/profile-photos/p.png")));
  await assertFails(getBytes(ref(storageAs("adminB", "B"), "schools/A/profile-photos/p.png")));
  await assertFails(uploadString(ref(storageAs("adminA", "A"), "schools/A/profile-photos/new.png"), "x"));
  assert.ok(true);
});

test("private admin observation: Admin/Principal (the ADMIN role) always reads it; the subject teacher never does", async () => {
  // "Principal" has no separate auth role in this system (Admin IS Principal here) — isAdmin()
  // is the only check this feature has, or needs.
  await assertSucceeds(getDoc(doc(as("adminA"), "teacherObservations", "obs-private")));
  await assertSucceeds(getDoc(doc(as("adminA"), "teacherObservations", "obs-open")));
  // tch-a is the subject of BOTH notes — only the non-private one is visible to them.
  await assertSucceeds(getDoc(doc(as("teacherA"), "teacherObservations", "obs-open")));
  await assertFails(getDoc(doc(as("teacherA"), "teacherObservations", "obs-private")));
  // A teacher who is neither admin nor the subject sees neither, regardless of isPrivate.
  await assertFails(getDoc(doc(as("teacher2A"), "teacherObservations", "obs-open")));
  await assertFails(getDoc(doc(as("teacher2A"), "teacherObservations", "obs-private")));
  // Cross-school: school B's admin is still just an ADMIN of a different school.
  await assertFails(getDoc(doc(as("adminB"), "teacherObservations", "obs-private")));
  // Students/parents were never in scope for this collection at all.
  await assertFails(getDoc(doc(as("studentA"), "teacherObservations", "obs-open")));
  await assertFails(getDoc(doc(as("parentA"), "teacherObservations", "obs-open")));
  // Never written directly, private or not — the API (Admin SDK) is the only writer.
  await assertFails(setDoc(doc(as("adminA"), "teacherObservations", "obs-open"), { isPrivate: false }));
  await assertFails(setDoc(doc(as("adminA"), "teacherObservations", "obs-private"), { isPrivate: false }));
});

test("coordinator observation submission: opposite scoping from teacherObservations — the SUBMITTER reads their own, the SUBJECT never does", async () => {
  // sub-a: submittedByTeacherId = tch-a2 (teacher2A), teacherId (the subject) = tch-a (teacherA).
  await assertSucceeds(getDoc(doc(as("adminA"), "teacherObservationSubmissions", "sub-a")));
  await assertSucceeds(getDoc(doc(as("teacher2A"), "teacherObservationSubmissions", "sub-a")));
  // The critical check: tch-a is who this PENDING submission is ABOUT, and must never read it —
  // not while pending, and the rule makes no exception for any other status either.
  await assertFails(getDoc(doc(as("teacherA"), "teacherObservationSubmissions", "sub-a")));
  // Cross-school and other roles: no path in.
  await assertFails(getDoc(doc(as("adminB"), "teacherObservationSubmissions", "sub-a")));
  await assertFails(getDoc(doc(as("studentA"), "teacherObservationSubmissions", "sub-a")));
  await assertFails(getDoc(doc(as("parentA"), "teacherObservationSubmissions", "sub-a")));
  // Never written directly — not a create, not a status flip to APPROVED/REJECTED, by anyone,
  // including the submitter and the admin. Only the Admin SDK (the approve/reject API) writes.
  await assertFails(setDoc(doc(as("teacher2A"), "teacherObservationSubmissions", "sub-a"), { status: "APPROVED" }));
  await assertFails(setDoc(doc(as("adminA"), "teacherObservationSubmissions", "sub-a"), { status: "APPROVED" }));
  await assertFails(setDoc(doc(as("teacher2A"), "teacherObservationSubmissions", "sub-new"), { schoolId: "A", teacherId: "tch-a", submittedByTeacherId: "tch-a2", status: "PENDING" }));
});

test("VOID fee challans: same read/write rule as any other status — never a special case, never client-writable, never restorable by a client", async () => {
  // Read access for a VOID challan is identical to a PAID/PENDING/PARTIAL one — the rule has no
  // status condition at all, by design (voiding is an application-level, not a rules-level,
  // concept). This is what's actually being asserted: status never widens or narrows the rule.
  await assertSucceeds(getDoc(doc(as("adminA"), "feeChallans", "ch-a-void")));
  await assertSucceeds(getDoc(doc(as("studentA"), "feeChallans", "ch-a-void")));
  await assertSucceeds(getDoc(doc(as("parentA"), "feeChallans", "ch-a-void")));
  await assertFails(getDoc(doc(as("adminB"), "feeChallans", "ch-a-void")));
  // The actual safety net against "accidentally restoring" a VOID challan (e.g. an import bug
  // un-zeroing totalExpected, or a client trying to) is that NO client write ever reaches
  // feeChallans at all, regardless of status — only the Admin SDK (server) writes here, and the
  // server-side guards (yearly-ledger-import / transaction-import) are covered by
  // scripts/private-obs-coordinator-fees-edit-test.ts, not by rules.
  await assertFails(setDoc(doc(as("adminA"), "feeChallans", "ch-a-void"), { status: "PARTIAL", totalExpected: 5000, paidAmount: 1000 }));
  await assertFails(setDoc(doc(as("adminA"), "feeChallans", "ch-a-void"), { totalExpected: 5000 }));
  await assertFails(deleteDoc(doc(as("adminA"), "feeChallans", "ch-a-void")));
});
