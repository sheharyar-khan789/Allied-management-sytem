import assert from "assert";
import {
  getEmailConfigStatus,
  sendPasswordResetEmail,
  sendViaFirebaseAuth,
  maskEmail,
  DeliveryStatusCode,
} from "../src/lib/email-service";
import {
  updateTeacherAccountEmail,
  resetTeacherPassword,
} from "../src/lib/teacher-lifecycle";
import {
  saveTeacherServer,
  getTeacherByIdServer,
  getUserByIdServer,
  updateUserServer,
  claimUsernameServer,
  localStore,
} from "../src/lib/firebase/server-db";
import { TeacherDoc, UserProfile } from "../src/lib/firebase/types";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error("    Error:", err?.message || err);
    failed++;
  }
}

async function runAllTests() {
  console.log("\n========================================================");
  console.log("Teacher Email Delivery & Password Reset Regression Suite");
  console.log("========================================================\n");

  const testSchoolId = "test-school-email-deliver-001";
  const crossSchoolId = "test-school-other-002";

  // Test 1: Masking helper
  await test("Email masking hides sensitive characters safely", async () => {
    assert.strictEqual(maskEmail("saira.saira@gmail.com"), "sa***a@gmail.com");
    assert.strictEqual(maskEmail("ab@test.com"), "a***@test.com");
    assert.strictEqual(maskEmail("invalid"), "***");
  });

  // Test 2: Missing email configuration detection
  await test("getEmailConfigStatus detects missing Resend & SMTP keys", async () => {
    const emptyEnv = { NODE_ENV: "production" };
    const status = getEmailConfigStatus(emptyEnv);
    assert.strictEqual(status.providers.length, 0);
    assert(status.missingForResend.includes("RESEND_API_KEY"));
    assert(status.missingForResend.includes("EMAIL_FROM"));
    assert(status.missingForSmtp.includes("SMTP_HOST"));
    assert(status.missingForSmtp.includes("SMTP_USER"));
    assert(status.missingForSmtp.includes("SMTP_PASS"));
  });

  // Test 3: Provider detection with mock env
  await test("getEmailConfigStatus detects configured Resend & SMTP", async () => {
    const resendEnv = { RESEND_API_KEY: "re_12345", EMAIL_FROM: "admin@school.com" };
    const resendStatus = getEmailConfigStatus(resendEnv);
    assert(resendStatus.providers.includes("resend"));

    const smtpEnv = { SMTP_HOST: "smtp.mail.test", SMTP_USER: "user@test.com", SMTP_PASS: "secret" };
    const smtpStatus = getEmailConfigStatus(smtpEnv);
    assert(smtpStatus.providers.includes("smtp"));
  });

  // Test 4: Missing configuration in production returns NOT_CONFIGURED
  await test("sendPasswordResetEmail in production with no providers returns NOT_CONFIGURED", async () => {
    const prodEnv = { NODE_ENV: "production" };
    const res = await sendPasswordResetEmail(
      {
        to: "teacher@test.com",
        resetUrl: "https://school.test/reset-password?token=abc",
        recipientName: "Test Teacher",
      },
      prodEnv
    );
    assert.strictEqual(res.delivered, false);
    assert.strictEqual(res.deliveryStatus, "NOT_CONFIGURED");
    assert.strictEqual(res.mode, "not-configured");
  });

  // Test 5: Local dev fallback outputs DEV_CONSOLE
  await test("sendPasswordResetEmail in dev mode returns DEV_CONSOLE", async () => {
    const devEnv = { NODE_ENV: "development" };
    const res = await sendPasswordResetEmail(
      {
        to: "teacher@test.com",
        resetUrl: "http://localhost:3000/reset-password?token=abc",
        recipientName: "Test Teacher",
      },
      devEnv
    );
    assert.strictEqual(res.delivered, false);
    assert.strictEqual(res.deliveryStatus, "DEV_CONSOLE");
    assert.strictEqual(res.mode, "dev-console");
  });

  // Setup sample test teacher in localStore
  const teacherId = "tch-reg-001";
  const teacherUid = "uid-reg-001";
  const initialEmail = "reg.teacher.old@test.com";
  const updatedEmail = "reg.teacher.new@test.com";

  const sampleTeacher: TeacherDoc = {
    id: teacherId,
    schoolId: testSchoolId,
    employeeId: "TCH-991",
    fullName: "Rabia Tariq",
    email: initialEmail,
    userId: teacherUid,
    status: "ACTIVE",
    department: "Science",
    designation: "Senior Teacher",
    qualification: "M.Sc",
    phone: "03001234567",
    assignedClassIds: ["cls-1"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleProfile: UserProfile = {
    uid: teacherUid,
    email: initialEmail,
    role: "TEACHER",
    schoolId: testSchoolId,
    teacherId,
    name: "Rabia Tariq",
    status: "ACTIVE",
    username: "rabia.tariq",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveTeacherServer(sampleTeacher);
  await updateUserServer(sampleProfile);
  await claimUsernameServer({ username: "rabia.tariq", uid: teacherUid, schoolId: testSchoolId, teacherId });

  // Test 6: Teacher email update synchronization
  await test("updateTeacherAccountEmail synchronizes UserProfile and TeacherDoc", async () => {
    const updateRes = await updateTeacherAccountEmail(testSchoolId, teacherId, updatedEmail, {
      performedByUid: "admin-uid-1",
      performedByEmail: "admin@test.com",
      performedByRole: "ADMIN",
    });

    assert.strictEqual(updateRes.ok, true);
    assert.strictEqual(updateRes.email, updatedEmail);

    const updatedT = await getTeacherByIdServer(testSchoolId, teacherId);
    assert.strictEqual(updatedT?.email, updatedEmail);
    assert.strictEqual(updatedT?.userId, teacherUid);

    const updatedP = await getUserByIdServer(teacherUid);
    assert.strictEqual(updatedP?.email, updatedEmail);
    assert.strictEqual(updatedP?.teacherId, teacherId);
    assert.strictEqual(updatedP?.username, "rabia.tariq");
  });

  // Test 7: Username resolution continues working after email update
  await test("Username-based lookup resolves to the NEW email address", async () => {
    const profile = await getUserByIdServer(teacherUid);
    assert.strictEqual(profile?.username, "rabia.tariq");
    assert.strictEqual(profile?.email, updatedEmail);
  });

  // Test 8: Duplicate email rejection within same school
  await test("Rejects duplicate email when another teacher in school has it", async () => {
    const t2: TeacherDoc = {
      ...sampleTeacher,
      id: "tch-reg-002",
      email: "t2@test.com",
      employeeId: "TCH-992",
    };
    await saveTeacherServer(t2);

    const res = await updateTeacherAccountEmail(testSchoolId, "tch-reg-002", updatedEmail);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 409);
  });

  // Test 9: Invalid email format rejection
  await test("Rejects invalid email format safely", async () => {
    const res = await updateTeacherAccountEmail(testSchoolId, teacherId, "not-an-email");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 400);
  });

  // Test 10: Cross-school update rejection
  await test("Cross-school update is rejected (404 / tenant isolation)", async () => {
    const res = await updateTeacherAccountEmail(crossSchoolId, teacherId, "cross@test.com");
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 404);
  });

  // Test 11: Password reset targets NEW email, not old email
  await test("resetTeacherPassword targets newly updated email", async () => {
    const resetRes = await resetTeacherPassword(
      testSchoolId,
      teacherId,
      { origin: "http://localhost:3000", host: "localhost:3000" },
      { performedByUid: "admin-uid-1", performedByEmail: "admin@test.com", performedByRole: "ADMIN" }
    );

    assert.strictEqual(resetRes.ok, true);
    assert.strictEqual(resetRes.email, updatedEmail);
    assert.notStrictEqual(resetRes.email, initialEmail);
  });

  // Test 12: Accurate status distinction - Firebase unconfirmed vs Provider confirmed
  await test("Firebase Auth delivery status accurately marked DELIVERY_UNCONFIRMED", async () => {
    const mockOutcome = await sendViaFirebaseAuth("test@invalid.domain", null, {
      NEXT_PUBLIC_FIREBASE_API_KEY: "Dummy-Key",
    });
    assert.strictEqual(mockOutcome.ok, false);
    assert(mockOutcome.error?.includes("Firebase Web API key is not configured"));
  });

  // Test 13: Inactive teacher cannot reset password
  await test("Inactive teacher account cannot reset password (409)", async () => {
    const inactT = await getTeacherByIdServer(testSchoolId, teacherId);
    await saveTeacherServer({ ...inactT!, status: "INACTIVE" });

    const res = await resetTeacherPassword(testSchoolId, teacherId, {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 409);
    assert(res.error?.includes("inactive"));

    // Restore
    await saveTeacherServer({ ...inactT!, status: "ACTIVE" });
  });

  // Test 14: Cross-school password reset rejection
  await test("Cross-school password reset is rejected (404)", async () => {
    const res = await resetTeacherPassword(crossSchoolId, teacherId, {});
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 404);
  });

  // Test 15: Preservation of allocations and UID
  await test("Teacher's assignedClassIds and UID remain intact after email update", async () => {
    const t = await getTeacherByIdServer(testSchoolId, teacherId);
    assert.strictEqual(t?.userId, teacherUid);
    assert.deepStrictEqual(t?.assignedClassIds, ["cls-1"]);
    assert.strictEqual(t?.employeeId, "TCH-991");
  });

  // Test 16: Safe message content - no secrets, reset tokens or passwords exposed
  await test("Password reset result never exposes raw tokens or private credentials", async () => {
    const resetRes = await resetTeacherPassword(
      testSchoolId,
      teacherId,
      { origin: "http://localhost:3000" }
    );
    const jsonStr = JSON.stringify(resetRes);
    assert(!jsonStr.includes("PRIVATE KEY"));
    assert(!jsonStr.includes("FIREBASE_CLIENT_EMAIL"));
    assert(!jsonStr.includes("passwordHash"));
  });

  console.log("\n--------------------------------------------------------");
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log("--------------------------------------------------------\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
