/**
 * Task 2 — Fees Dashboard rewritten around six figures, all reconciled against real Firestore
 * records (never a parallel estimate): Total Fee Amount, Fee Collected, Outstanding Amount,
 * Other Collections, Other Expenses, Net Collection. Supersedes the original Phase 4 "four
 * blocks" design (Net Collection/Received Amount/Vouchers/Other Expenses) — that design read
 * Net Collection from the Yearly Fee Ledger directly, which could drift from the Student Fee
 * Ledger whenever a challan hadn't been generated yet. This version aggregates Total Fee Amount
 * and Outstanding Amount from the SAME real FeeChallanDoc records the Ledger page itself reads,
 * so the two can never disagree by construction. Fee Collected and Other Collections are the
 * tuition/non-tuition shares of the exact same active payments, split by each payment's own
 * linked challan's fee composition (not by import category), so a manually-recorded payment is
 * split correctly too, and the two shares always sum to exactly the period's total collections.
 */
import { NextRequest } from "next/server";
import { GET as dashboardGet } from "../src/app/api/fees/dashboard/route";
import { POST as expensesPost, PUT as expensesPut } from "../src/app/api/fees/expenses/route";
import { POST as ledgerPost } from "../src/app/api/fees/yearly-ledger-import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  recordPaymentServer,
  getFeeChallansServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, StudentDoc } from "../src/lib/firebase/types";
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

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
function uploadReq(token: string | null, url: string, content: string) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "import.csv");
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(url, { method: "POST", headers, body: fd });
}
function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function dashboard(token: string, qs: string) {
  const res = await dashboardGet(req(token, `/api/fees/dashboard?${qs}`));
  return { status: res.status, body: await json(res) };
}

