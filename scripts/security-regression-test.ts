import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { POST as loginHandler } from "../src/app/api/auth/login/route";
import { POST as logoutHandler } from "../src/app/api/auth/logout/route";
import { POST as registerHandler } from "../src/app/api/auth/register/route";
import { GET as lockedRecordsHandler } from "../src/app/api/locked-records/route";
import { GET as studentMeHandler } from "../src/app/api/student/me/route";
import { GET as studentsHandler } from "../src/app/api/students/route";
import { GET as feesHandler } from "../src/app/api/fees/route";
import { GET as attendanceGet, POST as attendancePost } from "../src/app/api/attendance/route";
import { createSessionCookieServer, requireAuth } from "../src/lib/firebase/server-auth";
import { checkAuthRateLimit, recordAuthFailure, resetAuthRateLimit } from "../src/lib/rate-limiter";
import nextConfig from "../next.config";
import { SignJWT } from "jose";
import { GET as studentDetailGet, PUT as studentPut, DELETE as studentDelete } from "../src/app/api/students/[id]/route";
import { POST as studentsPost } from "../src/app/api/students/route";
import { PUT as feesPut } from "../src/app/api/fees/route";
import { POST as payrollPost } from "../src/app/api/payroll/route";
import { POST as uploadPost } from "../src/app/api/upload/route";
import { POST as resetPasswordHandler } from "../src/app/api/auth/reset-password/route";
import { POST as forgotPasswordHandler } from "../src/app/api/auth/forgot-password/route";
import { GET as parentChildGet } from "../src/app/api/parent/child/[id]/route";
import { GET as printChallanGet } from "../src/app/api/print/challan/[id]/route";
import { GET as printReportCardGet } from "../src/app/api/print/report-card/[studentId]/route";
import { GET as printAttendanceGet } from "../src/app/api/print/attendance/[studentId]/route";
import { middleware } from "../src/middleware";
import { evaluateSessionAgainstProfile } from "../src/lib/firebase/server-auth";
import { getJwtSecretKey, signSessionToken, verifySessionToken } from "../src/lib/session-token";
import { isCrossSiteStateChange } from "../src/lib/request-security";
import { checkPasswordPolicy } from "../src/lib/password-reset";
import { sniffMimeType } from "../src/lib/storage";
import { neutralizeSpreadsheetFormula } from "../src/lib/spreadsheet-parser";
import { currentStep, generateTotpSecret, totpAt, verifyTotp } from "../src/lib/totp";
import { getUserByEmailServer, updateUserServer } from "../src/lib/firebase/server-db";
import bcrypt from "bcryptjs";
import { POST as classesPost } from "../src/app/api/classes/route";
import { POST as subjectsPost } from "../src/app/api/subjects/route";
import { POST as mfaPost } from "../src/app/api/auth/mfa/route";
import { requirePageRole } from "../src/lib/page-auth";
import { headerSafe } from "../src/lib/email-service";

