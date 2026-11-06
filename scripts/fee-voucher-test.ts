/**
 * Fee voucher (printed challan) — amounts, single print API and bulk print API.
 * Runs against the in-memory store like the other suites. Uses only fixtures created here.
 */
import { NextRequest } from "next/server";
import { GET as singleGet } from "../src/app/api/print/challan/[id]/route";
import { GET as bulkGet } from "../src/app/api/print/challans/route";
import { POST as voucherAdjustPost } from "../src/app/api/vouchers/[id]/adjust/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { updateSchoolSettingsServer, saveClassServer, saveStudentServer, saveFeeChallanServer, recordPaymentServer } from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, PaymentDoc, StudentDoc } from "../src/lib/firebase/types";
import { AFTER_DUE_DATE_FEE, computeVoucherAmounts, voucherDate } from "../src/lib/fee-voucher";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) { console.log(`[PASS] ${name}`); passed++; } else { console.error(`[FAIL] ${name}`); failed++; }
}
const eq = (a: unknown, b: unknown, name: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) console.error(`   expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);
  assert(ok, name);
};
const req = (token: string | null, url: string, method = "GET", body?: unknown) => {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
};
const json = async (res: Response) => res.json().catch(() => ({}));
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  const now = new Date().toISOString();
  const A = "school-fv-a";
  const B = "school-fv-b";
  const YEAR = "2026-2027";

  const cls = (id: string, schoolId: string, name: string): ClassDoc => ({
    id, schoolId, name, section: "", numericLevel: 1, capacity: 40, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  await updateSchoolSettingsServer({
    id: `settings-${A}`, schoolId: A, schoolName: "Allied School", campusName: "Dhoria Campus", motto: "", address: "Dinga Road, Dhoria (Kharian)",
    phone: "0303-5380696", email: "a@x.edu", principalName: "", academicYear: YEAR, gradingScale: [],
  } as any);
  await saveClassServer(cls("cls-fv-nursery", A, "Nursery"));
  await saveClassServer(cls("cls-fv-empty", A, "Prep"));
  await saveClassServer(cls("cls-fv-b", B, "Nursery"));

  const std = (id: string, name: string, father: string, classId = "cls-fv-nursery", schoolId = A, rollNo = "1"): StudentDoc => ({
    id, schoolId, admissionNo: `ADM-${id}`, fullName: name, fatherName: father, gender: "MALE", classId, section: "", rollNo,
    status: "ACTIVE", guardianName: father, guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 3000, discount: 0,
    academicYear: YEAR, className: "Nursery", createdAt: now, updatedAt: now,
  });
  const students = [
    std("s-huz", "M. Huzaifa", "Abdul Majeed", "cls-fv-nursery", A, "1"),
    std("s-laq", "M. Laique", "Ehsan Ali", "cls-fv-nursery", A, "2"),
    std("s-dup", "Duplicate Dan", "Dad", "cls-fv-nursery", A, "3"),
    std("s-none", "No Challan Nora", "Dad", "cls-fv-nursery", A, "4"),
    std("s-long", "Muhammad Abdul Rehman Bin Muhammad Ibrahim Khan Niazi Sahib", "Haji Muhammad Ibrahim Khan Niazi Sahib Ali", "cls-fv-nursery", A, "5"),
    std("s-b", "B School Kid", "B Dad", "cls-fv-b", B),
  ];
  for (const s of students) await saveStudentServer(s);

  let seq = 0;
  const ch = (studentId: string, month: string, year: number, o: Partial<FeeChallanDoc> = {}, schoolId = A): FeeChallanDoc => {
    const tuitionFee = o.tuitionFee ?? 3000;
    const admissionFee = o.admissionFee ?? 0, examFee = o.examFee ?? 0, otherFee = o.otherFee ?? 0, discount = o.discount ?? 0;
    const totalExpected = tuitionFee + admissionFee + examFee + otherFee - discount;
    const paidAmount = o.paidAmount ?? 0;
    return {
      id: `ch-fv-${++seq}`, schoolId, studentId, studentName: "x", admissionNo: "x", classId: schoolId === A ? "cls-fv-nursery" : "cls-fv-b",
      className: "Nursery", challanNo: `CH-FV-${seq}`, month, year, issueDate: `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}-01`,
      dueDate: `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}-15`, tuitionFee, admissionFee, examFee, otherFee, discount,
      totalExpected, paidAmount, balanceAmount: Math.max(0, totalExpected - paidAmount),
      status: paidAmount >= totalExpected ? "PAID" : paidAmount > 0 ? "PARTIAL" : "PENDING", academicYear: YEAR,
      createdAt: `2026-${String(seq).padStart(2, "0")}-01T00:00:00.000Z`, updatedAt: now, ...o,
    } as FeeChallanDoc;
  };
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // Huzaifa: October fully paid, November unpaid -> pending 0.
  const huzOct = ch("s-huz", "October", 2026, { tuitionFee: 3700, paidAmount: 3700 });
  const huzNov = ch("s-huz", "November", 2026, { tuitionFee: 3700 });
  // Laique: September unpaid (3300), October partly paid (1000 of 3300), November has annual 3000, a December challan exists later.
  const laqSep = ch("s-laq", "September", 2026, { tuitionFee: 3300 });
  const laqOct = ch("s-laq", "October", 2026, { tuitionFee: 3300, paidAmount: 1000 });
  const laqNov = ch("s-laq", "November", 2026, { tuitionFee: 3300, admissionFee: 2000, examFee: 1000, otherFee: 500, discount: 300, paidAmount: 800 });
  const laqDec = ch("s-laq", "December", 2026, { tuitionFee: 3300 });
  // Duplicate: two November challans.
  const dupA = ch("s-dup", "November", 2026, { tuitionFee: 2000 });
  const dupB = ch("s-dup", "November", 2026, { tuitionFee: 2100 });
  // Long names + large amount.
  const longNov = ch("s-long", "November", 2026, { tuitionFee: 1234567 });
  // Previous year's unpaid balance (same session label would be wrong, so a different session stays out).
  const huzOldYear = ch("s-huz", "November", 2025, { tuitionFee: 999, academicYear: "2025-2026" });
  // Other school.
  const bNov = ch("s-b", "November", 2026, {}, B);
  for (const c of [huzOct, huzNov, laqSep, laqOct, laqNov, laqDec, dupA, dupB, longNov, huzOldYear, bNov]) await saveFeeChallanServer(c);

  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT", schoolId: string, studentId?: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...(studentId ? { studentId } : {}) } as any);
  const ADMIN_A = await session("uid-fv-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-fv-admin-b", "ADMIN", B);
  const TEACHER_A = await session("uid-fv-teacher-a", "TEACHER", A);
  const STUDENT_HUZ = await session("uid-fv-stu-huz", "STUDENT", A, "s-huz");
  const STUDENT_LAQ = await session("uid-fv-stu-laq", "STUDENT", A, "s-laq");

  console.log("== amounts (pure) ==");
  {
    const all = [laqSep, laqOct, laqNov, laqDec];
    const a = computeVoucherAmounts(laqNov, all);
    eq(a.tuitionFee, 3300, "tuition = tuitionFee");
    eq(a.annualSubscription, 3000, "annual subscription = admission + exam");
    eq(a.bookDues, 500, "book dues = other fee");
    eq(a.pendingFees, 3300 + 2300, "pending = unpaid Sep (3300) + partly-paid Oct outstanding (2300)");
    eq(a.total, (3300 + 3000 + 500 - 300) + 5600, "total = charges - discount + pending");
    eq(a.paidDues, 800, "paid dues = challan paidAmount (shown, not subtracted)");
    eq(a.afterDueDate, AFTER_DUE_DATE_FEE, "after due date = template surcharge");
    eq(computeVoucherAmounts(laqNov, [...all, ...all]).pendingFees, 5600, "duplicate rows of the same challan are not double counted");
    eq(computeVoucherAmounts(laqNov, [laqNov]).pendingFees, 0, "the challan itself never counts as pending");
    eq(computeVoucherAmounts(laqSep, all).pendingFees, 0, "first challan has no pending; later challans (Oct, Dec) are not carried backwards");
    eq(computeVoucherAmounts(huzNov, [huzOct, huzNov, huzOldYear]).pendingFees, 0, "paid previous challan and other-session challan add nothing");
    const overpaid = ch("s-huz", "March", 2026, { paidAmount: 5000 });
    eq(computeVoucherAmounts(huzNov, [overpaid]).pendingFees, 0, "an overpaid earlier challan never reduces the total (no negative pending)");
    const bigDiscount = ch("s-huz", "November", 2026, { tuitionFee: 100, discount: 500 });
    eq(computeVoucherAmounts({ ...bigDiscount, totalExpected: 0 }, []).total, 0, "discount larger than charges floors at 0");
    eq(voucherDate("2026-11-01"), "01-Nov-2026", "date format matches the template (01-Nov-2026)");
    eq(voucherDate(""), "", "missing date is blank, not invented");
  }

  console.log("== single print API ==");
  {
    assert((await singleGet(req(null, "http://x/api/print/challan/x"), paramsOf(huzNov.id))).status === 401, "unauthenticated -> 401");
    assert((await singleGet(req(TEACHER_A, "http://x"), paramsOf(huzNov.id))).status === 403, "teacher -> 403");
    const res = await singleGet(req(ADMIN_A, "http://x"), paramsOf(laqNov.id));
    const d = await json(res);
    assert(res.status === 200 && d.voucher, "admin gets the voucher");
    eq(d.voucher.amounts.total, 3300 + 3000 + 500 - 300 + 5600, "API total matches server calculation");
    eq(d.voucher.student.fatherName, "Ehsan Ali", "father name comes from the student record");
    eq(d.voucher.challan.dueDate, "2026-11-15", "due date from the challan");
    eq([d.voucher.school.name, d.voucher.school.campusName, d.voucher.school.phone], ["Allied School", "Dhoria Campus", "0303-5380696"], "school header comes from school settings");
    assert(!("outstanding" in d) && !JSON.stringify(d).includes("ADMIN_A"), "response contains no unrelated data");
    assert((await singleGet(req(ADMIN_B, "http://x"), paramsOf(huzNov.id))).status === 404, "other school's admin cannot read the challan (404)");
    assert((await singleGet(req(ADMIN_A, "http://x"), paramsOf("does-not-exist"))).status === 404, "missing challan -> 404");
    assert((await singleGet(req(STUDENT_HUZ, "http://x"), paramsOf(huzNov.id))).status === 200, "student can print their own challan");
    assert((await singleGet(req(STUDENT_HUZ, "http://x"), paramsOf(laqNov.id))).status === 403, "student cannot print another student's challan");
    assert((await singleGet(req(STUDENT_LAQ, "http://x"), paramsOf(huzNov.id))).status === 403, "…in either direction");
  }

  console.log("== bulk print API ==");
  const bulk = (token: string | null, qs: string) => bulkGet(req(token, `http://x/api/print/challans?${qs}`));
  {
    assert((await bulk(null, "classId=cls-fv-nursery&month=November")).status === 401, "unauthenticated -> 401");
    assert((await bulk(TEACHER_A, "classId=cls-fv-nursery&month=November")).status === 403, "teacher -> 403");
    assert((await bulk(STUDENT_HUZ, "classId=cls-fv-nursery&month=November")).status === 403, "student -> 403 (no school-wide fee data)");
    assert((await bulk(ADMIN_A, "month=November")).status === 400, "empty selection (no class) -> 400");
    assert((await bulk(ADMIN_A, "classId=cls-fv-nursery&month=Smarch")).status === 400, "invalid month -> 400");
    assert((await bulk(ADMIN_A, "classId=cls-fv-nursery&month=November&year=20x6")).status === 400, "invalid year -> 400");
    assert((await bulk(ADMIN_B, "classId=cls-fv-nursery&month=November")).status === 404, "other school's class is not reachable (404)");
    assert((await bulk(ADMIN_A, "classId=nope&month=November")).status === 404, "unknown class -> 404");

    const res = await bulk(ADMIN_A, "classId=cls-fv-nursery&month=November&year=2026");
    const d = await json(res);
    assert(res.status === 200 && d.success, "admin loads the November batch");
    const ids = d.vouchers.map((v: any) => v.student.id);
    eq(ids, ["s-huz", "s-laq", "s-dup", "s-long"], "one voucher per student with a November challan, in roll order, no duplicates");
    eq(d.missing.map((m: any) => m.studentId), ["s-none"], "student without a challan is reported, not silently dropped");
    eq(d.duplicates.map((m: any) => [m.studentId, m.count]), [["s-dup", 2]], "student with two challans is reported");
    eq(d.vouchers.find((v: any) => v.student.id === "s-dup").challan.id, dupB.id, "duplicate resolves to the most recent challan only");
    assert(!ids.includes("s-b"), "no other-school student appears");
    const huz = d.vouchers.find((v: any) => v.student.id === "s-huz").amounts;
    eq([huz.tuitionFee, huz.pendingFees, huz.total, huz.paidDues], [3700, 0, 3700, 0], "Huzaifa: 3700 / 0 pending / total 3700 / paid 0 (matches template row)");
    const laq = d.vouchers.find((v: any) => v.student.id === "s-laq").amounts;
    eq([laq.pendingFees, laq.total, laq.paidDues], [5600, 3300 + 3000 + 500 - 300 + 5600, 800], "Laique: pending 5600, total and paid dues from records");
    const long = d.vouchers.find((v: any) => v.student.id === "s-long");
    eq(long.amounts.total, 1234567, "large amount preserved");

    const sub = await json(await bulk(ADMIN_A, "classId=cls-fv-nursery&month=November&studentIds=s-laq,s-b,s-none"));
    eq(sub.vouchers.map((v: any) => v.student.id), ["s-laq"], "individual selection prints only that student (foreign/missing ids ignored or reported)");
    eq(sub.missing.map((m: any) => m.studentId), ["s-none"], "selected student without challan reported");

    const empty = await json(await bulk(ADMIN_A, "classId=cls-fv-empty&month=November"));
    eq([empty.vouchers.length, empty.missing.length], [0, 0], "class with no students -> empty batch, no error");
    const none = await json(await bulk(ADMIN_A, "classId=cls-fv-nursery&month=July"));
    eq([none.vouchers.length, none.missing.length], [0, 5], "month with no challans -> nothing to print, every student listed as missing");

    const oct = await json(await bulk(ADMIN_A, "classId=cls-fv-nursery&month=October"));
    eq(oct.vouchers.map((v: any) => v.student.id), ["s-huz", "s-laq"], "October batch");
    eq(oct.vouchers.find((v: any) => v.student.id === "s-laq").amounts.pendingFees, 3300, "October pending = Sep only (Nov/Dec not carried backwards)");

    const meta = await json(await bulk(ADMIN_A, "meta=1"));
    assert(meta.success && meta.sessions.includes(YEAR) && meta.classes.some((c: any) => c.id === "cls-fv-nursery"), "meta lists the session and its classes");
    assert(!meta.classes.some((c: any) => c.id === "cls-fv-b"), "meta never lists another school's classes");
  }

  console.log("== payments / reversals ==");
  {
    const pay: PaymentDoc = {
      id: "pay-fv-1", schoolId: A, challanId: huzNov.id, studentId: "s-huz", studentName: "M. Huzaifa", receiptNo: "RCT-FV-1",
      amount: 1200, paymentDate: new Date().toISOString().split("T")[0], paymentMode: "CASH", collectedBy: "uid-fv-admin-a",
      createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    };
    await recordPaymentServer(pay);
    let d = await json(await bulk(ADMIN_A, "classId=cls-fv-nursery&month=November&studentIds=s-huz"));
    let a = d.vouchers[0].amounts;
    eq([a.paidDues, a.total], [1200, 3700], "partial payment shows in Paid Dues; Total is unchanged (not subtracted, not doubled)");
    const rev = await voucherAdjustPost(req(ADMIN_A, `http://x/api/vouchers/${pay.id}/adjust`, "POST", { type: "REVERSAL", reason: "Entered in error." }), paramsOf(pay.id));
    assert(rev.status === 200, "reversal accepted");
    d = await json(await bulk(ADMIN_A, "classId=cls-fv-nursery&month=November&studentIds=s-huz"));
    a = d.vouchers[0].amounts;
    eq([a.paidDues, a.total], [0, 3700], "a reversed payment no longer counts in Paid Dues");
    const dec = await json(await bulk(ADMIN_A, "classId=cls-fv-nursery&month=December&studentIds=s-laq"));
    eq(dec.vouchers[0].amounts.pendingFees, 3300 + 2300 + (3300 + 3000 + 500 - 300 - 800), "December pending carries Nov's unpaid balance once (Sep + Oct + Nov outstanding)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
