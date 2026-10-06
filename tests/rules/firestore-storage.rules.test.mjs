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
    await setDoc(doc(db, "payrollRecords", "pay-a"), { id: "pay-a", schoolId: "A", teacherId: "tch-a" });
    await setDoc(doc(db, "auditLogs", "log-a"), { id: "log-a", schoolId: "A" });
    await setDoc(doc(db, "passwordResetTokens", "h"), { uid: "adminA" });
    await setDoc(doc(db, "studentObservations", "obs-a"), { id: "obs-a", schoolId: "A", studentId: "std-a2" });
  });
});

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();

test("default deny: unauthenticated users read nothing", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "students", "std-a")));
  await assertFails(getDoc(doc(db, "users", "adminA")));
});

test("users: only the owner can read a profile (no other user's password hash)", async () => {
  await assertSucceeds(getDoc(doc(as("teacherA"), "users", "teacherA")));
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

test("server-only collections are never readable by clients", async () => {
  await assertFails(getDoc(doc(as("adminA"), "payrollRecords", "pay-a")));
  await assertFails(getDoc(doc(as("adminA"), "passwordResetTokens", "h")));
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
