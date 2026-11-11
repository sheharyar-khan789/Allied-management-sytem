/**
 * Phase 3 — automatic voucher generation (Daily Import's payments ARE the vouchers, per the
 * existing "no separate vouchers collection" architecture — see PaymentDoc/getVoucherDailySummaryServer),
 * Voucher Management integration, and the academic-year correction (the school's configured
 * SchoolSettingsDoc.academicYear is now authoritative, never derived from a payment's own
 * calendar date).
 */
import { NextRequest } from "next/server";
import { POST as importPost } from "../src/app/api/fees/transaction-import/route";
import { GET as vouchersGet } from "../src/app/api/vouchers/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  recordPaymentServer,
  updateSchoolSettingsServer,
  getFeeChallansServer,
  getPaymentsByStudentServer,
  getAdvanceCreditServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, PaymentDoc, StudentDoc } from "../src/lib/firebase/types";
import { DEFAULT_GRADING_SCALE } from "../src/lib/exam-results";
import { POST as ledgerPost } from "../src/app/api/fees/yearly-ledger-import/route";

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
function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}
const json = async (res: Response) => res.json().catch(() => ({}));
const req = jsonReq; // readability alias for GET-style helper reuse below

async function previewDaily(token: string, rows: string[][]) {
  const header = ["Day & Date", "Category", "Details", "Class", "Amount"];
  const res = await importPost(uploadReq(token, "http://x/api/fees/transaction-import?action=preview", csvOf([header, ...rows])));
  return json(res);
}
async function commitDaily(token: string, fileName: string, results: any[]) {
  const res = await importPost(jsonReq(token, "http://x/api/fees/transaction-import?action=commit", { fileName, results }));
  return { status: res.status, body: await json(res) };
}
function getReq(token: string | null, url: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(url, { method: "GET", headers });
}

