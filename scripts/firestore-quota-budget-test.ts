/**
 * Firestore read/write budget test. Runs every main flow of the app against the LOCAL Firestore
 * emulator with a realistic seeded school (scripts/lib/quota-seed.ts), counts the billable
 * document reads/writes each flow causes (scripts/lib/firestore-op-counter.ts) and fails if a
 * flow exceeds its budget — so a future change cannot quietly bring back the reads that used to
 * exhaust the Spark plan's 50K reads/day.
 *
 *   npm run test:quota          (starts the emulator via firebase-tools, then runs this file)
 *
 * Env:
 *   QUOTA_REPORT_ONLY=1  print the table without enforcing budgets
 *   QUOTA_JSON_OUT=path  also write the measured numbers as JSON
 *   QUOTA_SNAPSHOT_OUT=path  also write the computed dashboard/report/fee figures (to compare runs)
 *
 * Every flow is measured "cold" (server caches emptied first), i.e. as a fresh serverless
 * instance would serve it. The two "One-time" flows are the first dashboard / student page after
 * this change is deployed: they build the attendance summary documents from the existing records
 * once; every later load reads the summaries instead.
 *
 * Safety: refuses to run unless FIRESTORE_EMULATOR_HOST is set and the project id starts with
 * "demo-" (the emulator never touches a real project then). No real credentials are used.
 */
import fs from "fs";
import path from "path";
import { prepareEmulatorEnv } from "./lib/emulator-env";

prepareEmulatorEnv();

type Budget = { reads: number; writes: number };
type Row = { flow: string; reads: number; writes: number; warmReads?: number; budget?: Budget; ok: boolean; note?: string };

