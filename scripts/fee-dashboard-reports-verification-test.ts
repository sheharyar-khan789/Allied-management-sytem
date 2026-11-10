import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { POST as voucherCommitHandler } from "../src/app/api/fees/vouchers/generate/commit/route";
import { POST as transactionCommitHandler } from "../src/app/api/fees/transactions/import/commit/route";
import { POST as collectionsPost } from "../src/app/api/other-collections/route";
import { POST as expensesPost } from "../src/app/api/other-expenses/route";
import { GET as reportsGet } from "../src/app/api/fees/reports/route";
import { GET as reportsExportGet } from "../src/app/api/fees/reports/export/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveStudentServer, saveYearlyFeeStructureServer } from "../src/lib/firebase/server-db";
import { StudentDoc, YearlyFeeStructureDoc } from "../src/lib/firebase/types";

function buildWorkbookBuffer(headers: string[], rows: any[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
function fileFromBuffer(buf: Buffer, name: string): File {
  return new File([new Uint8Array(buf)], name);
}
const TXN_HEADERS = ["PaymentDate", "AdmissionNumber", "StudentName", "Class", "Amount", "PaymentCategory", "TransactionDetails", "PaymentMethod", "ReferenceNumber"];

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: FINANCIAL DASHBOARD & REPORTS (PHASE 8)");
  console.log("==================================================");

  let passed = 0;
  let total = 0;
  function assert(condition: boolean, name: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${name}`);
      process.exitCode = 1;
    }
  }

  const schoolId = "school-dashboard-reports-test-001";
  const academicYear = "2028-2029";

  const studentA: StudentDoc = {
    id: "std-dr-a",
    schoolId,
    admissionNo: "DR-A",
    fullName: "Sana Yousaf",
    fatherName: "Yousaf Khan",
    gender: "FEMALE",
    classId: "cls-dr-10a",
    className: "Grade 10",
    section: "A",
    rollNo: "1",
    status: "ACTIVE",
    guardianName: "Yousaf Khan",
    guardianPhone: "03001234567",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const studentB: StudentDoc = { ...studentA, id: "std-dr-b", admissionNo: "DR-B", fullName: "Omar Siddiqui", classId: "cls-dr-10b", className: "Grade 10", section: "B" };
  await saveStudentServer(studentA);
  await saveStudentServer(studentB);

  const structureA: YearlyFeeStructureDoc = {
    id: `${schoolId}__${academicYear}__DR-A`,
    schoolId,
    academicYear,
    studentId: studentA.id,
    admissionNo: "DR-A",
    studentName: studentA.fullName,
    classId: studentA.classId,
    className: studentA.className,
    monthlyTuitionFee: 4000,
    annualFee: 0,
    admissionFee: 0,
    otherCharges: 0,
    discount: 0,
    source: "MANUAL",
    createdAt: new Date().toISOString(),
    createdBy: "seed",
    updatedAt: new Date().toISOString(),
    updatedBy: "seed",
  };
  const structureB: YearlyFeeStructureDoc = { ...structureA, id: `${schoolId}__${academicYear}__DR-B`, studentId: studentB.id, admissionNo: "DR-B", studentName: studentB.fullName, classId: studentB.classId, className: studentB.className, monthlyTuitionFee: 6000 };
  await saveYearlyFeeStructureServer(structureA);
  await saveYearlyFeeStructureServer(structureB);

  const adminToken = await createSessionCookieServer({ uid: "usr-admin-dr", email: "admin-dr@example.com", role: "ADMIN", schoolId, name: "Admin" });
  const teacherToken = await createSessionCookieServer({ uid: "usr-teacher-dr", email: "teacher-dr@example.com", role: "TEACHER", schoolId, name: "Teacher" });

  function jsonReq(path: string, body: any, cookie = `allied_session=${adminToken}`) {
    return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function multipartReq(path: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("academicYear", academicYear);
    return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: { cookie: `allied_session=${adminToken}` }, body: form as any });
  }
  function getReq(path: string, cookie = `allied_session=${adminToken}`) {
    return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie } });
  }

  // Seed: generate September vouchers for both students, pay one fully and leave one partial
  await voucherCommitHandler(jsonReq("/api/fees/vouchers/generate/commit", { academicYear, month: "September", year: 2028, scope: "SCHOOL" }));
  const bufA = buildWorkbookBuffer(TXN_HEADERS, [["2028-09-05", "DR-A", "Sana Yousaf", "Grade 10", 4000, "Tuition Fee", "", "CASH", "RCPT-A"]]);
  const bufB = buildWorkbookBuffer(TXN_HEADERS, [["2028-09-06", "DR-B", "Omar Siddiqui", "Grade 10", 2500, "Tuition Fee", "", "CASH", "RCPT-B"]]);
  await transactionCommitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufA, "a.xlsx")));
  await transactionCommitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufB, "b.xlsx")));

  await collectionsPost(jsonReq("/api/other-collections", { date: "2028-09-10", category: "EVENT", description: "Annual sports day tickets", amount: 1500, paymentMethod: "CASH" }));
  await expensesPost(jsonReq("/api/other-expenses", { date: "2028-09-11", category: "STATIONERY", description: "Exam stationery", amount: 800, paymentMethod: "CASH" }));

  // ----------------------------------------------------
  // TEST: Teachers cannot access reports
  // ----------------------------------------------------
  const teacherRes = await reportsGet(getReq(`/api/fees/reports?type=net-summary&academicYear=${academicYear}`, `allied_session=${teacherToken}`));
  assert(teacherRes.status === 403, "Teacher is forbidden from running financial reports");

  // ----------------------------------------------------
  // TEST: Net summary report matches the Phase 7 financial-summary formulas
  // ----------------------------------------------------
  const netRes = await reportsGet(getReq(`/api/fees/reports?type=net-summary&academicYear=${academicYear}`));
  const netJson = await netRes.json();
  const summary = netJson.rows[0];
  assert(summary.totalStudentFeeCollections === 6500, `Net summary totals real collections (4000+2500=6500, got ${summary.totalStudentFeeCollections})`);
  assert(summary.otherCollectionsTotal === 1500 && summary.otherExpensesTotal === 800, "Net summary includes other income/expenses separately");
  assert(summary.totalIncome === 8000 && summary.netRemainingBalance === 7200, `Total income and net balance reconcile (income=8000, net=7200; got income=${summary.totalIncome}, net=${summary.netRemainingBalance})`);

  // ----------------------------------------------------
  // TEST: Class-wise report groups correctly and totals match net summary
  // ----------------------------------------------------
  const classRes = await reportsGet(getReq(`/api/fees/reports?type=class-wise-collections&academicYear=${academicYear}`));
  const classRows = (await classRes.json()).rows;
  const classCollectedSum = classRows.reduce((s: number, r: any) => s + r.collected, 0);
  assert(classRows.length === 2 && classCollectedSum === 6500, `Class-wise collections sum to the same total as the net summary (got ${classCollectedSum})`);

  // ----------------------------------------------------
  // TEST: Student ledger report reflects per-student figures and respects class filter
  // ----------------------------------------------------
  const ledgerRes = await reportsGet(getReq(`/api/fees/reports?type=student-ledger&academicYear=${academicYear}`));
  const ledgerRows = (await ledgerRes.json()).rows;
  const rowA = ledgerRows.find((r: any) => r.admissionNo === "DR-A");
  const rowB = ledgerRows.find((r: any) => r.admissionNo === "DR-B");
  assert(rowA?.totalPaid === 4000 && rowA?.outstanding === 0, "Student ledger shows Student A fully paid");
  assert(rowB?.totalPaid === 2500 && rowB?.outstanding === 3500, `Student ledger shows Student B's correct partial balance (6000 total - 2500 paid = 3500, got ${rowB?.outstanding})`);

  const filteredLedgerRes = await reportsGet(getReq(`/api/fees/reports?type=student-ledger&academicYear=${academicYear}&classId=cls-dr-10a`));
  const filteredLedgerRows = (await filteredLedgerRes.json()).rows;
  assert(filteredLedgerRows.length === 1 && filteredLedgerRows[0].admissionNo === "DR-A", "Class filter on student ledger returns only that class's students");

  // ----------------------------------------------------
  // TEST: Outstanding dues report lists only Student B's voucher
  // ----------------------------------------------------
  const duesRes = await reportsGet(getReq(`/api/fees/reports?type=outstanding-dues&academicYear=${academicYear}`));
  const duesRows = (await duesRes.json()).rows;
  assert(duesRows.length === 1 && duesRows[0].admissionNo === "DR-B" && duesRows[0].balanceAmount === 3500, "Outstanding dues report lists exactly the one unpaid voucher");

  // ----------------------------------------------------
  // TEST: Other collections / expenses reports reuse Phase 6 data untouched
  // ----------------------------------------------------
  const ocRes = await reportsGet(getReq(`/api/fees/reports?type=other-collections&academicYear=${academicYear}`));
  const ocRows = (await ocRes.json()).rows;
  assert(ocRows.length === 1 && ocRows[0].amount === 1500, "Other collections report returns the recorded event income");

  // ----------------------------------------------------
  // TEST: Excel export returns a real workbook whose data matches the on-screen report
  // ----------------------------------------------------
  const exportRes = await reportsExportGet(getReq(`/api/fees/reports/export?type=student-ledger&academicYear=${academicYear}`));
  assert(exportRes.status === 200 && (exportRes.headers.get("content-type")?.includes("spreadsheet") ?? false), "Excel export responds with a spreadsheet content type");
  const exportBuffer = Buffer.from(await exportRes.arrayBuffer());
  const workbook = XLSX.read(exportBuffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const exportedRows: any[] = XLSX.utils.sheet_to_json(sheet);
  const exportedB = exportedRows.find((r: any) => r.admissionNo === "DR-B");
  assert(
    exportedRows.length === ledgerRows.length && exportedB?.totalPaid === 2500 && exportedB?.outstanding === 3500,
    "Exported Excel file contains the same real figures as the on-screen report, not placeholder data"
  );

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
