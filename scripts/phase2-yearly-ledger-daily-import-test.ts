/**
 * Phase 2 — commit-time data integrity, the Yearly Fee Ledger, and the rewired Daily Import
 * (actual received payments). Exercises the real routes end to end wherever practical, same
 * convention as the Phase 1 suite.
 */
import { NextRequest } from "next/server";
import { POST as importPost } from "../src/app/api/fees/transaction-import/route";
import { POST as ledgerPost, GET as ledgerGet } from "../src/app/api/fees/yearly-ledger-import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  getFeeChallansServer,
  getPaymentsByStudentServer,
  getYearlyFeeLedgerForStudentServer,
  getAdvanceCreditServer,
} from "../src/lib/firebase/server-db";
import { saveTransactionServer, saveExpenseServer, generateContentTransactionId } from "../src/lib/firebase/transaction-db";
import { ClassDoc, StudentDoc } from "../src/lib/firebase/types";

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

async function previewDaily(token: string, rows: string[][]) {
  const header = ["Day & Date", "Category", "Details", "Class", "Amount"];
  const res = await importPost(uploadReq(token, "http://x/api/fees/transaction-import?action=preview", csvOf([header, ...rows])));
  return json(res);
}
async function commitDaily(token: string, fileName: string, results: any[]) {
  const res = await importPost(jsonReq(token, "http://x/api/fees/transaction-import?action=commit", { fileName, results }));
  return { status: res.status, body: await json(res) };
}
async function previewLedger(token: string, academicYear: string, rows: string[][]) {
  const header = ["Admission No", "Student Name", "Monthly Fee", "Annual Fee"];
  const res = await ledgerPost(uploadReq(token, `http://x/api/fees/yearly-ledger-import?action=preview&academicYear=${academicYear}`, csvOf([header, ...rows])));
  return json(res);
}
async function commitLedger(token: string, academicYear: string, rowsResults: any[], allowUpdates = false) {
  const res = await ledgerPost(
    jsonReq(token, "http://x/api/fees/yearly-ledger-import?action=commit", {
      academicYear,
      allowUpdates,
      fileName: "ledger.csv",
      rows: rowsResults.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })),
    })
  );
  return { status: res.status, body: await json(res) };
}