async function run() {
  console.log("==================================================");
  console.log("PHASE 3 — AUTOMATIC VOUCHER GENERATION + ACADEMIC YEAR CORRECTION");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-p3-a";
  const CONFIGURED_YEAR = "2025-2026"; // deliberately NOT what date-derivation would produce for Nov/Dec 2026 dates

  await updateSchoolSettingsServer({
    id: A, schoolId: A, schoolName: "School P3", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@p3.edu", principalName: "Principal", academicYear: CONFIGURED_YEAR,
    gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
  } as any);

  const classA: ClassDoc = { id: "cls-p3-a", schoolId: A, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, classTeacherId: null, academicYear: CONFIGURED_YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(classA);

  const student = (id: string, admissionNo: string, name: string): StudentDoc => ({
    id, schoolId: A, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId: classA.id, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 2000, discount: 0, academicYear: CONFIGURED_YEAR, className: "Class 5-A", createdAt: now, updatedAt: now,
  });
  const ali = student("std-p3-ali", "P3-001", "Ali Khan");
  const sara = student("std-p3-sara", "P3-002", "Sara Noor");
  const zainab = student("std-p3-zainab", "P3-005", "Zainab Riaz"); // dedicated to the historical-record test, so it never participates in Sara's own payment allocation
  await saveStudentServer(ali);
  await saveStudentServer(sara);
  await saveStudentServer(zainab);

  const ADMIN_A = await createSessionCookieServer({ uid: "uid-p3-admin-a", email: "a@x.edu", role: "ADMIN", schoolId: A, name: "a" });

  // Yearly ledger entry created under the CONFIGURED academic year (as the admin would do).
  const pLedger = await json(
    await ledgerPost(uploadReq(ADMIN_A, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${CONFIGURED_YEAR}`, csvOf([["Admission No", "Student Name", "Monthly Fee", "Annual Fee"], ["P3-001", "Ali Khan", "5000", "6000"]])))
  );
  await ledgerPost(jsonReq(ADMIN_A, "http://x/api/fees/yearly-ledger-import?action=commit", { academicYear: CONFIGURED_YEAR, rows: pLedger.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) }));

  // =========================================================================
  // ACADEMIC YEAR CORRECTION
  // =========================================================================

  // November payment: date-derivation would have produced "2026-2027"; the configured year is "2025-2026".
  const pNov = await previewDaily(ADMIN_A, [["15-11-2026", "Fees", "Ali Khan", "Class 5-A", "5000"]]);
  const cNov = await commitDaily(ADMIN_A, "nov.csv", pNov.summary.results);
  assert(cNov.body.successCount === 1, "Academic year: November payment imports successfully");
  const novChallan = (await getFeeChallansServer(A, ali.id, "November", 2026))[0];
  assert(novChallan.academicYear === CONFIGURED_YEAR, "Academic year: November challan is stamped with the school's CONFIGURED academic year, not calendar-year-derived 2026-2027");
  assert(novChallan.totalExpected === 5000, "Academic year: the correct Yearly Ledger entry was found using the configured year, so the challan's expected amount is correct (5000), not the StudentDoc fallback (2000)");

  // December payment: date-derivation would ALSO produce "2026-2027" for a Dec 2026 date.
  const pDec = await previewDaily(ADMIN_A, [["20-12-2026", "Fees", "Ali Khan", "Class 5-A", "5000"]]);
  const cDec = await commitDaily(ADMIN_A, "dec.csv", pDec.summary.results);
  assert(cDec.body.successCount === 1, "Academic year: December payment imports successfully");
  const decChallan = (await getFeeChallansServer(A, ali.id, "December", 2026))[0];
  assert(decChallan.academicYear === CONFIGURED_YEAR, "Academic year: December challan also correctly uses the configured academic year");

  // January payment: date-derivation's OLD bug would flip to "2027-2028"; the real academic
  // year has not changed just because the calendar flipped to a new year.
  const pJan = await previewDaily(ADMIN_A, [["10-1-2027", "Fees", "Ali Khan", "Class 5-A", "5000"]]);
  const cJan = await commitDaily(ADMIN_A, "jan.csv", pJan.summary.results);
  assert(cJan.body.successCount === 1, "Academic year: January payment imports successfully");
  const janChallan = (await getFeeChallansServer(A, ali.id, "January", 2027))[0];
  assert(janChallan.academicYear === CONFIGURED_YEAR, "Academic year: January does NOT automatically assume a new academic year — still the configured 2025-2026");
  assert(janChallan.totalExpected === 5000, "Academic year: January's expected amount also correctly comes from the Yearly Ledger (the lookup now uses the right academic year)");

  // Existing historical records are never silently rewritten: a challan stamped under the OLD
  // (pre-fix) date-derived convention keeps that value untouched by unrelated later writes.
  const historicalChallan: FeeChallanDoc = {
    id: "ch-p3-historical", schoolId: A, studentId: zainab.id, studentName: zainab.fullName, classId: classA.id, className: "Class 5-A",
    challanNo: "CHL-HIST", month: "March", year: 2026, issueDate: "2026-03-01", dueDate: "2026-03-10", tuitionFee: 2000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 2000, paidAmount: 0, balanceAmount: 2000,
    status: "PENDING", academicYear: "2026-2027" /* the OLD (now-superseded) date-derived value */, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(historicalChallan);
  await previewDaily(ADMIN_A, [["1-2-2027", "Fees", "Sara Noor", "Class 5-A", "100"]]); // unrelated activity
  // allSessions:true — this historical record is stamped with a different academicYear than
  // the school's currently configured session, so the default active-session-filtered read
  // would correctly exclude it; that's the existing session-isolation feature working as
  // designed, not what this assertion is checking. We need the raw stored value here.
  const historicalAfter = (await getFeeChallansServer(A, zainab.id, "March", 2026, undefined, undefined, { allSessions: true }))[0];
  assert(historicalAfter.academicYear === "2026-2027", "Academic year: a pre-existing historical challan's academicYear is never silently rewritten by later, unrelated activity");

  // =========================================================================
  // AUTOMATIC VOUCHER GENERATION (every successfully recorded payment IS a voucher)
  // =========================================================================

  const novVoucherSearch = await json(await vouchersGet(getReq(ADMIN_A, "http://x/api/vouchers?from=2026-11-15&to=2026-11-15")));
  const novVoucher = novVoucherSearch.vouchers?.find((v: any) => v.studentId === ali.id);
  assert(!!novVoucher, "Voucher generation: Ali's November Daily Import payment appears as a real voucher in Voucher Management");
  assert(novVoucher?.admissionNo === "P3-001", "Voucher generation: the voucher correctly shows Ali's admission number (sourced from the challan Daily Import now populates)");
  assert(novVoucher?.amount === 5000, "Voucher generation: the voucher shows the actual received amount (5000), not any expected/ledger figure");
  assert(novVoucher?.academicYear === CONFIGURED_YEAR, "Voucher generation: the voucher inherits the correct configured academic year from its challan");

  // Invalid / failed / duplicate rows never generate a voucher.
  const pInvalid = await previewDaily(ADMIN_A, [["1-12-2026", "Fees", "Totally Unknown Person", "Class 5-A", "1000"]]);
  assert(pInvalid.summary.results[0].status === "INVALID", "Voucher generation setup: the row is genuinely invalid");
  const cInvalid = await commitDaily(ADMIN_A, "invalid.csv", pInvalid.summary.results);
  assert(cInvalid.status === 400 || cInvalid.body.successCount === 0, "Voucher generation: an invalid row creates no voucher at all");

  // Partial payment creates a correct receipt (not the full expected amount).
  const pPartial = await previewDaily(ADMIN_A, [["5-2-2027", "Fees", "Ali Khan", "Class 5-A", "2000"]]);
  await commitDaily(ADMIN_A, "partial.csv", pPartial.summary.results);
  const febChallan = (await getFeeChallansServer(A, ali.id, "February", 2027))[0];
  const febPayments = (await getPaymentsByStudentServer(A, ali.id)).filter((p) => p.challanId === febChallan.id);
  assert(febPayments.length === 1 && febPayments[0].amount === 2000, "Voucher generation: a partial payment creates exactly one receipt for the actual partial amount received (2000), not the full expected fee");

  // Multiple-allocation payment: one row split across several months must NOT produce
  // several full-amount receipts — each receipt is for its own slice only, and they sum to
  // exactly the original amount.
  const octChallan: FeeChallanDoc = {
    id: "ch-p3-oct", schoolId: A, studentId: sara.id, studentName: sara.fullName, classId: classA.id, className: "Class 5-A",
    challanNo: "CHL-P3-OCT", month: "October", year: 2026, issueDate: "2026-10-01", dueDate: "2026-10-10", tuitionFee: 3000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 3000, paidAmount: 0, balanceAmount: 3000,
    status: "PENDING", academicYear: CONFIGURED_YEAR, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(octChallan);
  // Give Sara a yearly ledger entry too, so her November challan auto-creates with a real expected amount.
  const pLedgerSara = await json(
    await ledgerPost(uploadReq(ADMIN_A, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${CONFIGURED_YEAR}`, csvOf([["Admission No", "Student Name", "Monthly Fee", "Annual Fee"], ["P3-002", "Sara Noor", "3000", "0"]])))
  );
  await ledgerPost(jsonReq(ADMIN_A, "http://x/api/fees/yearly-ledger-import?action=commit", { academicYear: CONFIGURED_YEAR, rows: pLedgerSara.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) }));

  const pMulti = await previewDaily(ADMIN_A, [["10-11-2026", "Fees", "Sara Noor", "Class 5-A", "5500"]]); // 3000 for Oct + 3000 for Nov -> only covers Oct fully + partial Nov
  const cMulti = await commitDaily(ADMIN_A, "multi.csv", pMulti.summary.results);
  assert(cMulti.body.successCount === 1, "Voucher generation: a multi-month-allocated row still commits as one successful transaction");
  const sarasPayments = await getPaymentsByStudentServer(A, sara.id);
  const multiReceipts = sarasPayments.filter((p) => p.paymentDate === "2026-11-10");
  assert(multiReceipts.length === 2, "Voucher generation: a payment spanning two months produces exactly two receipts (one per challan), never one giant duplicate");
  assert(!multiReceipts.some((p) => p.amount === 5500), "Voucher generation: neither receipt carries the full original amount — each is only its own slice");
  const receiptsSum = multiReceipts.reduce((s, p) => s + p.amount, 0);
  assert(receiptsSum === 5500, "Voucher generation: the receipts' amounts sum to exactly the original payment, nothing lost or invented");
  // Allocation order (documented in planPaymentAllocation): the row's OWN targeted month
  // first (November, in full), then other outstanding months oldest-first for the remainder
  // (October, partially) — not a blind "oldest always first" which would misapply money to a
  // month the row was never actually dated for.
  const novReceipt = multiReceipts.find((p) => p.challanId !== octChallan.id);
  assert(novReceipt?.amount === 3000, "Voucher generation: the row's own targeted month (November) is fully settled first, in full");
  const octReceipt = multiReceipts.find((p) => p.challanId === octChallan.id);
  assert(octReceipt?.amount === 2500, "Voucher generation: the remainder (2500) correctly flows to the next-oldest outstanding month (October)");

  // Advance credit represented transparently on the receipt.
  const pAdvance = await previewDaily(ADMIN_A, [["12-11-2026", "Fees", "Sara Noor", "Class 5-A", "10000"]]);
  const cAdvance = await commitDaily(ADMIN_A, "advance.csv", pAdvance.summary.results);
  assert(cAdvance.body.successCount === 1, "Voucher generation: the overpayment row still commits successfully");
  const advanceCredit = await getAdvanceCreditServer(A, sara.id);
  assert((advanceCredit?.balance || 0) > 0, "Voucher generation: a payment exceeding every outstanding due creates advance credit");
  const latestSaraPayments = (await getPaymentsByStudentServer(A, sara.id)).filter((p) => p.paymentDate === "2026-11-12");
  assert(latestSaraPayments.some((p) => /advance credit/i.test(p.notes || "")), "Voucher generation: the advance credit amount is transparently noted on the receipt that produced it");

  // Concurrent imports create exactly one voucher.
  const pConc = await previewDaily(ADMIN_A, [["1-3-2027", "Fees", "Ali Khan", "Class 5-A", "1234"]]);
  const [r1, r2] = await Promise.all([
    commitDaily(ADMIN_A, "conc.csv", pConc.summary.results),
    commitDaily(ADMIN_A, "conc.csv", pConc.summary.results),
  ]);
  const concTotal = (r1.body.successCount || 0) + (r2.body.successCount || 0);
  assert(concTotal === 1, "Voucher generation: two concurrent imports of the identical row produce exactly one successful commit, never two vouchers");
  const marChallan = (await getFeeChallansServer(A, ali.id, "March", 2027))[0];
  const marPayments = (await getPaymentsByStudentServer(A, ali.id)).filter((p) => p.challanId === marChallan?.id);
  assert(marPayments.length === 1, "Voucher generation: exactly one real payment/voucher exists for the concurrently-submitted row, not two");

  // Retry safety: calling recordPaymentServer twice with the IDENTICAL deterministic payment id
  // must apply the amount only once — this is the exact mechanism that makes "retry after a
  // partial mid-row failure" safe, since each allocation line has its own idempotent id.
  const retryTestChallan: FeeChallanDoc = {
    id: "ch-p3-retry", schoolId: A, studentId: ali.id, studentName: ali.fullName, classId: classA.id, className: "Class 5-A",
    challanNo: "CHL-P3-RETRY", month: "April", year: 2027, issueDate: "2027-04-01", dueDate: "2027-04-10", tuitionFee: 5000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 5000, paidAmount: 0, balanceAmount: 5000,
    status: "PENDING", academicYear: CONFIGURED_YEAR, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(retryTestChallan);
  const retryPayment: PaymentDoc = {
    id: "pay-p3-retry-fixed-id", schoolId: A, challanId: retryTestChallan.id, studentId: ali.id, studentName: ali.fullName,
    receiptNo: "RCT-P3-RETRY", amount: 2000, paymentDate: "2027-04-05", paymentMode: "CASH", collectedBy: "uid-p3-admin-a", createdAt: now,
  };
  await recordPaymentServer({ ...retryPayment });
  await recordPaymentServer({ ...retryPayment }); // simulated retry of the exact same payment
  const retriedChallan = (await getFeeChallansServer(A, ali.id, "April", 2027))[0];
  assert(retriedChallan.paidAmount === 2000, "Retry safety: retrying the identical payment id applies the amount exactly once (2000), never twice (would be 4000)");

  // Existing manually generated vouchers remain unaffected by any of this.
  const manualChallan: FeeChallanDoc = {
    id: "ch-p3-manual", schoolId: A, studentId: sara.id, studentName: sara.fullName, classId: classA.id, className: "Class 5-A",
    challanNo: "CHL-P3-MANUAL", month: "May", year: 2027, issueDate: "2027-05-01", dueDate: "2027-05-10", tuitionFee: 3000,
    admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 3000, paidAmount: 0, balanceAmount: 3000,
    status: "PENDING", academicYear: CONFIGURED_YEAR, createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(manualChallan);
  const manualPayment: PaymentDoc = {
    id: "pay-p3-manual-1", schoolId: A, challanId: manualChallan.id, studentId: sara.id, studentName: sara.fullName,
    receiptNo: "RCT-P3-MANUAL", amount: 3000, paymentDate: "2027-05-02", paymentMode: "BANK_TRANSFER",
    notes: "Manually recorded by admin at the counter", collectedBy: "uid-p3-admin-a", createdAt: now,
  };
  await recordPaymentServer(manualPayment);
  const manualVoucherSearch = await json(await vouchersGet(getReq(ADMIN_A, "http://x/api/vouchers?from=2027-05-02&to=2027-05-02")));
  const manualVoucher = manualVoucherSearch.vouchers?.find((v: any) => v.studentId === sara.id);
  assert(manualVoucher?.amount === 3000 && manualVoucher?.notes === "Manually recorded by admin at the counter", "Voucher generation: an existing manually-recorded voucher is completely unaffected and still appears correctly");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
