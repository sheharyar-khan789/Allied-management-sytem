/**
 * Task 2 — Fee & Payments trial-data cleanup script. Verifies the matcher only ever catches the
 * exact literal seed-firebase.ts pattern (never a genuine payment that merely looks similar),
 * that dry run never writes anything, that --confirm is gated on both a matching project-id
 * confirmation and a real actor uid, and that the actual removal is an auditable reversal (never
 * a hard delete) that correctly recomputes the challan and leaves unrelated records untouched.
 * Runs against the in-memory store (no Firebase credentials loaded by tsx).
 */
import { runFeeTrialCleanup, isSeedPayment, SEED_SCHOOL_ID } from "./cleanup-seed-trial-payments";
import {
  saveFeeChallanServer,
  recordFeePaymentServer,
  getFeeChallanByIdServer,
  getPaymentByIdServer,
  getVoucherAdjustmentsForPaymentServer,
} from "../src/lib/firebase/server-db";
import { FeeChallanDoc, PaymentDoc } from "../src/lib/firebase/types";

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

async function run() {
  console.log("==================================================");
  console.log("FEE TRIAL-DATA CLEANUP SCRIPT — VERIFICATION");
  console.log("==================================================");

  const now = new Date().toISOString();

  // --- A genuine seed-pattern challan + payment, exactly matching scripts/seed-firebase.ts ---
  const seedChallan: FeeChallanDoc = {
    id: "ch-9001", schoolId: SEED_SCHOOL_ID, studentId: "std-seed-1", studentName: "Seed Student",
    admissionNo: "STD-SEED-001", classId: "cls-seed", className: "Class 9-A", challanNo: "CH-2025-9001",
    month: "January", year: 2025, issueDate: "2025-01-01", dueDate: "2025-01-15",
    tuitionFee: 6000, admissionFee: 0, examFee: 500, otherFee: 0, discount: 0,
    totalExpected: 6500, paidAmount: 0, balanceAmount: 6500, status: "PENDING", createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(seedChallan);
  const seedPayment: PaymentDoc = {
    id: "pay-9001", schoolId: SEED_SCHOOL_ID, challanId: seedChallan.id, studentId: seedChallan.studentId,
    studentName: seedChallan.studentName, receiptNo: "REC-2025-9001", amount: 6500, paymentDate: "2025-01-10",
    paymentMode: "CASH", transactionRef: "CASH-COUNTER-01", notes: "Fee paid on time at campus finance desk",
    collectedBy: "admin_allied_001", createdAt: now,
  };
  await recordFeePaymentServer(seedPayment);

  // --- A genuine, real-looking payment for the SAME school that must NEVER be touched: almost
  // everything matches except one field (paid by bank transfer, not the seed script's cash path).
  const genuineChallan: FeeChallanDoc = { ...seedChallan, id: "ch-9002", studentId: "std-real-1", studentName: "Real Student", challanNo: "CH-2025-9002", paidAmount: 0, balanceAmount: 6500, status: "PENDING" };
  await saveFeeChallanServer(genuineChallan);
  const genuinePayment: PaymentDoc = {
    id: "pay-9002", schoolId: SEED_SCHOOL_ID, challanId: genuineChallan.id, studentId: genuineChallan.studentId,
    studentName: genuineChallan.studentName, receiptNo: "REC-2025-9002", amount: 6500, paymentDate: "2025-01-10",
    paymentMode: "BANK_TRANSFER", transactionRef: "CASH-COUNTER-01", notes: "Fee paid on time at campus finance desk",
    collectedBy: "admin_allied_001", createdAt: now,
  };
  await recordFeePaymentServer(genuinePayment);

  // --- Another genuine payment, this time with everything matching except collectedBy (a real
  // staff member recorded it manually, by coincidence on the same literal date/notes/ref). ---
  const genuineChallan2: FeeChallanDoc = { ...seedChallan, id: "ch-9003", studentId: "std-real-2", studentName: "Another Real Student", challanNo: "CH-2025-9003", paidAmount: 0, balanceAmount: 6500, status: "PENDING" };
  await saveFeeChallanServer(genuineChallan2);
  const genuinePayment2: PaymentDoc = {
    id: "pay-9003", schoolId: SEED_SCHOOL_ID, challanId: genuineChallan2.id, studentId: genuineChallan2.studentId,
    studentName: genuineChallan2.studentName, receiptNo: "REC-2025-9003", amount: 6500, paymentDate: "2025-01-10",
    paymentMode: "CASH", transactionRef: "CASH-COUNTER-01", notes: "Fee paid on time at campus finance desk",
    collectedBy: "front-desk-staff-uid-77", createdAt: now,
  };
  await recordFeePaymentServer(genuinePayment2);

  // ======================================================================
  // 1. MATCHER — exact pattern only
  // ======================================================================
  assert(isSeedPayment(seedPayment) === true, "The exact seed-pattern payment is matched");
  assert(isSeedPayment(genuinePayment) === false, "A payment differing only in paymentMode is NOT matched");
  assert(isSeedPayment(genuinePayment2) === false, "A payment differing only in collectedBy is NOT matched");

  // ======================================================================
  // 2. DRY RUN — reports matches, writes nothing
  // ======================================================================
  const dryRun = await runFeeTrialCleanup({ confirm: false });
  assert(dryRun.matches.length === 1 && dryRun.matches[0].id === "pay-9001", "Dry run finds exactly the one true seed payment, none of the genuine look-alikes");
  assert(dryRun.totalAmount === 6500, "Dry run reports the correct total amount");
  assert(dryRun.reversed === 0 && dryRun.alreadyReversed === 0 && dryRun.failed === 0, "Dry run performs no writes at all");

  const challanAfterDryRun = await getFeeChallanByIdServer(SEED_SCHOOL_ID, seedChallan.id);
  assert(challanAfterDryRun?.paidAmount === 6500 && challanAfterDryRun?.status === "PAID", "Dry run leaves the matched challan's balance completely untouched");

  // ======================================================================
  // 3. --confirm GATING
  // ======================================================================
  const noProjectId = await runFeeTrialCleanup({ confirm: true, actorUid: "admin-uid-1" });
  assert(noProjectId.aborted === true, "Confirm without a matching --project-id is aborted, not executed");

  const wrongProjectId = await runFeeTrialCleanup({ confirm: true, projectIdConfirmation: "some-other-project", actorUid: "admin-uid-1" });
  assert(wrongProjectId.aborted === true, "Confirm with the WRONG project id is aborted");

  const noActor = await runFeeTrialCleanup({ confirm: true, projectIdConfirmation: "(none — in-memory/local store)" });
  assert(noActor.aborted === true, "Confirm without --actor-uid is aborted, even with the right project id");

  const stillUntouched = await getPaymentByIdServer(SEED_SCHOOL_ID, seedPayment.id);
  assert(stillUntouched?.voucherStatus !== "REVERSED", "None of the aborted confirm attempts actually reversed anything");

  // ======================================================================
  // 4. REAL EXECUTION — auditable reversal, never a hard delete
  // ======================================================================
  const realRun = await runFeeTrialCleanup({
    confirm: true,
    projectIdConfirmation: "(none — in-memory/local store)",
    actorUid: "admin-uid-1",
    actorName: "Test Admin",
  });
  assert(realRun.aborted === false && realRun.reversed === 1 && realRun.failed === 0, "Confirmed run with valid project-id and actor-uid reverses exactly the one matched payment");

  const reversedPayment = await getPaymentByIdServer(SEED_SCHOOL_ID, seedPayment.id);
  assert(reversedPayment !== null, "The payment document still exists — it was never hard-deleted");
  assert(reversedPayment?.voucherStatus === "REVERSED", "The payment is flagged REVERSED");
  assert(reversedPayment?.amount === 6500, "The original payment amount is preserved verbatim on the record itself");

  const adjustments = await getVoucherAdjustmentsForPaymentServer(SEED_SCHOOL_ID, seedPayment.id);
  assert(adjustments.length === 1 && adjustments[0].type === "REVERSAL" && adjustments[0].createdBy === "admin-uid-1", "An auditable REVERSAL adjustment was created, attributed to the real admin who confirmed it");

  const challanAfterReversal = await getFeeChallanByIdServer(SEED_SCHOOL_ID, seedChallan.id);
  assert(challanAfterReversal?.paidAmount === 0 && challanAfterReversal?.balanceAmount === 6500 && challanAfterReversal?.status === "PENDING", "The challan's paidAmount/balance/status are correctly recomputed back to unpaid");

  const genuineUntouched1 = await getPaymentByIdServer(SEED_SCHOOL_ID, genuinePayment.id);
  const genuineUntouched2 = await getPaymentByIdServer(SEED_SCHOOL_ID, genuinePayment2.id);
  assert(genuineUntouched1?.voucherStatus !== "REVERSED" && genuineUntouched2?.voucherStatus !== "REVERSED", "Neither genuine look-alike payment was touched by the cleanup");
  const genuineChallanAfter1 = await getFeeChallanByIdServer(SEED_SCHOOL_ID, genuineChallan.id);
  const genuineChallanAfter2 = await getFeeChallanByIdServer(SEED_SCHOOL_ID, genuineChallan2.id);
  assert(genuineChallanAfter1?.paidAmount === 6500 && genuineChallanAfter2?.paidAmount === 6500, "Both genuine challans still show their original paid amount, unaffected");

  // ======================================================================
  // 5. RE-RUN SAFETY — idempotent, never double-reverses
  // ======================================================================
  const secondRun = await runFeeTrialCleanup({
    confirm: true,
    projectIdConfirmation: "(none — in-memory/local store)",
    actorUid: "admin-uid-1",
  });
  assert(secondRun.alreadyReversed === 1 && secondRun.reversed === 0, "Re-running the confirmed cleanup reports ALREADY_REVERSED rather than reversing twice");
  const adjustmentsAfterSecondRun = await getVoucherAdjustmentsForPaymentServer(SEED_SCHOOL_ID, seedPayment.id);
  assert(adjustmentsAfterSecondRun.length === 1, "No second adjustment document was created by the re-run");

  console.log("==================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
