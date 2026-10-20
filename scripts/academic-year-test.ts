/**
 * Academic-year / calendar-year selection: options are generated (no fixed last year), always
 * include the configured active session and historical sessions, never create a session or
 * records just because a year is selectable, and future-dated records save normally.
 *
 * Runs against the in-memory store (tsx does not load .env.local), like the other suites here.
 */
import { NextRequest } from "next/server";
import { GET as settingsGet, PUT as settingsPut } from "../src/app/api/settings/route";
import { GET as examsGet, POST as examsPost } from "../src/app/api/exams/route";
import { POST as payrollPost, GET as payrollGet } from "../src/app/api/payroll/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getClassesServer,
  getExamsServer,
  saveClassServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import {
  academicYearOptions,
  calendarYearOptions,
  currentAcademicYear,
  isValidAcademicYear,
  parseAcademicYear,
} from "../src/lib/academic-year";
import { getDefaultAcademicYear } from "../src/lib/school-display";
import { DEFAULT_GRADING_SCALE } from "../src/lib/exam-results";

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

let ipCounter = 1;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("ACADEMIC YEAR / CALENDAR YEAR SELECTION");
  console.log("==================================================");

  // ------------------------------------------------------------ pure option generation
  // Fixed reference dates, so the suite gives the same answer whatever day it runs.
  const oct2026 = new Date(2026, 9, 20);
  const may2027 = new Date(2027, 4, 1);
  {
    assert(currentAcademicYear(oct2026) === "2026-2027", "Current session for Oct 2026 is 2026-2027");
    assert(currentAcademicYear(may2027) === "2026-2027", "Before the start month the previous session is still current");
    assert(getDefaultAcademicYear(oct2026) === currentAcademicYear(oct2026) && getDefaultAcademicYear(may2027) === currentAcademicYear(may2027), "Server default and selector use the same rule");

    const opts = academicYearOptions({ referenceDate: oct2026 });
    assert(opts.includes("2029-2030") && opts.includes("2030-2031"), "Options no longer stop at 2029-2030");
    assert(opts.includes("2036-2037") && opts.includes("2041-2042"), "Options reach 10 and 15 years ahead");
    assert(opts.includes("2021-2022"), "Options include recent historical sessions");
    assert(opts.every((o, i) => i === 0 || parseAcademicYear(o)! === parseAcademicYear(opts[i - 1])! + 1), "Options are consecutive and oldest first");

    const far = academicYearOptions({ referenceDate: new Date(2045, 9, 1) });
    assert(far.includes("2060-2061"), "Options move with the calendar (no hardcoded end year)");

    const withHistoric = academicYearOptions({ referenceDate: oct2026, include: ["2012-2013"] });
    assert(withHistoric.includes("2012-2013") && withHistoric.indexOf("2012-2013") === 0, "A configured historical session outside the window is still selectable");
    const withFarFuture = academicYearOptions({ referenceDate: oct2026, include: ["2055-2056"] });
    assert(withFarFuture[withFarFuture.length - 1] === "2055-2056", "A configured far-future session is still selectable");
    assert(academicYearOptions({ referenceDate: oct2026, include: ["2026-2027"] }).filter((o) => o === "2026-2027").length === 1, "The active session is not duplicated");
    assert(!academicYearOptions({ referenceDate: oct2026, include: ["Summer Camp", "2030-2035"] }).some((o) => o === "Summer Camp" || o === "2030-2035"), "Invalid include values are ignored");

    assert(isValidAcademicYear("2040-2041") && !isValidAcademicYear("2040-2045") && !isValidAcademicYear("2040") && !isValidAcademicYear(""), "Validation: consecutive YYYY-YYYY only");

    const cal = calendarYearOptions({ referenceDate: oct2026 });
    assert(cal.includes(2021) && cal.includes(2036) && cal.includes(2041), "Calendar years: 5 back through 15 ahead");
    assert(calendarYearOptions({ referenceDate: oct2026, include: [2001] })[0] === 2001, "Calendar years: a selected historical year stays selectable");
    assert(calendarYearOptions({ referenceDate: oct2026, futureYears: 1 }).slice(-1)[0] === 2027, "Calendar years: a screen can narrow the future window explicitly");
  }

  // ------------------------------------------------------------ API: sessions & records
  const now = new Date().toISOString();
  const S = "school-ayr";
  const HISTORIC = "2019-2020";
  await updateSchoolSettingsServer({
    id: S, schoolId: S, schoolName: "AYR School", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@ayr.edu", principalName: "Head", academicYear: HISTORIC,
    gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
  } as any);
  await saveClassServer({
    id: "cls-ayr-hist", schoolId: S, name: "Class 5", section: "A", numericLevel: 5, capacity: 30,
    classTeacherId: null, academicYear: HISTORIC, createdAt: now, updatedAt: now,
  });
  await saveTeacherServer({
    id: "tch-ayr", schoolId: S, employeeId: "E1", fullName: "T", email: "t@ayr.edu", phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 0, createdAt: now, updatedAt: now,
  });
  const ADMIN = await createSessionCookieServer({ uid: "uid-ayr-admin", email: "a@ayr.edu", role: "ADMIN", schoolId: S, name: "A" });
  const TEACHER = await createSessionCookieServer({ uid: "uid-ayr-t", email: "t@ayr.edu", role: "TEACHER", schoolId: S, name: "T", teacherId: "tch-ayr" });

  const g = await json(await settingsGet(req(ADMIN, "/api/settings")));
  assert(g.settings?.academicYear === HISTORIC, "Settings: a configured historical session is reported as-is (not replaced by today's)");

  const examsBefore = (await getExamsServer(S, { allSessions: true })).length;
  const classesBefore = (await getClassesServer(S, { allSessions: true })).length;

  assert((await settingsPut(req(ADMIN, "/api/settings", "PUT", { academicYear: "2040-2045" }))).status === 400, "Settings PUT: non-consecutive session rejected");
  assert((await settingsPut(req(ADMIN, "/api/settings", "PUT", { academicYear: "2040" }))).status === 400, "Settings PUT: malformed session rejected");
  assert((await settingsPut(req(TEACHER, "/api/settings", "PUT", { academicYear: "2040-2041" }))).status === 403, "Settings PUT: teachers cannot switch the session");

  const FUTURE = "2040-2041";
  const put = await settingsPut(req(ADMIN, "/api/settings", "PUT", { academicYear: FUTURE }));
  assert(put.status === 200, "Settings PUT: a session 14 years ahead is accepted");
  const g2 = await json(await settingsGet(req(ADMIN, "/api/settings")));
  assert(g2.settings?.academicYear === FUTURE, "Settings: the future session is the active session after saving");

  assert((await getClassesServer(S, { allSessions: true })).length === classesBefore, "Switching to a future session creates no classes");
  assert((await getExamsServer(S, { allSessions: true })).length === examsBefore, "Switching to a future session creates no exams");
  const hist = await getClassesServer(S, { academicYear: HISTORIC });
  assert(hist.length === 1 && hist[0].id === "cls-ayr-hist" && hist[0].academicYear === HISTORIC, "Historical session's records are untouched");
  assert((await getClassesServer(S)).length === 0, "The future session starts empty (historical records are not moved into it)");

  // Saving genuinely future-dated records.
  const exam = await examsPost(req(ADMIN, "/api/exams", "POST", { title: "Finals 2041", term: "Final", startDate: "2041-03-01", endDate: "2041-03-10" }));
  const examJson = await json(exam);
  assert(exam.status === 201 || exam.status === 200, "Exam POST: a future-dated exam is saved");
  const listed = await json(await examsGet(req(ADMIN, "/api/exams")));
  const savedExam = (listed.exams || []).find((e: any) => e.name === "Finals 2041" || e.title === "Finals 2041");
  assert(savedExam && (savedExam.session === FUTURE || examJson.exam?.session === FUTURE), "Exam POST: the future exam is stamped with the active future session");

  const pay = await payrollPost(req(ADMIN, "/api/payroll", "POST", { teacherId: "tch-ayr", month: "March", year: 2041, status: "UNPAID", amount: 50000 }));
  assert(pay.status === 200 || pay.status === 201, "Payroll POST: a record for a future calendar year (2041) is saved");
  const payList = await json(await payrollGet(req(ADMIN, "/api/payroll?month=March&year=2041")));
  const payRow = (payList.records || []).find((r: any) => r.teacherId === "tch-ayr");
  assert(payList.year === 2041 && payRow?.year === 2041 && payRow?.baseSalary === 50000, "Payroll GET: the future-year record reads back with its saved amount");
  assert((await payrollPost(req(ADMIN, "/api/payroll", "POST", { teacherId: "tch-ayr", month: "March", year: 2101 }))).status === 400, "Payroll POST: out-of-range year is still rejected");

  // Restore the historical session: switching back shows its data again.
  await settingsPut(req(ADMIN, "/api/settings", "PUT", { academicYear: HISTORIC }));
  assert((await getClassesServer(S)).length === 1, "Switching back to the historical session shows its records again");

  console.log(`\nAcademic year tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Academic year test suite crashed:", e);
  process.exit(1);
});
