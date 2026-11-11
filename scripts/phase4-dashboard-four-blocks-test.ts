/**
 * Phase 4 — Fees Dashboard restructured around FOUR independent financial blocks:
 *   1. Net Collection   — YearlyFeeLedgerDoc.yearlyExpectedFee (expected, never touched by payments)
 *   2. Received Amount  — PaymentDoc, active only (actual money received)
 *   3. Vouchers         — the SAME active PaymentDoc records as (2), presented as counts
 *   4. Other Expenses   — ExpenseDoc only (never double-counted with its linked TransactionDoc)
 * See src/app/api/fees/dashboard/route.ts.
 */
import { NextRequest } from "next/server";
import { GET as dashboardGet } from "../src/app/api/fees/dashboard/route";
import { POST as importPost } from "../src/app/api/fees/transaction-import/route";
import { POST as ledgerPost } from "../src/app/api/fees/yearly-ledger-import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  recordPaymentServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, PaymentDoc, StudentDoc } from "../src/lib/firebase/types";
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

function uploadReq(token: string | null, url: string, content: string) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "import.csv");
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(url, { method: "POST", headers, body: fd });
}
function jsonReq(token: string | null, url: string, body: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  headers.set("content-type", "application/json");
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}
function getReq(token: string | null, url: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(url, { method: "GET", headers });
}
function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function previewDaily(token: string, rows: string[][]) {
  const header = ["Day & Date", "Category", "Details", "Class", "Amount"];
  const res = await importPost(uploadReq(token, "http://x/api/fees/transaction-import?action=preview", csvOf([header, ...rows])));
  return json(res);
}
async function commitDaily(token: string, fileName: string, results: any[]) {
  const res = await importPost(jsonReq(token, "http://x/api/fees/transaction-import?action=commit", { fileName, results }));
  return { status: res.status, body: await json(res) };
}
async function dashboard(token: string, qs: string) {
  const res = await dashboardGet(getReq(token, `http://x/api/fees/dashboard?${qs}`));
  return { status: res.status, body: await json(res) };
}

