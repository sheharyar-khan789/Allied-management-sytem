import { NextRequest } from "next/server";
import { PUT as structurePutHandler } from "../src/app/api/fees/yearly-structure/route";
import { POST as adjustHandler } from "../src/app/api/fees/vouchers/[id]/adjust/route";
import { POST as reverseHandler } from "../src/app/api/fees/payments/[id]/reverse/route";
import { GET as accountHandler } from "../src/app/api/fees/student-account/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveStudentServer,
  saveYearlyFeeStructureServer,
  saveFeeChallanServer,
  recordFeePaymentServer,
  getFeeChallanByIdServer,
  getFeeAdjustmentsServer,
  getPaymentsByStudentServer,
} from "../src/lib/firebase/server-db";
import { StudentDoc, YearlyFeeStructureDoc, FeeChallanDoc } from "../src/lib/firebase/types";

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: STUDENT FEE UPDATE (PHASE 5)");
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

  const schoolId = "school-student-update-test-001";
  const academicYear = "2025-2026";

  const student: StudentDoc = {
    id: "std-sut-1",
    schoolId,
    admissionNo: "SU-001",
    fullName: "Zoya Malik",
    fatherName: "Malik Rehman",
    gender: "FEMALE",
    classId: "cls-sut-8a",
    className: "Grade 8",
    section: "A",
    rollNo: "4",
    status: "ACTIVE",
    guardianName: "Malik Rehman",
    guardianPhone: "03001112233",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStudentServer(student);

  const structure: YearlyFeeStructureDoc = {
    id: `${schoolId}__${academicYear}__SU-001`,
    schoolId,
    academicYear,
    studentId: student.id,
    admissionNo: "SU-001",
    studentName: student.fullName,
    classId: student.classId,
    className: student.className,
    monthlyTuitionFee: 5000,
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
  await saveYearlyFeeStructureServer(structure);

  const challan: FeeChallanDoc = {
    id: "ch-sut-sep",
    schoolId,
    studentId: student.id,
    studentName: student.fullName,
    admissionNo: student.admissionNo,
    classId: student.classId,
    className: student.className,
    challanNo: "MV-SUT-SEP",
    month: "September",
    year: 2025,
    issueDate: "2025-09-01",
    dueDate: "2025-09-10",
    tuitionFee: 5000,
    admissionFee: 0,
    examFee: 0,
    otherFee: 0,
    discount: 0,
    totalExpected: 5000,
    paidAmount: 0,
    balanceAmount: 5000,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    academicYear,
    source: "AUTO_MONTHLY",
  };
  await saveFeeChallanServer(challan);

  const adminToken = await createSessionCookieServer({ uid: "usr-admin-sut", email: "admin-sut@example.com", role: "ADMIN", schoolId, name: "Admin" });
  const teacherToken = await createSessionCookieServer({ uid: "usr-teacher-sut", email: "teacher-sut@example.com", role: "TEACHER", schoolId, name: "Teacher" });

  function jsonReq(path: string, method: string, body: any, cookie: string) {
    return new NextRequest(`http://localhost:3000${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  // ----------------------------------------------------
  // TEST: Teacher cannot edit yearly fee structure
  // ----------------------------------------------------
  const teacherStructureRes = await structurePutHandler(
    jsonReq("/api/fees/yearly-structure", "PUT", { studentId: student.id, academicYear, monthlyTuitionFee: 6000, reason: "hack", effectiveDate: "2025-10-01" }, `allied_session=${teacherToken}`)
  );
  assert(teacherStructureRes.status === 403, "Teacher is forbidden from editing yearly fee structure");

  // ----------------------------------------------------
  // TEST: Structure edit without a reason is rejected
  // ----------------------------------------------------
  const noReasonRes = await structurePutHandler(
    jsonReq("/api/fees/yearly-structure", "PUT", { studentId: student.id, academicYear, monthlyTuitionFee: 6000, effectiveDate: "2025-10-01" }, `allied_session=${adminToken}`)
  );
  assert(noReasonRes.status === 400, "Structure edit without a reason is rejected (400)");

  // ----------------------------------------------------
  // TEST: Structure edit with reason succeeds and writes a FeeAdjustmentDoc
  // ----------------------------------------------------
  const structureEditRes = await structurePutHandler(
    jsonReq(
      "/api/fees/yearly-structure",
      "PUT",
      { studentId: student.id, academicYear, monthlyTuitionFee: 6500, annualFee: 0, admissionFee: 0, otherCharges: 0, discount: 500, reason: "Mid-year fee revision approved by principal", effectiveDate: "2025-11-01" },
      `allied_session=${adminToken}`
    )
  );
  assert(structureEditRes.status === 200, "Structure edit with monthly fee + discount change succeeds");

  const adjustmentsAfterStructureEdit = await getFeeAdjustmentsServer(schoolId, student.id);
  const feeChangeAdj = adjustmentsAfterStructureEdit.find((a) => a.adjustmentType === "MONTHLY_FEE_CHANGE");
  const discountAdj = adjustmentsAfterStructureEdit.find((a) => a.adjustmentType === "DISCOUNT_CHANGE");
  assert(
    feeChangeAdj?.previousValue === 5000 && feeChangeAdj?.newValue === 6500,
    `MONTHLY_FEE_CHANGE adjustment correctly records previous=5000, new=6500 (got prev=${feeChangeAdj?.previousValue}, new=${feeChangeAdj?.newValue})`
  );
  assert(
    discountAdj?.previousValue === 0 && discountAdj?.newValue === 500,
    "DISCOUNT_CHANGE adjustment recorded as a separate entry from the fee change"
  );

  const sepChallanAfterStructureEdit = await getFeeChallanByIdServer(schoolId, "ch-sut-sep");
  assert(
    sepChallanAfterStructureEdit?.totalExpected === 5000,
    "Already-generated September voucher keeps its original snapshot untouched by the later structure edit"
  );

  // ----------------------------------------------------
  // TEST: Voucher-level additional charge adjustment
  // ----------------------------------------------------
  const chargeRes = await adjustHandler(
    jsonReq("/api/fees/vouchers/ch-sut-sep/adjust", "POST", { amount: 300, adjustmentType: "ADDITIONAL_CHARGE", reason: "Late submission fine", effectiveDate: "2025-09-15" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: "ch-sut-sep" }) }
  );
  const chargeResult = await chargeRes.json();
  assert(chargeResult.success && chargeResult.challan.totalExpected === 5300, "Additional charge increases voucher total (5000 -> 5300)");

  // ----------------------------------------------------
  // TEST: Voucher-level concession adjustment
  // ----------------------------------------------------
  const concessionRes = await adjustHandler(
    jsonReq("/api/fees/vouchers/ch-sut-sep/adjust", "POST", { amount: 200, adjustmentType: "CONCESSION", reason: "Hardship concession", effectiveDate: "2025-09-16" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: "ch-sut-sep" }) }
  );
  const concessionResult = await concessionRes.json();
  assert(concessionResult.challan.totalExpected === 5100, "Concession reduces voucher total correctly (5300 -> 5100), sign handled by type regardless of input sign");

  // ----------------------------------------------------
  // TEST: Record a payment, then reverse it — original stays in history, flagged reversed
  // ----------------------------------------------------
  const payment = await recordFeePaymentServer(schoolId, "ch-sut-sep", 5100, "CASH", undefined, "Full settlement", "Cashier");
  const challanAfterPayment = await getFeeChallanByIdServer(schoolId, "ch-sut-sep");
  assert(challanAfterPayment?.status === "PAID" && challanAfterPayment?.balanceAmount === 0, "Voucher fully settled after payment of adjusted total");

  const reverseRes = await reverseHandler(
    jsonReq(`/api/fees/payments/${payment.id}/reverse`, "POST", { reason: "Cashier entered wrong amount" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: payment.id }) }
  );
  assert(reverseRes.status === 200, "Reversing an unreversed payment succeeds");

  const challanAfterReversal = await getFeeChallanByIdServer(schoolId, "ch-sut-sep");
  assert(
    challanAfterReversal?.paidAmount === 0 && challanAfterReversal?.balanceAmount === 5100 && challanAfterReversal?.status === "PENDING",
    "Voucher balance is restored after reversal"
  );

  const allPayments = await getPaymentsByStudentServer(schoolId, student.id);
  const originalAfterReversal = allPayments.find((p) => p.id === payment.id);
  const reversalEntry = allPayments.find((p) => p.reversesPaymentId === payment.id);
  assert(
    originalAfterReversal?.reversed === true && originalAfterReversal?.amount === 5100,
    "Original payment record is preserved (not deleted/edited) and flagged reversed"
  );
  assert(!!reversalEntry && reversalEntry.amount === -5100, "A separate negative-amount reversal entry exists, linked to the original");

  // ----------------------------------------------------
  // TEST: A payment cannot be reversed twice
  // ----------------------------------------------------
  const doubleReverseRes = await reverseHandler(
    jsonReq(`/api/fees/payments/${payment.id}/reverse`, "POST", { reason: "trying again" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: payment.id }) }
  );
  assert(doubleReverseRes.status === 400, "Reversing an already-reversed payment is rejected");

  // ----------------------------------------------------
  // TEST: Student account view aggregates everything correctly
  // ----------------------------------------------------
  const accountReq = new NextRequest(`http://localhost:3000/api/fees/student-account?studentId=${student.id}&academicYear=${academicYear}`, {
    headers: { cookie: `allied_session=${adminToken}` },
  });
  const accountRes = await accountHandler(accountReq);
  const accountData = await accountRes.json();
  assert(
    accountData.success && accountData.structure?.monthlyTuitionFee === 6500 && accountData.vouchers.length === 1,
    "Student account view returns current structure and voucher history"
  );
  assert(accountData.adjustments.length >= 4, "Student account view includes the full adjustment history (structure + voucher adjustments)");

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