async function run() {
  console.log("==================================================");
  console.log("PHASE 2 — COMMIT-TIME INTEGRITY, YEARLY FEE LEDGER, DAILY IMPORT");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-p2-a";
  const YEAR = "2026-2027";

  const classA: ClassDoc = { id: "cls-p2-a", schoolId: A, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(classA);

  const student = (id: string, admissionNo: string, name: string): StudentDoc => ({
    id, schoolId: A, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId: classA.id, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 2000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now,
  });
  const ali = student("std-p2-ali", "P2-001", "Ali Khan");
  const sara = student("std-p2-sara", "P2-002", "Sara Noor");
  const bilal = student("std-p2-bilal", "P2-003", "Bilal Ahmed");
  await saveStudentServer(ali);
  await saveStudentServer(sara);
  await saveStudentServer(bilal);

  const ADMIN_A = await createSessionCookieServer({ uid: "uid-p2-admin-a", email: "a@x.edu", role: "ADMIN", schoolId: A, name: "a" });

  // =========================================================================
  // YEARLY FEE LEDGER
  // =========================================================================
  const pLedger1 = await previewLedger(ADMIN_A, YEAR, [
    ["P2-001", "Ali Khan", "5000", "6000"],
    ["P2-002", "Sara Noor", "3000", "0"],
  ]);
  assert(pLedger1.summary?.newCount === 2, "Ledger: preview reports 2 new entries");
  assert(pLedger1.rows[0].entry.yearlyExpectedFee === 5000 * 12 + 6000, "Ledger: yearly expected = monthly*12 + annual (Rs. 5,000 -> correctly includes the 12x factor)");

  const cLedger1 = await commitLedger(ADMIN_A, YEAR, pLedger1.rows);
  assert(cLedger1.body.summary?.created === 2, "Ledger: commit creates 2 entries");

  const aliLedger = await getYearlyFeeLedgerForStudentServer(A, ali.id, YEAR);
  assert(aliLedger?.monthlyFee === 5000, "Ledger: correct monthly fee stored for Ali");
  assert(aliLedger?.yearlyExpectedFee === 66000, "Ledger: correct yearly calculation stored for Ali (5000*12+6000=66000)");
  const saraLedger = await getYearlyFeeLedgerForStudentServer(A, sara.id, YEAR);
  assert(saraLedger?.yearlyExpectedFee === 36000, "Ledger: correct yearly calculation for Sara (multiple students each stored independently)");

  // Newly admitted student added to the ledger afterwards.
  const newcomer = student("std-p2-newcomer", "P2-004", "Zara Ahmed");
  await saveStudentServer(newcomer);
  const pLedger2 = await previewLedger(ADMIN_A, YEAR, [["P2-004", "Zara Ahmed", "4000", "0"]]);
  const cLedger2 = await commitLedger(ADMIN_A, YEAR, pLedger2.rows);
  assert(cLedger2.body.summary?.created === 1, "Ledger: a newly admitted student can be added to the ledger independently");
  assert((await getYearlyFeeLedgerForStudentServer(A, newcomer.id, YEAR))?.monthlyFee === 4000, "Ledger: the newcomer's fee is stored correctly");

  // Existing student's fee changes — update.
  const pLedgerUpdate = await previewLedger(ADMIN_A, YEAR, [["P2-001", "Ali Khan", "5500", "6000"]]);
  assert(pLedgerUpdate.rows[0].action === "UPDATE", "Ledger: a changed fee for an existing student is flagged UPDATE");
  const cSkipUpdate = await commitLedger(ADMIN_A, YEAR, pLedgerUpdate.rows, false);
  assert(cSkipUpdate.body.summary?.skipped === 1, "Ledger: without allowUpdates, the changed-fee row is skipped, not silently applied");
  const cDoUpdate = await commitLedger(ADMIN_A, YEAR, pLedgerUpdate.rows, true);
  assert(cDoUpdate.body.summary?.updated === 1, "Ledger: with allowUpdates=true, the existing student's fee is updated correctly");
  assert((await getYearlyFeeLedgerForStudentServer(A, ali.id, YEAR))?.monthlyFee === 5500, "Ledger: Ali's monthly fee is now 5500 after the explicit update");

  // Duplicate yearly import — idempotent, no duplicate document.
  const pLedgerDup = await previewLedger(ADMIN_A, YEAR, [["P2-002", "Sara Noor", "3000", "0"]]);
  assert(pLedgerDup.rows[0].action === "UNCHANGED", "Ledger: re-importing the identical row is recognized as UNCHANGED");
  const cLedgerDup = await commitLedger(ADMIN_A, YEAR, pLedgerDup.rows);
  assert(cLedgerDup.body.summary?.unchanged === 1 && cLedgerDup.body.summary?.created === 0, "Ledger: duplicate yearly import creates nothing new");

  // Automatic voucher generation (Task 4): the ledger import now eagerly creates the whole
  // academic year's 12 monthly fee challans ("vouchers") for the student — none of them Paid,
  // none touching PaymentDoc. This is the documented, intentional replacement for the old
  // lazy-creation behaviour, confirmed in the Phase 4 (Yearly Import v2) report.
  const challansForBilalBefore = await getFeeChallansServer(A, bilal.id);
  const pLedgerBilal = await previewLedger(ADMIN_A, YEAR, [["P2-003", "Bilal Ahmed", "2500", "0"]]);
  const cLedgerBilal = await commitLedger(ADMIN_A, YEAR, pLedgerBilal.rows);
  const challansForBilalAfter = await getFeeChallansServer(A, bilal.id);
  assert(challansForBilalBefore.length === 0, "Ledger import: Bilal has no challans before his first yearly import");
  assert(challansForBilalAfter.length === 12, "Ledger import: automatically generates all 12 monthly vouchers (fee challans) for the imported student");
  assert(challansForBilalAfter.every((c) => c.status === "PENDING" && c.paidAmount === 0), "Ledger import: every generated voucher is unpaid — the import itself never marks anything Paid or creates a PaymentDoc");
  assert(cLedgerBilal.body.summary?.challansCreated === 12, "Ledger import: the commit summary reports exactly 12 vouchers created for this one student");
  const bilalYearlyTotal = challansForBilalAfter.reduce((s, c) => s + c.totalExpected, 0);
  assert(bilalYearlyTotal === 2500 * 12, "Ledger import: the 12 generated vouchers' totalExpected sum exactly matches the ledger's own yearlyExpectedFee (Bilal has no annual fee)");

  // =========================================================================
  // DAILY IMPORT — actual received payments
  // =========================================================================

  // Correct student matching + class recognition + successful payment import + automatic Paid status.
  const pDaily1 = await previewDaily(ADMIN_A, [["15-11-2026", "Fees", "Ali Khan", "Class 5-A", "5500"]]);
  assert(pDaily1.summary?.results?.[0]?.status === "VALID" && pDaily1.summary.results[0].resolvedStudentId === ali.id, "Daily: correct student+class matching for Ali's November payment");
  const cDaily1 = await commitDaily(ADMIN_A, "daily1.csv", pDaily1.summary.results);
  assert(cDaily1.body.successCount === 1, "Daily: payment import succeeds");

  const novChallans = await getFeeChallansServer(A, ali.id, "November", 2026);
  assert(novChallans.length === 1, "Daily: a November challan was created, expected amount sourced from the Yearly Ledger (5500), not invented from the payment");
  assert(novChallans[0].totalExpected === 5500, "Daily: November challan's totalExpected equals Ali's ledger monthly fee (5500), confirming Yearly Ledger -> Daily Import linkage");
  assert(novChallans[0].status === "PAID" && novChallans[0].balanceAmount === 0, "Daily: a full payment automatically marks the challan Paid");

  const alisPayments = await getPaymentsByStudentServer(A, ali.id);
  assert(alisPayments.some((p) => p.amount === 5500 && p.challanId === novChallans[0].id), "Daily: payment history retrieval shows the recorded payment against the correct challan");

  // Previous outstanding dues remain Unpaid: October's voucher — already eagerly generated by
  // the Yearly Import above (Task 4), refreshed to Ali's updated 5500 monthly fee since it had
  // no payment against it yet — stays PENDING even though November is now fully paid.
  const octChallanBefore = (await getFeeChallansServer(A, ali.id, "October", 2026))[0];
  assert(octChallanBefore?.status === "PENDING" && octChallanBefore?.balanceAmount === 5500, "Daily: an unrelated prior month (October), auto-generated by the Yearly Import, is untouched and remains Unpaid after November's payment");

  // Partial payment handling.
  const pDaily2 = await previewDaily(ADMIN_A, [["20-12-2026", "Fees", "Ali Khan", "Class 5-A", "2000"]]);
  const cDaily2 = await commitDaily(ADMIN_A, "daily2.csv", pDaily2.summary.results);
  assert(cDaily2.body.successCount === 1, "Daily: partial payment import succeeds");
  const decChallans = await getFeeChallansServer(A, ali.id, "December", 2026);
  assert(decChallans[0].paidAmount === 2000 && decChallans[0].status === "PARTIAL" && decChallans[0].balanceAmount === 3500, "Daily: a partial payment (2000 of 5500) leaves the challan correctly PARTIAL with balance 3500, not Paid");

  // Advance payment handling: with the whole academic year's vouchers already eagerly
  // generated (Task 4), "every outstanding due" now really does mean the full remaining year,
  // not just whichever months a payment happened to touch before. Ali's full remaining balance
  // right now (yearlyExpectedFee 72000, minus November's 5500 and December's partial 2000
  // already paid) is exactly 64500 — paying 70000 settles every single remaining voucher and
  // leaves exactly 5500 as advance credit, never silently applied to an unrelated month.
  const remainingBefore = (await getFeeChallansServer(A, ali.id)).reduce((s, c) => s + c.balanceAmount, 0);
  assert(remainingBefore === 64500, "Daily: sanity check — Ali's total remaining balance across the full eagerly-generated year is exactly 64500 before the big overpayment");
  const pDaily3 = await previewDaily(ADMIN_A, [["25-12-2026", "Fees", "Ali Khan", "Class 5-A", "70000"]]);
  const cDaily3 = await commitDaily(ADMIN_A, "daily3.csv", pDaily3.summary.results);
  assert(cDaily3.body.successCount === 1, "Daily: a large overpayment still imports successfully");
  const allAliChallansAfter = await getFeeChallansServer(A, ali.id);
  assert(allAliChallansAfter.length === 12, "Daily: still exactly 12 vouchers for the year — none duplicated, none removed");
  assert(allAliChallansAfter.every((c) => c.status === "PAID" && c.balanceAmount === 0), "Daily: the overpayment settles every single remaining outstanding due across the whole year, oldest-first");
  const advance = await getAdvanceCreditServer(A, ali.id);
  assert(advance?.balance === 70000 - remainingBefore, "Daily: whatever is left after every outstanding due for the whole year is settled becomes advance credit, not lost and not applied to a month that's already fully paid");

  // Accurate import totals for a mixed batch.
  const pDaily4 = await previewDaily(ADMIN_A, [
    ["5-1-2027", "Fees", "Sara Noor", "Class 5-A", "3000"],
    ["5-1-2027", "Fees", "Ghost Student", "Class 5-A", "1000"],
  ]);
  const cDaily4 = await commitDaily(ADMIN_A, "daily4.csv", pDaily4.summary.results);
  assert(cDaily4.body.successCount === 1 && cDaily4.body.totalCount === 2, "Daily: accurate import totals for a mixed valid/invalid batch (1 succeeded of 2 total)");

  // Duplicate payment rejection — re-committing the exact same row never double-pays.
  const saraJanChallanBefore = (await getFeeChallansServer(A, sara.id, "January", 2027))[0];
  const pDailyDup = await previewDaily(ADMIN_A, [["5-1-2027", "Fees", "Sara Noor", "Class 5-A", "3000"]]);
  assert(pDailyDup.summary.results[0].status === "DUPLICATE", "Daily: re-previewing the exact same payment row is flagged DUPLICATE");
  const cDailyDup = await commitDaily(ADMIN_A, "daily4.csv", pDailyDup.summary.results);
  assert(cDailyDup.status === 400 || cDailyDup.body.successCount === 0, "Daily: re-committing the same payment creates no new payment");
  const saraJanChallanAfter = (await getFeeChallansServer(A, sara.id, "January", 2027))[0];
  assert(saraJanChallanAfter.paidAmount === saraJanChallanBefore.paidAmount, "Daily: duplicate rejection means paidAmount is not double-applied");

  // =========================================================================
  // COMMIT-TIME VALIDATION (Phase 2 Section 2)
  // =========================================================================

  // Stale preview rejection: a preview claiming VALID for a row that would now actually be
  // INVALID (e.g. the student was deleted/renamed in the meantime) must be rejected at commit,
  // not trusted. Simulate by hand-crafting a "stale" results array claiming a status that no
  // longer matches reality.
  const staleResults = [
    {
      row: { rowNumber: 2, date: "10-01-2027", category: "Fees", details: "Totally Fake Student", className: "Class 5-A", amount: 1000, rawDate: "10-01-2027", rawCategory: "Fees", rawAmount: "1000" },
      status: "VALID", // claims VALID even though this student does not exist
      errors: [],
      resolvedStudentId: "std-does-not-exist",
      resolvedStudentName: "Totally Fake Student",
    },
  ];
  const cStale = await commitDaily(ADMIN_A, "stale.csv", staleResults);
  assert(cStale.status === 400, "Commit-time validation: a stale/tampered VALID claim for a non-existent student is rejected server-side, never trusted from the client");

  // Concurrent import protection / retry safety: fire the exact same commit twice "simultaneously".
  const pConcurrent = await previewDaily(ADMIN_A, [["12-1-2027", "Other Expenses", "Internet Bill", "General", "4000"]]);
  const [cc1, cc2] = await Promise.all([
    commitDaily(ADMIN_A, "concurrent.csv", pConcurrent.summary.results),
    commitDaily(ADMIN_A, "concurrent.csv", pConcurrent.summary.results),
  ]);
  const totalSucceeded = (cc1.body.successCount || 0) + (cc2.body.successCount || 0);
  assert(totalSucceeded === 1, "Concurrency: two simultaneous commits of the identical row result in exactly one success, never two");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
