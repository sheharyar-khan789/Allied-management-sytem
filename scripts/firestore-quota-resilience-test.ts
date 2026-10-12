/**
 * Behaviour when Firestore is out of quota or flaky, session revocation with the profile cache,
 * and the login → /admin hand-off. Runs against the LOCAL Firestore + Auth emulators
 * (npm run test:quota); faults are injected in-process (scripts/lib/firestore-op-counter.ts), so
 * no real project is involved.
 */
import { prepareEmulatorEnv } from "./lib/emulator-env";

prepareEmulatorEnv();

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

async function main() {
  const counter = await import("./lib/firestore-op-counter");
  counter.installFirestoreOpCounter();
  const { injectFirestoreFault, grpcError, measure } = counter;
  const { NextRequest } = await import("next/server");
  const { adminDb, adminAuth } = await import("../src/lib/firebase/admin");
  const { seedQuotaSchool, ids, SCHOOL, PASSWORD } = await import("./lib/quota-seed");
  const serverAuth = await import("../src/lib/firebase/server-auth");
  const { createSessionCookieServer, getAuthenticatedUser } = serverAuth;
  const db = await import("../src/lib/firebase/server-db");
  const { resetServerCaches } = await import("../src/lib/server-cache");
  const { SERVICE_BUSY_MESSAGE, ServiceUnavailableError } = await import("../src/lib/firebase/firestore-errors");
  const { syncLoginActive } = await import("../src/lib/account-status");
  const { middleware } = await import("../src/middleware");
  const login = await import("../src/app/api/auth/login/route");
  const me = await import("../src/app/api/auth/me/route");
  const logout = await import("../src/app/api/auth/logout/route");
  const changePassword = await import("../src/app/api/auth/change-password/route");
  const dashboard = await import("../src/app/api/dashboard/route");
  const attendance = await import("../src/app/api/attendance/route");

  console.log("Seeding emulator...");
  const { attendanceDays } = await seedQuotaSchool(adminDb);

  let ipN = 1;
  const BASE = "http://localhost:3000";
  const req = (token: string | null, url: string, method = "GET", body?: unknown, ip?: string) => {
    const headers = new Headers({ "x-forwarded-for": ip || `10.99.${Math.floor(ipN / 250)}.${ipN++ % 250}` });
    if (token) headers.set("cookie", `allied_session=${token}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    return new NextRequest(BASE + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  };
  const loginReq = (email: string, password: string, ip?: string) =>
    login.POST(req(null, "/api/auth/login", "POST", { identifier: email, password }, ip));
  const cookieFrom = (res: Response) => /allied_session=([^;]+)/.exec(res.headers.get("set-cookie") || "")?.[1] || "";

  const quotaError = () => grpcError(8, "RESOURCE_EXHAUSTED", "Quota exceeded.");
  const unavailableError = () => grpcError(14, "UNAVAILABLE", "No connection established.");
  const deadlineError = () => grpcError(4, "DEADLINE_EXCEEDED", "Deadline exceeded.");
  const usersReads = (kind: string, col: string) => col === "users";

  async function captureErrors<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const lines: string[] = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    try {
      return { result: await fn(), lines };
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 1. RESOURCE_EXHAUSTED during login: 503 + clear message, no retry, no lockout.
  // ---------------------------------------------------------------------------------------------
  {
    resetServerCaches();
    const fault = injectFirestoreFault({ match: usersReads, makeError: quotaError });
    const sameIp = "10.50.0.1";
    const statuses: number[] = [];
    const bodies: any[] = [];
    // 11 attempts from one IP for one account: more than ACCOUNT_MAX_FAILURES (5) and the per-IP
    // limit (10), so any of them being counted as a failure would lock the account/IP.
    const { lines } = await captureErrors(async () => {
      for (let i = 0; i < 11; i++) {
        const res = await loginReq(ids.admin.email, PASSWORD, sameIp);
        statuses.push(res.status);
        bodies.push(await res.json());
      }
    });
    fault.remove();
    assert(statuses.every((s) => s === 503), `login returns 503 while Firestore is out of quota (got ${[...new Set(statuses)].join(",")})`);
    assert(bodies.every((b) => b.error === SERVICE_BUSY_MESSAGE && b.serviceBusy === true), `503 body says "${SERVICE_BUSY_MESSAGE}"`);
    assert(!bodies.some((b) => /Authentication service error/i.test(b.error || "")), "no 'Authentication service error' message");
    assert(fault.calls === 11, `RESOURCE_EXHAUSTED is not retried (1 users read per attempt, got ${fault.calls} for 11 attempts)`);
    assert(lines.some((l) => l.includes("FIRESTORE_QUOTA_EXCEEDED")), "server log line is tagged FIRESTORE_QUOTA_EXCEEDED");
    const after = await loginReq(ids.admin.email, PASSWORD, sameIp);
    assert(after.status === 200, `after the quota returns, the same account and IP can sign in (not locked): HTTP ${after.status}`);
  }

  // ---------------------------------------------------------------------------------------------
  // 2. Transient errors (UNAVAILABLE / DEADLINE_EXCEEDED): short retry, max 2 retries.
  // ---------------------------------------------------------------------------------------------
  {
    resetServerCaches();
    let fault = injectFirestoreFault({ match: usersReads, makeError: unavailableError, times: 2 });
    const res = await captureErrors(() => loginReq(ids.teacher.email, PASSWORD));
    fault.remove();
    assert(res.result.status === 200 && fault.calls === 3, `UNAVAILABLE twice then OK: login succeeds after 2 retries (HTTP ${res.result.status}, ${fault.calls} attempts)`);

    fault = injectFirestoreFault({ match: usersReads, makeError: unavailableError, times: 3 });
    const res2 = await captureErrors(() => loginReq(ids.teacher.email, PASSWORD));
    fault.remove();
    assert(res2.result.status === 503 && fault.calls === 3, `UNAVAILABLE 3 times: gives up after 2 retries with 503 (HTTP ${res2.result.status}, ${fault.calls} attempts)`);
    assert(res2.lines.some((l) => l.includes("FIRESTORE_UNAVAILABLE")), "transient outage is logged as FIRESTORE_UNAVAILABLE");

    fault = injectFirestoreFault({ match: usersReads, makeError: deadlineError, times: 1 });
    const res3 = await captureErrors(() => loginReq(ids.teacher.email, PASSWORD));
    fault.remove();
    assert(res3.result.status === 200 && fault.calls === 2, `DEADLINE_EXCEEDED once: retried and succeeds (HTTP ${res3.result.status}, ${fault.calls} attempts)`);
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Authenticated APIs under quota exhaustion: 503 (not 401 → client would sign the user out).
  // ---------------------------------------------------------------------------------------------
  const adminToken = await createSessionCookieServer({ uid: ids.admin.uid, email: ids.admin.email, role: "ADMIN", schoolId: SCHOOL, name: "Admin" });
  {
    resetServerCaches();
    const fault = injectFirestoreFault({ match: () => true, makeError: quotaError });
    const { result } = await captureErrors(async () => ({
      dash: await dashboard.GET(req(adminToken, "/api/dashboard")),
      me: await me.GET(req(adminToken, "/api/auth/me")),
      thrown: await getAuthenticatedUser(req(adminToken, "/api/x")).then(() => null, (e) => e),
    }));
    fault.remove();
    const dashBody = await result.dash.json();
    assert(result.dash.status === 503 && dashBody.error === SERVICE_BUSY_MESSAGE, `/api/dashboard returns 503 "${SERVICE_BUSY_MESSAGE}" (HTTP ${result.dash.status})`);
    assert(result.me.status === 503, `/api/auth/me returns 503, not 401, so the browser does not log the user out (HTTP ${result.me.status})`);
    assert(result.thrown instanceof ServiceUnavailableError, "session check throws ServiceUnavailableError instead of treating the session as revoked");

    // Session check fine (cached), but the dashboard's own aggregates hit the quota.
    resetServerCaches();
    await getAuthenticatedUser(req(adminToken, "/api/x"));
    const fault2 = injectFirestoreFault({ match: (kind) => kind === "aggregate", makeError: quotaError });
    const { result: dash2 } = await captureErrors(() => dashboard.GET(req(adminToken, "/api/dashboard")));
    fault2.remove();
    assert(dash2.status === 503, `dashboard aggregates out of quota → 503 instead of a dashboard of zeros (HTTP ${dash2.status})`);
  }

  // ---------------------------------------------------------------------------------------------
  // 4. Login → /admin hand-off (no bounce back to /login).
  // ---------------------------------------------------------------------------------------------
  {
    resetServerCaches();
    const res = await loginReq(ids.admin.email, PASSWORD);
    const body = await res.json();
    const token = cookieFrom(res);
    assert(res.status === 200 && body.redirectUrl === "/admin" && token.length > 20, "login sets the session cookie and points to /admin");
    const mw = await middleware(new NextRequest(`${BASE}/admin`, { headers: { cookie: `allied_session=${token}` } }));
    assert(!mw.headers.get("location"), `middleware lets the fresh cookie through to /admin (no redirect; got ${mw.headers.get("location") || "none"})`);
    const session = await getAuthenticatedUser(req(token, "/admin"));
    assert(session?.uid === ids.admin.uid, "the server-side session check (admin layout) accepts the cookie immediately after login");
    const { ops } = await measure(async () => {
      await getAuthenticatedUser(req(token, "/admin"));
      await getAuthenticatedUser(req(token, "/api/dashboard"));
    });
    assert(ops.reads === 0, `layout + API session checks right after login reuse the cached profile (${ops.reads} extra reads)`);

    // Why the old code looped: /login with a valid cookie redirects to /admin; if the /admin
    // layout then treated a quota error as "signed out" and redirected to /login, the two bounced.
    const mwLogin = await middleware(new NextRequest(`${BASE}/login`, { headers: { cookie: `allied_session=${token}` } }));
    assert((mwLogin.headers.get("location") || "").endsWith("/admin"), "middleware sends a signed-in user from /login to /admin");
    resetServerCaches();
    const fault = injectFirestoreFault({ match: usersReads, makeError: quotaError });
    const outcome = await captureErrors(() => getAuthenticatedUser(req(token, "/admin")).then((u) => (u ? "user" : "null"), (e) => e));
    fault.remove();
    assert(
      outcome.result instanceof ServiceUnavailableError,
      "with Firestore out of quota the layout's session check throws (→ 'temporarily busy' page) instead of returning null (→ redirect to /login → bounce)"
    );
  }

  // ---------------------------------------------------------------------------------------------
  // 5. Profile cache invalidation: revocations take effect on the very next request.
  // ---------------------------------------------------------------------------------------------
  const tokenFor = (uid: string, email: string, role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT", extra: Record<string, unknown> = {}) =>
    createSessionCookieServer({ uid, email, role, schoolId: SCHOOL, name: uid, ...extra });
  const accepted = async (token: string) => (await getAuthenticatedUser(req(token, "/api/x")))?.uid || null;
  resetServerCaches();
  {
    // Logout revokes this session id.
    const t = await tokenFor("u-tch-1", "teacher1@quota.test", "TEACHER", { teacherId: "tch-1" });
    assert((await accepted(t)) === "u-tch-1", "teacher session accepted (profile now cached)");
    const out = await logout.POST(req(t, "/api/auth/logout", "POST"));
    assert(out.status === 200, "logout succeeds");
    assert((await accepted(t)) === null, "after logout the same cookie is rejected immediately (cache dropped)");
  }
  {
    // Password change signs out older sessions (other devices); the caller gets a fresh cookie.
    await adminAuth.createUser({ uid: "u-tch-2", email: "teacher2@quota.test", password: PASSWORD }).catch(() => undefined);
    const other = await tokenFor("u-tch-2", "teacher2@quota.test", "TEACHER", { teacherId: "tch-2", authAt: Math.floor(Date.now() / 1000) - 120 });
    const caller = await tokenFor("u-tch-2", "teacher2@quota.test", "TEACHER", { teacherId: "tch-2", authAt: Math.floor(Date.now() / 1000) - 60 });
    assert((await accepted(other)) === "u-tch-2", "second device session accepted (profile cached)");
    const res = await changePassword.POST(
      req(caller, "/api/auth/change-password", "POST", { currentPassword: PASSWORD, newPassword: "N3w-Quota#Pass-2026" })
    );
    const fresh = cookieFrom(res);
    assert(res.status === 200 && fresh.length > 20, `password change succeeds (HTTP ${res.status})`);
    assert((await accepted(other)) === null, "after a password change the other device's session is rejected immediately");
    assert((await accepted(fresh)) === "u-tch-2", "the re-issued session keeps working");
  }
  {
    // Role change.
    const t = await tokenFor("u-tch-3", "teacher3@quota.test", "TEACHER", { teacherId: "tch-3" });
    assert((await accepted(t)) === "u-tch-3", "session accepted before role change (profile cached)");
    const profile = await db.getUserByIdServer("u-tch-3");
    await db.updateUserServer({ ...profile!, role: "STUDENT" });
    assert((await accepted(t)) === null, "after a role change the old session is rejected immediately");
  }
  {
    // Deactivation (student archived → login deactivated).
    await adminAuth.createUser({ uid: "u-std-5", email: "student5@quota.test", password: PASSWORD }).catch(() => undefined);
    const t = await tokenFor("u-std-5", "student5@quota.test", "STUDENT", { studentId: "std-5" });
    assert((await accepted(t)) === "u-std-5", "student session accepted before deactivation (profile cached)");
    await syncLoginActive("u-std-5", SCHOOL, false);
    assert((await accepted(t)) === null, "after deactivation the session is rejected immediately");
  }
  {
    // A change made by ANOTHER server instance (simulated: a direct write that bypasses this
    // instance's cache) is picked up when the cached profile expires (TTL 30s).
    const t = await tokenFor("u-tch-4", "teacher4@quota.test", "TEACHER", { teacherId: "tch-4" });
    assert((await accepted(t)) === "u-tch-4", "session accepted (profile cached)");
    await adminDb.collection("users").doc("u-tch-4").set({ status: "INACTIVE" }, { merge: true });
    assert((await accepted(t)) === "u-tch-4", "documented trade-off: another instance's deactivation is not seen until the 30s cache entry expires");
    resetServerCaches(); // = TTL elapsed
    assert((await accepted(t)) === null, "once the cache entry expires the deactivated session is rejected");
  }

  // ---------------------------------------------------------------------------------------------
  // 6. Data caches + summaries stay correct after writes.
  // ---------------------------------------------------------------------------------------------
  {
    resetServerCaches();
    const before = (await (await dashboard.GET(req(adminToken, "/api/dashboard"))).json()).stats.totalStudents;
    await db.saveStudentServer({
      id: "std-new-1", schoolId: SCHOOL, admissionNo: "A9999", fullName: "New Student", fatherName: "F", gender: "MALE",
      classId: ids.classIds[0], section: "A", rollNo: "999", status: "ACTIVE", guardianName: "G", guardianPhone: "",
      guardianRelation: "Father", monthlyFee: 3000, discount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const after = (await (await dashboard.GET(req(adminToken, "/api/dashboard"))).json()).stats.totalStudents;
    assert(after === before + 1, `a new student shows on the dashboard right away (cached count invalidated): ${before} → ${after}`);

    // Attendance totals stay equal to a raw recount after an edit that changes statuses.
    const day = attendanceDays[2];
    const cls = ids.classIds[3];
    const roster = (await adminDb.collection("attendance").where("schoolId", "==", SCHOOL).where("date", "==", day).where("classId", "==", cls).get())
      .docs.map((d) => d.data());
    const records = roster.map((r: any, i: number) => ({ studentId: r.studentId, status: i % 2 ? "ABSENT" : "LATE" }));
    const sid = roster[1]?.studentId as string;
    // Build this student's totals first, so the edit below is applied as increments to an
    // existing summary (not just rebuilt from scratch afterwards).
    await db.getStudentAttendanceTotalsServer(SCHOOL, sid);
    const res = await attendance.POST(req(adminToken, "/api/attendance", "POST", { classId: cls, date: day, records }));
    assert(res.status === 200, `admin re-marks a past day (HTTP ${res.status})`);
    const totals = (await db.getAttendanceTotalsByClassServer(SCHOOL, day, day)).get(cls);
    const raw = (await adminDb.collection("attendance").where("schoolId", "==", SCHOOL).where("date", "==", day).where("classId", "==", cls).get())
      .docs.map((d) => d.data() as any).filter((a) => !a.subjectId);
    const rawCount = (st: string) => raw.filter((a) => a.status === st).length;
    assert(
      !!totals && ["PRESENT", "LATE", "ABSENT", "LEAVE"].every((st) => (totals as any)[st] === rawCount(st)),
      `daily attendance totals match a raw recount after the edit (${JSON.stringify(totals)})`
    );
    const studentTotals = await db.getStudentAttendanceTotalsServer(SCHOOL, sid);
    const rawStudent = (await adminDb.collection("attendance").where("schoolId", "==", SCHOOL).where("studentId", "==", sid).get())
      .docs.map((d) => d.data() as any).filter((a) => !a.subjectId);
    assert(
      ["PRESENT", "LATE", "ABSENT", "LEAVE"].every((st) => (studentTotals as any)[st] === rawStudent.filter((a) => a.status === st).length),
      `student attendance totals match a raw recount (${JSON.stringify(studentTotals)})`
    );
  }

  console.log(`\nResilience: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