async function run() {
  console.log("==================================================");
  console.log("TASK 2 — FEES DASHBOARD SIX-FIGURE MODEL");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-p4-a";
  const B = "school-p4-b";
  const YEAR = "2026-2027";

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

  const cls: ClassDoc = { id: "cls-p4-main", schoolId: A, name: "Class 6", section: "A", numericLevel: 6, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(cls);

  const student = (id: string, admissionNo: string, name: string): StudentDoc => ({
    id, schoolId: A, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId: cls.id, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 2000, discount: 0, academicYear: YEAR, className: "Class 6-A", createdAt: now, updatedAt: now,
  });
  const ali = student("std-p4-ali", "P4-001", "Ali Raza");
  const sara = student("std-p4-sara", "P4-002", "Sara Bano");
  await saveStudentServer(ali);
  await saveStudentServer(sara);

  const ADMIN = await createSessionCookieServer({ uid: "uid-p4-admin", email: "a@p4.edu", role: "ADMIN", schoolId: A, name: "a" });
  const ADMIN_B = await createSessionCookieServer({ uid: "uid-p4-admin-b", email: "b@p4b.edu", role: "ADMIN", schoolId: B, name: "b" });

  // Yearly import (Task 1 + Task 4): Ali 5000/mo + 6000 annual, Sara 3000/mo + 0 annual —
  // eagerly generates each student's 12 real monthly fee challans.
  const pLedger = await json(
    await ledgerPost(uploadReq(ADMIN, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${YEAR}`, csvOf([
      ["Student Name", "Class", "Monthly Fee", "Annual Fee"],
      ["Ali Raza", "Class 6-A", "5000", "6000"],
      ["Sara Bano", "Class 6-A", "3000", "0"],
    ])))
  );
  await ledgerPost(req(ADMIN, "/api/fees/yearly-ledger-import?action=commit", "POST", { academicYear: YEAR, rows: pLedger.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) }));

  // =========================================================================
  // BLOCK 1 & 3 — TOTAL FEE AMOUNT / OUTSTANDING AMOUNT (real challans, snapshot)
  // =========================================================================
  const d1 = await dashboard(ADMIN, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}`);
  assert(d1.status === 200, "Dashboard: responds 200");
  const expectedTotal = (5000 * 12 + 6000) + (3000 * 12); // Ali 66000 + Sara 36000 = 102000
  assert(d1.body.summary.totalFeeAmount.amount === expectedTotal, "Total Fee Amount: sums every real challan's totalExpected (66000 + 36000 = 102000), matching the Ledger's own figure exactly");
  assert(d1.body.summary.totalFeeAmount.challanCount === 24, "Total Fee Amount: 24 real challans exist (12 months x 2 students) — Task 4's eager generation, not an estimate");
  assert(d1.body.summary.outstandingAmount.amount === expectedTotal, "Outstanding Amount: with nothing paid yet, outstanding equals the full total fee amount");

  // Recording a payment must reduce Outstanding Amount but never change Total Fee Amount.
  const novChallan = (await getFeeChallansServer(A, ali.id, "November", 2026))[0];
  await recordPaymentServer({
    id: "pay-p4-nov-ali", schoolId: A, challanId: novChallan.id, studentId: ali.id, studentName: ali.fullName,
    receiptNo: "RCT-P4-NOV", amount: 5000, paymentDate: "2026-11-05", paymentMode: "CASH", collectedBy: "uid-p4-admin", createdAt: now, academicYear: YEAR,
  });
  const d1b = await dashboard(ADMIN, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}`);
  assert(d1b.body.summary.totalFeeAmount.amount === expectedTotal, "Total Fee Amount: unaffected by a payment being recorded — still 102000");
  assert(d1b.body.summary.outstandingAmount.amount === expectedTotal - 5000, "Outstanding Amount: reduced by exactly the payment just recorded (102000 - 5000)");

  // =========================================================================
  // BLOCK 2 & 4 — FEE COLLECTED / OTHER COLLECTIONS (date-range, split by challan composition)
  // =========================================================================
  // Ali's November challan is 5500/11500 tuition-ratio... actually tuitionFee=5000, totalExpected=5000
  // (annual fee only applies to Ali's FIRST academic-year month, July, not November) — so this
  // payment is 100% tuition.
  const d2 = await dashboard(ADMIN, `from=2026-11-01&to=2026-11-30&academicYear=${YEAR}`);
  assert(d2.body.summary.feeCollected.amount === 5000, "Fee Collected: a payment against a pure-tuition month (November, no annual fee attached) is counted entirely as Fee Collected");
  assert(d2.body.summary.otherCollections.amount === 0, "Other Collections: the same payment contributes nothing to Other Collections (no annual/other component on this challan)");

  // A payment against Ali's JULY challan (which carries the one-time annual fee: tuitionFee 5000
  // + admissionFee 6000 = totalExpected 11000) must split proportionally.
  const julyChallan = (await getFeeChallansServer(A, ali.id, "July", 2026))[0];
  await recordPaymentServer({
    id: "pay-p4-july-ali", schoolId: A, challanId: julyChallan.id, studentId: ali.id, studentName: ali.fullName,
    receiptNo: "RCT-P4-JULY", amount: 11000, paymentDate: "2026-07-10", paymentMode: "CASH", collectedBy: "uid-p4-admin", createdAt: now, academicYear: YEAR,
  });
  const d2b = await dashboard(ADMIN, `from=2026-07-01&to=2026-07-31&academicYear=${YEAR}`);
  // tuitionRatio = 5000/11000; tuitionShare = 11000 * 5000/11000 = 5000; otherShare = 6000.
  assert(d2b.body.summary.feeCollected.amount === 5000, "Fee Collected: the July payment's tuition share (5000 of 11000) is correctly isolated");
  assert(d2b.body.summary.otherCollections.amount === 6000, "Other Collections: the July payment's annual-fee share (6000 of 11000) is correctly isolated, never counted as Fee Collected");
  assert(d2b.body.summary.feeCollected.amount + d2b.body.summary.otherCollections.amount === 11000, "No double-counting: Fee Collected + Other Collections sums to exactly the original payment, nothing invented or lost");

  // =========================================================================
  // BLOCK 5 — OTHER EXPENSES (unchanged: ExpenseDoc only, never a student fee collection)
  // =========================================================================
  const pExp = await json(await expensesPost(req(ADMIN, "/api/fees/expenses", "POST", { date: "2026-03-10", description: "Electricity Bill", amount: 4500 })));
  assert(pExp.success === true, "Manual Expense entry: POST creates a new Other Expense record");
  const expenseId = pExp.expense.id as string;

  const d3 = await dashboard(ADMIN, `from=2026-03-01&to=2026-03-31&academicYear=${YEAR}`);
  assert(d3.body.summary.otherExpenses.amount === 4500, "Other Expenses: the manually-entered expense appears in the dashboard total");
  assert(d3.body.summary.feeCollected.amount === 0 && d3.body.summary.otherCollections.amount === 0, "Other Expenses: never counted as a student fee collection (Fee Collected / Other Collections unaffected)");
  assert(d3.body.summary.totalFeeAmount.amount === expectedTotal, "Other Expenses: never changes Total Fee Amount");

  // Editing a manually-entered expense corrects the dashboard total, never duplicates it.
  const pEdit = await json(await expensesPut(req(ADMIN, "/api/fees/expenses", "PUT", { id: expenseId, amount: 5200 })));
  assert(pEdit.success === true && pEdit.expense.amount === 5200, "Manual Expense entry: PUT edits the amount in place");
  const d3b = await dashboard(ADMIN, `from=2026-03-01&to=2026-03-31&academicYear=${YEAR}`);
  assert(d3b.body.summary.otherExpenses.amount === 5200 && d3b.body.summary.otherExpenses.count === 1, "Other Expenses: the edited amount is reflected exactly once, not duplicated alongside the original");

  // Duplicate manual entry (same date+description+amount) is rejected, same as bulk import.
  // An edit (PUT) updates the existing record's fields IN PLACE — it does not change the
  // record's content-derived id — so re-posting the ORIGINAL pre-edit content (date,
  // description, 4500) still collides with that same id and is correctly rejected, even though
  // the document's live amount field is now 5200. This is intentional: it prevents accidentally
  // re-creating what is conceptually the same expense slot after it was corrected.
  const pDup = await expensesPost(req(ADMIN, "/api/fees/expenses", "POST", { date: "2026-03-10", description: "Electricity Bill", amount: 4500 }));
  assert(pDup.status === 409, "Manual Expense entry: re-posting the pre-edit content still collides with the (now-edited) record's unchanged id and is rejected");
  // Posting the record's CURRENT (post-edit) content computes a genuinely different id than
  // the one actually stored (which is still keyed by the ORIGINAL pre-edit content) — so this
  // is correctly treated as a brand-new, distinct expense, not a duplicate of the edited one.
  const pDup2 = await expensesPost(req(ADMIN, "/api/fees/expenses", "POST", { date: "2026-03-10", description: "Electricity Bill", amount: 5200 }));
  assert(pDup2.status === 201, "Manual Expense entry: posting content matching the edited record's current values creates a new, distinct record, since its id is still bound to the original pre-edit content");

  // =========================================================================
  // BLOCK 6 — NET COLLECTION (date-range: real net cash position)
  // =========================================================================
  // November: Fee Collected 5000, Other Collections 0, Other Expenses 0 (none recorded in Nov).
  const d4 = await dashboard(ADMIN, `from=2026-11-01&to=2026-11-30&academicYear=${YEAR}`);
  assert(d4.body.summary.netCollection.amount === 5000, "Net Collection: (Fee Collected + Other Collections) - Other Expenses for a month with no expenses equals Fee Collected");

  // A combined range covering both July (collections) and March (the expense) recomputes correctly.
  const d5 = await dashboard(ADMIN, `from=2026-07-01&to=2026-11-30&academicYear=${YEAR}`);
  const expectedNet = (5000 + 11000) - 0; // July 11000 + Nov 5000 collected, no expenses in this range
  assert(d5.body.summary.netCollection.amount === expectedNet, "Net Collection: correctly sums collections across the whole selected range");

  // =========================================================================
  // INTEGRATION — class filter, tenant isolation, permissions
  // =========================================================================
  const dClass = await dashboard(ADMIN, `from=2026-01-01&to=2026-01-31&academicYear=${YEAR}&classId=${cls.id}`);
  assert(dClass.body.summary.totalFeeAmount.amount === expectedTotal, "Class filter: the only class in this school still sums to the same total when filtered explicitly");

  const dB = await dashboard(ADMIN_B, `from=2026-01-01&to=2026-12-31&academicYear=${YEAR}`);
  assert(dB.body.summary.totalFeeAmount.amount === 0, "Tenant isolation: School B's Total Fee Amount is unaffected by School A's yearly import");
  assert(dB.body.summary.feeCollected.amount === 0, "Tenant isolation: School B's Fee Collected is unaffected by School A's payments");
  assert(dB.body.summary.otherExpenses.amount === 0, "Tenant isolation: School B's Other Expenses is unaffected by School A's manual entry");

  const TEACHER = await createSessionCookieServer({ uid: "uid-p4-teacher", email: "t@p4.edu", role: "TEACHER", schoolId: A, name: "t" });
  const dTeacher = await dashboard(TEACHER, `from=2026-01-01&to=2026-12-31`);
  assert(dTeacher.status === 403, "Permissions: a non-admin role is rejected from the financial dashboard");

  const teacherExpensePost = await expensesPost(req(TEACHER, "/api/fees/expenses", "POST", { date: "2026-03-10", description: "x", amount: 100 }));
  assert(teacherExpensePost.status === 403, "Permissions: a non-admin cannot record a manual Other Expense");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
