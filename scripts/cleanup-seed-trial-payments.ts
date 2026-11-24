/**
 * Task 2 — Fee & Payments trial-data cleanup.
 *
 * Scope: ONLY payment records that exactly match the deterministic demo data written by
 * `scripts/seed-firebase.ts` for schoolId "allied-school-main" (fixed ids ch-1001+/pay-1001+,
 * paymentDate 2025-01-10, transactionRef "CASH-COUNTER-01", collectedBy "admin_allied_001",
 * notes "Fee paid on time at campus finance desk"). No trial/test flag exists anywhere in the fee
 * schema, so this script does NOT attempt to guess at anything outside this exact literal
 * pattern — a payment that merely looks similar but doesn't match every field is left untouched
 * and is NOT reported as a candidate.
 *
 * Removal method: an auditable REVERSAL via the existing createVoucherAdjustmentServer — this
 * codebase deliberately has no hard-delete path for a payment (see server-db.ts, "no second
 * collection mirroring the same financial facts"). A reversal zeroes the payment's effect on its
 * challan (recomputing paidAmount/balanceAmount/status) and flips the payment to voucherStatus
 * "REVERSED", so it stops counting in collection totals/dashboards while the record itself, and
 * every number that ever existed, stays in the audit trail.
 *
 * SAFETY:
 *  - Defaults to DRY RUN: only lists matches, writes nothing.
 *  - Writing requires both --confirm AND --project-id=<the exact connected Firebase project id>,
 *    so an operator cannot accidentally confirm against the wrong project by habit.
 *  - Requires --actor-uid=<admin uid> (and optional --actor-name=) so every reversal's audit trail
 *    names a real person, not a generic "script" identity.
 *  - Never touches feeStructures, concessions, student profiles, or the studentFeeLedgers/
 *    yearlyFeeLedger collections (reported separately, informational only, if anything is found).
 *
 * Usage:
 *   npx tsx scripts/cleanup-seed-trial-payments.ts                                   (dry run)
 *   npx tsx scripts/cleanup-seed-trial-payments.ts --confirm --project-id=<id> --actor-uid=<uid> [--actor-name="Full Name"]
 */
import {
  getPaymentsServer,
  getFeeChallanByIdServer,
  getStudentFeeLedgerServer,
  getYearlyFeeLedgerForStudentServer,
  createVoucherAdjustmentServer,
} from "../src/lib/firebase/server-db";
import { hasAdminCredentials } from "../src/lib/firebase/admin";
import { PaymentDoc } from "../src/lib/firebase/types";

export const SEED_SCHOOL_ID = "allied-school-main";

/** True only when every field matches the literal seed-firebase.ts pattern exactly. */
export function isSeedPayment(p: PaymentDoc): boolean {
  return (
    /^pay-\d+$/.test(p.id) &&
    p.schoolId === SEED_SCHOOL_ID &&
    p.paymentDate === "2025-01-10" &&
    p.paymentMode === "CASH" &&
    p.transactionRef === "CASH-COUNTER-01" &&
    p.collectedBy === "admin_allied_001" &&
    p.notes === "Fee paid on time at campus finance desk"
  );
}

export interface CleanupOptions {
  confirm: boolean;
  /** Required and must equal the connected project id when confirm is true. */
  projectIdConfirmation?: string;
  /** Required when confirm is true — names who authorized the reversal in the audit trail. */
  actorUid?: string;
  actorName?: string;
}

export interface CleanupResult {
  connectedProjectId: string;
  matches: PaymentDoc[];
  totalAmount: number;
  ledgerHits: number;
  aborted: boolean;
  abortReason?: string;
  reversed: number;
  alreadyReversed: number;
  failed: number;
}

