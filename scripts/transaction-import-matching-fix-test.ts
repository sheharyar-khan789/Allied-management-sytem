/**
 * Phase 1 — Fees & Payments import fixes: class/section recognition, student name matching,
 * and Other Expenses persistence (see /api/fees/transaction-import, transaction-import.ts,
 * transaction-db.ts). Exercises the real route (preview then commit, exactly as the
 * TransactionImportModal UI does — JSON commit of the preview's own results) so the fix is
 * verified end to end, not just at the pure-function level already covered by
 * transaction-import-test.ts.
 */
import { NextRequest } from "next/server";
import { POST as importPost } from "../src/app/api/fees/transaction-import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveStudentServer } from "../src/lib/firebase/server-db";
import { getExpensesByDateRangeServer, getTransactionsByBatchServer } from "../src/lib/firebase/transaction-db";
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

function uploadReq(token: string | null, action: string, content: string) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "transactions.csv");
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(`http://x/api/fees/transaction-import?action=${action}`, { method: "POST", headers, body: fd });
}

function jsonReq(token: string | null, action: string, body: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  headers.set("content-type", "application/json");
  return new NextRequest(`http://x/api/fees/transaction-import?action=${action}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}

const json = async (res: Response) => res.json().catch(() => ({}));
const HEADER = ["Day & Date", "Category", "Details", "Class", "Amount"];

async function preview(token: string, rows: string[][]) {
  const res = await importPost(uploadReq(token, "preview", csvOf([HEADER, ...rows])));
  return json(res);
}
async function commit(token: string, fileName: string, results: any[]) {
  const res = await importPost(jsonReq(token, "commit", { fileName, results }));
  return { status: res.status, body: await json(res) };
}

async function run() {
  console.log("==================================================");
  console.log("PHASE 1 — TRANSACTION IMPORT: CLASS/SECTION/NAME MATCHING + OTHER EXPENSES");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-tifix-a";

  const cls = (id: string, name: string, section: string): ClassDoc => ({
    id, schoolId: A, name, section, numericLevel: 5, capacity: 40, classTeacherId: null,
    academicYear: "2026-2027", createdAt: now, updatedAt: now,
  });
  const class5A = cls("cls-tifix-5a", "Class 5", "A");
  const class5B = cls("cls-tifix-5b", "Class 5", "B");
  const class15A = cls("cls-tifix-15a", "Class 15", "A");
  await saveClassServer(class5A);
  await saveClassServer(class5B);
  await saveClassServer(class15A);

  const student = (id: string, admissionNo: string, name: string, classId: string, className: string): StudentDoc => ({
    id, schoolId: A, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId, section: className.split("-")[1] || "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 3000, discount: 0, academicYear: "2026-2027", className, createdAt: now, updatedAt: now,
  });
  const aliA = student("std-tifix-ali-a", "TIFIX-001", "Ali Khan", class5A.id, "Class 5-A");
  const aliB = student("std-tifix-ali-b", "TIFIX-002", "Ali Khan", class5B.id, "Class 5-B");
  const bilal15A = student("std-tifix-bilal", "TIFIX-003", "Bilal Ahmed", class15A.id, "Class 15-A");
  const saraA = student("std-tifix-sara", "TIFIX-004", "Sara Noor", class5A.id, "Class 5-A");
  await saveStudentServer(aliA);
  await saveStudentServer(aliB);
  await saveStudentServer(bilal15A);
  await saveStudentServer(saraA);

  const ADMIN_A = await createSessionCookieServer({ uid: "uid-tifix-admin-a", email: "a@x.edu", role: "ADMIN", schoolId: A, name: "a" });

  // -----------------------------------------------------------------------
  // 1. Existing class correctly recognized
  // -----------------------------------------------------------------------
  const p1 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Ali Khan", "Class 5-A", "3700"]]);
  assert(p1.summary?.results?.[0]?.status === "VALID" && p1.summary.results[0].resolvedStudentId === aliA.id, "1. Existing class 'Class 5-A' is correctly recognized and resolves the right student");

  // -----------------------------------------------------------------------
  // 2. Existing section correctly recognized (section given without the "Class" word)
  // -----------------------------------------------------------------------
  const p2 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Ali Khan", "5-B", "3700"]]);
  assert(p2.summary?.results?.[0]?.status === "VALID" && p2.summary.results[0].resolvedStudentId === aliB.id, "2. Existing section '5-B' is correctly recognized and resolves the Section-B student, not Section-A");

  // -----------------------------------------------------------------------
  // 3. Correct student name successfully matched
  // -----------------------------------------------------------------------
  const p3 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Sara Noor", "Class 5-A", "3700"]]);
  assert(p3.summary?.results?.[0]?.status === "VALID" && p3.summary.results[0].resolvedStudentId === saraA.id, "3. Correct student name 'Sara Noor' is successfully matched");

  // -----------------------------------------------------------------------
  // 4. Whitespace and casing differences handled safely
  // -----------------------------------------------------------------------
  const p4 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Ali  Khan", "5 A", "3700"]]); // double space in name, space instead of hyphen in class
  assert(p4.summary?.results?.[0]?.status === "VALID" && p4.summary.results[0].resolvedStudentId === aliA.id, "4. Double-space name and space-instead-of-hyphen class format are both handled safely");

  // -----------------------------------------------------------------------
  // 5. Similar student names do not cause incorrect matching (no class given to disambiguate)
  // -----------------------------------------------------------------------
  const p5 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Ali Khan", "", "3700"]]);
  assert(p5.summary?.results?.[0]?.status === "AMBIGUOUS", "5. Two same-named students with no disambiguating class are flagged AMBIGUOUS, never silently resolved to one of them");

  // -----------------------------------------------------------------------
  // 6. Cross-class/section matching is rejected (searching "5-A" must never match "Class 15-A")
  // -----------------------------------------------------------------------
  const p6 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Bilal Ahmed", "5-A", "3700"]]);
  assert(p6.summary?.results?.[0]?.status === "INVALID", "6. 'Bilal Ahmed' (actually in Class 15-A) searched under class '5-A' is correctly rejected, not cross-matched by digit substring");

  // -----------------------------------------------------------------------
  // 7. Missing student is correctly reported
  // -----------------------------------------------------------------------
  const p7 = await preview(ADMIN_A, [["15-11-2026", "Fees", "Nonexistent Person", "Class 5-A", "3700"]]);
  assert(p7.summary?.results?.[0]?.status === "INVALID" && /not found/i.test(p7.summary.results[0].errors[0]), "7. A genuinely missing student is reported INVALID with a clear reason");

  // -----------------------------------------------------------------------
  // 8 & 9. Other Expenses saved to Firestore (local-store stand-in here) and retrievable after refresh
  // -----------------------------------------------------------------------
  const pExp = await preview(ADMIN_A, [["15-11-2026", "Other Expenses", "November Electricity Bill", "General", "12000"]]);
  assert(pExp.summary?.results?.[0]?.status === "VALID", "8a. A valid Other Expenses row previews as VALID");
  const cExp = await commit(ADMIN_A, "expenses.csv", pExp.summary.results);
  assert(cExp.status === 200 && cExp.body.successCount === 1, "8b. The Other Expenses row commits successfully");

  const savedExpenses = await getExpensesByDateRangeServer(A);
  const savedExp = savedExpenses.find((e) => e.description === "November Electricity Bill");
  assert(!!savedExp, "9a. The committed expense is retrievable afterwards (survives a fresh read, not just in-request state)");
  assert(savedExp?.transactionRef !== undefined && savedExp?.transactionRef !== "", "9b. The saved expense carries transactionRef, so the dashboard will not double-count it against its linked transaction");
  const batchTxs = await getTransactionsByBatchServer(A, cExp.body.batchId);
  assert(batchTxs.some((t) => t.category === "Other Expenses" && t.details === "November Electricity Bill"), "9c. The matching TransactionDoc for the same row also exists");

  // -----------------------------------------------------------------------
  // 10. Duplicate imports do not create duplicate records
  // -----------------------------------------------------------------------
  const pExpAgain = await preview(ADMIN_A, [["15-11-2026", "Other Expenses", "November Electricity Bill", "General", "12000"]]);
  assert(pExpAgain.summary?.results?.[0]?.status === "DUPLICATE", "10a. Re-previewing the exact same Other Expenses row is flagged DUPLICATE against the existing record");
  const cExpAgain = await commit(ADMIN_A, "expenses.csv", pExpAgain.summary.results);
  // An all-duplicate batch has no VALID rows at all, so the route correctly refuses the commit
  // outright (400 "No valid rows to commit") rather than reporting a hollow successCount: 0.
  assert(cExpAgain.status === 400 || cExpAgain.body.successCount === 0, "10b. Re-committing it creates nothing (DUPLICATE rows are never in the committed set)");
  const expensesAfterRetry = (await getExpensesByDateRangeServer(A)).filter((e) => e.description === "November Electricity Bill");
  assert(expensesAfterRetry.length === 1, "10c. Exactly one expense record exists after the duplicate re-import attempt, not two");

  // -----------------------------------------------------------------------
  // 11. Partial import failures are reported correctly (mix of valid and invalid rows)
  // -----------------------------------------------------------------------
  const pMixed = await preview(ADMIN_A, [
    ["16-11-2026", "Fees", "Sara Noor", "Class 5-A", "3000"], // valid
    ["16-11-2026", "Fees", "Ghost Student", "Class 5-A", "3000"], // invalid
    ["16-11-2026", "Other Expenses", "Stationery Purchase", "General", "1500"], // valid
  ]);
  assert(
    pMixed.summary?.results?.[0]?.status === "VALID" && pMixed.summary.results[1].status === "INVALID" && pMixed.summary.results[2].status === "VALID",
    "11a. A mixed batch correctly distinguishes the valid rows from the genuinely invalid one"
  );
  const cMixed = await commit(ADMIN_A, "mixed.csv", pMixed.summary.results);
  assert(cMixed.body.successCount === 2 && cMixed.body.totalCount === 3, "11b. Partial commit reports 2 succeeded out of 3 total — the invalid row is never silently counted as imported");

  // -----------------------------------------------------------------------
  // 12. Existing functionality remains unaffected — a plain, unambiguous Fees row still
  // round-trips end to end through the real route exactly as before.
  // -----------------------------------------------------------------------
  const pRegression = await preview(ADMIN_A, [["17-11-2026", "Annual Amount", "Sara Noor", "Class 5-A", "3000"]]);
  const cRegression = await commit(ADMIN_A, "regression.csv", pRegression.summary.results);
  assert(cRegression.body.successCount === 1, "12. A standard, unambiguous Annual Amount row still imports successfully end to end");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
