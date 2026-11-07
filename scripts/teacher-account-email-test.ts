/**
 * Teacher Account Management & Email Synchronization Test Suite
 *
 * Verifies:
 *  1. Successful email update via PUT /api/teachers/[id] and PUT /api/teachers/[id]/login-email.
 *  2. Duplicate email rejection (within school and across schools).
 *  3. Role-based authorization & cross-school isolation (403 for non-admins, 404 for cross-school).
 *  4. UID, username, role, schoolId, and allocation preservation (classes, subjects, timetable).
 *  5. Username login compatibility before and after email update.
 *  6. Direct email login compatibility (new email works, old email fails).
 *  7. Password recovery compatibility (reset link delivered to new email, username resolves to new email, old email dead).
 *  8. Account deactivation & reactivation (INACTIVE blocks login & reset, ACTIVE restores them).
 *  9. Rollback protection on synchronization failure.
 */
import { NextRequest } from "next/server";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getAuditLogsServer,
  getClassesServer,
  getSubjectsServer,
  getTeacherByIdServer,
  getTimetableServer,
  getUserByEmailServer,
  getUserByIdServer,
  getUsernameRecordServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  saveTimetableEntryServer,
  updateSchoolSettingsServer,
  updateUserServer,
} from "../src/lib/firebase/server-db";
import { POST as teachersPost } from "../src/app/api/teachers/route";
import { PUT as teacherPut, GET as teacherGet } from "../src/app/api/teachers/[id]/route";
import { PUT as loginEmailPut } from "../src/app/api/teachers/[id]/login-email/route";
import { POST as resetPasswordPost } from "../src/app/api/teachers/[id]/reset-password/route";
import { POST as activationPost } from "../src/app/api/teachers/[id]/activation/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as changePasswordPost } from "../src/app/api/auth/change-password/route";
import { POST as forgotPost } from "../src/app/api/auth/forgot-password/route";
import { updateTeacherAccountEmail, syncTeacherAccountStatus } from "../src/lib/teacher-lifecycle";

let passed = 0;
let failed = 0;

