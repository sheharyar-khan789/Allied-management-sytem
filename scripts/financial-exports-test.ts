/**
 * Excel/CSV exports (Priority 7): Yearly Fee Structure export and the Financial Summary
 * export. Every figure in the CSV must come from the same underlying records as the
 * on-screen views it mirrors — verified here by reconciling the exported numbers against
 * the records this test itself created, not by trusting the route's own arithmetic.
 */
import { NextRequest } from "next/server";
import { GET as structureExportGet } from "../src/app/api/fees/structure-import/export/route";
import { GET as dashboardExportGet } from "../src/app/api/fees/dashboard/export/route";
import { POST as structureImportPost } from "../src/app/api/fees/structure-import/route";
import { POST as generatePost } from "../src/app/api/fees/vouchers/generate/route";
import { GET as collectionGet } from "../src/app/api/fees/reports/collection/route";
import { GET as outstandingDuesGet } from "../src/app/api/fees/reports/outstanding-dues/route";
import { GET as advancePaymentsGet } from "../src/app/api/fees/reports/advance-payments/route";
import { GET as studentLedgerGet } from "../src/app/api/fees/reports/student-ledger/route";
import { GET as otherCollectionsExportGet } from "../src/app/api/fees/other-collections/export/route";
import { GET as otherExpensesExportGet } from "../src/app/api/fees/other-expenses/export/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveStudentServer, recordPaymentServer, adjustAdvanceBalanceServer, getFeeChallansServer } from "../src/lib/firebase/server-db";
import { saveOtherCollectionServer, saveExpenseServer } from "../src/lib/firebase/transaction-db";
import { ClassDoc, PaymentDoc, StudentDoc } from "../src/lib/firebase/types";

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
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

function parseCsv(text: string): string[][] {
  return text.trim().split(/\r\n/).map((line) => line.split(","));
}