async function main() {
  const { installFirestoreOpCounter, measure } = await import("./lib/firestore-op-counter");
  installFirestoreOpCounter();
  const { NextRequest } = await import("next/server");
  const { adminDb } = await import("../src/lib/firebase/admin");
  const { seedQuotaSchool, ids, SCHOOL, PASSWORD } = await import("./lib/quota-seed");
  const { createSessionCookieServer, getAuthenticatedUser } = await import("../src/lib/firebase/server-auth");
  const { loadAdminShellData, loadTeacherShellData, loadStudentShellData } = await import("../src/lib/layout-data");
  const { resetServerCaches } = await import("../src/lib/server-cache");

  const routes = {
    login: await import("../src/app/api/auth/login/route"),
    me: await import("../src/app/api/auth/me/route"),
    dashboard: await import("../src/app/api/dashboard/route"),
    settings: await import("../src/app/api/settings/route"),
    students: await import("../src/app/api/students/route"),
    teachers: await import("../src/app/api/teachers/route"),
    classes: await import("../src/app/api/classes/route"),
    fees: await import("../src/app/api/fees/route"),
    account: await import("../src/app/api/fees/student-account/route"),
    attendance: await import("../src/app/api/attendance/route"),
    reports: await import("../src/app/api/reports/route"),
    timetable: await import("../src/app/api/timetable/route"),
    audit: await import("../src/app/api/audit/route"),
    announcements: await import("../src/app/api/announcements/route"),
    exams: await import("../src/app/api/exams/route"),
    studentMe: await import("../src/app/api/student/me/route"),
    parentChildren: await import("../src/app/api/parent/children/route"),
    parentChild: await import("../src/app/api/parent/child/[id]/route"),
  };

  console.log("Seeding emulator...");
  const { attendanceDays } = await seedQuotaSchool(adminDb);
  const today = attendanceDays[0];

  let ip = 1;
  const BASE = "http://localhost:3000";
  const req = (token: string | null, url: string, method = "GET", body?: unknown) => {
    const headers = new Headers({ "x-forwarded-for": `10.88.${Math.floor(ip / 250)}.${ip++ % 250}` });
    if (token) headers.set("cookie", `allied_session=${token}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    return new NextRequest(BASE + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  };

  // Session cookies have a 5-minute idle lifetime, so fresh ones are minted before every flow.
  const tokens = { admin: "", teacher: "", student: "", parent: "" };
  const mintTokens = async () => {
    tokens.admin = await createSessionCookieServer({ uid: ids.admin.uid, email: ids.admin.email, role: "ADMIN", schoolId: SCHOOL, name: "Admin" });
    tokens.teacher = await createSessionCookieServer({
      uid: ids.teacher.uid, email: ids.teacher.email, role: "TEACHER", schoolId: SCHOOL, name: "Teacher 0", teacherId: ids.teacher.teacherId,
    });
    tokens.student = await createSessionCookieServer({
      uid: ids.student.uid, email: ids.student.email, role: "STUDENT", schoolId: SCHOOL, name: "Student 0", studentId: ids.student.studentId,
    });
    tokens.parent = await createSessionCookieServer({
      uid: ids.parent.uid, email: ids.parent.email, role: "PARENT", schoolId: SCHOOL, name: "Parent", studentIds: ids.parent.studentIds,
    });
  };
  await mintTokens();
  const sessionOf = async (token: string) => (await getAuthenticatedUser(req(token, "/admin")))!;

  const failures: string[] = [];
  const expectOk = async (label: string, p: Promise<Response> | Response) => {
    const res = await p;
    if (res.status !== 200) failures.push(`${label} -> HTTP ${res.status}`);
    return res;
  };
  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

  // Page views = server layout (session check + layout data) + the API calls the page makes on load.
  const adminPage = async (...apis: Array<() => Promise<Response> | Response>) => {
    const s = await sessionOf(tokens.admin);
    await loadAdminShellData(s.schoolId);
    await expectOk("admin header /api/settings", routes.settings.GET(req(tokens.admin, "/api/settings")));
    for (const api of apis) await expectOk("admin api", api());
  };
  const teacherPage = async (...apis: Array<() => Promise<Response> | Response>) => {
    const s = await sessionOf(tokens.teacher);
    await loadTeacherShellData(s);
    for (const api of apis) await expectOk("teacher api", api());
  };
  const studentPage = async (...apis: Array<() => Promise<Response> | Response>) => {
    const s = await sessionOf(tokens.student);
    await loadStudentShellData(s);
    for (const api of apis) await expectOk("student api", api());
  };
  const parentPage = async (...apis: Array<() => Promise<Response> | Response>) => {
    await sessionOf(tokens.parent);
    for (const api of apis) await expectOk("parent api", api());
  };
  const loginAs = (email: string) => async () => {
    await expectOk(`login ${email}`, routes.login.POST(req(null, "/api/auth/login", "POST", { identifier: email, password: PASSWORD })));
  };

  // Getters, so every flow uses the tokens minted just before it.
  const tk = {
    get A() { return tokens.admin; },
    get T() { return tokens.teacher; },
    get S() { return tokens.student; },
    get P() { return tokens.parent; },
  };
  const cls0 = ids.classIds[0];

  const flows: Array<{ name: string; run: () => Promise<void>; budget?: Budget }> = [
    { name: "Login: Admin", run: loginAs(ids.admin.email) },
    { name: "Login: Teacher", run: loginAs(ids.teacher.email) },
    { name: "Login: Student", run: loginAs(ids.student.email) },
    { name: "Login: Parent", run: loginAs(ids.parent.email) },
    { name: "Session check (any authenticated API call)", run: async () => { await sessionOf(tk.A); } },
    { name: "/api/auth/me keep-alive", run: async () => { await expectOk("me", routes.me.GET(req(tk.A, "/api/auth/me"))); } },
    {
      name: "One-time: first admin dashboard after deploy (builds 31 daily attendance summaries)",
      run: () => adminPage(() => routes.dashboard.GET(req(tk.A, "/api/dashboard"))),
    },
    { name: "Admin: dashboard", run: () => adminPage(() => routes.dashboard.GET(req(tk.A, "/api/dashboard"))) },
    { name: "Admin: page refresh (layout + header only)", run: () => adminPage() },
    {
      name: "Admin: students list",
      run: () => adminPage(() => routes.classes.GET(req(tk.A, "/api/classes")), () => routes.students.GET(req(tk.A, "/api/students"))),
    },
    { name: "Admin: teachers list", run: () => adminPage(() => routes.teachers.GET(req(tk.A, "/api/teachers?search="))) },
    { name: "Admin: fees page", run: () => adminPage(() => routes.fees.GET(req(tk.A, "/api/fees?"))) },
    {
      name: "Admin: fees search (1 request, as sent by the debounced search box)",
      run: async () => {
        await expectOk("fees search", routes.fees.GET(req(tk.A, `/api/fees?search=${encodeURIComponent("student 01")}`)));
      },
    },
    {
      name: "Admin: fees search (8 requests, one per keystroke as the old page did)",
      run: async () => {
        for (const q of ["s", "st", "stu", "stud", "stude", "studen", "student", "student 0"]) {
          await expectOk("fees search", routes.fees.GET(req(tk.A, `/api/fees?search=${encodeURIComponent(q)}`)));
        }
      },
    },
    {
      name: "Admin: Student Fee Account tab",
      run: () => adminPage(
        () => routes.students.GET(req(tk.A, `/api/students?classId=${cls0}&limit=250`)),
        () => routes.account.GET(req(tk.A, `/api/fees/student-account?studentId=std-0&year=2026`))
      ),
    },
    {
      name: "Admin: attendance",
      run: () => adminPage(
        () => routes.classes.GET(req(tk.A, "/api/classes")),
        () => routes.attendance.GET(req(tk.A, `/api/attendance?classId=${cls0}&date=${today}`))
      ),
    },
    { name: "Admin: reports", run: () => adminPage(() => routes.reports.GET(req(tk.A, "/api/reports"))) },
    {
      name: "Admin: timetable",
      run: () => adminPage(
        () => routes.classes.GET(req(tk.A, "/api/classes")),
        () => routes.teachers.GET(req(tk.A, "/api/teachers")),
        () => routes.timetable.GET(req(tk.A, "/api/timetable"))
      ),
    },
    { name: "Admin: audit log", run: () => adminPage(() => routes.audit.GET(req(tk.A, "/api/audit"))) },
    { name: "Admin: announcements", run: () => adminPage(() => routes.announcements.GET(req(tk.A, "/api/announcements"))) },
    {
      name: "Teacher: dashboard",
      run: () => teacherPage(
        () => routes.classes.GET(req(tk.T, "/api/classes")),
        () => routes.timetable.GET(req(tk.T, "/api/timetable?dayOfWeek=Monday"))
      ),
    },
    {
      name: "Teacher: attendance",
      run: () => teacherPage(
        () => routes.classes.GET(req(tk.T, "/api/classes")),
        () => routes.attendance.GET(req(tk.T, `/api/attendance?classId=${cls0}&date=${today}`))
      ),
    },
    {
      name: "Teacher: mark attendance (30 students)",
      run: async () => {
        const records = Array.from({ length: 30 }, (_, i) => ({ studentId: `std-${i * 10}`, status: i % 7 === 0 ? "ABSENT" : "PRESENT" }));
        await expectOk("attendance save", routes.attendance.POST(req(tk.T, "/api/attendance", "POST", { classId: cls0, date: today, records })));
      },
    },
    {
      name: "Admin: exams / gradebook (selected schedule)",
      run: () => adminPage(
        () => routes.classes.GET(req(tk.A, "/api/classes")),
        () => routes.exams.GET(req(tk.A, "/api/exams?rosters=one"))
      ),
    },
    { name: "Teacher: gradebook", run: () => teacherPage(() => routes.exams.GET(req(tk.T, "/api/exams?rosters=one"))) },
    {
      name: "Teacher: students",
      run: () => teacherPage(
        () => routes.classes.GET(req(tk.T, "/api/classes")),
        () => routes.students.GET(req(tk.T, `/api/students?classId=${cls0}`))
      ),
    },
    {
      name: "One-time: first student page after deploy (builds the student's attendance totals)",
      run: () => studentPage(() => routes.studentMe.GET(req(tk.S, "/api/student/me?view=dashboard"))),
    },
    { name: "Student: dashboard", run: () => studentPage(() => routes.studentMe.GET(req(tk.S, "/api/student/me?view=dashboard"))) },
    {
      name: "Student: fees",
      run: () => studentPage(
        () => routes.studentMe.GET(req(tk.S, "/api/student/me?view=fees")),
        () => routes.account.GET(req(tk.S, "/api/fees/student-account?year=2026"))
      ),
    },
    { name: "Student: results", run: () => studentPage(() => routes.studentMe.GET(req(tk.S, "/api/student/me?view=results"))) },
    { name: "Student: attendance", run: () => studentPage(() => routes.studentMe.GET(req(tk.S, "/api/student/me?view=attendance"))) },
    { name: "Student: timetable", run: () => studentPage(() => routes.timetable.GET(req(tk.S, "/api/timetable"))) },
    {
      name: "Parent: dashboard",
      run: () => parentPage(
        () => routes.parentChildren.GET(req(tk.P, "/api/parent/children")),
        () => routes.parentChild.GET(req(tk.P, "/api/parent/child/std-0"), params({ id: "std-0" }))
      ),
    },
  ];

  const budgetFile = path.join(__dirname, "lib", "quota-budgets.json");
  const budgets: Record<string, Budget> = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, "utf-8")) : {};
  const reportOnly = process.env.QUOTA_REPORT_ONLY === "1";

  const rows: Row[] = [];
  for (const flow of flows) {
    // Each flow is measured cold (empty server caches), the way a fresh serverless instance
    // serves it — the worst case, not the cached best case.
    resetServerCaches();
    await mintTokens();
    const { ops } = await measure(flow.run);
    // The same flow again on the now-warm instance (caches filled, within their TTL): the
    // typical cost while the app is in use. Reported, not budgeted.
    const { ops: warm } = await measure(flow.run);
    const budget = budgets[flow.name];
    const ok = reportOnly || !budget || (ops.reads <= budget.reads && ops.writes <= budget.writes);
    const top = Object.entries(ops.readsByCollection).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([c, n]) => `${c}:${n}`).join(" ");
    rows.push({ flow: flow.name, reads: ops.reads, writes: ops.writes, warmReads: warm.reads, budget, ok, note: top });
  }

  // Optional: response snapshots of the computed figures, to compare results before/after a change.
  if (process.env.QUOTA_SNAPSHOT_OUT) {
    resetServerCaches();
    const body = async (p: Promise<Response> | Response) => (await p).json();
    const snapshot = {
      dashboard: await body(routes.dashboard.GET(req(tk.A, "/api/dashboard"))),
      reports: await body(routes.reports.GET(req(tk.A, "/api/reports"))),
      fees: await body(routes.fees.GET(req(tk.A, "/api/fees?"))),
      feesClass0Unpaid: await body(routes.fees.GET(req(tk.A, `/api/fees?classId=${cls0}&status=UNPAID`))),
      classes: await body(routes.classes.GET(req(tk.A, "/api/classes"))),
      studentMe: await body(routes.studentMe.GET(req(tk.S, "/api/student/me"))),
      parentChild: await body(routes.parentChild.GET(req(tk.P, "/api/parent/child/std-0"), params({ id: "std-0" }))),
      parentChildren: await body(routes.parentChildren.GET(req(tk.P, "/api/parent/children"))),
      adminShell: await loadAdminShellData(SCHOOL),
    };
    fs.writeFileSync(process.env.QUOTA_SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2));
  }

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log("\n" + pad("Flow (cold = fresh server instance)", 92) + pad("Reads", 8) + pad("Writes", 8) + pad("Warm R", 8) + pad("Budget R/W", 12) + "Top collections (cold)");
  console.log("-".repeat(160));
  for (const r of rows) {
    console.log(
      pad(r.flow, 92) + pad(r.reads, 8) + pad(r.writes, 8) + pad(r.warmReads ?? "-", 8) + pad(r.budget ? `${r.budget.reads}/${r.budget.writes}` : "-", 12) +
        (r.ok ? "" : "OVER BUDGET  ") + (r.note || "")
    );
  }
  if (process.env.QUOTA_JSON_OUT) fs.writeFileSync(process.env.QUOTA_JSON_OUT, JSON.stringify(rows, null, 2));

  let failed = 0;
  for (const f of failures) {
    console.error(`[FAIL] ${f}`);
    failed++;
  }
  for (const r of rows) {
    if (!r.ok) {
      console.error(`[FAIL] ${r.flow}: ${r.reads} reads / ${r.writes} writes exceeds budget ${r.budget!.reads}/${r.budget!.writes}`);
      failed++;
    } else if (r.budget && !reportOnly) {
      console.log(`[PASS] ${r.flow}: ${r.reads} reads <= ${r.budget.reads}, ${r.writes} writes <= ${r.budget.writes}`);
    }
  }
  if (!reportOnly) {
    const missing = rows.filter((r) => !r.budget).map((r) => r.flow);
    for (const m of missing) {
      console.error(`[FAIL] no budget defined for flow "${m}"`);
      failed++;
    }
  }
  console.log(`\nFlows: ${rows.length}, HTTP failures: ${failures.length}, failed checks: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
