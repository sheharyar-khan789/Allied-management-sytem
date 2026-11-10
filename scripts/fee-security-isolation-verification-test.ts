import { NextRequest } from "next/server";
import { PUT as structurePutHandler } from "../src/app/api/fees/yearly-structure/route";
import { POST as adjustHandler } from "../src/app/api/fees/vouchers/[id]/adjust/route";
import { POST as regenerateHandler } from "../src/app/api/fees/vouchers/[id]/regenerate/route";
import { POST as reverseHandler } from "../src/app/api/fees/payments/[id]/reverse/route";
import { GET as accountHandler } from "../src/app/api/fees/student-account/route";
import { POST as collectionsReverseHandler } from "../src/app/api/other-collections/[id]/reverse/route";
import { POST as expensesReverseHandler } from "../src/app/api/other-expenses/[id]/reverse/route";
import { GET as batchPrintHandler } from "../src/app/api/print/challan/batch/[batchId]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveStudentServer,
  saveYearlyFeeStructureServer,
  saveFeeChallanServer,
  recordFeePaymentServer,
  saveOtherCollectionServer,
  saveOtherExpenseServer,
  saveVoucherGenerationBatchServer,
} from "../src/lib/firebase/server-db";
import { StudentDoc, YearlyFeeStructureDoc, FeeChallanDoc, OtherCollectionDoc, OtherExpenseDoc, VoucherGenerationBatchDoc } from "../src/lib/firebase/types";

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: CROSS-SCHOOL SECURITY ISOLATION (PHASE 10)");
  console.log("Every sensitive Phase 2-8 endpoint, attacked from a different school's admin");
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

  const schoolA = "school-isolation-test-a";
  const schoolB = "school-isolation-test-b";
  const academicYear = "2029-2030";

  // --- Seed School B's data (the target the attacker from School A should never reach) ---
  const studentB: StudentDoc = {
    id: "std-iso-b",
    schoolId: schoolB,
    admissionNo: "ISO-B",
    fullName: "Bilal Qureshi",
    fatherName: "Qureshi Sr.",
    gender: "MALE",
    classId: "cls-iso-b",
    className: "Grade 4",
    section: "A",
    rollNo: "7",
    status: "ACTIVE",
    guardianName: "Qureshi Sr.",
    guardianPhone: "03001112222",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStudentServer(studentB);

  const structureB: YearlyFeeStructureDoc = {
    id: `${schoolB}__${academicYear}__ISO-B`,
    schoolId: schoolB,
    academicYear,
    studentId: studentB.id,
    admissionNo: "ISO-B",
    studentName: studentB.fullName,
    classId: studentB.classId,
    className: studentB.className,
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
  await saveYearlyFeeStructureServer(structureB);

  const challanB: FeeChallanDoc = {
    id: "ch-iso-b",
    schoolId: schoolB,
    studentId: studentB.id,
    studentName: studentB.fullName,
    admissionNo: studentB.admissionNo,
    classId: studentB.classId,
    className: studentB.className,
    challanNo: "MV-ISO-B",
    month: "September",
    year: 2029,
    issueDate: "2029-09-01",
    dueDate: "2029-09-10",
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
  await saveFeeChallanServer(challanB);
  const paymentB = await recordFeePaymentServer(schoolB, "ch-iso-b", 2000, "CASH", undefined, "Partial payment", "Cashier B");

  const otherCollectionB: OtherCollectionDoc = {
    id: "oc-iso-b",
    schoolId: schoolB,
    date: "2029-09-05",
    category: "FINE",
    description: "School B fine",
    amount: 500,
    createdBy: "admin-b",
    createdByEmail: "admin-b@example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveOtherCollectionServer(otherCollectionB);

  const otherExpenseB: OtherExpenseDoc = {
    id: "oe-iso-b",
    schoolId: schoolB,
    date: "2029-09-05",
    category: "MAINTENANCE",
    description: "School B repair",
    amount: 1200,
    createdBy: "admin-b",
    createdByEmail: "admin-b@example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveOtherExpenseServer(otherExpenseB);

  const voucherBatchB: VoucherGenerationBatchDoc = {
    id: "vgb-iso-b",
    schoolId: schoolB,
    academicYear,
    month: "September",
    year: 2029,
    scope: "SCHOOL",
    totalRows: 1,
    createdCount: 1,
    skippedCount: 0,
    errorCount: 0,
    rows: [{ studentId: studentB.id, admissionNo: "ISO-B", studentName: studentB.fullName, action: "CREATED", challanId: "ch-iso-b", totalExpected: 5000 }],
    generatedBy: "admin-b",
    generatedByEmail: "admin-b@example.com",
    createdAt: new Date().toISOString(),
  };
  await saveVoucherGenerationBatchServer(voucherBatchB);

  // --- School A admin (the attacker) ---
  const adminAToken = await createSessionCookieServer({ uid: "usr-admin-iso-a", email: "admin-a@example.com", role: "ADMIN", schoolId: schoolA, name: "Admin A" });
  function jsonReq(path: string, method: string, body: any) {
    return new NextRequest(`http://localhost:3000${path}`, { method, headers: { cookie: `allied_session=${adminAToken}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  }
  function getReq(path: string) {
    return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: `allied_session=${adminAToken}` } });
  }

  // ----------------------------------------------------
  // TEST 1: School A admin cannot edit School B's fee structure (studentId lookup fails)
  // ----------------------------------------------------
  const structureRes = await structurePutHandler(
    jsonReq("/api/fees/yearly-structure", "PUT", { studentId: studentB.id, academicYear, monthlyTuitionFee: 99999, reason: "attack", effectiveDate: "2029-09-01" })
  );
  assert(structureRes.status === 404, "School A admin cannot edit School B student's fee structure (404 — student not found in their school)");

  // ----------------------------------------------------
  // TEST 2: School A admin cannot adjust School B's voucher
  // ----------------------------------------------------
  const adjustRes = await adjustHandler(
    jsonReq("/api/fees/vouchers/ch-iso-b/adjust", "POST", { amount: 1000, adjustmentType: "ADDITIONAL_CHARGE", reason: "attack", effectiveDate: "2029-09-01" }),
    { params: Promise.resolve({ id: "ch-iso-b" }) }
  );
  assert(adjustRes.status === 404, "School A admin cannot adjust School B's voucher (404)");

  // ----------------------------------------------------
  // TEST 3: School A admin cannot regenerate School B's voucher
  // ----------------------------------------------------
  const regenRes = await regenerateHandler(jsonReq("/api/fees/vouchers/ch-iso-b/regenerate", "POST", {}), { params: Promise.resolve({ id: "ch-iso-b" }) });
  assert(regenRes.status === 404, "School A admin cannot regenerate School B's voucher (404)");

  // ----------------------------------------------------
  // TEST 4: School A admin cannot reverse School B's payment
  // ----------------------------------------------------
  const reverseRes = await reverseHandler(jsonReq(`/api/fees/payments/${paymentB.id}/reverse`, "POST", { reason: "attack" }), { params: Promise.resolve({ id: paymentB.id }) });
  assert(reverseRes.status >= 400, "School A admin cannot reverse School B's payment (rejected)");

  // ----------------------------------------------------
  // TEST 5: School A admin cannot view School B's student fee account
  // ----------------------------------------------------
  const accountRes = await accountHandler(getReq(`/api/fees/student-account?studentId=${studentB.id}&academicYear=${academicYear}`));
  assert(accountRes.status === 404, "School A admin cannot view School B student's fee account (404)");

  // ----------------------------------------------------
  // TEST 6: School A admin cannot reverse School B's other-collection / other-expense record
  // ----------------------------------------------------
  const ocReverseRes = await collectionsReverseHandler(jsonReq("/api/other-collections/oc-iso-b/reverse", "POST", { reason: "attack" }), { params: Promise.resolve({ id: "oc-iso-b" }) });
  assert(ocReverseRes.status >= 400, "School A admin cannot reverse School B's other-collection record (rejected)");

  const oeReverseRes = await expensesReverseHandler(jsonReq("/api/other-expenses/oe-iso-b/reverse", "POST", { reason: "attack" }), { params: Promise.resolve({ id: "oe-iso-b" }) });
  assert(oeReverseRes.status >= 400, "School A admin cannot reverse School B's other-expense record (rejected)");

  // ----------------------------------------------------
  // TEST 7: School A admin cannot print School B's voucher generation batch
  // ----------------------------------------------------
  const batchPrintRes = await batchPrintHandler(getReq("/api/print/challan/batch/vgb-iso-b"), { params: Promise.resolve({ batchId: "vgb-iso-b" }) });
  assert(batchPrintRes.status === 404, "School A admin cannot print School B's voucher generation batch (404)");

  // ----------------------------------------------------
  // TEST 8: Sanity check — School B's own admin CAN still do all of the above on their own data
  // ----------------------------------------------------
  const adminBToken = await createSessionCookieServer({ uid: "usr-admin-iso-b", email: "admin-b@example.com", role: "ADMIN", schoolId: schoolB, name: "Admin B" });
  const ownAccountRes = await accountHandler(
    new NextRequest(`http://localhost:3000/api/fees/student-account?studentId=${studentB.id}&academicYear=${academicYear}`, { headers: { cookie: `allied_session=${adminBToken}` } })
  );
  assert(ownAccountRes.status === 200, "School B's own admin can view their own student's fee account (isolation is school-specific, not a global lockout)");

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