async function run() {
  console.log("==================================================");
  console.log("FINANCIAL EXPORTS (CSV)");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-exp-a";
  const YEAR = "2026-2027";

  const classA: ClassDoc = { id: "cls-exp-a", schoolId: A, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(classA);
  const s1: StudentDoc = { id: "std-exp-1", schoolId: A, admissionNo: "EXP-001", fullName: "Ali Khan", fatherName: "F", gender: "MALE", classId: classA.id, section: "A", rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now };
  await saveStudentServer(s1);

  const ADMIN_A = await createSessionCookieServer({ uid: "uid-exp-admin-a", email: "a@x.edu", role: "ADMIN", schoolId: A, name: "a" });

  await structureImportPost(
    req(ADMIN_A, "http://x/api/fees/structure-import", "POST", {
      academicYear: YEAR,
      rows: [{ rowNumber: 2, input: { admissionNo: "EXP-001", studentName: "Ali Khan", monthlyTuitionFee: "3700", annualFee: "3000", admissionFee: "5000", otherCharges: "200", discount: "0" } }],
    })
  );

  // ---- Yearly Fee Structure export ----
  const structureCsvRes = await structureExportGet(req(ADMIN_A, `http://x/api/fees/structure-import/export?academicYear=${YEAR}`));
  assert(structureCsvRes.status === 200, "Structure export: returns 200");
  assert(structureCsvRes.headers.get("content-type")?.includes("text/csv"), "Structure export: Content-Type is text/csv");
  const structureCsv = parseCsv(await structureCsvRes.text());
  assert(structureCsv[0][0] === "Admission No", "Structure export: header row starts with Admission No");
  const aliRow = structureCsv.find((r) => r[0] === "EXP-001");
  assert(!!aliRow && aliRow[3] === "3700" && aliRow[4] === "3000", "Structure export: Ali's row has the correct monthly/annual fee");
  assert(!!aliRow && Number(aliRow[8]) === (3700 + 200) * 12 + 3000 + 5000, "Structure export: Yearly Expected Fee column is (tuition+other)*12 + annual + admission");

  const unauthStructure = await structureExportGet(req(null, `http://x/api/fees/structure-import/export?academicYear=${YEAR}`));
  assert(unauthStructure.status === 401, "Unauthorized: an unauthenticated request to the structure export is rejected");

  // ---- Financial Summary export ----
  await saveOtherCollectionServer({ id: "oc-exp-1", schoolId: A, date: "2026-11-01", category: "FINE", description: "Fine", amount: 1000, createdBy: "uid-exp-admin-a", createdAt: now });
  await saveExpenseServer({ id: "exp-exp-1", schoolId: A, date: "2026-11-01", description: "Electricity", amount: 5000, category: "ELECTRICITY", createdBy: "uid-exp-admin-a", createdAt: now });

  const dashboardCsvRes = await dashboardExportGet(req(ADMIN_A, `http://x/api/fees/dashboard/export?academicYear=${YEAR}`));
  assert(dashboardCsvRes.status === 200, "Financial summary export: returns 200");
  const dashboardCsv = parseCsv(await dashboardCsvRes.text());
  const header = dashboardCsv[0];
  const row = dashboardCsv[1];
  const col = (name: string) => row[header.indexOf(name)];
  assert(Number(col("Other Collections")) === 1000, "Financial summary export: Other Collections reconciles to the recorded fine");
  assert(Number(col("Other Expenses")) === 5000, "Financial summary export: Other Expenses reconciles to the recorded electricity bill");
  assert(Number(col("Yearly Expected Fees")) === (3700 + 200) * 12 + 3000 + 5000, "Financial summary export: Yearly Expected Fees reconciles to the structure just imported");

  // ---- Collection / Outstanding Dues / Advance Payments / Student Ledger reports ----
  const s2: StudentDoc = { id: "std-exp-2", schoolId: A, admissionNo: "EXP-002", fullName: "Sara Khan", fatherName: "F", gender: "FEMALE", classId: classA.id, section: "A", rollNo: "2", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now };
  await saveStudentServer(s2);
  await adjustAdvanceBalanceServer(A, s2.id, YEAR, 1500);

  await generatePost(req(ADMIN_A, "http://x/api/fees/vouchers/generate?commit=true", "POST", { academicYear: YEAR, month: "September", year: 2026, scope: "STUDENT", studentId: s1.id }));
  const [aliSept] = await getFeeChallansServer(A, s1.id, "September", 2026);
  assert(!!aliSept, "Setup: Ali's September voucher was generated for the report tests");
  const partialPayment: PaymentDoc = { id: "pay-exp-1", schoolId: A, challanId: aliSept.id, studentId: s1.id, studentName: s1.fullName, receiptNo: "RCT-EXP-1", amount: 4000, paymentDate: "2026-09-15", paymentMode: "CASH", collectedBy: "uid-exp-admin-a", createdAt: now };
  await recordPaymentServer(partialPayment);

  const monthlyCsv = parseCsv(await (await collectionGet(req(ADMIN_A, "http://x/api/fees/reports/collection?scope=MONTHLY&month=September&year=2026"))).text());
  const aliMonthlyRow = monthlyCsv.find((r) => r[0] === s1.id);
  assert(!!aliMonthlyRow && Number(aliMonthlyRow[3]) === 4000, "Monthly collection report: Ali's September total matches the recorded payment");

  const yearlyCsv = parseCsv(await (await collectionGet(req(ADMIN_A, `http://x/api/fees/reports/collection?scope=YEARLY&academicYear=${YEAR}`))).text());
  const septemberRow = yearlyCsv.find((r) => r[0] === "September");
  assert(!!septemberRow && Number(septemberRow[1]) === 4000, "Yearly collection report: September's total matches the recorded payment");

  const classWiseCsv = parseCsv(await (await collectionGet(req(ADMIN_A, `http://x/api/fees/reports/collection?scope=CLASS_WISE&academicYear=${YEAR}`))).text());
  const classRow = classWiseCsv.find((r) => r[0] === classA.id);
  assert(!!classRow && Number(classRow[3]) === 4000, "Class-wise collection report: Class 5-A's collected total matches the recorded payment");

  const outstandingCsv = parseCsv(await (await outstandingDuesGet(req(ADMIN_A, `http://x/api/fees/reports/outstanding-dues?academicYear=${YEAR}`))).text());
  const aliOutstandingRow = outstandingCsv.find((r) => r[1] === "EXP-001");
  assert(!!aliOutstandingRow && Number(aliOutstandingRow[6]) === aliSept.totalExpected - 4000, "Outstanding dues report: Ali's balance matches totalExpected minus the recorded payment");

  const advanceCsv = parseCsv(await (await advancePaymentsGet(req(ADMIN_A, `http://x/api/fees/reports/advance-payments?academicYear=${YEAR}`))).text());
  const saraAdvanceRow = advanceCsv.find((r) => r[1] === "EXP-002");
  assert(!!saraAdvanceRow && Number(saraAdvanceRow[4]) === 1500, "Advance payments report: Sara's 1500 credit is listed");

  const ledgerCsvText = await (await studentLedgerGet(req(ADMIN_A, `http://x/api/fees/reports/student-ledger?studentId=${s1.id}&academicYear=${YEAR}`))).text();
  assert(ledgerCsvText.includes(aliSept.challanNo), "Student ledger report: Ali's September voucher number appears in the export");
  assert(ledgerCsvText.includes("RCT-EXP-1"), "Student ledger report: Ali's payment receipt number appears in the export");

  const ocExportCsv = parseCsv(await (await otherCollectionsExportGet(req(ADMIN_A, "http://x/api/fees/other-collections/export"))).text());
  assert(ocExportCsv.some((r) => r[2] === "Fine" && Number(r[3]) === 1000), "Other Collections export: the recorded fine appears with the correct amount");

  const oeExportCsv = parseCsv(await (await otherExpensesExportGet(req(ADMIN_A, "http://x/api/fees/other-expenses/export"))).text());
  assert(oeExportCsv.some((r) => r[1] === "ELECTRICITY" && Number(r[3]) === 5000), "School Expenses export: the recorded electricity bill appears with the correct amount");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
