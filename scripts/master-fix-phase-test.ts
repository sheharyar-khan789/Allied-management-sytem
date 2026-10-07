/**
 * Master fix phase verification: student fees (monthly / annual / additional payments), the
 * 12-month fee ledger, timetable for every role, student password reset, class-incharge-only
 * attendance, and student CNIC persistence. Runs against the in-memory store (tsx does not load
 * .env.local, so no Firebase project is touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { POST as studentsPost } from "../src/app/api/students/route";
import { GET as studentGet, PUT as studentPut } from "../src/app/api/students/[id]/route";
import { GET as feesGet, POST as feesPost, PUT as feesPut } from "../src/app/api/fees/route";
import { GET as accountGet, PUT as accountPut } from "../src/app/api/fees/student-account/route";
import { POST as chargePost, PUT as chargePut } from "../src/app/api/fees/charges/route";
import { GET as attendanceGet, POST as attendancePost } from "../src/app/api/attendance/route";
import { GET as classesGet } from "../src/app/api/classes/route";
import { GET as printAttendanceGet } from "../src/app/api/print/attendance/[studentId]/route";
import { GET as reportCardGet } from "../src/app/api/print/report-card/[studentId]/route";
import {
  GET as timetableGet,
  POST as timetablePost,
  PUT as timetablePut,
  DELETE as timetableDelete,
} from "../src/app/api/timetable/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as forgotPost } from "../src/app/api/auth/forgot-password/route";
import { POST as resetPost } from "../src/app/api/auth/reset-password/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  createUserServer,
  getStudentByIdServer,
  getTimetableServer,
  saveClassServer,
  saveStudentServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { normalizeCnic } from "../src/lib/input-validation";
import { ClassDoc, FEE_MONTHS, StudentDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";

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
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const sidParams = (studentId: string) => ({ params: Promise.resolve({ studentId }) });

/** Runs `fn` while capturing console.warn; returns the dev-console reset link and its recipient. */
async function captureResetLink(fn: () => Promise<Response>): Promise<{ res: Response; link: string | null; to: string | null }> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    const res = await fn();
    const line = lines.find((l) => l.includes("/reset-password?token="));
    const m = line ? /link for (\S+): (https?:\/\/\S+)/.exec(line) : null;
    return { res, link: m ? m[2] : null, to: m ? m[1] : null };
  } finally {
    console.warn = orig;
  }
}
const tokenFromLink = (link: string | null) => (link ? new URL(link).searchParams.get("token") || "" : "");

