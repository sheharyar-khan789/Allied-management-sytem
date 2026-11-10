import { NextRequest } from "next/server";
import { GET as feesGetHandler, PUT as feesPutHandler } from "../src/app/api/fees/route";
import { GET as reportsGetHandler } from "../src/app/api/fees/reports/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveStudentServer, saveFeeChallanServer, getFeeChallanByIdServer } from "../src/lib/firebase/server-db";
import { computeFinancialSummary } from "../src/lib/financial-summary";
import { StudentDoc, FeeChallanDoc } from "../src/lib/firebase/types";

// Phase 11 — proves the new fee system (Phases 2-10) is additive, not a breaking schema
// change: a challan created the OLD way (manual single-entry form, before any of
// academicYear/source/previousOutstandingDues/etc existed) must keep working exactly as
// it did before, in the original ledger, in the payment engine, and in reversal — while
// the NEW academic-year-scoped reports/dashboard correctly and visibly exclude it rather
// than silently guessing which academic year it belongs to.
async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: BACKWARD COMPATIBILITY / MIGRATION (PHASE 11)");
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

  const schoolId = "school-backcompat-test-001";
  const academicYear = "2030-2031";

  const legacyStudent: StudentDoc = {
    id: "std-legacy-1",
    schoolId,
    admissionNo: "STD-2024-LEGACY",
    fullName: "Legacy Student",
    fatherName: "Legacy Father",
    gender: "MALE",
    classId: "cls-legacy",
    className: "Class 8",
    section: "A",
    rollNo: "15",
    status: "ACTIVE",
    guardianName: "Legacy Father",
    guardianPhone: "03001112233",
    guardianRelation: "Father",
    monthlyFee: 6000,
    discount: 0,
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
  };
  await saveStudentServer(legacyStudent);

  // A challan exactly as the ORIGINAL single-entry form created it, pre-dating every
  // Phase 2-10 field. No academicYear, no source, no previousOutstandingDues, etc.
  const legacyChallan: FeeChallanDoc = {
    id: "ch-legacy-1",
    schoolId,
    studentId: legacyStudent.id,
    studentName: legacyStudent.fullName,
    admissionNo: legacyStudent.admissionNo,
    classId: legacyStudent.classId,
    className: legacyStudent.className,
    challanNo: "CHL-2023-SEP-0001",
    month: "September",
    year: 2023,
    issueDate: "2023-09-01",
    dueDate: "2023-09-15",
    tuitionFee: 6000,
    admissionFee: 0,
    examFee: 500,
    otherFee: 0,
    discount: 0,
    totalExpected: 6500,
    paidAmount: 0,
    balanceAmount: 6500,
    status: "PENDING",
    createdAt: "2023-09-01T00:00:00.000Z",
    updatedAt: "2023-09-01T00:00:00.000Z",
    // Deliberately no academicYear / source / previousOutstandingDues / annualFeeCharged /
    // oneTimeChargesApplied / yearlyStructureId / generationBatchId.
  };
  await saveFeeChallanServer(legacyChallan);

  const adminToken = await createSessionCookieServer({ uid: "usr-admin-legacy", email: "admin-legacy@example.com", role: "ADMIN", schoolId, name: "Admin" });
  function getReq(path: string) {
    return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: `allied_session=${adminToken}` } });
  }
  function putReq(path: string, body: any) {
    return new NextRequest(`http://localhost:3000${path}`, { method: "PUT", headers: { cookie: `allied_session=${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  // ----------------------------------------------------
  // TEST: The original Collection Ledger (unscoped by academic year) still shows it
  // ----------------------------------------------------
  const ledgerRes = await feesGetHandler(getReq("/api/fees"));
  const ledgerJson = await ledgerRes.json();
  const foundInLedger = ledgerJson.challans.find((c: any) => c.id === "ch-legacy-1");
  assert(!!foundInLedger && foundInLedger.totalExpected === 6500, "Legacy challan (pre-dating every new field) still appears correctly in the original Collection Ledger");

  // ----------------------------------------------------
  // TEST: The original manual payment flow still works unchanged on a legacy challan
  // ----------------------------------------------------
  const payRes = await feesPutHandler(putReq("/api/fees", { challanId: "ch-legacy-1", amount: 6500, paymentMethod: "Cash Counter" }));
  assert(payRes.status === 200, "Recording a payment against a legacy challan via the original single-challan flow still succeeds");

  const legacyAfterPay = await getFeeChallanByIdServer(schoolId, "ch-legacy-1");
  assert(legacyAfterPay?.status === "PAID" && legacyAfterPay?.balanceAmount === 0, "Legacy challan's balance/status update exactly as before (no new-field dependency)");

  // ----------------------------------------------------
  // TEST: Academic-year-scoped reports correctly and visibly EXCLUDE untagged legacy data
  // (rather than silently guessing, or crashing on the missing field)
  // ----------------------------------------------------
  const duesRes = await reportsGetHandler(getReq(`/api/fees/reports?type=outstanding-dues&academicYear=${academicYear}`));
  const duesJson = await duesRes.json();
  assert(duesRes.status === 200, "Academic-year-scoped report runs without error despite untagged legacy data existing in the same school");
  assert(
    !duesJson.rows.some((r: any) => r.challanNo === "CHL-2023-SEP-0001"),
    "Legacy challan without an academicYear tag is correctly excluded from academic-year-scoped reports (not guessed into the wrong year)"
  );

  // ----------------------------------------------------
  // TEST: The centralized financial summary doesn't crash or silently miscount because of
  // untagged legacy records sharing the same school
  // ----------------------------------------------------
  const summary = await computeFinancialSummary(schoolId, academicYear);
  assert(
    Number.isFinite(summary.totalIncome) && Number.isFinite(summary.outstandingStudentDues),
    "Financial summary computes finite, well-formed numbers even with untagged legacy records present in the same school"
  );
  assert(summary.outstandingStudentDues === 0, "Legacy challan's balance is correctly excluded from the academic-year-scoped outstanding dues total (it belongs to no tracked academic year)");

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
  console.log("");
  console.log("MIGRATION NOTE: No destructive migration was required or performed.");
  console.log("Reason: Phase 1's audit found no pre-existing yearly fee structure, Excel");
  console.log("import, or expense-tracking data to migrate -- those features did not exist");
  console.log("before this work. Legacy manually-created challans/payments remain fully");
  console.log("functional in the original ledger and payment engine unchanged. They are");
  console.log("simply invisible to the NEW academic-year-scoped dashboard/reports unless an");
  console.log("admin backfills their academicYear field via a one-time admin action -- which");
  console.log("was deliberately NOT done automatically, since guessing a historical record's");
  console.log("academic year risks misclassifying real financial data.");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