async function run() {
  console.log("==================================================");
  console.log("PHASE 4 — FEES DASHBOARD FOUR-BLOCK RESTRUCTURING");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-p4-a";
  const B = "school-p4-b"; // tenant isolation
  const YEAR = "2025-2026";

  await updateSchoolSettingsServer({
    id: A, schoolId: A, schoolName: "School P4", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@p4.edu", principalName: "Principal", academicYear: YEAR,
    gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now, timezone: "Asia/Karachi",
  } as any);
  await updateSchoolSettingsServer({
    id: B, schoolId: B, schoolName: "School P4-B", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@p4b.edu", principalName: "Principal", academicYear: YEAR,
    gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
  } as any);

  const classA: ClassDoc = { id: "cls-p4-a", schoolId: A, name: "Class 6", section: "A", numericLevel: 6, capacity: 40, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(classA);

  const student = (id: string, admissionNo: string, name: string, schoolId: string): StudentDoc => ({
    id, schoolId, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId: classA.id, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 2000, discount: 0, academicYear: YEAR, className: "Class 6-A", createdAt: now, updatedAt: now,
  });
  const ali = student("std-p4-ali", "P4-001", "Ali Raza", A);
  const sara = student("std-p4-sara", "P4-002", "Sara Bano", A);
  await saveStudentServer(ali);
  await saveStudentServer(sara);

  const ADMIN_A = await createSessionCookieServer({ uid: "uid-p4-admin-a", email: "a@p4.edu", role: "ADMIN", schoolId: A, name: "a" });
  const ADMIN_B = await createSessionCookieServer({ uid: "uid-p4-admin-b", email: "b@p4b.edu", role: "ADMIN", schoolId: B, name: "b" });

  // Yearly ledger: Ali 5000/mo + 6000 annual => 66000 expected; Sara 3000/mo + 0 annual => 36000 expected.
  const pLedger = await json(
    await ledgerPost(uploadReq(ADMIN_A, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${YEAR}`, csvOf([
      ["Admission No", "Student Name", "Monthly Fee", "Annual Fee"],
      ["P4-001", "Ali Raza", "5000", "6000"],
      ["P4-002", "Sara Bano", "3000", "0"],
    ])))
  );
  await ledgerPost(jsonReq(ADMIN_A, "http://x/api/fees/yearly-ledger-import?action=commit", { academicYear: YEAR, rows: pLedger.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) }));

  // =========================================================================
  // BLOCK 1 — NET COLLECTION
  // =========================================================================
  const d1 = await dashboard(ADMIN_A, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}`);
  assert(d1.status === 200, "Net Collection: dashboard responds 200");
  assert(d1.body.summary.netCollection.amount === 66000 + 36000, "Net Collection: sums yearlyExpectedFee across both students (5000*12+6000=66000, 3000*12+0=36000 => 102000)");
  assert(d1.body.summary.netCollection.studentCount === 2, "Net Collection: counts both ledger students");

  // Recording an actual payment must NOT move Net Collection at all — it is expected-fee only.
  const novChallan: FeeChallanDoc = {
    id: "ch-p4-nov-ali", schoolId: A, studentId: ali.id, studentName: ali.fullName, classId: classA.id, className: "Class 6-A",
    challanNo: "CHL-P4-NOV", month: "November", year: 2026, issueDate: "2026-11-01", dueDate: "2026-11-10", tuitionFee: 5000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 5000, paidAmount: 0, balanceAmount: 5000,
    status: "PENDING", academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(novChallan);
  await recordPaymentServer({
    id: "pay-p4-nov-ali", schoolId: A, challanId: novChallan.id, studentId: ali.id, studentName: ali.fullName,
    receiptNo: "RCT-P4-NOV", amount: 5000, paymentDate: "2026-11-05", paymentMode: "CASH", collectedBy: "uid-p4-admin-a", createdAt: now, academicYear: YEAR,
  });
  const d1b = await dashboard(ADMIN_A, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}`);
  assert(d1b.body.summary.netCollection.amount === 102000, "Net Collection: unaffected by a payment being recorded — still 102000");

  // New student added to the ledger increases Net Collection.
  const zara = student("std-p4-zara", "P4-003", "Zara Khan", A);
  await saveStudentServer(zara);
  const pLedgerZ = await json(
    await ledgerPost(uploadReq(ADMIN_A, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${YEAR}`, csvOf([
      ["Admission No", "Student Name", "Monthly Fee", "Annual Fee"],
      ["P4-003", "Zara Khan", "4000", "1000"],
    ])))
  );
  await ledgerPost(jsonReq(ADMIN_A, "http://x/api/fees/yearly-ledger-import?action=commit", { academicYear: YEAR, rows: pLedgerZ.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) }));
  const d1c = await dashboard(ADMIN_A, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}`);
  assert(d1c.body.summary.netCollection.amount === 102000 + (4000 * 12 + 1000), "Net Collection: a new ledger entry (Zara, 49000) increases the total to 151000");
  assert(d1c.body.summary.netCollection.studentCount === 3, "Net Collection: student count increases to 3");

  // Fee update (re-import changes Ali's fee) must be reflected, not accumulated as a duplicate.
  const pLedgerUpd = await json(
    await ledgerPost(uploadReq(ADMIN_A, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${YEAR}`, csvOf([
      ["Admission No", "Student Name", "Monthly Fee", "Annual Fee"],
      ["P4-001", "Ali Raza", "6000", "6000"],
    ])))
  );
  await ledgerPost(jsonReq(ADMIN_A, "http://x/api/fees/yearly-ledger-import?action=commit", { academicYear: YEAR, allowUpdates: true, rows: pLedgerUpd.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) }));
  const d1d = await dashboard(ADMIN_A, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}`);
  assert(d1d.body.summary.netCollection.studentCount === 3, "Net Collection: a fee UPDATE for an existing student does not add a duplicate ledger row");
  assert(d1d.body.summary.netCollection.amount === (6000 * 12 + 6000) + 36000 + 49000, "Net Collection: Ali's updated fee (78000) replaces his old figure, not adds to it");

  // Academic-year filtering: a different academic year's ledger is entirely separate.
  const OTHER_YEAR = "2024-2025";
  const d1e = await dashboard(ADMIN_A, `from=2026-01-01&to=2026-01-31&academicYear=${OTHER_YEAR}`);
  assert(d1e.body.summary.netCollection.amount === 0, "Net Collection: a different academic year with no ledger entries shows zero, not the active year's total");

  // =========================================================================
  // BLOCK 2 — RECEIVED AMOUNT
  // =========================================================================
  const decChallanSara: FeeChallanDoc = {
    id: "ch-p4-dec-sara", schoolId: A, studentId: sara.id, studentName: sara.fullName, classId: classA.id, className: "Class 6-A",
    challanNo: "CHL-P4-DEC-S", month: "December", year: 2026, issueDate: "2026-12-01", dueDate: "2026-12-10", tuitionFee: 3000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 3000, paidAmount: 0, balanceAmount: 3000,
    status: "PENDING", academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(decChallanSara);
  // Partial payment.
  await recordPaymentServer({
    id: "pay-p4-dec-sara-partial", schoolId: A, challanId: decChallanSara.id, studentId: sara.id, studentName: sara.fullName,
    receiptNo: "RCT-P4-DEC-S1", amount: 1000, paymentDate: "2026-12-03", paymentMode: "CASH", collectedBy: "uid-p4-admin-a", createdAt: now, academicYear: YEAR,
  });
  // Second, separate payment the same month.
  await recordPaymentServer({
    id: "pay-p4-dec-sara-rest", schoolId: A, challanId: decChallanSara.id, studentId: sara.id, studentName: sara.fullName,
    receiptNo: "RCT-P4-DEC-S2", amount: 2000, paymentDate: "2026-12-15", paymentMode: "CASH", collectedBy: "uid-p4-admin-a", createdAt: now, academicYear: YEAR,
  });
  // A reversed payment that must be EXCLUDED from Received Amount.
  await recordPaymentServer({
    id: "pay-p4-dec-sara-reversed", schoolId: A, challanId: decChallanSara.id, studentId: sara.id, studentName: sara.fullName,
    receiptNo: "RCT-P4-DEC-S3", amount: 9999, paymentDate: "2026-12-20", paymentMode: "CASH", collectedBy: "uid-p4-admin-a", createdAt: now,
    academicYear: YEAR, voucherStatus: "REVERSED",
  });

  const d2 = await dashboard(ADMIN_A, `from=2026-12-01&to=2026-12-31&academicYear=${YEAR}`);
  assert(d2.body.summary.receivedAmount.amount === 3000, "Received Amount: sums only active payments in range (1000+2000=3000), excluding the reversed 9999");
  assert(d2.body.summary.receivedAmount.paymentCount === 2, "Received Amount: counts exactly the 2 active payments, not the reversed one");

  // Multiple payments across different students in range.
  const d2b = await dashboard(ADMIN_A, `from=2026-11-01&to=2026-12-31&academicYear=${YEAR}`);
  assert(d2b.body.summary.receivedAmount.amount === 5000 + 3000, "Received Amount: aggregates across multiple students correctly (Ali 5000 + Sara's 3000)");

  // =========================================================================
  // BLOCK 3 — VOUCHERS
  // =========================================================================
  assert(d2.body.summary.vouchers !== undefined, "Vouchers: block present in response");
  assert(d2.body.summary.vouchers.totalCount === d2.body.summary.receivedAmount.paymentCount, "Vouchers: totalCount matches Received Amount's active payment count for the same range");
  assert(d2.body.summary.vouchers.totalAmount === d2.body.summary.receivedAmount.amount, "Vouchers: totalAmount matches Received Amount exactly — same source data, no double counting");

  // Daily/monthly voucher figures are fixed to "today"/"this month" in the school's timezone,
  // not the requested [from,to] filter. We only assert structural sanity here since "today" is
  // relative to actual run time, not the historical 2026 fixtures above.
  const d3 = await dashboard(ADMIN_A, `from=2026-01-01&to=2026-01-31`);
  assert(typeof d3.body.summary.vouchers.dailyCount === "number", "Vouchers: dailyCount is present and numeric");
  assert(typeof d3.body.summary.vouchers.monthlyCount === "number", "Vouchers: monthlyCount is present and numeric");
  assert(d3.body.summary.vouchers.dailyAmount >= 0 && d3.body.summary.vouchers.monthlyAmount >= 0, "Vouchers: daily/monthly amounts are non-negative");

  // A multi-month-allocated payment (two PaymentDoc rows from one import row) counts as TWO
  // voucher records, matching Received Amount exactly, never collapsed or double counted.
  const janChallanAli: FeeChallanDoc = {
    id: "ch-p4-jan-ali", schoolId: A, studentId: ali.id, studentName: ali.fullName, classId: classA.id, className: "Class 6-A",
    challanNo: "CHL-P4-JAN", month: "January", year: 2027, issueDate: "2027-01-01", dueDate: "2027-01-10", tuitionFee: 6000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 6000, paidAmount: 0, balanceAmount: 6000,
    status: "PENDING", academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  const febChallanAli: FeeChallanDoc = {
    id: "ch-p4-feb-ali", schoolId: A, studentId: ali.id, studentName: ali.fullName, classId: classA.id, className: "Class 6-A",
    challanNo: "CHL-P4-FEB", month: "February", year: 2027, issueDate: "2027-02-01", dueDate: "2027-02-10", tuitionFee: 6000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 6000, paidAmount: 0, balanceAmount: 6000,
    status: "PENDING", academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(janChallanAli);
  await saveFeeChallanServer(febChallanAli);
  await recordPaymentServer({ id: "pay-p4-jan-ali", schoolId: A, challanId: janChallanAli.id, studentId: ali.id, studentName: ali.fullName, receiptNo: "RCT-P4-JAN", amount: 6000, paymentDate: "2027-01-05", paymentMode: "CASH", collectedBy: "uid-p4-admin-a", createdAt: now, academicYear: YEAR });
  await recordPaymentServer({ id: "pay-p4-feb-ali-partial", schoolId: A, challanId: febChallanAli.id, studentId: ali.id, studentName: ali.fullName, receiptNo: "RCT-P4-FEB", amount: 2500, paymentDate: "2027-01-05", paymentMode: "CASH", collectedBy: "uid-p4-admin-a", createdAt: now, academicYear: YEAR });
  const d3b = await dashboard(ADMIN_A, `from=2027-01-01&to=2027-01-31&academicYear=${YEAR}`);
  assert(d3b.body.summary.vouchers.totalCount === 2, "Vouchers: a payment allocated across two challans on the same date produces exactly 2 voucher records, matching the 2 underlying payments");
  assert(d3b.body.summary.vouchers.totalAmount === 8500, "Vouchers: the two allocation receipts sum correctly (6000+2500=8500), not double-counted as one giant figure");

  // =========================================================================
  // BLOCK 4 — OTHER EXPENSES
  // =========================================================================
  const pExp = await previewDaily(ADMIN_A, [
    ["10-3-2026", "Other Expenses", "Electricity Bill", "N/A", "4500"],
    ["12-3-2026", "Other Expenses", "Stationery Purchase", "N/A", "1200"],
  ]);
  assert(pExp.summary.results.every((r: any) => r.status === "VALID"), "Other Expenses: both import rows preview as VALID");
  const cExp = await commitDaily(ADMIN_A, "expenses-march.csv", pExp.summary.results);
  assert(cExp.body.successCount === 2, "Other Expenses: both rows commit successfully");

  const d4 = await dashboard(ADMIN_A, `from=2026-03-01&to=2026-03-31&academicYear=${YEAR}`);
  assert(d4.body.summary.otherExpenses.amount === 5700, "Other Expenses: dashboard total sums ExpenseDoc records (4500+1200=5700)");
  assert(d4.body.summary.otherExpenses.count === 2, "Other Expenses: record count is 2");
  assert(Array.isArray(d4.body.expenses) && d4.body.expenses.length === 2, "Other Expenses: individual records are exposed in the response for drill-down");

  // Never double-counted with its own linked TransactionDoc: Received Amount and Net Collection
  // must be completely untouched by these expense rows.
  assert(d4.body.summary.receivedAmount.amount === 0, "Other Expenses: does not leak into Received Amount for this date range (no payments recorded in March 2026)");
  const d4ledger = await dashboard(ADMIN_A, `from=2026-03-01&to=2026-03-31&academicYear=${YEAR}`);
  assert(d4ledger.body.summary.netCollection.amount === d1d.body.summary.netCollection.amount, "Other Expenses: importing expenses never changes Net Collection");

  // Re-importing the identical rows must not duplicate them (existing dedup/idempotency guard).
  const pExpDup = await previewDaily(ADMIN_A, [["10-3-2026", "Other Expenses", "Electricity Bill", "N/A", "4500"]]);
  assert(pExpDup.summary.results[0].status !== "VALID" || pExpDup.summary.results[0].isDuplicate, "Other Expenses: preview flags the identical row as a duplicate (or invalid) rather than silently re-offering it as importable");

  // Daily/monthly breakdown for expenses is numerically sane.
  assert(d4.body.summary.otherExpenses.dailyAmount >= 0 && d4.body.summary.otherExpenses.monthlyAmount >= 0, "Other Expenses: daily/monthly figures are non-negative");

  // =========================================================================
  // INTEGRATION — cross-block reconciliation, filters, tenant isolation
  // =========================================================================

  // Every block's underlying numbers reconcile against directly-queried source data.
  const novToDec = await dashboard(ADMIN_A, `from=2026-11-01&to=2026-12-31&academicYear=${YEAR}`);
  const expectedReceived = 5000 /* Ali Nov */ + 1000 + 2000 /* Sara Dec active */;
  assert(novToDec.body.summary.receivedAmount.amount === expectedReceived, "Integration: Received Amount for Nov-Dec reconciles with the individually recorded active payments");

  // Date filters actually narrow the result set.
  const narrow = await dashboard(ADMIN_A, `from=2026-12-01&to=2026-12-01&academicYear=${YEAR}`);
  assert(narrow.body.summary.receivedAmount.amount === 0, "Integration: a date filter excluding all payment dates correctly returns zero received amount");

  // Tenant isolation: School B sees none of School A's data.
  const dB = await dashboard(ADMIN_B, `from=2026-01-01&to=2026-12-31&academicYear=${YEAR}`);
  assert(dB.body.summary.netCollection.amount === 0, "Integration: tenant isolation — School B's Net Collection is unaffected by School A's ledger");
  assert(dB.body.summary.receivedAmount.amount === 0, "Integration: tenant isolation — School B's Received Amount is unaffected by School A's payments");
  assert(dB.body.summary.otherExpenses.amount === 0, "Integration: tenant isolation — School B's Other Expenses is unaffected by School A's imports");

  // Authorization: a non-admin cannot read the dashboard.
  const TEACHER_A = await createSessionCookieServer({ uid: "uid-p4-teacher-a", email: "t@p4.edu", role: "TEACHER", schoolId: A, name: "t" });
  const dTeacher = await dashboard(TEACHER_A, `from=2026-01-01&to=2026-12-31`);
  assert(dTeacher.status === 403, "Integration: a non-admin role is rejected from the financial dashboard");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
