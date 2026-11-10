import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { POST as voucherCommitHandler } from "../src/app/api/fees/vouchers/generate/commit/route";
import { POST as transactionCommitHandler } from "../src/app/api/fees/transactions/import/commit/route";
import { POST as adjustHandler } from "../src/app/api/fees/vouchers/[id]/adjust/route";
import { GET as financialSummaryHandler } from "../src/app/api/fees/financial-summary/route";
import { POST as collectionsPost } from "../src/app/api/other-collections/route";
import { POST as expensesPost } from "../src/app/api/other-expenses/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveStudentServer, saveYearlyFeeStructureServer, getFeeChallanByIdServer, getPaymentsByStudentServer, reversePaymentServer } from "../src/lib/firebase/server-db";
import { StudentDoc, YearlyFeeStructureDoc } from "../src/lib/firebase/types";
import { monthlyVoucherId } from "../src/lib/fee-calculations";

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
  console.log("RUNNING AUTOMATED TEST SUITE: CENTRALIZED FINANCIAL LEDGER (PHASE 7)");
  console.log("Exercises the full pipeline: structure -> vouchers -> daily payments ->");
  console.log("adjustments -> reversal -> other income/expense -> financial summary");
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

  const schoolId = "school-centralized-ledger-test-001";
  const academicYear = "2027-2028";

  const student: StudentDoc = {
    id: "std-ledger-1",
    schoolId,
    admissionNo: "LG-001",
    fullName: "Hassan Raza",
    fatherName: "Raza Ahmed",
    gender: "MALE",
    classId: "cls-lg-9a",
    className: "Grade 9",
    section: "A",
    rollNo: "3",
    status: "ACTIVE",
    guardianName: "Raza Ahmed",
    guardianPhone: "03005556677",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStudentServer(student);

  const structure: YearlyFeeStructureDoc = {
    id: `${schoolId}__${academicYear}__LG-001`,
    schoolId,
    academicYear,
    studentId: student.id,
    admissionNo: "LG-001",
    studentName: student.fullName,
    classId: student.classId,
    className: student.className,
    monthlyTuitionFee: 5000,
    annualFee: 0,
    admissionFee: 2000,
    otherCharges: 0,
    discount: 0,
    source: "MANUAL",
    createdAt: new Date().toISOString(),
    createdBy: "seed",
    updatedAt: new Date().toISOString(),
    updatedBy: "seed",
  };
  await saveYearlyFeeStructureServer(structure);

  const adminToken = await createSessionCookieServer({ uid: "usr-admin-ledger", email: "admin-ledger@example.com", role: "ADMIN", schoolId, name: "Admin" });

  function jsonReq(path: string, body: any) {
    return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: { cookie: `allied_session=${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function multipartReq(path: string, file: File, academicYearValue: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("academicYear", academicYearValue);
    return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: { cookie: `allied_session=${adminToken}` }, body: form as any });
  }

  // Step A: generate September voucher (Phase 3) -> 5000 tuition + 2000 one-time admission fee
  await voucherCommitHandler(jsonReq("/api/fees/vouchers/generate/commit", { academicYear, month: "September", year: 2027, scope: "SCHOOL" }));
  const sepId = monthlyVoucherId(schoolId, academicYear, "LG-001", "September", 2027);
  const sepAfterGen = await getFeeChallanByIdServer(schoolId, sepId);
  assert(sepAfterGen?.totalExpected === 7000, `September voucher total includes one-time admission fee (got ${sepAfterGen?.totalExpected})`);

  // Step B: daily transaction payment of 3000 against September (Phase 4)
  const bufB = buildWorkbookBuffer(TXN_HEADERS, [["2027-09-05", "LG-001", "Hassan Raza", "Grade 9", 3000, "Tuition Fee", "Counter payment", "CASH", "RCPT-B"]]);
  await transactionCommitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufB, "b.xlsx"), academicYear));
  const sepAfterB = await getFeeChallanByIdServer(schoolId, sepId);
  assert(sepAfterB?.paidAmount === 3000 && sepAfterB?.balanceAmount === 4000, "Partial daily-transaction payment correctly reduces September's balance (7000 -> 4000)");

  // Step C: voucher adjustment +500 additional charge on September (Phase 5)
  await adjustHandler(jsonReq(`/api/fees/vouchers/${sepId}/adjust`, { amount: 500, adjustmentType: "ADDITIONAL_CHARGE", reason: "Late submission fine", effectiveDate: "2027-09-20" }), { params: Promise.resolve({ id: sepId }) });
  const sepAfterC = await getFeeChallanByIdServer(schoolId, sepId);
  assert(sepAfterC?.totalExpected === 7500 && sepAfterC?.balanceAmount === 4500, "Additional charge adjustment updates total and balance without touching paidAmount (balance -> 4500)");

  // Step D: generate October voucher (Phase 3) -> carries forward September's CURRENT balance (post-adjustment)
  await voucherCommitHandler(jsonReq("/api/fees/vouchers/generate/commit", { academicYear, month: "October", year: 2027, scope: "SCHOOL" }));
  const octId = monthlyVoucherId(schoolId, academicYear, "LG-001", "October", 2027);
  const octAfterGen = await getFeeChallanByIdServer(schoolId, octId);
  assert(
    octAfterGen?.previousOutstandingDues === 4500 && octAfterGen?.totalExpected === 9500,
    `October voucher carries forward September's adjusted balance, not the original pre-adjustment figure (got prevDues=${octAfterGen?.previousOutstandingDues})`
  );

  // Step E: daily transaction overpayment of 15000 -> settles September (4500) + October (9500) + 1000 advance
  const bufE = buildWorkbookBuffer(TXN_HEADERS, [["2027-10-05", "LG-001", "Hassan Raza", "Grade 9", 15000, "Tuition Fee", "Large settlement", "BANK_TRANSFER", "RCPT-E"]]);
  await transactionCommitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufE, "e.xlsx"), academicYear));
  const sepAfterE = await getFeeChallanByIdServer(schoolId, sepId);
  const octAfterE = await getFeeChallanByIdServer(schoolId, octId);
  assert(sepAfterE?.status === "PAID" && octAfterE?.status === "PAID", "Overpayment settles both outstanding vouchers before any advance is created");

  const summaryAfterE = await (await financialSummaryHandler(new NextRequest(`http://localhost:3000/api/fees/financial-summary?academicYear=${academicYear}`, { headers: { cookie: `allied_session=${adminToken}` } }))).json();
  assert(summaryAfterE.summary.advancePaymentsTotal === 1000, `Excess payment beyond all dues becomes a 1000 advance credit (got ${summaryAfterE.summary.advancePaymentsTotal})`);

  // Step F: reverse the original 3000 payment (step B) — should NOT affect October or the advance
  const sepPayments = await getPaymentsByStudentServer(schoolId, student.id);
  const stepBPayment = sepPayments.find((p) => p.transactionRef === "RCPT-B" && p.amount === 3000 && !p.reversed);
  if (!stepBPayment) throw new Error("Could not locate step B payment to reverse");
  await reversePaymentServer(schoolId, stepBPayment.id, "Cashier entered wrong amount", "usr-admin-ledger");

  const sepAfterF = await getFeeChallanByIdServer(schoolId, sepId);
  const octAfterF = await getFeeChallanByIdServer(schoolId, octId);
  assert(
    sepAfterF?.paidAmount === 4500 && sepAfterF?.balanceAmount === 3000 && sepAfterF?.status === "PARTIAL",
    `Reversing the isolated step-B payment only affects September (paid 7500 -> 4500, balance -> 3000), got paid=${sepAfterF?.paidAmount}`
  );
  assert(octAfterF?.status === "PAID" && octAfterF?.paidAmount === 9500, "October remains fully paid — unrelated to the reversed September payment");

  // Step G: record other income and expense (Phase 6)
  await collectionsPost(jsonReq("/api/other-collections", { date: "2027-10-10", category: "REGISTRATION", description: "New registration fee", amount: 1000, paymentMethod: "CASH" }));
  await expensesPost(jsonReq("/api/other-expenses", { date: "2027-10-10", category: "MAINTENANCE", description: "Classroom repair", amount: 2000, paymentMethod: "CASH" }));

  // Final: verify the centralized financial summary reconciles exactly, with no double counting
  const finalRes = await financialSummaryHandler(new NextRequest(`http://localhost:3000/api/fees/financial-summary?academicYear=${academicYear}`, { headers: { cookie: `allied_session=${adminToken}` } }));
  const finalSummary = (await finalRes.json()).summary;

  assert(finalSummary.yearlyExpectedFees === 62000, `Yearly expected fees = 12 x monthly tuition + one-time admission fee (got ${finalSummary.yearlyExpectedFees})`);
  assert(finalSummary.outstandingStudentDues === 3000, `Outstanding dues reflect only September's remaining balance (got ${finalSummary.outstandingStudentDues})`);
  assert(finalSummary.totalStudentFeeCollections === 15000, `Total student fee collections = paid-on-challans (14000) + unconsumed advance (1000) = 15000 (got ${finalSummary.totalStudentFeeCollections})`);
  assert(finalSummary.otherCollectionsTotal === 1000, "Other collections counted separately from student fee payments");
  assert(finalSummary.totalIncome === 16000, `Total income = student fee collections + other collections (got ${finalSummary.totalIncome})`);
  assert(finalSummary.netRemainingBalance === 14000, `Net remaining balance = total income - expenses (16000 - 2000 = 14000, got ${finalSummary.netRemainingBalance})`);

  // The ultimate conservation check: every cash movement that actually happened
  // (3000 + 15000 - 3000 reversed) must equal totalStudentFeeCollections exactly.
  const actualCashMovements = 3000 + 15000 - 3000;
  assert(
    actualCashMovements === finalSummary.totalStudentFeeCollections,
    `No leakage or double counting: real cash received (${actualCashMovements}) exactly equals the reported total (${finalSummary.totalStudentFeeCollections})`
  );

  // Step H: generate November — the unconsumed 1000 advance should pre-pay it automatically,
  // shifting money from "advance" to "paid on a challan" with zero net change to total income.
  await voucherCommitHandler(jsonReq("/api/fees/vouchers/generate/commit", { academicYear, month: "November", year: 2027, scope: "SCHOOL" }));
  const novId = monthlyVoucherId(schoolId, academicYear, "LG-001", "November", 2027);
  const novAfterGen = await getFeeChallanByIdServer(schoolId, novId);
  assert(
    novAfterGen?.paidAmount === 1000 && novAfterGen?.totalExpected === 5000 && novAfterGen?.balanceAmount === 4000,
    `November voucher is automatically pre-paid from the 1000 advance credit (got paid=${novAfterGen?.paidAmount}, balance=${novAfterGen?.balanceAmount})`
  );

  const summaryAfterNov = (await (await financialSummaryHandler(new NextRequest(`http://localhost:3000/api/fees/financial-summary?academicYear=${academicYear}`, { headers: { cookie: `allied_session=${adminToken}` } }))).json()).summary;
  assert(summaryAfterNov.advancePaymentsTotal === 0, "Advance balance is fully consumed after November's voucher absorbs it");
  assert(
    summaryAfterNov.totalStudentFeeCollections === 15000 && summaryAfterNov.totalIncome === 16000,
    `Consuming the advance into a real voucher changes WHERE the money is recorded but not the total — still 15000 collected / 16000 income (got collections=${summaryAfterNov.totalStudentFeeCollections}, income=${summaryAfterNov.totalIncome})`
  );

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