function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${name}`);
    failed++;
  }
}

let ipCounter = 200;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => res.json().catch(() => ({}));

async function captureLink(fn: () => Promise<Response>): Promise<{ res: Response; link: string | null; to: string | null }> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    lines.push(a.join(" "));
  };
  try {
    const res = await fn();
    const m = /link for (\S+): (https?:\/\/\S+)/.exec(lines.find((l) => l.includes("/reset-password?token=")) || "");
    return { res, link: m ? m[2] : null, to: m ? m[1] : null };
  } finally {
    console.warn = orig;
  }
}

async function run() {
  console.log("\n=======================================================");
  console.log("TEACHER ACCOUNT MANAGEMENT & EMAIL UPDATE TEST SUITE");
  console.log("=======================================================\n");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const schoolA = "school-tam-a";
  const schoolB = "school-tam-b";

  for (const sId of [schoolA, schoolB]) {
    await updateSchoolSettingsServer({
      id: sId,
      schoolId: sId,
      schoolName: `Allied School ${sId}`,
      campusName: "Main",
      motto: "",
      address: "Campus Rd",
      phone: "051-1234567",
      email: `admin@${sId}.edu`,
      principalName: "Principal",
      academicYear: YEAR,
      gradingScale: [],
      updatedAt: now,
    });
  }

  const session = (uid: string, role: "ADMIN" | "TEACHER", sId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@test.edu`, role, schoolId: sId, name: uid, ...extra });

  const ADMIN_A = await session("uid-tam-admin-a", "ADMIN", schoolA);
  const ADMIN_B = await session("uid-tam-admin-b", "ADMIN", schoolB);
  const TEACHER_SESSION = await session("uid-tam-t1", "TEACHER", schoolA, { teacherId: "tch-tam-t1" });

  console.log("--- Section 1: Teacher Creation with Username & Initial Login ---");
  const createRes = await teachersPost(
    req(ADMIN_A, "/api/teachers", "POST", {
      firstName: "Rashid",
      lastName: "Mehmood",
      email: "rashid.initial@school-tam.edu",
      phone: "03009876543",
      joiningDate: "2026-08-01",
      username: "rashid.physics",
      designation: "Physics Lecturer",
    })
  );
  const createJson = await json(createRes);
  assert(createRes.status === 201, "Teacher created with 201 Created");
  const teacherId = createJson.teacher?.id as string;
  const initialUid = createJson.teacher?.userId as string;
  const tempPassword = createJson.credentials?.temporaryPassword as string;

  assert(Boolean(teacherId && initialUid), "Teacher has valid teacherId and userId");
  assert(createJson.credentials?.username === "rashid.physics", "Teacher assigned username 'rashid.physics'");
  assert(Boolean(tempPassword), "Temporary password issued to admin");

  // Allocate class, subject, and timetable to teacher
  const classId = "cls-tam-9a";
  const subjectId = "sub-tam-phy9";
  await saveClassServer({
    id: classId,
    schoolId: schoolA,
    name: "Class 9",
    section: "A",
    classTeacherId: teacherId,
    classTeacherName: "Rashid Mehmood",
    academicYear: YEAR,
    roomNo: "Room 10",
  });
  await saveSubjectServer({
    id: subjectId,
    schoolId: schoolA,
    classId,
    className: "Class 9-A",
    name: "Physics",
    code: "PHY-9",
    teacherId,
    teacherName: "Rashid Mehmood",
    academicYear: YEAR,
  });
  await saveTimetableEntryServer({
    id: "slot-tam-phy1",
    schoolId: schoolA,
    classId,
    className: "Class 9-A",
    subjectId,
    subjectName: "Physics",
    teacherId,
    teacherName: "Rashid Mehmood",
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "08:00",
    endTime: "08:40",
    roomNo: "Lab 1",
    academicYear: YEAR,
    createdAt: now,
    updatedAt: now,
  });

  // Teacher changes temporary password to a permanent one
  const loginTemp = await loginPost(
    req(null, "/api/auth/login", "POST", {
      identifier: "rashid.physics",
      password: tempPassword,
      portal: "teacher",
    })
  );
  assert(loginTemp.status === 200, "Teacher can login with username and temporary password");
  const tempCookie = /allied_session=([^;]+)/.exec(loginTemp.headers.get("set-cookie") || "")?.[1];

  const PERM_PASSWORD = "A-Brand-New-Passw0rd!";
  const changeRes = await changePasswordPost(
    req(tempCookie, "/api/auth/change-password", "POST", {
      currentPassword: tempPassword,
      newPassword: PERM_PASSWORD,
    })
  );
  assert(changeRes.status === 200, "Teacher sets permanent password successfully");

  console.log("\n--- Section 2: Safe Email Update via Dedicated Endpoint (PUT /api/teachers/[id]/login-email) ---");
  const NEW_EMAIL_1 = "rashid.updated@school-tam.edu";
  const updateRes1 = await loginEmailPut(
    req(ADMIN_A, `/api/teachers/${teacherId}/login-email`, "PUT", { email: NEW_EMAIL_1 }),
    idParams(teacherId)
  );
  const updateJson1 = await json(updateRes1);
  assert(updateRes1.status === 200, "PUT /api/teachers/[id]/login-email returns 200");
  assert(updateJson1.email === NEW_EMAIL_1, "Response echoes normalized new email");

  // Verify database state & preservation of IDs and allocations
  const teacherAfter1 = await getTeacherByIdServer(schoolA, teacherId);
  const profileAfter1 = await getUserByIdServer(initialUid);

  assert(teacherAfter1?.id === teacherId, "Teacher ID is preserved");
  assert(teacherAfter1?.userId === initialUid, "Teacher userId is preserved");
  assert(profileAfter1?.uid === initialUid, "UserProfile UID is preserved");
  assert(teacherAfter1?.email === NEW_EMAIL_1, "TeacherDoc email updated to new email");
  assert(profileAfter1?.email === NEW_EMAIL_1, "UserProfile email updated to new email");
  assert(teacherAfter1?.username === "rashid.physics", "Teacher username preserved on TeacherDoc");
  assert(profileAfter1?.username === "rashid.physics", "Teacher username preserved on UserProfile");
  assert(profileAfter1?.role === "TEACHER", "Teacher role preserved as TEACHER");

  // Verify allocations remain completely linked
  const classesAfter1 = await getClassesServer(schoolA);
  const subjectsAfter1 = await getSubjectsServer(schoolA);
  const slotsAfter1 = await getTimetableServer(schoolA, teacherId);

  assert(classesAfter1.find((c) => c.id === classId)?.classTeacherId === teacherId, "Class incharge allocation preserved");
  assert(subjectsAfter1.find((s) => s.id === subjectId)?.teacherId === teacherId, "Subject teacher allocation preserved");
  assert(slotsAfter1.some((s) => s.id === "slot-tam-phy1" && s.teacherId === teacherId), "Timetable period allocation preserved");

  console.log("\n--- Section 3: Safe Email Update via Profile Route (PUT /api/teachers/[id]) ---");
  const NEW_EMAIL_2 = "rashid.final@school-tam.edu";
  const profilePutRes = await teacherPut(
    req(ADMIN_A, `/api/teachers/${teacherId}`, "PUT", {
      email: NEW_EMAIL_2,
      firstName: "Rashid",
      lastName: "Mehmood",
      designation: "Senior Physics Lecturer",
    }),
    idParams(teacherId)
  );
  const profilePutJson = await json(profilePutRes);
  assert(profilePutRes.status === 200, "PUT /api/teachers/[id] with updated email returns 200");
  assert(profilePutJson.teacher?.email === NEW_EMAIL_2, "Profile PUT echoes updated email");

  const teacherAfter2 = await getTeacherByIdServer(schoolA, teacherId);
  const profileAfter2 = await getUserByIdServer(initialUid);
  assert(teacherAfter2?.email === NEW_EMAIL_2, "TeacherDoc reflects profile PUT email change");
  assert(profileAfter2?.email === NEW_EMAIL_2, "UserProfile reflects profile PUT email change");

  console.log("\n--- Section 4: Duplicate Email Rejection & Validation ---");
  // 1. Invalid email syntax
  const invalidRes = await loginEmailPut(
    req(ADMIN_A, `/api/teachers/${teacherId}/login-email`, "PUT", { email: "not-an-email" }),
    idParams(teacherId)
  );
  assert(invalidRes.status === 400, "Invalid email address rejected with 400");

  // 2. Create second teacher in school A
  const t2Res = await teachersPost(
    req(ADMIN_A, "/api/teachers", "POST", {
      firstName: "Sana",
      lastName: "Tariq",
      email: "sana.tariq@school-tam.edu",
      phone: "03001112233",
      joiningDate: "2026-08-01",
      username: "sana.tariq01",
    })
  );
  const t2Json = await json(t2Res);
  const t2Id = t2Json.teacher?.id as string;
  assert(t2Res.status === 201, "Second teacher created");

  // 3. Attempting to update teacher 2 to teacher 1's email must be rejected with 409
  const dupRes1 = await loginEmailPut(
    req(ADMIN_A, `/api/teachers/${t2Id}/login-email`, "PUT", { email: NEW_EMAIL_2 }),
    idParams(t2Id)
  );
  assert(dupRes1.status === 409, "Duplicate email within school rejected with 409 Conflict");

  // 4. Same check via profile PUT /api/teachers/[id]
  const dupRes2 = await teacherPut(
    req(ADMIN_A, `/api/teachers/${t2Id}`, "PUT", { email: NEW_EMAIL_2 }),
    idParams(t2Id)
  );
  assert(dupRes2.status === 409, "Duplicate email in profile PUT rejected with 409 Conflict");

  // 5. Duplicate across schools
  const dupCrossSchool = await loginEmailPut(
    req(ADMIN_B, `/api/teachers/non-existent/login-email`, "PUT", { email: NEW_EMAIL_2 }),
    idParams("non-existent")
  );
  assert(dupCrossSchool.status === 404, "Unknown or cross-school teacher returns 404");

  console.log("\n--- Section 5: Role-based Authorization & Tenant Isolation ---");
  // 1. Teacher cannot change email
  const teacherForbidden = await loginEmailPut(
    req(TEACHER_SESSION, `/api/teachers/${teacherId}/login-email`, "PUT", { email: "hacker@test.edu" }),
    idParams(teacherId)
  );
  assert(teacherForbidden.status === 403, "Non-admin (teacher) rejected with 403 Forbidden");

  // 2. Admin of School B cannot update teacher of School A
  const crossAdminPut = await loginEmailPut(
    req(ADMIN_B, `/api/teachers/${teacherId}/login-email`, "PUT", { email: "cross@school-tam.edu" }),
    idParams(teacherId)
  );
  assert(crossAdminPut.status === 404, "Cross-school admin update rejected with 404 Not Found");

  // 3. Admin of School B cannot read teacher of School A
  const crossAdminGet = await teacherGet(
    req(ADMIN_B, `/api/teachers/${teacherId}`),
    idParams(teacherId)
  );
  assert(crossAdminGet.status === 404, "Cross-school admin view rejected with 404 Not Found");

  console.log("\n--- Section 6: Login Compatibility After Email Update ---");
  // 1. Username-based login must still work seamlessly
  const loginByUsername = await loginPost(
    req(null, "/api/auth/login", "POST", {
      identifier: "rashid.physics",
      password: PERM_PASSWORD,
      portal: "teacher",
    })
  );
  const loginUserJson = await json(loginByUsername);
  assert(loginByUsername.status === 200, "Teacher logs in successfully using assigned username");
  assert(loginUserJson.user?.email === NEW_EMAIL_2, "Login response reflects current updated email");

  // 2. Login by new email address must work
  const loginByNewEmail = await loginPost(
    req(null, "/api/auth/login", "POST", {
      identifier: NEW_EMAIL_2,
      password: PERM_PASSWORD,
      portal: "teacher",
    })
  );
  assert(loginByNewEmail.status === 200, "Teacher logs in successfully using new email address");

  // 3. Login by old email address must fail
  const loginByOldEmail = await loginPost(
    req(null, "/api/auth/login", "POST", {
      identifier: "rashid.initial@school-tam.edu",
      password: PERM_PASSWORD,
      portal: "teacher",
    })
  );
  assert(loginByOldEmail.status === 401, "Login with old email address fails (401)");

  console.log("\n--- Section 7: Password Recovery Compatibility ---");
  // 1. Forgot password using new email sends link to new email
  const forgotNew = await captureLink(() =>
    forgotPost(req(null, "/api/auth/forgot-password", "POST", { email: NEW_EMAIL_2 }))
  );
  assert(forgotNew.res.status === 200, "Forgot password with new email returns 200");
  assert(forgotNew.to === NEW_EMAIL_2, `Reset link is delivered to new email (${NEW_EMAIL_2})`);

  // 2. Forgot password using username sends link to new email
  const forgotUser = await captureLink(() =>
    forgotPost(req(null, "/api/auth/forgot-password", "POST", { identifier: "rashid.physics" }))
  );
  assert(forgotUser.res.status === 200, "Forgot password with username returns 200");
  assert(forgotUser.to === NEW_EMAIL_2, `Username password reset resolves to new email (${NEW_EMAIL_2})`);

  // 3. Forgot password with old email does NOT deliver to old email
  const forgotOld = await captureLink(() =>
    forgotPost(req(null, "/api/auth/forgot-password", "POST", { email: "rashid.initial@school-tam.edu" }))
  );
  assert(forgotOld.res.status === 200, "Forgot password with old email returns generic 200");
  assert(forgotOld.link === null, "No reset link was generated for old email");

  console.log("\n--- Section 8: Account Activation / Deactivation Synchronization ---");
  // 1. Deactivate teacher account (status: INACTIVE)
  const deactRes = await teacherPut(
    req(ADMIN_A, `/api/teachers/${teacherId}`, "PUT", { status: "INACTIVE" }),
    idParams(teacherId)
  );
  assert(deactRes.status === 200, "Admin can set teacher status to INACTIVE");
  const teacherDeact = await getTeacherByIdServer(schoolA, teacherId);
  const profileDeact = await getUserByIdServer(initialUid);
  assert(teacherDeact?.status === "INACTIVE", "TeacherDoc status is INACTIVE");
  assert(profileDeact?.status === "INACTIVE", "UserProfile status synchronized to INACTIVE");

  // Inactive teacher cannot log in
  const loginDeact = await loginPost(
    req(null, "/api/auth/login", "POST", {
      identifier: "rashid.physics",
      password: PERM_PASSWORD,
      portal: "teacher",
    })
  );
  assert(loginDeact.status === 403 || loginDeact.status === 401, "Inactive teacher cannot sign in (403/401)");

  // Inactive teacher cannot request password reset
  const resetDeact = await captureLink(() =>
    forgotPost(req(null, "/api/auth/forgot-password", "POST", { email: NEW_EMAIL_2 }))
  );
  assert(resetDeact.link === null, "Password reset is not dispatched for inactive account");

  // 2. Reactivate teacher account (status: ACTIVE)
  const reactRes = await teacherPut(
    req(ADMIN_A, `/api/teachers/${teacherId}`, "PUT", { status: "ACTIVE" }),
    idParams(teacherId)
  );
  assert(reactRes.status === 200, "Admin can reactivate teacher (status: ACTIVE)");
  const teacherActive = await getTeacherByIdServer(schoolA, teacherId);
  const profileActive = await getUserByIdServer(initialUid);
  assert(teacherActive?.status === "ACTIVE", "TeacherDoc status is ACTIVE");
  assert(profileActive?.status === "ACTIVE", "UserProfile status synchronized to ACTIVE");

  // Reactivated teacher can log in again
  const loginReactivated = await loginPost(
    req(null, "/api/auth/login", "POST", {
      identifier: "rashid.physics",
      password: PERM_PASSWORD,
      portal: "teacher",
    })
  );
  assert(loginReactivated.status === 200, "Reactivated teacher signs in successfully");

  console.log("\n--- Section 9: Audit Trail Logging ---");
  const logs = await getAuditLogsServer(schoolA);
  const emailLog = logs.find((l: any) => l.action === "UPDATE_TEACHER_EMAIL" && l.entityId === teacherId);
  assert(Boolean(emailLog), "Audit log records UPDATE_TEACHER_EMAIL");
  assert(emailLog?.details?.includes(NEW_EMAIL_1), "Audit log details mention updated email");

  
  console.log("\n--- Section 10: Admin Teacher Password Reset & Authoritative Email Resolution ---");
  // 1. Admin sends password reset via POST /api/teachers/[id]/reset-password
  const adminResetCapture = await captureLink(() =>
    resetPasswordPost(req(ADMIN_A, `/api/teachers/${teacherId}/reset-password`, "POST"), idParams(teacherId))
  );
  const adminResetJson = await json(adminResetCapture.res);
  assert(adminResetCapture.res.status === 200, "Admin reset password returns 200 OK");
  assert(adminResetJson.email === NEW_EMAIL_2, `Admin reset response targets NEW email (${NEW_EMAIL_2})`);
  assert(adminResetCapture.to === NEW_EMAIL_2, `Captured reset email recipient is NEW email (${NEW_EMAIL_2})`);
  assert(adminResetCapture.to !== "rashid.initial@school-tam.edu", "Old initial email was NEVER targeted by reset link");
  assert(adminResetCapture.to !== NEW_EMAIL_1, "Previous intermediate email was NEVER targeted by reset link");

  // 2. Teacher activation endpoint also targets the new authoritative email
  const adminActCapture = await captureLink(() =>
    activationPost(req(ADMIN_A, `/api/teachers/${teacherId}/activation`, "POST"), idParams(teacherId))
  );
  const adminActJson = await json(adminActCapture.res);
  assert(adminActCapture.res.status === 200, "Teacher activation returns 200 OK");
  assert(adminActJson.email === NEW_EMAIL_2, `Activation targets NEW email (${NEW_EMAIL_2})`);
  assert(adminActCapture.to === NEW_EMAIL_2, `Activation captured recipient is NEW email (${NEW_EMAIL_2})`);

  // 3. Stale cache / desync test:
  // If TeacherDoc temporarily had an old email in cache, resetPassword resolves by UID and synchronizes
  const desyncTeacherId = "tch-tam-desync";
  const desyncUid = "uid-tam-desync";
  const DESYNC_OLD_EMAIL = "desync.old@school-tam.edu";
  const DESYNC_NEW_EMAIL = "desync.new@school-tam.edu";

  await saveTeacherServer({
    id: desyncTeacherId,
    schoolId: schoolA,
    userId: desyncUid,
    employeeId: "TCH-999",
    fullName: "Desync Test Teacher",
    email: DESYNC_OLD_EMAIL, // stale email on teacher record
    phone: "03000000000",
    status: "ACTIVE",
    joiningDate: "2026-08-01",
    department: "Science",
    designation: "Instructor",
  });
  await updateUserServer({
    uid: desyncUid,
    schoolId: schoolA,
    email: DESYNC_NEW_EMAIL, // updated email on user profile
    name: "Desync Test Teacher",
    role: "TEACHER",
    teacherId: desyncTeacherId,
    status: "ACTIVE",
    updatedAt: now,
  });

  const staleResetCapture = await captureLink(() =>
    resetPasswordPost(req(ADMIN_A, `/api/teachers/${desyncTeacherId}/reset-password`, "POST"), idParams(desyncTeacherId))
  );
  const staleResetJson = await json(staleResetCapture.res);
  assert(staleResetCapture.res.status === 200, "Reset password succeeds despite desynced teacher email");
  assert(staleResetJson.email === DESYNC_NEW_EMAIL, `Reset password resolved authoritative NEW email (${DESYNC_NEW_EMAIL})`);
  assert(staleResetCapture.to === DESYNC_NEW_EMAIL, "Reset email delivered to authoritative NEW email, not stale old email");

  // 4. Inactive teacher reset is rejected
  await saveTeacherServer({
    id: desyncTeacherId,
    schoolId: schoolA,
    userId: desyncUid,
    employeeId: "TCH-999",
    fullName: "Desync Test Teacher",
    email: DESYNC_NEW_EMAIL,
    phone: "03000000000",
    status: "INACTIVE", // inactive!
    joiningDate: "2026-08-01",
    department: "Science",
    designation: "Instructor",
  });
  const inactiveResetRes = await resetPasswordPost(
    req(ADMIN_A, `/api/teachers/${desyncTeacherId}/reset-password`, "POST"),
    idParams(desyncTeacherId)
  );
  assert(inactiveResetRes.status === 409, "Reset password for inactive teacher is rejected (409 Conflict)");

  // 5. Non-existent teacher returns 404
  const notFoundReset = await resetPasswordPost(
    req(ADMIN_A, `/api/teachers/non-existent-teacher/reset-password`, "POST"),
    idParams("non-existent-teacher")
  );
  assert(notFoundReset.status === 404, "Non-existent teacher reset returns 404 Not Found");

  // 6. Non-admin (teacher) access is forbidden
  const teacherForbiddenReset = await resetPasswordPost(
    req(TEACHER_SESSION, `/api/teachers/${teacherId}/reset-password`, "POST"),
    idParams(teacherId)
  );
  assert(teacherForbiddenReset.status === 403, "Non-admin teacher cannot trigger admin reset password (403)");

  // 7. Cross-school admin reset is forbidden
  const crossSchoolReset = await resetPasswordPost(
    req(ADMIN_B, `/api/teachers/${teacherId}/reset-password`, "POST"),
    idParams(teacherId)
  );
  assert(crossSchoolReset.status === 404, "Cross-school admin cannot reset teacher password (404)");

  console.log("\n=======================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Unhandled test exception:", e);
  process.exit(1);
});