async function runSecurityTests() {
  console.log("=================================================");
  console.log("   ALLIED SMS — SECURITY REGRESSION SUITE        ");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ""}`);
      failed++;
    }
  }

  // 1. Invalid login: missing password
  {
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin@alliedschool.edu" }),
    });
    const res = await loginHandler(req);
    const data = await res.json();
    assert(res.status === 400 && data.error, "1. Invalid Login: Missing password rejected (400)");
  }

  // 2. Invalid login: wrong password
  {
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin@alliedschool.edu", password: "WrongPassword999!" }),
    });
    const res = await loginHandler(req);
    const data = await res.json();
    assert(res.status === 401 && data.error, "2. Invalid Login: Bad password rejected (401)");
  }

  // 3. Valid login: correct demo admin credentials in dev
  let adminSessionCookie = "";
  {
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin@alliedschool.edu", password: "AdminSecure2025#" }),
    });
    const res = await loginHandler(req);
    const data = await res.json();
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/allied_session=([^;]+)/);
    if (match) adminSessionCookie = match[1];

    assert(
      res.status === 200 && data.success === true && adminSessionCookie.length > 20,
      "3. Valid Login: Admin authentication issues secure allied_session token (200)"
    );
  }

  // 4. Logout: clears allied_session
  {
    const req = new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
    });
    const res = await logoutHandler(req);
    const setCookie = res.headers.get("set-cookie") || "";
    assert(
      res.status === 200 && setCookie.includes("allied_session=;"),
      "4. Logout: Session cookie properly deleted"
    );
  }

  // Create test tokens for RBAC tests
  const adminToken = await createSessionCookieServer({
    uid: "usr-admin-test",
    email: "admin@alliedschool.edu",
    role: "ADMIN",
    schoolId: "allied-school-main",
    name: "System Administrator",
  });

  const teacherToken = await createSessionCookieServer({
    uid: "usr-teacher-test",
    email: "teacher@alliedschool.edu",
    role: "TEACHER",
    schoolId: "allied-school-main",
    name: "Teacher User",
    teacherId: "tch-1",
  });

  const studentToken = await createSessionCookieServer({
    uid: "usr-student-test",
    email: "student@alliedschool.edu",
    role: "STUDENT",
    schoolId: "allied-school-main",
    name: "Student User",
    studentId: "std-1",
  });

  const otherSchoolStudentToken = await createSessionCookieServer({
    uid: "usr-student-other",
    email: "other@otherschool.edu",
    role: "STUDENT",
    schoolId: "other-school-campus",
    name: "Other Student",
    studentId: "std-99",
  });

  // 5. /api/locked-records authorization
  {
    // ADMIN allowed
    const reqAdmin = new NextRequest("http://localhost:3000/api/locked-records", {
      headers: { cookie: `allied_session=${adminToken}` },
    });
    const resAdmin = await lockedRecordsHandler(reqAdmin);
    assert(resAdmin.status === 200, "5a. /api/locked-records: ADMIN allowed (200)");

    // TEACHER forbidden
    const reqTeacher = new NextRequest("http://localhost:3000/api/locked-records", {
      headers: { cookie: `allied_session=${teacherToken}` },
    });
    const resTeacher = await lockedRecordsHandler(reqTeacher);
    assert(resTeacher.status === 403, "5b. /api/locked-records: TEACHER forbidden (403)");

    // STUDENT forbidden
    const reqStudent = new NextRequest("http://localhost:3000/api/locked-records", {
      headers: { cookie: `allied_session=${studentToken}` },
    });
    const resStudent = await lockedRecordsHandler(reqStudent);
    assert(resStudent.status === 403, "5c. /api/locked-records: STUDENT forbidden (403)");

    // Unauthenticated unauthorized
    const reqUnauth = new NextRequest("http://localhost:3000/api/locked-records");
    const resUnauth = await lockedRecordsHandler(reqUnauth);
    assert(resUnauth.status === 401, "5d. /api/locked-records: Unauthenticated rejected (401)");
  }

  // 6. /api/student/me: student self-identity
  {
    const reqStudent = new NextRequest("http://localhost:3000/api/student/me", {
      headers: { cookie: `allied_session=${studentToken}` },
    });
    const resStudent = await studentMeHandler(reqStudent);
    const dataStudent = await resStudent.json();
    assert(
      resStudent.status === 200 && dataStudent.success && dataStudent.student.id === "std-1",
      "6. /api/student/me: Resolves authenticated student record strictly"
    );
  }

  // 7. /api/students permissions (STUDENT = 403)
  {
    const reqStudent = new NextRequest("http://localhost:3000/api/students", {
      headers: { cookie: `allied_session=${studentToken}` },
    });
    const resStudent = await studentsHandler(reqStudent);
    assert(resStudent.status === 403, "7. /api/students: STUDENT blocked (403)");
  }

  // 8. /api/fees permissions (STUDENT = 403)
  {
    const reqStudent = new NextRequest("http://localhost:3000/api/fees", {
      headers: { cookie: `allied_session=${studentToken}` },
    });
    const resStudent = await feesHandler(reqStudent);
    assert(resStudent.status === 403, "8. /api/fees: STUDENT blocked (403)");
  }

  // 9. Cross-school isolation: student from other school cannot access main school's student record
  {
    const reqOther = new NextRequest("http://localhost:3000/api/student/me", {
      headers: { cookie: `allied_session=${otherSchoolStudentToken}` },
    });
    const resOther = await studentMeHandler(reqOther);
    const dataOther = await resOther.json();
    // Should either return 404 (no record in their school) or return other school record, NEVER allied-school-main student
    const isolated = resOther.status === 404 || (dataOther.student && dataOther.student.schoolId === "other-school-campus");
    assert(isolated, "9. Cross-school isolation: Multi-tenant boundary preserved");
  }

  // 10. Production JWT_SECRET requirement test
  {
    // Simulate production environment check with short/missing secret
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.JWT_SECRET;
    try {
      (process.env as any).NODE_ENV = "production";
      delete process.env.JWT_SECRET;

      let threwError = false;
      try {
        // Calling requireAuth under production with no JWT_SECRET should throw or reject
        const reqProd = new NextRequest("http://localhost:3000/api/locked-records");
        await requireAuth(reqProd);
      } catch (e: any) {
        threwError = true;
      }
      assert(threwError, "10. Production JWT_SECRET requirement: Enforced safely");
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      if (origSecret) process.env.JWT_SECRET = origSecret;
    }
  }

  // 10b. Test demo credentials in production: MUST BE REJECTED (401)
  {
    const origEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      const req = new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: "admin@alliedschool.edu", password: "AdminSecure2025#" }),
      });
      const res = await loginHandler(req);
      assert(
        res.status === 401,
        "10b. Production security: Demo credentials strictly blocked in production (401)"
      );
    } finally {
      (process.env as any).NODE_ENV = origEnv;
    }
  }

  // 11. Login API always returning JSON
  {
    const reqBad = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "INVALID_MALFORMED_JSON_STRING",
    });
    const resBad = await loginHandler(reqBad);
    const contentType = resBad.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const jsonBody = await resBad.json().catch(() => null);
    assert(
      resBad.status === 400 && isJson && jsonBody !== null,
      "11. Login API always returns valid JSON on malformed input"
    );
  }

  // 12. Security Headers configuration check
  {
    if (typeof nextConfig.headers === "function") {
      const headersList = await nextConfig.headers();
      const rootHeaders = headersList.find((h: any) => h.source === "/:path*")?.headers || [];
      const headerMap = new Map(rootHeaders.map((h: any) => [h.key, h.value]));

      const hasNosniff = headerMap.get("X-Content-Type-Options") === "nosniff";
      const hasDenyFrame = headerMap.get("X-Frame-Options") === "DENY";
      const hasReferrer = headerMap.get("Referrer-Policy") === "strict-origin-when-cross-origin";
      const hasPermissions = headerMap.has("Permissions-Policy");

      assert(
        hasNosniff && hasDenyFrame && hasReferrer && hasPermissions,
        "12. HTTP Security Headers: nosniff, DENY, Referrer-Policy, and Permissions-Policy configured"
      );
    } else {
      assert(false, "12. HTTP Security Headers: headers function missing in next.config.ts");
    }
  }

  // 13. Rate limiting behavior check
  {
    const testIp = "192.168.1.199";
    resetAuthRateLimit(testIp);

    // Initial check: allowed
    const r1 = checkAuthRateLimit(testIp, 5, 60);
    assert(r1.allowed && r1.remaining === 5, "13a. Rate Limiting: Initial request allowed");

    // Record 5 failures
    for (let i = 0; i < 5; i++) {
      recordAuthFailure(testIp, 5, 60);
    }

    // Now check: blocked
    const r2 = checkAuthRateLimit(testIp, 5, 60);
    assert(!r2.allowed && r2.remaining === 0, "13b. Rate Limiting: Burst of 5 failures blocks requests (429)");

    // Reset after success
    resetAuthRateLimit(testIp);
    const r3 = checkAuthRateLimit(testIp, 5, 60);
    assert(r3.allowed && r3.remaining === 5, "13c. Rate Limiting: Reset works as expected");
  }

  // 14. Firebase Storage deny-all rules configuration check (Phase 9)
  {
    const storageRulesPath = path.resolve(__dirname, "../storage.rules");
    const firebaseJsonPath = path.resolve(__dirname, "../firebase.json");
    const storageRulesExist = fs.existsSync(storageRulesPath);
    const firebaseJsonContent = fs.existsSync(firebaseJsonPath)
      ? fs.readFileSync(firebaseJsonPath, "utf-8")
      : "";
    const storageRulesContent = storageRulesExist
      ? fs.readFileSync(storageRulesPath, "utf-8")
      : "";

    const hasSchoolIsolation = storageRulesContent.includes("request.auth.token.schoolId == schoolId");
    const hasClientWriteBlocked = storageRulesContent.includes("allow write: if false;");
    const configuredInJson = firebaseJsonContent.includes('"storage"') && firebaseJsonContent.includes('"rules": "storage.rules"');

    assert(
      storageRulesExist && hasSchoolIsolation && hasClientWriteBlocked && configuredInJson,
      "14. Firebase Storage Security: Tenant-isolated storage.rules exists, enforces schoolId, blocks client writes, and is registered in firebase.json"
    );
  }

  // 15. Firestore Security Rules syntax & client-write prevention check (Phase 8)
  {
    const firestoreRulesPath = path.resolve(__dirname, "../firestore.rules");
    const rulesExist = fs.existsSync(firestoreRulesPath);
    const content = rulesExist ? fs.readFileSync(firestoreRulesPath, "utf-8") : "";

    const hasValidLower = content.includes(".lower()");
    const hasInvalidToLowerCase = content.includes(".toLowerCase()");
    const hasClientWriteBlocked = content.includes("allow write: if false;");

    assert(
      rulesExist && hasValidLower && !hasInvalidToLowerCase && hasClientWriteBlocked,
      "15. Firestore Security Rules: Valid CEL syntax (.lower) and direct client writes forbidden"
    );
  }

  // 16. Attendance GET retrieval check (verifying date and classId query matching)
  {
    const targetDate = "2026-09-16";
    const targetClass = "cls-10a";

    // Mark attendance first
    const markReq = new NextRequest("http://localhost:3000/api/attendance", {
      method: "POST",
      headers: {
        cookie: `allied_session=${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        classId: targetClass,
        date: targetDate,
        records: [{ studentId: "std-1", status: "LATE" }],
      }),
    });
    const markRes = await attendancePost(markReq);
    assert(markRes.status === 200, "16a. Attendance POST: Successfully recorded roll call");

    // Query attendance for that date and class
    const getReq = new NextRequest(
      `http://localhost:3000/api/attendance?classId=${targetClass}&date=${targetDate}`,
      {
        headers: { cookie: `allied_session=${adminToken}` },
      }
    );
    const getRes = await attendanceGet(getReq);
    const getData = await getRes.json();
    const studentRecord = (getData.roster || []).find((r: any) => r.studentId === "std-1");

      assert(
        getRes.status === 200 &&
          getData.isSaved === true &&
          studentRecord?.status === "LATE",
        "16b. Attendance GET: Correctly queries by date and classId and returns saved status"
      );
    }

  // 17. School Registration Secret Authorization Enforcement
  {
    const prevSecret = process.env.SCHOOL_REGISTRATION_SECRET;
    process.env.SCHOOL_REGISTRATION_SECRET = "super-secret-registration-key-2026";

    try {
      // 17a: Missing or invalid secret rejected (403)
      const badReq = new NextRequest("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Principal Test",
          email: "newadmin@alliedschool.edu",
          password: "SecureMasterPassword123!",
          schoolName: "Test School Campus",
          registrationSecret: "wrong-secret",
        }),
      });
      const badRes = await registerHandler(badReq);
      const badData = await badRes.json();
      assert(
        badRes.status === 403 && badData.error?.includes("secret"),
        "17a. Registration Security: Invalid or missing registrationSecret returns 403"
      );

      // 17b: Valid secret allows registration request past the secret check
      const goodReq = new NextRequest("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Principal Test",
          email: "newuniqueadmin@alliedschool.edu",
          password: "SecureMasterPassword123!",
          schoolName: "Test School Campus",
          registrationSecret: "super-secret-registration-key-2026",
        }),
      });
      const goodRes = await registerHandler(goodReq);
      assert(
        goodRes.status === 201,
        "17b. Registration Security: Matching registrationSecret authorizes school registration (201)"
      );
    } finally {
      process.env.SCHOOL_REGISTRATION_SECRET = prevSecret;
    }
  }


  // =====================================================================
  // 18–39. SECURITY HARDENING (see ALLIED_SECURITY_REPORT.md)
  // =====================================================================
  const ip = (n: number) => ({ "x-real-ip": `10.99.${Math.floor(n / 250)}.${n % 250}` });
  let ipCounter = 1;
  const nextIp = () => ip(ipCounter++);
  const authed = (token: string, url: string, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}) =>
    new NextRequest(url, {
      method,
      headers: { cookie: `allied_session=${token}`, "Content-Type": "application/json", ...nextIp(), ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const devSecret = getJwtSecretKey();

  // 18. JWT algorithm pinning, issuer/audience, signature, absolute lifetime
  {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const nowS = Math.floor(Date.now() / 1000);
    const claims = { uid: "usr-admin-1", email: "admin@alliedschool.edu", role: "ADMIN", schoolId: "allied-school-main", name: "x", authAt: nowS, iat: nowS, exp: nowS + 300, iss: "allied-sms", aud: "allied-sms-session" };
    const noneToken = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
    assert((await verifySessionToken(noneToken)) === null, "18a. JWT: alg=none token rejected");
    const { iss: _iss, aud: _aud, ...noIssClaims } = claims;
    void _iss;
    void _aud;
    const noIssuer = await new SignJWT(noIssClaims).setProtectedHeader({ alg: "HS256" }).sign(devSecret);
    assert((await verifySessionToken(noIssuer)) === null, "18b. JWT: token without the expected issuer/audience rejected");
    const hs512 = await new SignJWT(claims).setProtectedHeader({ alg: "HS512" }).sign(new Uint8Array(64).fill(7));
    assert((await verifySessionToken(hs512)) === null, "18c. JWT: other algorithm / other key rejected");
    const forged = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("attacker-chosen-secret-attacker-chosen"));
    assert((await verifySessionToken(forged)) === null, "18d. JWT: token signed with a different secret rejected");
    const stale = await signSessionToken({ uid: "usr-admin-1", email: "a@x", role: "ADMIN", schoolId: "allied-school-main", name: "x", authAt: nowS - 13 * 3600 });
    assert((await verifySessionToken(stale)) === null, "18e. JWT: session older than the 12h absolute lifetime rejected even if freshly refreshed");
    const ok = await signSessionToken({ uid: "usr-admin-1", email: "a@x", role: "ADMIN", schoolId: "allied-school-main", name: "x" });
    assert((await verifySessionToken(ok))?.uid === "usr-admin-1", "18f. JWT: valid HS256 session accepted");
  }

  // 19. Dev fallback secret is refused in production and whenever real Firebase credentials exist
  {
    const throws = (env: Record<string, string | undefined>) => {
      try {
        getJwtSecretKey(env);
        return false;
      } catch {
        return true;
      }
    };
    assert(throws({ NODE_ENV: "production" }), "19a. JWT secret: missing secret in production is fatal");
    assert(throws({ NODE_ENV: "development", FIREBASE_PRIVATE_KEY: "x", FIREBASE_CLIENT_EMAIL: "x" }), "19b. JWT secret: dev fallback refused when Firebase Admin credentials are configured");
    assert(throws({ NODE_ENV: "development", VERCEL: "1" }), "19c. JWT secret: dev fallback refused on Vercel (incl. preview)");
    assert(throws({ NODE_ENV: "production", JWT_SECRET: "short-secret" }), "19d. JWT secret: secrets under 32 chars refused");
    assert(!throws({ NODE_ENV: "production", JWT_SECRET: "x".repeat(48) }), "19e. JWT secret: 32+ char secret accepted in production");
  }

  // 20. Session revocation against the live profile
  {
    const base = { uid: "u1", role: "TEACHER" as const, schoolId: "s1", authAt: 1000, sid: "abc" };
    const profile = { uid: "u1", role: "TEACHER", schoolId: "s1", status: "ACTIVE", email: "t@x", name: "T", createdAt: "", updatedAt: "" } as any;
    assert(evaluateSessionAgainstProfile(base, profile, true) === "OK", "20a. Revocation: matching active profile keeps the session");
    assert(evaluateSessionAgainstProfile(base, { ...profile, status: "INACTIVE" }, true) === "INACTIVE", "20b. Revocation: disabled user loses the session immediately");
    assert(evaluateSessionAgainstProfile(base, { ...profile, role: "ADMIN" }, true) === "ROLE_CHANGED", "20c. Revocation: role change invalidates old sessions");
    assert(evaluateSessionAgainstProfile(base, { ...profile, schoolId: "s2" }, true) === "SCHOOL_CHANGED", "20d. Revocation: moving school invalidates old sessions");
    assert(evaluateSessionAgainstProfile(base, null, true) === "PROFILE_MISSING", "20e. Revocation: deleted user (no profile) rejected with a real database");
    assert(evaluateSessionAgainstProfile(base, { ...profile, revokedSessionIds: ["abc"] }, true) === "LOGGED_OUT", "20f. Revocation: logged-out session id rejected");
    assert(evaluateSessionAgainstProfile(base, { ...profile, sessionsValidAfter: new Date(2000 * 1000).toISOString() }, true) === "PASSWORD_CHANGED", "20g. Revocation: sessions older than a password change rejected");
  }

  // 21. Cookie flags + logout revokes the token server-side (a copied cookie stops working)
  {
    const loginRes = await loginHandler(new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...nextIp() },
      body: JSON.stringify({ identifier: "admin@alliedschool.edu", password: "AdminSecure2025#" }),
    }));
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const token = (setCookie.match(/allied_session=([^;]+)/) || [])[1] || "";
    assert(/HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie) && /Path=\//.test(setCookie) && /Max-Age=300/.test(setCookie), "21a. Cookie: HttpOnly, SameSite=Lax, Path=/, 5-minute Max-Age");
    const before = await lockedRecordsHandler(authed(token, "http://localhost:3000/api/locked-records"));
    await logoutHandler(new NextRequest("http://localhost:3000/api/auth/logout", { method: "POST", headers: { cookie: `allied_session=${token}` } }));
    const after = await lockedRecordsHandler(authed(token, "http://localhost:3000/api/locked-records"));
    assert(before.status === 200 && after.status === 401, "21b. Logout: the same token is rejected (401) after logout");
  }

  // 22. Per-account brute-force lockout (independent of IP)
  {
    const target = "teacher@alliedschool.edu";
    for (let i = 0; i < 5; i++) {
      await loginHandler(new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...nextIp() },
        body: JSON.stringify({ identifier: target, password: `Wrong#Guess${i}xx` }),
      }));
    }
    const locked = await loginHandler(new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...nextIp() },
      body: JSON.stringify({ identifier: target, password: "TeacherSecure2025#" }),
    }));
    assert(locked.status === 429, "22. Brute force: 5 failures from different IPs lock the account (correct password then gets 429)");
  }

  // 23. Password policy
  {
    assert(checkPasswordPolicy("Password123!") !== null, "23a. Password policy: common password rejected");
    assert(checkPasswordPolicy("AdminSecure2025#") !== null, "23b. Password policy: published demo password rejected");
    assert(checkPasswordPolicy("short1!") !== null, "23c. Password policy: under 10 characters rejected");
    assert(checkPasswordPolicy("zainab.khan.2026!", { email: "zainab.khan@x.edu" }) !== null, "23d. Password policy: password containing the email name rejected");
    assert(checkPasswordPolicy("Tulip-Garden-Lantern-81") === null, "23e. Password policy: strong passphrase accepted");
  }

  // 24. Reset-password endpoint is rate limited per IP
  {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await resetPasswordHandler(new NextRequest("http://localhost:3000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-real-ip": "10.250.0.1" },
        body: JSON.stringify({ token: "A".repeat(43), newPassword: "Tulip-Garden-Lantern-81" }),
      }));
      last = r.status;
    }
    assert(last === 429, "24. Reset password: 11th attempt from one IP is rate limited (429)");
  }

  // 25. Forgot-password gives the identical response for known and unknown emails
  {
    const ask = async (email: string) => {
      const r = await forgotPasswordHandler(new NextRequest("http://localhost:3000/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...nextIp() },
        body: JSON.stringify({ email }),
      }));
      return { status: r.status, body: JSON.stringify(await r.json()) };
    };
    const origWarn = console.warn;
    console.warn = () => undefined;
    const known = await ask("parent@alliedschool.edu");
    const unknown = await ask("nobody-here@alliedschool.edu");
    console.warn = origWarn;
    assert(known.status === unknown.status && known.body === unknown.body, "25. No user enumeration: forgot-password response identical for known/unknown emails");
  }

  // 26. Registration: one-time secret, no takeover of existing accounts, short secrets refused
  {
    const prevSecret = process.env.SCHOOL_REGISTRATION_SECRET;
    const register = (secret: string, email: string) =>
      registerHandler(new NextRequest("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...nextIp() },
        body: JSON.stringify({ fullName: "Principal Two", email, password: "Tulip-Garden-Lantern-81", schoolName: "Second Campus", registrationSecret: secret }),
      }));
    try {
      process.env.SCHOOL_REGISTRATION_SECRET = "super-secret-registration-key-2026"; // consumed by 17b
      const reused = await register("super-secret-registration-key-2026", "another.admin@alliedschool.edu");
      assert(reused.status === 403, "26a. Registration: a used registration secret cannot create a second institution (403)");
      process.env.SCHOOL_REGISTRATION_SECRET = "fresh-one-time-setup-secret-0001";
      const existing = await register("fresh-one-time-setup-secret-0001", "teacher@alliedschool.edu");
      assert(existing.status === 409, "26b. Registration: an existing user (teacher) cannot be re-registered as ADMIN of a new school (409)");
      process.env.SCHOOL_REGISTRATION_SECRET = "short";
      const weak = await register("short", "x.admin@alliedschool.edu");
      assert(weak.status === 403, "26c. Registration: a configured secret shorter than 16 chars is refused");
    } finally {
      process.env.SCHOOL_REGISTRATION_SECRET = prevSecret;
    }
  }

  // Tokens for IDOR tests (in-memory dev store; seeded school "allied-school-main")
  const adminA = await createSessionCookieServer({ uid: "usr-admin-1", email: "admin@alliedschool.edu", role: "ADMIN", schoolId: "allied-school-main", name: "Admin A" });
  const adminB = await createSessionCookieServer({ uid: "usr-admin-b", email: "admin@school-b.edu", role: "ADMIN", schoolId: "school-b-campus", name: "Admin B" });
  const teacherNoAlloc = await createSessionCookieServer({ uid: "usr-teacher-noalloc", email: "t2@alliedschool.edu", role: "TEACHER", schoolId: "allied-school-main", name: "T2", teacherId: "tch-none" });
  const otherParent = await createSessionCookieServer({ uid: "usr-parent-other", email: "other.parent@alliedschool.edu", role: "PARENT", schoolId: "allied-school-main", name: "P2" });
  const otherStudent = await createSessionCookieServer({ uid: "usr-student-other2", email: "s2@alliedschool.edu", role: "STUDENT", schoolId: "allied-school-main", name: "S2", studentId: "std-other" });

  // 27. Cross-school IDOR (school B admin vs school A records)
  {
    const s = await studentDetailGet(authed(adminB, "http://localhost:3000/api/students/std-1"), { params: Promise.resolve({ id: "std-1" }) });
    assert(s.status === 404, "27a. IDOR: school B admin cannot read school A student (404)");
    const pay = await feesPut(authed(adminB, "http://localhost:3000/api/fees", "PUT", { challanId: "ch-1001", amount: 10 }));
    assert(pay.status === 404, "27b. IDOR: school B admin cannot record a payment on school A challan (404)");
    const ch = await printChallanGet(authed(adminB, "http://localhost:3000/api/print/challan/ch-1001"), { params: Promise.resolve({ id: "ch-1001" }) });
    assert(ch.status === 404, "27c. IDOR: school B admin cannot print school A challan (404)");
    const del = await studentDelete(authed(adminB, "http://localhost:3000/api/students/std-1", "DELETE"), { params: Promise.resolve({ id: "std-1" }) });
    assert(del.status === 404, "27d. IDOR: school B admin cannot archive school A student (404)");
  }

  // 28. Teacher / parent / student scoping
  {
    const t = await studentDetailGet(authed(teacherNoAlloc, "http://localhost:3000/api/students/std-1"), { params: Promise.resolve({ id: "std-1" }) });
    assert(t.status === 403, "28a. Scoping: unallocated teacher cannot open a student dossier (403)");
    const p = await parentChildGet(authed(otherParent, "http://localhost:3000/api/parent/child/std-1"), { params: Promise.resolve({ id: "std-1" }) });
    assert(p.status === 403, "28b. Scoping: parent cannot read a child not linked to them (403)");
    const rc = await printReportCardGet(authed(otherStudent, "http://localhost:3000/api/print/report-card/std-1"), { params: Promise.resolve({ studentId: "std-1" }) });
    assert(rc.status === 403, "28c. Scoping: student cannot print another student's report card (403)");
    const pa = await printAttendanceGet(authed(otherParent, "http://localhost:3000/api/print/attendance/std-1"), { params: Promise.resolve({ studentId: "std-1" }) });
    assert(pa.status === 403, "28d. Scoping: unlinked parent cannot print attendance (403)");
  }

  // 29. Mass assignment and input validation
  {
    const r1 = await studentPut(authed(adminA, "http://localhost:3000/api/students/std-1", "PUT", { schoolId: "school-b-campus" }), { params: Promise.resolve({ id: "std-1" }) });
    assert(r1.status === 400, "29a. Mass assignment: schoolId in a student update is rejected (400)");
    const r2 = await studentPut(authed(adminA, "http://localhost:3000/api/students/std-1", "PUT", { parentUserIds: ["attacker"] }), { params: Promise.resolve({ id: "std-1" }) });
    assert(r2.status === 400, "29b. Mass assignment: parentUserIds cannot be set by the client (400)");
    const r3 = await feesPut(authed(adminA, "http://localhost:3000/api/fees", "PUT", { challanId: "ch-1001", amount: 10, paidAmount: 999999 }));
    assert(r3.status === 400, "29c. Mass assignment: paidAmount cannot be set on a payment (400)");
    const r4 = await feesPut(authed(adminA, "http://localhost:3000/api/fees", "PUT", { challanId: "ch-1001", amount: "abc" }));
    assert(r4.status === 400, "29d. Validation: non-numeric payment amount rejected (previously stored NaN)");
    const r5 = await payrollPost(authed(adminA, "http://localhost:3000/api/payroll", "POST", { teacherId: "tch-1", month: "x/y", year: 2026, status: "PAID" }));
    assert(r5.status === 400, "29e. Validation: payroll month must be a real month name");
    const r6 = await payrollPost(authed(adminA, "http://localhost:3000/api/payroll", "POST", { teacherId: "tch-1", month: "October", year: 2026, status: "PAID", amount: -500 }));
    assert(r6.status === 400, "29f. Validation: negative salary rejected");
    const r7 = await studentPut(authed(adminA, "http://localhost:3000/api/students/std-1", "PUT", { photoUrl: "javascript:alert(document.cookie)" }), { params: Promise.resolve({ id: "std-1" }) });
    assert(r7.status === 400, "29g. XSS: javascript: URL rejected for photoUrl");
    const r8 = await studentPut(authed(adminA, "http://localhost:3000/api/students/std-1", "PUT", { status: "SUPERUSER" }), { params: Promise.resolve({ id: "std-1" }) });
    assert(r8.status === 400, "29h. Validation: student status limited to known values");
  }

  // 30. Upload validation by content (magic bytes), not by declared type
  {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    assert(sniffMimeType(png) === "image/png" && sniffMimeType(Buffer.from("%PDF-1.7\n")) === "application/pdf", "30a. Upload: PNG/PDF recognised from their bytes");
    assert(sniffMimeType(Buffer.from("<html><script>alert(1)</script></html>")) === null && sniffMimeType(Buffer.from("<svg onload=alert(1)>")) === null, "30b. Upload: HTML/SVG content never recognised as an allowed type");
    const fd = new FormData();
    fd.append("folder", "profile-photos");
    fd.append("file", new Blob(["<html><script>alert(1)</script></html>"], { type: "image/png" }), "../../evil.png");
    const up = await uploadPost(new NextRequest("http://localhost:3000/api/upload", { method: "POST", headers: { cookie: `allied_session=${adminA}`, ...nextIp() }, body: fd }));
    assert(up.status === 400, "30c. Upload: HTML disguised as image/png is rejected (400)");
    const fd2 = new FormData();
    fd2.append("folder", "profile-photos");
    fd2.append("file", new Blob([png], { type: "image/png" }), "../../../etc/passwd.html");
    const up2 = await uploadPost(new NextRequest("http://localhost:3000/api/upload", { method: "POST", headers: { cookie: `allied_session=${adminA}`, ...nextIp() }, body: fd2 }));
    const upJson = await up2.json();
    assert(
      up2.status === 201 && upJson.storagePath.startsWith("schools/allied-school-main/profile-photos/") && !upJson.storagePath.includes("..") && upJson.storagePath.endsWith(".png"),
      "30d. Upload: stored under the caller's school path with a safe generated name (no traversal, server-chosen extension)"
    );
  }

  // 31. CSRF: cross-site state-changing requests rejected (route-level and middleware)
  {
    const evil = await feesPut(authed(adminA, "http://localhost:3000/api/fees", "PUT", { challanId: "ch-1001", amount: 1 }, { origin: "https://evil.example" }));
    assert(evil.status === 403, "31a. CSRF: cross-origin PUT with a valid cookie is rejected by requireAuth (403)");
    const site = await feesPut(authed(adminA, "http://localhost:3000/api/fees", "PUT", { challanId: "ch-1001", amount: 1 }, { "sec-fetch-site": "cross-site" }));
    assert(site.status === 403, "31b. CSRF: Sec-Fetch-Site: cross-site is rejected (403)");
    const mw = await middleware(new NextRequest("http://localhost:3000/api/fees", { method: "POST", headers: { origin: "https://evil.example" } }));
    assert(mw.status === 403, "31c. CSRF: middleware blocks cross-site API writes before the handler runs");
    const prodLike = isCrossSiteStateChange(
      { method: "POST", url: "https://school.example.com/api/fees", headers: new Headers({ origin: "http://localhost:3000" }) },
      { NODE_ENV: "production" }
    );
    assert(prodLike === true, "31d. CSRF: localhost origins are NOT trusted in production");
  }

  // 32. Security headers
  {
    const list = await nextConfig.headers!();
    const root = new Map<string, string>((list.find((h: any) => h.source === "/:path*")?.headers || []).map((h: any) => [h.key, h.value]));
    const api = new Map<string, string>((list.find((h: any) => h.source === "/api/:path*")?.headers || []).map((h: any) => [h.key, h.value]));
    assert((nextConfig as any).poweredByHeader === false, "32a. Headers: X-Powered-By disabled");
    const baseCsp = root.get("Content-Security-Policy") || "";
    assert(baseCsp.includes("frame-ancestors 'none'") && baseCsp.includes("object-src 'none'") && baseCsp.includes("base-uri 'self'") && baseCsp.includes("form-action 'self'"), "32b. Headers: baseline CSP (frame-ancestors, object-src, base-uri, form-action) on every route");
    assert((api.get("Cache-Control") || "").includes("no-store"), "32c. Headers: API responses are no-store");
    const mwRes = await middleware(new NextRequest("http://localhost:3000/login"));
    const csp = mwRes.headers.get("content-security-policy") || "";
    assert(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"), "32d. Headers: middleware sets nonce-based CSP on pages");
  }

  // 33/34. Unique random initial student passwords; archiving ends the student's login
  {
    const mk = (first: string) => studentsPost(authed(adminA, "http://localhost:3000/api/students", "POST", {
      firstName: first, lastName: "Security", classId: "cls-10a", guardianName: "G", guardianPhone: "03001234567", gender: "Female",
    }));
    const a = await (await mk("Alpha")).json();
    const b = await (await mk("Bravo")).json();
    assert(
      typeof a.temporaryPassword === "string" && a.temporaryPassword !== b.temporaryPassword && a.temporaryPassword !== "Student@123" && a.temporaryPassword.length >= 20,
      "33. Credentials: every new student gets a different random initial password"
    );
    const loginRes = await loginHandler(new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...nextIp() },
      body: JSON.stringify({ identifier: a.student?.email, password: a.temporaryPassword }),
    }));
    const stuToken = ((loginRes.headers.get("set-cookie") || "").match(/allied_session=([^;]+)/) || [])[1] || "";
    const meBefore = await studentMeHandler(authed(stuToken, "http://localhost:3000/api/student/me"));
    await studentDelete(authed(adminA, `http://localhost:3000/api/students/${a.student?.id}`, "DELETE"), { params: Promise.resolve({ id: a.student?.id }) });
    const meAfter = await studentMeHandler(authed(stuToken, "http://localhost:3000/api/student/me"));
    assert(loginRes.status === 200 && meBefore.status === 200 && meAfter.status === 401, "34. Offboarding: archived student's existing session is rejected (401)");
  }

  // 35. Spreadsheet formula injection
  {
    assert(!neutralizeSpreadsheetFormula('=HYPERLINK("http://evil","x")').startsWith("=") && !neutralizeSpreadsheetFormula("@SUM(A1)").startsWith("@"), "35a. CSV import: leading formula characters stripped");
    assert(neutralizeSpreadsheetFormula("+92 300 1234567") === "+92 300 1234567", "35b. CSV import: phone numbers with a leading + are preserved");
  }

  // 36. TOTP + admin 2FA at login (flag on, enrolled admin)
  {
    const secret = generateTotpSecret();
    const step = currentStep();
    assert(verifyTotp(secret, totpAt(secret, step)) !== null && verifyTotp(secret, "000000x") === null, "36a. TOTP: RFC 6238 code verifies; malformed code rejected");
    assert(verifyTotp(secret, totpAt(secret, step), { lastUsedStep: step + 1 }) === null, "36b. TOTP: a used code (or older) cannot be replayed");
    const prev = process.env.ADMIN_MFA_ENABLED;
    process.env.ADMIN_MFA_ENABLED = "true";
    const adminProfile = await getUserByEmailServer("admin@alliedschool.edu");
    await updateUserServer({ ...adminProfile!, mfaEnabled: true, mfaSecret: secret, mfaLastUsedStep: undefined });
    try {
      const attempt = (extra: Record<string, string>) => loginHandler(new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...nextIp() },
        body: JSON.stringify({ identifier: "admin@alliedschool.edu", password: "AdminSecure2025#", ...extra }),
      }));
      const noCode = await attempt({});
      const noCodeJson = await noCode.json();
      const withCode = await attempt({ totpCode: totpAt(secret, currentStep()) });
      assert(noCode.status === 401 && noCodeJson.mfaRequired === true && withCode.status === 200, "36c. Admin 2FA: password alone is not enough; password + valid code signs in");
    } finally {
      const p2 = await getUserByEmailServer("admin@alliedschool.edu");
      await updateUserServer({ ...p2!, mfaEnabled: false, mfaSecret: undefined, mfaLastUsedStep: undefined });
      process.env.ADMIN_MFA_ENABLED = prev;
    }
  }

  // 37. Re-authentication for sensitive admin actions (flag on)
  {
    const prev = process.env.ADMIN_REAUTH_MAX_AGE_MINUTES;
    process.env.ADMIN_REAUTH_MAX_AGE_MINUTES = "15";
    try {
      const oldSession = await createSessionCookieServer({ uid: "usr-admin-1", email: "admin@alliedschool.edu", role: "ADMIN", schoolId: "allied-school-main", name: "A", authAt: Math.floor(Date.now() / 1000) - 3600 });
      const r = await payrollPost(authed(oldSession, "http://localhost:3000/api/payroll", "POST", { teacherId: "tch-1", month: "October", year: 2026, status: "PAID" }));
      const j = await r.json();
      const fresh = await payrollPost(authed(adminA, "http://localhost:3000/api/payroll", "POST", { teacherId: "tch-1", month: "October", year: 2026, status: "UNPAID" }));
      assert(r.status === 401 && j.reauthRequired === true && fresh.status === 200, "37. Re-auth: payroll change needs a sign-in within the configured window");
    } finally {
      process.env.ADMIN_REAUTH_MAX_AGE_MINUTES = prev;
    }
  }

  // 38. Firestore rules: least privilege for profiles and teacher records
  {
    const rules = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf-8");
    const usersBlock = rules.slice(rules.indexOf("match /users/{userId}"), rules.indexOf("match /students/{studentId}"));
    const teachersBlock = rules.slice(rules.indexOf("match /teachers/{teacherId}"), rules.indexOf("match /classes/{classId}"));
    // Stricter than the earlier owner-only rule: a profile holds the TOTP secret, and an owner
    // read with just the password would defeat admin 2FA. No client reads profiles at all.
    assert(/allow read:\s*if false;/.test(usersBlock) && !/allow read:\s*if (?!false)/.test(usersBlock) && !usersBlock.includes("isTeacher()") && !usersBlock.includes("isAdmin()"), "38a. Firestore rules: no client can read any profile (password hash, 2FA secret), not even its own");
    assert(teachersBlock.includes("isAdmin()") && teachersBlock.includes("callerTeacherId() == teacherId"), "38b. Firestore rules: teacher records (salary) readable by admins or the teacher only");
  }

  // 39. Errors don't leak internals
  {
    const r = await loginHandler(new NextRequest("http://localhost:3000/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", ...nextIp() }, body: "{not json" }));
    const text = await r.text();
    assert(!/at \w+ \(|node_modules|src\/|FIREBASE_|Error:/.test(text), "39. Errors: API error bodies contain no stack traces, paths or env names");
  }

  // =====================================================================
  // 40–46. RESUMED HARDENING (layout guards, strict schemas, auth-route CSRF, 2FA enrolment,
  //        email headers, no client profile reads)
  // =====================================================================

  // 40. Role layouts re-check the session server-side (middleware is not the only check)
  {
    const layouts: Array<[string, string]> = [["admin", "ADMIN"], ["teacher", "TEACHER"], ["student", "STUDENT"], ["parent", "PARENT"]];
    const allGuarded = layouts.every(([dir, role]) => {
      const src = fs.readFileSync(path.resolve(__dirname, `../src/app/${dir}/layout.tsx`), "utf-8");
      return src.includes(`requirePageRole("${role}")`) && !src.includes("getAuthenticatedUser(");
    });
    assert(allGuarded, "40a. Layouts: /admin, /teacher, /student, /parent each enforce their own role server-side");
    let redirectedTo = "";
    try {
      await requirePageRole("ADMIN");
    } catch (e) {
      redirectedTo = String((e as { digest?: string })?.digest || "");
    }
    assert(redirectedTo.includes("/login"), "40b. Layouts: no session -> redirect to /login (never renders school data)", redirectedTo);
  }

  // 41. Strict body schemas on attendance / classes / subjects
  {
    const okRecord = { studentId: "std-1", status: "PRESENT" };
    const a1 = await attendancePost(authed(adminA, "http://localhost:3000/api/attendance", "POST", { classId: "cls-10a", date: "2026-09-17", records: [okRecord], isLocked: false }));
    assert(a1.status === 400, "41a. Attendance: server-controlled lock field cannot be submitted (400)");
    const a2 = await attendancePost(authed(adminA, "http://localhost:3000/api/attendance", "POST", { classId: "cls-10a", date: "2026-09-17", records: [okRecord], surprise: 1 }));
    assert(a2.status === 400, "41b. Attendance: unknown top-level field rejected (strict schema)");
    const a3 = await attendancePost(authed(adminA, "http://localhost:3000/api/attendance", "POST", { classId: "cls-10a", date: "2026-09-17", records: [{ ...okRecord, remarks: { $gt: "" } }] }));
    assert(a3.status === 400, "41c. Attendance: non-string remarks rejected");
    const many = Array.from({ length: 501 }, () => okRecord);
    const a4 = await attendancePost(authed(adminA, "http://localhost:3000/api/attendance", "POST", { classId: "cls-10a", date: "2026-09-17", records: many }));
    assert(a4.status === 400, "41d. Attendance: oversized roster (501 records) rejected");
    const c1 = await classesPost(authed(adminA, "http://localhost:3000/api/classes", "POST", { name: "Sec 9", section: "Z", schoolId: "school-b-campus" }));
    assert(c1.status === 400, "41e. Classes: schoolId cannot be set by the client (400)");
    const c2 = await classesPost(authed(adminA, "http://localhost:3000/api/classes", "POST", { name: { toString: "x" }, section: "Z" }));
    assert(c2.status === 400, "41f. Classes: non-string name rejected");
    const s1 = await subjectsPost(authed(adminA, "http://localhost:3000/api/subjects", "POST", { name: "x".repeat(500), code: "LONG", classId: "cls-10a" }));
    assert(s1.status === 400, "41g. Subjects: oversized name rejected");
    const s2 = await subjectsPost(authed(adminA, "http://localhost:3000/api/subjects", "POST", { name: "Bio", code: "BIO", classId: "cls-10a", teacherId: { $ne: "" } }));
    assert(s2.status === 400, "41h. Subjects: object-valued teacherId rejected");
  }

  // 42. CSRF enforced inside the unauthenticated auth routes too (not only in middleware)
  {
    const evil = (url: string, body: unknown) =>
      new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json", origin: "https://evil.example", ...nextIp() }, body: JSON.stringify(body) });
    const results = await Promise.all([
      loginHandler(evil("http://localhost:3000/api/auth/login", { identifier: "admin@alliedschool.edu", password: "AdminSecure2025#" })),
      registerHandler(evil("http://localhost:3000/api/auth/register", { fullName: "X Y", email: "x@y.example", password: "LongEnough#2026x", schoolName: "Z" })),
      forgotPasswordHandler(evil("http://localhost:3000/api/auth/forgot-password", { email: "admin@alliedschool.edu" })),
      resetPasswordHandler(evil("http://localhost:3000/api/auth/reset-password", { token: "x", newPassword: "LongEnough#2026x" })),
      logoutHandler(evil("http://localhost:3000/api/auth/logout", {})),
    ]);
    assert(results.every((r) => r.status === 403), "42. CSRF: login/register/forgot/reset/logout reject cross-site POSTs in the route itself (403)", results.map((r) => r.status).join(","));
  }

  // 43. CSRF_TRUSTED_ORIGINS adds to NEXT_PUBLIC_APP_URL instead of replacing it
  {
    const env = { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://school.example.com", CSRF_TRUSTED_ORIGINS: "https://admin.example.com" };
    const check = (origin: string) =>
      isCrossSiteStateChange({ method: "POST", url: "https://internal.example.net/api/fees", headers: new Headers({ origin }) }, env);
    assert(
      check("https://school.example.com") === false && check("https://admin.example.com") === false && check("https://evil.example") === true,
      "43. CSRF: both the app URL and the extra trusted origins are accepted; others rejected"
    );
  }

  // 44. Enrolling an admin authenticator needs the current password (a stolen session alone can't)
  {
    const prevFlag = process.env.ADMIN_MFA_ENABLED;
    process.env.ADMIN_MFA_ENABLED = "true";
    const original = await getUserByEmailServer("admin@alliedschool.edu");
    const testPassword = "Enrol-Check#2026-local";
    await updateUserServer({ ...original!, passwordHash: bcrypt.hashSync(testPassword, 4), mfaEnabled: false, mfaSecret: undefined, mfaPendingSecret: undefined, mfaLastUsedStep: undefined });
    try {
      const setup = await mfaPost(authed(adminA, "http://localhost:3000/api/auth/mfa", "POST", { action: "setup" }));
      const { secret } = await setup.json();
      const code = () => totpAt(secret, currentStep());
      const noPw = await mfaPost(authed(adminA, "http://localhost:3000/api/auth/mfa", "POST", { action: "enable", code: code() }));
      const badPw = await mfaPost(authed(adminA, "http://localhost:3000/api/auth/mfa", "POST", { action: "enable", code: code(), password: "wrong-password-123" }));
      const afterFail = await getUserByEmailServer("admin@alliedschool.edu");
      const good = await mfaPost(authed(adminA, "http://localhost:3000/api/auth/mfa", "POST", { action: "enable", code: code(), password: testPassword }));
      const goodJson = await good.json();
      assert(
        setup.status === 200 && noPw.status === 400 && badPw.status === 400 && !afterFail?.mfaEnabled && good.status === 200 && goodJson.enrolled === true,
        "44. 2FA enrolment: code alone or a wrong password is refused; code + current password enrols",
        [setup.status, noPw.status, badPw.status, good.status].join(",")
      );
    } finally {
      await updateUserServer({ ...original!, mfaEnabled: false, mfaSecret: undefined, mfaPendingSecret: undefined, mfaLastUsedStep: undefined });
      process.env.ADMIN_MFA_ENABLED = prevFlag;
    }
  }

  // 45. Email header values cannot carry CR/LF (header injection)
  {
    const v = headerSafe("Reset your School\r\nBcc: attacker@evil.example password");
    assert(!/[\r\n]/.test(v), "45. Email: CR/LF stripped from header values (subject/recipient)");
  }

  // 46. The browser never reads user profiles (password hash, 2FA secret) from Firestore
  {
    const ctx = fs.readFileSync(path.resolve(__dirname, "../src/lib/firebase/auth-context.tsx"), "utf-8");
    assert(!/doc\(\s*db\s*,\s*["']users["']/.test(ctx) && ctx.includes("/api/auth/me"), "46. Client: profile comes from the sanitised /api/auth/me, never a Firestore users/ read");
  }

  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