export async function runFeeTrialCleanup(options: CleanupOptions): Promise<CleanupResult> {
  const connectedProjectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "(none — in-memory/local store)";

  const allPayments = await getPaymentsServer(SEED_SCHOOL_ID, undefined, 500, { allSessions: true });
  const matches = allPayments.filter(isSeedPayment);
  const totalAmount = matches.reduce((sum, p) => sum + p.amount, 0);

  // Informational only — never written to. These are a separate, newer ledger feature; the seed
  // script does not populate them, so this is expected to report zero.
  const studentIds = Array.from(new Set(matches.map((p) => p.studentId)));
  let ledgerHits = 0;
  for (const studentId of studentIds) {
    const [studentLedger, yearlyLedger] = await Promise.all([
      getStudentFeeLedgerServer(SEED_SCHOOL_ID, studentId, 2025).catch(() => null),
      getYearlyFeeLedgerForStudentServer(SEED_SCHOOL_ID, studentId, "2025-2026").catch(() => null),
    ]);
    if (studentLedger || yearlyLedger) ledgerHits++;
  }

  const base: CleanupResult = { connectedProjectId, matches, totalAmount, ledgerHits, aborted: false, reversed: 0, alreadyReversed: 0, failed: 0 };
  if (!options.confirm || matches.length === 0) return base;

  if (!options.projectIdConfirmation || options.projectIdConfirmation !== connectedProjectId) {
    return { ...base, aborted: true, abortReason: `--project-id must exactly match the connected project ("${connectedProjectId}").` };
  }
  if (!options.actorUid) {
    return { ...base, aborted: true, abortReason: "--actor-uid=<admin uid> is required so the audit trail names a real person." };
  }

  let reversed = 0, alreadyReversed = 0, failed = 0;
  for (const p of matches) {
    const challan = await getFeeChallanByIdServer(SEED_SCHOOL_ID, p.challanId);
    if (!challan) { failed++; continue; }
    const result = await createVoucherAdjustmentServer(
      SEED_SCHOOL_ID,
      p.id,
      { type: "REVERSAL", reason: "Trial/seed data cleanup — demo payment created by scripts/seed-firebase.ts, removed per school request so Fee & Payments starts fresh." },
      { uid: options.actorUid, name: options.actorName }
    );
    if (result.ok) reversed++;
    else if (result.error === "ALREADY_REVERSED") alreadyReversed++;
    else failed++;
  }
  return { ...base, reversed, alreadyReversed, failed };
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.slice(2).split("=");
    args[key] = value === undefined ? true : value;
  }
  return args;
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  const confirm = args.confirm === true;

  console.log("==================================================");
  console.log("FEE & PAYMENTS TRIAL-DATA CLEANUP (Task 2)");
  console.log("==================================================");
  console.log(`Using real Firestore (Admin SDK) : ${hasAdminCredentials}`);
  console.log(`Target schoolId                  : ${SEED_SCHOOL_ID}`);
  console.log(`Mode                              : ${confirm ? "CONFIRM — WILL WRITE REVERSALS" : "DRY RUN — read-only"}`);
  console.log("==================================================\n");

  const result = await runFeeTrialCleanup({
    confirm,
    projectIdConfirmation: args["project-id"] ? String(args["project-id"]) : undefined,
    actorUid: args["actor-uid"] ? String(args["actor-uid"]) : undefined,
    actorName: args["actor-name"] ? String(args["actor-name"]) : undefined,
  });

  console.log(`Connected Firebase project: ${result.connectedProjectId}\n`);
  if (result.matches.length === 0) {
    console.log("No payments matching the exact seed-firebase.ts pattern were found. Nothing to do.");
    return;
  }

  console.log(`Found ${result.matches.length} payment(s) matching the exact seed pattern:\n`);
  for (const p of result.matches) {
    console.log(`  ${p.id}  student=${p.studentId} (${p.studentName || "?"})  amount=${p.amount}  challan=${p.challanId}`);
  }
  console.log(`\nTotal amount across matched payments: ${result.totalAmount}`);
  console.log(`studentFeeLedgers / yearlyFeeLedger entries found for these students: ${result.ledgerHits} (informational only — never touched by this script).`);

  if (!confirm) {
    console.log("\nDry run complete. No data was written. Re-run with --confirm --project-id=<id> --actor-uid=<uid> to reverse these payments.");
    return;
  }
  if (result.aborted) {
    console.error(`\nABORTED: ${result.abortReason}`);
    process.exitCode = 1;
    return;
  }

  console.log("\n==================================================");
  console.log(`DONE: ${result.reversed} reversed, ${result.alreadyReversed} already reversed, ${result.failed} failed.`);
  console.log("Fee aggregate caches were invalidated as part of each reversal — dashboards reflect this immediately.");
  console.log("==================================================");
  if (result.failed > 0) process.exitCode = 1;
}

// Only auto-run the CLI flow when this file is the actual entry script — not when imported
// (e.g. by scripts/fee-trial-cleanup-test.ts, which exercises runFeeTrialCleanup() directly
// against fixtures it controls, in the same process).
const isDirectRun = (process.argv[1] || "").replace(/\\/g, "/").endsWith("cleanup-seed-trial-payments.ts");
if (isDirectRun) {
  cli().catch((err) => {
    console.error("Cleanup script crashed:", err);
    process.exit(1);
  });
}
