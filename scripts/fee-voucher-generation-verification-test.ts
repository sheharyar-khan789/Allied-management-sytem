import { NextRequest } from "next/server";
import { POST as previewHandler } from "../src/app/api/fees/vouchers/generate/preview/route";
import { POST as commitHandler } from "../src/app/api/fees/vouchers/generate/commit/route";
import { POST as regenerateHandler } from "../src/app/api/fees/vouchers/[id]/regenerate/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveStudentServer,
  saveYearlyFeeStructureServer,
  getFeeChallanByIdServer,
  getFeeChallansServer,
  recordFeePaymentServer,
} from "../src/lib/firebase/server-db";
import { StudentDoc, YearlyFeeStructureDoc } from "../src/lib/firebase/types";
import { monthlyVoucherId } from "../src/lib/fee-calculations";

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: MONTHLY VOUCHER GENERATION (PHASE 3)");
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

  const schoolId = "school-voucher-gen-test-001";
  const academicYear = "2025-2026";

  const studentA: StudentDoc = {
    id: "std-vgt-a",
    schoolId,
    admissionNo: "VG-A",
    fullName: "Ayesha Tariq",
    fatherName: "Tariq Mehmood",
    gender: "FEMALE",
    classId: "cls-vgt-6a",
    className: "Grade 6",
    section: "A",
    rollNo: "1",
    status: "ACTIVE",
    guardianName: "Tariq Mehmood",
    guardianPhone: "03001234567",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const studentB: StudentDoc = { ...studentA, id: "std-vgt-b", admissionNo: "VG-B", fullName: "Hamza Sheikh", classId: "cls-vgt-6b", className: "Grade 6", section: "B" };
  await saveStudentServer(studentA);
  await saveStudentServer(studentB);

  const structureA: YearlyFeeStructureDoc = {
    id: `${schoolId}__${academicYear}__VG-A`,
    schoolId,
    academicYear,
    studentId: studentA.id,
    admissionNo: "VG-A",
    studentName: studentA.fullName,
    classId: studentA.classId,
    className: studentA.className,
    section: studentA.section,
    monthlyTuitionFee: 5000,
    annualFee: 10000,
    admissionFee: 3000,
    otherCharges: 200,
    discount: 0,
    source: "IMPORT",
    createdAt: new Date().toISOString(),
    createdBy: "test-admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "test-admin",
  };
  const structureB: YearlyFeeStructureDoc = {
    ...structureA,
    id: `${schoolId}__${academicYear}__VG-B`,
    studentId: studentB.id,
    admissionNo: "VG-B",
    studentName: studentB.fullName,
    classId: studentB.classId,
    className: studentB.className,
    monthlyTuitionFee: 6000,
    annualFee: 0,
    admissionFee: 0,
    otherCharges: 0,
  };
  await saveYearlyFeeStructureServer(structureA);
  await saveYearlyFeeStructureServer(structureB);

  const adminToken = await createSessionCookieServer({
    uid: "usr-admin-vgt",
    email: "admin-vgt@example.com",
    role: "ADMIN",
    schoolId,
    name: "Admin",
  });
  const teacherToken = await createSessionCookieServer({
    uid: "usr-teacher-vgt",
    email: "teacher-vgt@example.com",
    role: "TEACHER",
    schoolId,
    name: "Teacher",
  });

  function adminReq(path: string, body: any) {
    return new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { cookie: `allied_session=${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ----------------------------------------------------
  // TEST: Teachers cannot generate vouchers
  // ----------------------------------------------------
  const teacherReq = new NextRequest("http://localhost:3000/api/fees/vouchers/generate/preview", {
    method: "POST",
    headers: { cookie: `allied_session=${teacherToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ academicYear, month: "September", year: 2025, scope: "SCHOOL" }),
  });
  const teacherRes = await previewHandler(teacherReq);
  assert(teacherRes.status === 403, "Teacher is forbidden from previewing voucher generation (admin-only)");

  // ----------------------------------------------------
  // TEST: September generation — whole school, first month
  // ----------------------------------------------------
  const sepPreviewRes = await previewHandler(adminReq("/api/fees/vouchers/generate/preview", { academicYear, month: "September", year: 2025, scope: "SCHOOL" }));
  const sepPreview = await sepPreviewRes.json();
  assert(sepPreview.summary.createdCount === 2 && sepPreview.summary.errorCount === 0, "September preview plans both students as CREATED");

  const sepCommitRes = await commitHandler(adminReq("/api/fees/vouchers/generate/commit", { academicYear, month: "September", year: 2025, scope: "SCHOOL" }));
  const sepCommit = await sepCommitRes.json();
  assert(sepCommit.success && sepCommit.summary.createdCount === 2, "September commit creates 2 vouchers");

  const sepVoucherIdA = monthlyVoucherId(schoolId, academicYear, "VG-A", "September", 2025);
  const sepChallanA = await getFeeChallanByIdServer(schoolId, sepVoucherIdA);
  assert(
    !!sepChallanA && sepChallanA.totalExpected === 5000 + 3000 + 10000 + 200 && sepChallanA.previousOutstandingDues === 0,
    `September voucher for Student A includes one-time admission+annual fee and has zero prior dues (got total=${sepChallanA?.totalExpected})`
  );
  assert(!!sepChallanA?.oneTimeChargesApplied, "September voucher marks one-time charges as applied");

  // ----------------------------------------------------
  // TEST: Duplicate generation protection — re-running September is a no-op
  // ----------------------------------------------------
  const sepRepeatPreviewRes = await previewHandler(adminReq("/api/fees/vouchers/generate/preview", { academicYear, month: "September", year: 2025, scope: "SCHOOL" }));
  const sepRepeatPreview = await sepRepeatPreviewRes.json();
  assert(
    sepRepeatPreview.summary.skippedCount === 2 && sepRepeatPreview.summary.createdCount === 0,
    "Re-running September generation skips both students (already generated, never duplicated)"
  );

  // ----------------------------------------------------
  // TEST: October generation carries forward September's unpaid balance, no double one-time charges
  // ----------------------------------------------------
  await commitHandler(adminReq("/api/fees/vouchers/generate/commit", { academicYear, month: "October", year: 2025, scope: "SCHOOL" }));
  const octVoucherIdA = monthlyVoucherId(schoolId, academicYear, "VG-A", "October", 2025);
  const octChallanA = await getFeeChallanByIdServer(schoolId, octVoucherIdA);
  assert(
    !!octChallanA && octChallanA.previousOutstandingDues === 18200 && octChallanA.admissionFee === 0 && octChallanA.annualFeeCharged === 0,
    `October voucher carries forward September's full unpaid balance and applies no second one-time charge (got prevDues=${octChallanA?.previousOutstandingDues}, admissionFee=${octChallanA?.admissionFee})`
  );
  assert(octChallanA?.totalExpected === 5000 + 200 + 18200, `October total correctly combines recurring fee + carried-forward dues (got ${octChallanA?.totalExpected})`);

  // ----------------------------------------------------
  // TEST: Paying off September does not silently rewrite October's stored snapshot
  // ----------------------------------------------------
  await recordFeePaymentServer(schoolId, sepVoucherIdA, 18200, "CASH", undefined, "Full settlement", "Cashier");
  const sepAfterPayment = await getFeeChallanByIdServer(schoolId, sepVoucherIdA);
  const octAfterSepPayment = await getFeeChallanByIdServer(schoolId, octVoucherIdA);
  assert(sepAfterPayment?.status === "PAID" && sepAfterPayment?.balanceAmount === 0, "September voucher is fully settled after payment");
  assert(
    octAfterSepPayment?.previousOutstandingDues === 18200 && octAfterSepPayment?.totalExpected === 23400,
    "October's historical snapshot is untouched by a later payment against September (no silent rewrite)"
  );

  // ----------------------------------------------------
  // TEST: November carries forward October's balance (still unpaid), independent of September
  // ----------------------------------------------------
  await commitHandler(adminReq("/api/fees/vouchers/generate/commit", { academicYear, month: "November", year: 2025, scope: "SCHOOL" }));
  const novVoucherIdA = monthlyVoucherId(schoolId, academicYear, "VG-A", "November", 2025);
  const novChallanA = await getFeeChallanByIdServer(schoolId, novVoucherIdA);
  assert(
    novChallanA?.previousOutstandingDues === 23400 && novChallanA?.totalExpected === 5000 + 200 + 23400,
    `November carries forward October's balance correctly, chained rather than summed (got prevDues=${novChallanA?.previousOutstandingDues})`
  );

  // ----------------------------------------------------
  // TEST: CLASS scope only targets students in that class
  // ----------------------------------------------------
  const classPreviewRes = await previewHandler(adminReq("/api/fees/vouchers/generate/preview", { academicYear, month: "December", year: 2025, scope: "CLASS", classId: "cls-vgt-6a" }));
  const classPreview = await classPreviewRes.json();
  assert(
    classPreview.rows.length === 1 && classPreview.rows[0].admissionNo === "VG-A",
    "CLASS scope plans only students belonging to the specified class"
  );

  // ----------------------------------------------------
  // TEST: STUDENT scope with an unknown studentId reports an error, not a silent skip
  // ----------------------------------------------------
  const unknownStudentRes = await previewHandler(adminReq("/api/fees/vouchers/generate/preview", { academicYear, month: "December", year: 2025, scope: "STUDENT", studentId: "does-not-exist" }));
  const unknownStudentPreview = await unknownStudentRes.json();
  assert(
    unknownStudentPreview.rows.length === 1 && unknownStudentPreview.rows[0].action === "ERROR",
    "STUDENT scope with an unknown studentId is reported as an explicit error"
  );

  // ----------------------------------------------------
  // TEST: Regeneration is blocked once a payment exists, allowed when unpaid
  // ----------------------------------------------------
  const blockedRegenRes = await regenerateHandler(
    new NextRequest(`http://localhost:3000/api/fees/vouchers/${sepVoucherIdA}/regenerate`, {
      method: "POST",
      headers: { cookie: `allied_session=${adminToken}` },
    }),
    { params: Promise.resolve({ id: sepVoucherIdA }) }
  );
  assert(blockedRegenRes.status === 409, "Regenerating a voucher with a recorded payment is blocked (409)");

  const allowedRegenRes = await regenerateHandler(
    new NextRequest(`http://localhost:3000/api/fees/vouchers/${novVoucherIdA}/regenerate`, {
      method: "POST",
      headers: { cookie: `allied_session=${adminToken}` },
    }),
    { params: Promise.resolve({ id: novVoucherIdA }) }
  );
  assert(allowedRegenRes.status === 200, "Regenerating an unpaid voucher is allowed");

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
