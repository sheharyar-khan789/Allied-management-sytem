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