async function run() {
  console.log("==================================================");
  console.log("MASTER FIX PHASE: FEES / 12 MONTHS / TIMETABLE / RESET / ATTENDANCE / CNIC");
  console.log("==================================================");

  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const YEAR = "2026-2027";
  const A = "school-mf-a";
  const B = "school-mf-b";
  for (const schoolId of [A, B]) {
    await updateSchoolSettingsServer({
      id: schoolId, schoolId, schoolName: `School ${schoolId}`, campusName: "Main", motto: "", address: "",
      phone: "", email: `admin@${schoolId}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    });
  }

  // --- Fixture (prompt's example): Class 8 — incharge Teacher A; Maths: Teacher B; English:
  // Teacher C; Physics: Teacher D, who is incharge of Class 9. School B has its own class.
  const cls = (id: string, schoolId: string, name: string, classTeacherId: string | null): ClassDoc => ({
    id, schoolId, name, section: "A", numericLevel: 8, capacity: 30, roomNo: `R-${id}`,
    classTeacherId, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const c8 = cls("cls-mf-8", A, "Class 8", "tch-mf-a");
  const c9 = cls("cls-mf-9", A, "Class 9", "tch-mf-d");
  const cB = cls("cls-mf-b8", B, "Class 8", "tch-mf-b-school");
  for (const c of [c8, c9, cB]) await saveClassServer(c);

  const subj = (id: string, schoolId: string, classId: string, name: string, teacherId: string | null): SubjectDoc => ({
    id, schoolId, classId, name, code: id.toUpperCase(), teacherId, credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const math8 = subj("sb-mf-math8", A, c8.id, "Mathematics", "tch-mf-b");
  const eng8 = subj("sb-mf-eng8", A, c8.id, "English", "tch-mf-c");
  const phy8 = subj("sb-mf-phy8", A, c8.id, "Physics", "tch-mf-d");
  const urdu9 = subj("sb-mf-urdu9", A, c9.id, "Urdu", "tch-mf-d");
  const bMath = subj("sb-mf-bmath", B, cB.id, "Mathematics", "tch-mf-b-school");
  for (const s of [math8, eng8, phy8, urdu9, bMath]) await saveSubjectServer(s);

  const teacher = (id: string, schoolId: string, name: string, subjectIds: string[], classIds: string[]): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@${schoolId}.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: classIds, assignedSubjectIds: subjectIds, weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  const tA = teacher("tch-mf-a", A, "Teacher A", [], [c8.id]);
  const tB = teacher("tch-mf-b", A, "Teacher B", [math8.id], [c8.id]);
  const tC = teacher("tch-mf-c", A, "Teacher C", [eng8.id], [c8.id]);
  const tD = teacher("tch-mf-d", A, "Teacher D", [phy8.id, urdu9.id], [c8.id, c9.id]);
  const tBS = teacher("tch-mf-b-school", B, "School B Teacher", [bMath.id], [cB.id]);
  for (const t of [tA, tB, tC, tD, tBS]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra });
  const ADMIN_A = await session("uid-mf-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-mf-admin-b", "ADMIN", B);
  const T_A = await session("uid-mf-ta", "TEACHER", A, { teacherId: tA.id });
  const T_B = await session("uid-mf-tb", "TEACHER", A, { teacherId: tB.id });
  const T_C = await session("uid-mf-tc", "TEACHER", A, { teacherId: tC.id });
  const T_D = await session("uid-mf-td", "TEACHER", A, { teacherId: tD.id });
  const T_SCHOOL_B = await session("uid-mf-tbs", "TEACHER", B, { teacherId: tBS.id });

  // ======================================================================
  // 6. CNIC + 1. FEES — enrol through the real API
  // ======================================================================
  const enrol = (body: Record<string, unknown>) => studentsPost(req(ADMIN_A, "http://x/api/students", "POST", body));
  const baseStudent = { gender: "Male", classId: c8.id, guardianName: "Khan Sahib", guardianPhone: "03001234567", guardianRelation: "Father" };
  const ahmedRes = await enrol({ ...baseStudent, firstName: "Ahmed", lastName: "Khan", cnicBForm: "12345-1234567-1", monthlyFee: 5000, annualFee: 20000, guardianEmail: "khan.guardian@mail-a.test" });
  const ahmedJson = await json(ahmedRes);
  const ahmedId: string = ahmedJson.student?.id;
  const ahmedPassword: string = ahmedJson.temporaryPassword;
  assert(ahmedRes.status === 201 && ahmedId, "Admin enrols Ahmed Khan with CNIC, monthly fee and annual fee");
  const ahmedStored = await getStudentByIdServer(A, ahmedId);
  assert(ahmedStored?.cnic === "12345-1234567-1", "CNIC is persisted on the canonical student record at enrolment (previously dropped)");
  assert(ahmedStored?.monthlyFee === 5000 && ahmedStored?.annualFee === 20000, "Monthly fee (5,000) and annual fee (20,000) are stored independently on the student");

  const saraRes = await enrol({ ...baseStudent, gender: "Female", firstName: "Sara", lastName: "Ali", monthlyFee: 4000, annualFee: 15000, guardianEmail: "khan.guardian@mail-a.test" });
  const saraId: string = (await json(saraRes)).student?.id;
  const noGuardianRes = await enrol({ ...baseStudent, firstName: "Bilal", lastName: "Raza" });
  const noGuardianJson = await json(noGuardianRes);
  assert(saraRes.status === 201 && noGuardianRes.status === 201, "Further students enrolled (one with no guardian email)");
  // Sara moves to Class 9 so the parent's two children are in different classes.
  assert((await studentPut(req(ADMIN_A, `http://x/api/students/${saraId}`, "PUT", { classId: c9.id }), idParams(saraId))).status === 200, "Sara transferred to Class 9");

  const view = async (token: string, id: string) => json(await studentGet(req(token, `http://x/api/students/${id}`), idParams(id)));
  let ahmedView = await view(ADMIN_A, ahmedId);
  assert(ahmedView.student?.cnicBForm === "12345-1234567-1", "After refresh the CNIC is returned by the student API (edit form + profile source)");
  assert(ahmedView.student?.monthlyFee === 5000 && ahmedView.student?.annualFee === 20000, "Student API returns monthly and annual fee to the admin");

  const badCnic = await studentPut(req(ADMIN_A, `http://x/api/students/${ahmedId}`, "PUT", { cnicBForm: "12-34" }), idParams(ahmedId));
  assert(badCnic.status === 400, "Malformed CNIC is rejected with 400");
  assert((await enrol({ ...baseStudent, firstName: "Bad", lastName: "Cnic", cnicBForm: "abc" })).status === 400, "Malformed CNIC is rejected at enrolment");
  const cnicUpdate = await studentPut(req(ADMIN_A, `http://x/api/students/${ahmedId}`, "PUT", { cnicBForm: "1234576543219" }), idParams(ahmedId));
  assert(cnicUpdate.status === 200, "Admin updates CNIC (13 digits without dashes accepted)");
  ahmedView = await view(ADMIN_A, ahmedId);
  assert(ahmedView.student?.cnicBForm === "12345-7654321-9", "Updated CNIC persists, normalised to XXXXX-XXXXXXX-X — the old value is gone");
  // An unrelated profile edit (no cnicBForm sent) keeps the stored CNIC.
  await studentPut(req(ADMIN_A, `http://x/api/students/${ahmedId}`, "PUT", { address: "House 1" }), idParams(ahmedId));
  assert((await view(ADMIN_A, ahmedId)).student?.cnicBForm === "12345-7654321-9", "Editing other fields keeps the current CNIC (edit again loads the correct value)");
  // A legacy imported bForm must not reappear once the field is changed or cleared.
  await saveStudentServer({ ...(await getStudentByIdServer(A, noGuardianJson.student.id))!, bForm: "LEGACY-BFORM" });
  assert((await view(ADMIN_A, noGuardianJson.student.id)).student?.cnicBForm === "LEGACY-BFORM", "Legacy imported B-Form value is displayed");
  await studentPut(req(ADMIN_A, `http://x/api/students/${noGuardianJson.student.id}`, "PUT", { cnicBForm: "" }), idParams(noGuardianJson.student.id));
  assert((await view(ADMIN_A, noGuardianJson.student.id)).student?.cnicBForm === "", "Clearing the field removes the CNIC without falling back to the stale legacy value");
  assert(normalizeCnic("12345-1234567-1") === "12345-1234567-1" && normalizeCnic("1234512345671") === "12345-1234567-1" && normalizeCnic("123") === null, "CNIC normaliser accepts both forms, rejects others");
  const studentSelf = await session("uid-mf-ahmed", "STUDENT", A, { studentId: ahmedId });
  assert((await view(studentSelf, ahmedId)).student?.cnicBForm === "12345-7654321-9", "Student sees their own current CNIC in their profile data");
  assert((await view(studentSelf, ahmedId)).student?.monthlyFee === undefined, "Fee structure fields are only returned to the admin");

  const feeEdit = await studentPut(req(ADMIN_A, `http://x/api/students/${ahmedId}`, "PUT", { monthlyFee: 5500, annualFee: 22000 }), idParams(ahmedId));
  assert(feeEdit.status === 200, "Admin edits monthly + annual fee (previously silently dropped by the update schema)");
  ahmedView = await view(ADMIN_A, ahmedId);
  assert(ahmedView.student?.monthlyFee === 5500 && ahmedView.student?.annualFee === 22000, "Edited fees persist after refresh");
  assert((await studentPut(req(ADMIN_A, `http://x/api/students/${ahmedId}`, "PUT", { monthlyFee: -1 }), idParams(ahmedId))).status === 400, "Negative fee rejected");
  assert((await studentPut(req(ADMIN_B, `http://x/api/students/${ahmedId}`, "PUT", { monthlyFee: 1 }), idParams(ahmedId))).status === 404, "Other school's admin cannot edit this student's fee");

  // ======================================================================
  // 2. 12-MONTH LEDGER
  // ======================================================================
  const acct = async (token: string, studentId: string, year = 2026) =>
    accountGet(req(token, `http://x/api/fees/student-account?studentId=${studentId}&year=${year}`));
  const setMonth = (token: string, studentId: string, month: string, paid: boolean, year = 2026) =>
    accountPut(req(token, "http://x/api/fees/student-account", "PUT", { studentId, year, month, paid }));

  const fresh = await json(await acct(ADMIN_A, ahmedId));
  assert(fresh.success && fresh.months.length === 12 && fresh.months.map((m: any) => m.month).join() === FEE_MONTHS.join(), "Fee account lists all 12 months, January–December");
  assert(fresh.months.every((m: any) => m.paid === false) && fresh.annualFee.amount === 22000 && fresh.student.monthlyFee === 5500, "New account: every month unpaid; shows the stored monthly/annual fee");

  const pattern: Record<string, boolean> = {
    January: true, February: true, March: false, April: true, May: false, June: true,
    July: true, August: false, September: true, October: true, November: false, December: false,
  };
  let allWritesOk = true;
  for (const [month, paid] of Object.entries(pattern)) {
    if (paid) allWritesOk = allWritesOk && (await setMonth(ADMIN_A, ahmedId, month, true)).status === 200;
  }
  assert(allWritesOk, "Admin ticks the paid months one at a time");
  const afterTicks = await json(await acct(ADMIN_A, ahmedId));
  assert(afterTicks.months.every((m: any) => m.paid === pattern[m.month]), "Re-fetch (refresh / reopen / re-login) shows exactly the persisted pattern for all 12 months");
  assert(afterTicks.paidMonths === 7, "Paid-month count is 7 of 12");
  await setMonth(ADMIN_A, ahmedId, "October", false);
  const octOff = await json(await acct(ADMIN_A, ahmedId));
  assert(octOff.months.find((m: any) => m.month === "October").paid === false && octOff.months.find((m: any) => m.month === "September").paid === true, "Unticking October changes only October");
  await setMonth(ADMIN_A, ahmedId, "October", true);
  assert((await json(await acct(ADMIN_A, ahmedId))).months.find((m: any) => m.month === "October").paid === true, "October ☐ → ☑ persists");
  assert((await json(await acct(ADMIN_A, ahmedId, 2025))).months.every((m: any) => !m.paid), "Another year's ledger is independent");

  // Student switching: A → B → A.
  const saraAcct = await json(await acct(ADMIN_A, saraId));
  assert(saraAcct.student.id === saraId && saraAcct.months.every((m: any) => !m.paid) && saraAcct.student.monthlyFee === 4000, "Student B's account shows only B's fees (no leakage from A)");
  await setMonth(ADMIN_A, saraId, "March", true);
  const backToA = await json(await acct(ADMIN_A, ahmedId));
  assert(backToA.student.id === ahmedId && backToA.months.find((m: any) => m.month === "March").paid === false, "Back on Student A: A's latest data, unaffected by B's March tick");
  assert((await json(await acct(ADMIN_A, saraId))).months.find((m: any) => m.month === "March").paid === true, "B's March tick persisted on B");

  assert((await acct(ADMIN_B, ahmedId)).status === 404, "Cross-school admin cannot read the fee account");
  assert((await setMonth(ADMIN_B, ahmedId, "May", true)).status === 404, "Cross-school admin cannot change the fee account");
  assert((await acct(T_A, ahmedId)).status === 403 && (await setMonth(T_A, ahmedId, "May", true)).status === 403, "Teachers cannot read or change fee accounts");
  assert((await acct(studentSelf, ahmedId)).status === 403, "Students cannot call the admin fee account API");
  assert((await setMonth(ADMIN_A, ahmedId, "Smarch", true)).status === 400, "Unknown month name is rejected");
  assert((await accountPut(req(ADMIN_A, "http://x/api/fees/student-account", "PUT", { studentId: ahmedId, year: 2026, month: "May", paid: true, schoolId: B }))).status === 400, "Mass-assigning schoolId is rejected");

  // Annual fee paid status.
  const annualOn = await json(await accountPut(req(ADMIN_A, "http://x/api/fees/student-account", "PUT", { studentId: ahmedId, year: 2026, annualFeePaid: true })));
  assert(annualOn.annualFee.paid === true && annualOn.annualFee.paidAt, "Annual fee marked paid");
  assert((await json(await acct(ADMIN_A, ahmedId))).annualFee.paid === true, "Annual fee paid state persists");
  assert((await json(await acct(ADMIN_A, ahmedId))).months.find((m: any) => m.month === "May").paid === false, "Annual-fee toggle does not touch monthly statuses");

  // Challan → payment → month auto-synced.
  const challanRes = await feesPost(req(ADMIN_A, "http://x/api/fees", "POST", { studentId: saraId, classId: c9.id, month: "May", year: 2026, dueDate: "2026-05-10", tuitionFee: 4000 }));
  const challan = (await json(challanRes)).challan;
  assert(challanRes.status === 201, "Admin issues a May 2026 challan for Student B");
  const unpaidList = await json(await feesGet(req(ADMIN_A, "http://x/api/fees?status=UNPAID")));
  assert(unpaidList.challans.some((c: any) => c.id === challan.id), "Fee page 'Unpaid' filter now returns PENDING challans (previously always empty)");
  assert((await json(await acct(ADMIN_A, saraId))).months.find((m: any) => m.month === "May").paid === false, "Before payment May is unpaid");
  const pay = await feesPut(req(ADMIN_A, "http://x/api/fees", "PUT", { challanId: challan.id, amount: 4000 }));
  assert(pay.status === 200, "Admin collects the full challan amount");
  const mayAfterPay = (await json(await acct(ADMIN_A, saraId))).months.find((m: any) => m.month === "May");
  assert(mayAfterPay.paid === true && mayAfterPay.challans[0]?.status === "PAID", "Settled challan marks May paid on the 12-month grid");
  const paidList = await json(await feesGet(req(ADMIN_A, "http://x/api/fees?status=PAID")));
  assert(paidList.challans.some((c: any) => c.id === challan.id), "Fee page reflects the payment (status PAID)");

  // ======================================================================
  // 1C. ADDITIONAL / EVENT PAYMENTS
  // ======================================================================
  const newCharge = await chargePost(req(ADMIN_A, "http://x/api/fees/charges", "POST", { studentId: ahmedId, type: "SPORTS", description: "Sports Event", amount: 2000, date: "2026-10-05", status: "PAID", notes: "Inter-house" }));
  const chargeJson = await json(newCharge);
  assert(newCharge.status === 201 && chargeJson.charge.studentId === ahmedId && chargeJson.charge.schoolId === A && chargeJson.charge.createdAt && chargeJson.charge.updatedAt, "Admin adds a Sports Event payment (PKR 2,000, Paid, 2026-10-05) with studentId/schoolId/timestamps");
  const trip = await json(await chargePost(req(ADMIN_A, "http://x/api/fees/charges", "POST", { studentId: ahmedId, type: "TRIP", description: "Museum trip", amount: 1500, date: "2026-11-01", status: "UNPAID" })));
  const listed = (await json(await acct(ADMIN_A, ahmedId))).charges;
  assert(listed.length === 2 && listed.some((c: any) => c.id === trip.charge.id), "Both payments appear on the student's account after refresh");
  const editCharge = await chargePut(req(ADMIN_A, "http://x/api/fees/charges", "PUT", { id: trip.charge.id, type: "TRIP", description: "Museum trip", amount: 1800, date: "2026-11-01", status: "PAID", notes: "" }));
  assert(editCharge.status === 200 && (await json(editCharge)).charge.amount === 1800, "Admin edits a payment (amount and status)");
  const relisted = (await json(await acct(ADMIN_A, ahmedId))).charges;
  assert(relisted.length === 2 && relisted.find((c: any) => c.id === trip.charge.id).status === "PAID", "Edit updated the existing record — no duplicate");
  assert((await json(await acct(ADMIN_A, saraId))).charges.length === 0, "Another student's account shows none of these payments");
  assert((await chargePut(req(ADMIN_B, "http://x/api/fees/charges", "PUT", { id: trip.charge.id, type: "TRIP", description: "x", amount: 1, date: "2026-11-01", status: "PAID" }))).status === 404, "Other school's admin cannot edit the payment");
  assert((await chargePost(req(ADMIN_B, "http://x/api/fees/charges", "POST", { studentId: ahmedId, type: "EXAM", description: "x", amount: 1, date: "2026-11-01", status: "PAID" }))).status === 404, "Other school's admin cannot add a payment for this student");
  assert((await chargePut(req(ADMIN_A, "http://x/api/fees/charges", "PUT", { id: trip.charge.id, studentId: saraId, type: "TRIP", description: "x", amount: 1, date: "2026-11-01", status: "PAID" }))).status === 400, "A payment cannot be moved to another student");
  assert((await chargePost(req(T_A, "http://x/api/fees/charges", "POST", { studentId: ahmedId, type: "EXAM", description: "x", amount: 1, date: "2026-11-01", status: "PAID" }))).status === 403, "Teachers cannot add payments");
  assert((await chargePost(req(ADMIN_A, "http://x/api/fees/charges", "POST", { studentId: ahmedId, type: "EXAM", description: "x", amount: 0, date: "2026-11-01", status: "PAID" }))).status === 400, "Zero amount rejected");
  assert((await chargePost(req(ADMIN_A, "http://x/api/fees/charges", "POST", { studentId: ahmedId, type: "BRIBE", description: "x", amount: 5, date: "2026-11-01", status: "PAID" }))).status === 400, "Unknown payment type rejected");

  // ======================================================================
  // 5. CLASS-INCHARGE-ONLY ATTENDANCE
  // ======================================================================
  const att = (token: string, classId: string, subjectId?: string) =>
    attendanceGet(req(token, `http://x/api/attendance?classId=${classId}&date=${today}${subjectId ? `&subjectId=${subjectId}` : ""}`));
  const mark = (token: string, classId: string, studentId: string, status: string, subjectId?: string) =>
    attendancePost(req(token, "http://x/api/attendance", "POST", { classId, date: today, ...(subjectId ? { subjectId } : {}), records: [{ studentId, status }] }));
  const bilalId: string = noGuardianJson.student.id;

  const aView = await att(T_A, c8.id);
  assert(aView.status === 200 && (await json(aView)).roster.length === 2, "Teacher A (Class 8 incharge): attendance accessible");
  assert((await mark(T_A, c8.id, ahmedId, "ABSENT")).status === 200, "Teacher A: attendance update works");
  assert((await json(await att(T_A, c8.id))).roster.find((r: any) => r.studentId === ahmedId).status === "ABSENT", "Teacher A sees the saved record");

  assert((await att(T_B, c8.id)).status === 403, "Teacher B (Maths in Class 8): daily register rejected");
  assert((await att(T_B, c8.id, math8.id)).status === 403, "Teacher B: their own Maths subject register is also rejected (subject allocation grants nothing)");
  assert((await mark(T_B, c8.id, ahmedId, "PRESENT")).status === 403 && (await mark(T_B, c8.id, ahmedId, "PRESENT", math8.id)).status === 403, "Teacher B: direct POST rejected");
  assert((await att(T_C, c8.id)).status === 403 && (await att(T_C, c8.id, eng8.id)).status === 403, "Teacher C (English in Class 8): rejected");
  assert((await mark(T_C, c8.id, bilalId, "PRESENT", eng8.id)).status === 403, "Teacher C: direct POST rejected");
  assert((await att(T_D, c9.id)).status === 200, "Teacher D (Class 9 incharge): Class 9 attendance accessible");
  assert((await mark(T_D, c9.id, saraId, "LATE")).status === 200, "Teacher D: Class 9 update works");
  assert((await att(T_D, c8.id)).status === 403 && (await att(T_D, c8.id, phy8.id)).status === 403, "Teacher D: Class 8 rejected even though D teaches Physics there");
  assert((await mark(T_D, c8.id, ahmedId, "PRESENT")).status === 403, "Teacher D: direct POST to Class 8 rejected");
  // Spoofed ids in the body: Class 9's incharge sending a Class 8 student under Class 9.
  assert((await mark(T_D, c9.id, ahmedId, "PRESENT")).status === 403, "Teacher D: a Class 8 studentId submitted under Class 9 is rejected");
  const crossGet = await att(T_SCHOOL_B, c8.id);
  assert(crossGet.status === 403 || crossGet.status === 404, "Cross-school: School B teacher cannot read School A attendance");
  const crossAdmin = await att(ADMIN_B, c8.id);
  assert(crossAdmin.status === 200 ? (await json(crossAdmin)).roster.length === 0 : true, "Cross-school admin gets no School A students");
  assert((await att(ADMIN_A, c8.id)).status === 200 && (await att(ADMIN_A, c8.id, math8.id)).status === 200, "Admin keeps full attendance access (daily + subject registers)");
  assert((await mark(ADMIN_A, c8.id, bilalId, "PRESENT")).status === 200, "Admin can still mark attendance");

  const classesB = await json(await classesGet(req(T_B, "http://x/api/classes")));
  assert(classesB.classes.every((c: any) => c.isIncharge === false), "Teacher B's class list flags no incharge class (attendance menu hidden)");

  // Other attendance read paths: dossier + printouts.
  const dossierB = await view(T_B, ahmedId);
  assert(dossierB.success && dossierB.student.attendances.length === 0 && dossierB.student.attendanceRestricted === true && dossierB.stats.attendance.total === 0, "Subject teacher's student dossier carries no attendance data");
  const dossierA = await view(T_A, ahmedId);
  assert(dossierA.student.attendances.length === 1 && dossierA.student.attendanceRestricted === false, "Class incharge's dossier includes the attendance");
  assert((await printAttendanceGet(req(T_B, `http://x/api/print/attendance/${ahmedId}`), sidParams(ahmedId))).status === 403, "Subject teacher cannot print a student's attendance report");
  assert((await printAttendanceGet(req(T_A, `http://x/api/print/attendance/${ahmedId}`), sidParams(ahmedId))).status === 200, "Class incharge can print the attendance report");
  const rcB = await json(await reportCardGet(req(T_B, `http://x/api/print/report-card/${ahmedId}`), sidParams(ahmedId)));
  const rcA = await json(await reportCardGet(req(T_A, `http://x/api/print/report-card/${ahmedId}`), sidParams(ahmedId)));
  assert(rcB.success && !("attendance" in rcB) && rcA.attendance?.records?.length === 1, "Report card payload omits attendance for a subject teacher, keeps it for the incharge");
  assert((await printAttendanceGet(req(ADMIN_A, `http://x/api/print/attendance/${ahmedId}`), sidParams(ahmedId))).status === 200, "Admin can still print attendance");

  // ======================================================================
  // 3. TIMETABLE — admin CRUD, teacher / student / parent views
  // ======================================================================
  const slot = { classId: c8.id, subjectId: math8.id, dayOfWeek: "Monday", periodName: "1", startTime: "09:00", endTime: "09:45", roomNo: "R-8" };
  const created = await json(await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", slot)));
  const slot2 = await json(await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slot, subjectId: eng8.id, periodName: "2", startTime: "09:45", endTime: "10:30" })));
  const slot9 = await json(await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slot, classId: c9.id, subjectId: urdu9.id, roomNo: "R-9" })));
  const slotFri = await json(await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slot, dayOfWeek: "Friday", startTime: "08:00", endTime: "08:30" })));
  assert(created.id && slot2.id && slot9.id && slotFri.id, "Admin adds timetable entries (incl. a different Friday timing)");
  const adminCount = (await json(await timetableGet(req(ADMIN_A, "http://x/api/timetable")))).timetable.length;
  assert(adminCount === 4, "Admin views the timetable (4 entries)");

  const edit = await timetablePut(req(ADMIN_A, "http://x/api/timetable", "PUT", { ...slot, id: created.id, subjectId: phy8.id, startTime: "11:00", endTime: "11:45", periodName: "4" }));
  const editJson = await json(edit);
  assert(edit.status === 200 && editJson.timetable.id === created.id && editJson.timetable.subjectName === "Physics" && editJson.timetable.teacherId === tD.id, "Edit updates the existing entry (subject → Physics, teacher follows the subject)");
  assert((await json(await timetableGet(req(ADMIN_A, "http://x/api/timetable")))).timetable.length === 4, "Edit did not create a duplicate");

  const teacherD = (await json(await timetableGet(req(T_D, "http://x/api/timetable")))).timetable;
  assert(teacherD.some((t: any) => t.id === created.id && t.startTime === "11:00") && teacherD.every((t: any) => t.teacherId === tD.id), "Teacher D sees the updated entry and only their own periods");
  const teacherB = (await json(await timetableGet(req(T_B, "http://x/api/timetable")))).timetable;
  assert(!teacherB.some((t: any) => t.id === created.id), "Teacher B no longer sees the period moved to Teacher D");

  const ahmedTT = await json(await timetableGet(req(studentSelf, "http://x/api/timetable")));
  assert(ahmedTT.success && ahmedTT.timetable.length === 3 && ahmedTT.timetable.every((t: any) => t.classId === c8.id), "Student sees exactly their own class's timetable (Class 8)");
  assert(ahmedTT.timetable.some((t: any) => t.id === created.id && t.subjectName === "Physics" && t.startTime === "11:00"), "Student view reflects the admin's edit");
  assert(ahmedTT.timetable.every((t: any) => !("teacherId" in t) && !("schoolId" in t)), "Student view returns display fields only");
  const spoof = await json(await timetableGet(req(studentSelf, `http://x/api/timetable?classId=${c9.id}&teacherId=${tD.id}`)));
  assert(spoof.timetable.every((t: any) => t.classId === c8.id) && spoof.timetable.length === 3, "Student cannot read another class via ?classId= / ?teacherId=");
  const otherStudent = await session("uid-mf-spoof", "STUDENT", A, { studentId: saraId });
  assert((await json(await timetableGet(req(otherStudent, "http://x/api/timetable")))).timetable.every((t: any) => t.classId === c9.id), "A Class 9 student sees Class 9's timetable");
  const bStudentSession = await session("uid-mf-bstud", "STUDENT", B, { studentId: ahmedId });
  assert((await timetableGet(req(bStudentSession, "http://x/api/timetable"))).status === 404, "Cross-school: a School B session cannot resolve a School A student's timetable");

  await createUserServer({ uid: "uid-mf-parent", email: "khan.guardian@mail-a.test", name: "Khan Sahib", role: "PARENT", schoolId: A, status: "ACTIVE", createdAt: now, updatedAt: now });
  const PARENT = await session("uid-mf-parent", "PARENT", A);
  const childA = await json(await timetableGet(req(PARENT, `http://x/api/timetable?studentId=${ahmedId}`)));
  const childB = await json(await timetableGet(req(PARENT, `http://x/api/timetable?studentId=${saraId}`)));
  assert(childA.success && childA.timetable.length === 3 && childA.timetable.every((t: any) => t.classId === c8.id), "Parent: child A → Class 8 timetable");
  assert(childB.success && childB.timetable.length === 1 && childB.timetable[0].classId === c9.id, "Parent: child B → Class 9 timetable");
  assert((await timetableGet(req(PARENT, `http://x/api/timetable?studentId=${bilalId}`))).status === 403, "Parent cannot read the timetable of a child not linked to them");
  assert((await timetableGet(req(PARENT, "http://x/api/timetable"))).status === 400, "Parent request without a child is rejected");
  assert((await timetablePost(req(studentSelf, "http://x/api/timetable", "POST", slot))).status === 403 && (await timetablePut(req(PARENT, "http://x/api/timetable", "PUT", { ...slot, id: created.id }))).status === 403, "Students and parents cannot create or edit periods");

  const del = await timetableDelete(req(ADMIN_A, `http://x/api/timetable?id=${slot2.id}`, "DELETE"));
  assert(del.status === 200 && !(await getTimetableServer(A)).some((t) => t.id === slot2.id), "Admin deletes an entry");
  assert((await json(await timetableGet(req(studentSelf, "http://x/api/timetable")))).timetable.length === 2, "Deletion propagates to the student view");
  assert((await json(await timetableGet(req(PARENT, `http://x/api/timetable?studentId=${ahmedId}`)))).timetable.length === 2, "Deletion propagates to the parent view");

  // ======================================================================
  // 4. STUDENT PASSWORD RESET
  // ======================================================================
  const studentEmail: string = ahmedJson.student.email;
  const forgot = (email: string) =>
    forgotPost(new NextRequest("http://x/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.78.0.${ipCounter++ % 250}`, origin: "http://localhost:3000" },
      body: JSON.stringify({ email }),
    }));
  assert((await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: studentEmail, password: ahmedPassword }))).status === 200, "Student signs in with the generated password");
  const { res: fRes, link, to } = await captureResetLink(() => forgot(studentEmail));
  const fJson = await json(fRes);
  assert(fRes.status === 200 && fJson.success, "Student requests a reset (generic response)");
  assert(link && to === "khan.guardian@mail-a.test", "Reset link is delivered to the guardian email on file — not to the generated student address with no mailbox");
  assert(!JSON.stringify(fJson).includes("token") && !link!.includes(ahmedPassword), "No token in the API response; no password in the link");
  const token = tokenFromLink(link);
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), "Link carries a single-use 256-bit token");
  const weak = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token, newPassword: "password123" }));
  assert(weak.status === 400, "Weak new password rejected");
  const reset = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token, newPassword: "Fresh#Student2026" }));
  assert(reset.status === 200, "Reset link sets the new password");
  assert((await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: studentEmail, password: "Fresh#Student2026" }))).status === 200, "Student logs in with the new password");
  assert((await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: studentEmail, password: ahmedPassword }))).status === 401, "Old password is rejected");
  const reuse = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token, newPassword: "Another#Pass2026" }));
  assert(reuse.status === 400 && (await json(reuse)).code === "USED", "Used link is rejected safely");
  const bogus = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: "A".repeat(43), newPassword: "Another#Pass2026" }));
  assert(bogus.status === 400 && (await json(bogus)).code === "INVALID", "Invalid token is rejected safely");

  const bilalEmail: string = noGuardianJson.student.email;
  const { res: nRes, link: nLink } = await captureResetLink(() => forgot(bilalEmail));
  assert(nRes.status === 200 && (await json(nRes)).message === fJson.message && nLink === null, "Student without a guardian email: same generic response, no link sent anywhere");
  const { link: unknownLink } = await captureResetLink(() => forgot("nobody@school-mf-a.edu"));
  assert(unknownLink === null, "Unknown email: no link issued");
  const { to: parentTo } = await captureResetLink(() => forgot("khan.guardian@mail-a.test"));
  assert(parentTo === "khan.guardian@mail-a.test", "Parent reset still goes to the parent's own login email");

  // With a real provider configured (Resend, mocked here): the student's email goes to the
  // guardian, names the student account, and Firebase's mailer (login address only) is not used.
  const realFetch = globalThis.fetch;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.EMAIL_FROM;
  const calls: { url: string; body: any }[] = [];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "School <no-reply@school.test>";
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const providerRes = await forgot(studentEmail);
    const resendCall = calls.find((c) => c.url.includes("api.resend.com"));
    assert(providerRes.status === 200 && resendCall && resendCall.body.to[0] === "khan.guardian@mail-a.test", "Provider path: student reset email is addressed to the guardian");
    assert(resendCall && /student account of Ahmed Khan/.test(resendCall.body.html) && resendCall.body.html.includes(studentEmail), "Email names the student account it resets (guardian is not told it is 'your account')");
    assert(!calls.some((c) => c.url.includes("identitytoolkit")), "Firebase's built-in mailer is never used for a student reset");
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = prevFrom;
  }

  console.log("==================================================");
  console.log(`MASTER FIX SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
