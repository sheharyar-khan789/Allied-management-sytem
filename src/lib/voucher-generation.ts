import type { FeeChallanDoc, YearlyFeeStructureDoc } from "./firebase/types";

/**
 * Automatic Monthly Voucher Generation — pure calculation, no database access (same split as
 * fee-import.ts: the API route fetches the school's real structures/challans and does the writes).
 *
 * Deliberately does NOT add the student's previous outstanding balance into the generated
 * challan's totalExpected: that figure is already computed dynamically at PRINT time by
 * pendingFeesFor()/computeVoucherAmounts() in fee-voucher.ts, by scanning the student's earlier
 * challans. Baking it into totalExpected here as well would double-count every prior due on
 * every printed voucher.
 */

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthIndex(month: string): number {
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === month.trim().toLowerCase());
  return idx === -1 ? 0 : idx;
}

export interface VoucherPlan {
  tuitionFee: number;
  admissionFee: number;
  annualFeeCharged: number;
  otherFee: number;
  discount: number;
  totalExpected: number;
  /** True when this plan applies the student's one-time admission/annual charges. */
  oneTimeChargesApplied: boolean;
}

/**
 * Plans one student's voucher for (month, year) from their yearly fee structure.
 * `priorChallansThisYear` must be every challan already issued to this student in the SAME
 * academic year (any month) — used only to tell whether the one-time admission/annual charges
 * were already applied, never to carry a balance forward.
 */
export function planMonthlyVoucher(
  structure: Pick<YearlyFeeStructureDoc, "monthlyTuitionFee" | "annualFee" | "admissionFee" | "otherCharges" | "discount">,
  priorChallansThisYear: Pick<FeeChallanDoc, "oneTimeChargesApplied">[]
): VoucherPlan {
  const oneTimeAlreadyApplied = priorChallansThisYear.some((c) => c.oneTimeChargesApplied);

  const admissionFee = oneTimeAlreadyApplied ? 0 : structure.admissionFee || 0;
  const annualFeeCharged = oneTimeAlreadyApplied ? 0 : structure.annualFee || 0;
  const tuitionFee = structure.monthlyTuitionFee || 0;
  const otherFee = structure.otherCharges || 0;
  const discount = structure.discount || 0;

  const totalExpected = Math.max(0, tuitionFee + admissionFee + annualFeeCharged + otherFee - discount);

  return {
    tuitionFee,
    admissionFee,
    annualFeeCharged,
    otherFee,
    discount,
    totalExpected,
    oneTimeChargesApplied: !oneTimeAlreadyApplied,
  };
}

/** True when this student already has a voucher for (month, year) in this academic year — generation must skip it, never create a second one. */
export function voucherAlreadyExists(
  existingChallansForStudent: Pick<FeeChallanDoc, "month" | "year">[],
  month: string,
  year: number
): boolean {
  return existingChallansForStudent.some((c) => c.month === month && c.year === year);
}

export type VoucherGenerationAction = "GENERATED" | "SKIPPED_EXISTS" | "SKIPPED_NO_STRUCTURE" | "FAILED";

export interface VoucherGenerationRow {
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  className: string;
  action: VoucherGenerationAction;
  reason?: string;
  plan?: VoucherPlan;
}

export interface AdvanceApplication {
  /** Amount of the student's advance balance actually consumed by this voucher (0 if none/unavailable). */
  amountApplied: number;
  balanceAmount: number;
  status: "PAID" | "PARTIAL" | "PENDING";
}

/** Applies at most `availableAdvance` toward `totalExpected`, never more than either figure. */
export function applyAdvanceToVoucher(totalExpected: number, availableAdvance: number): AdvanceApplication {
  const amountApplied = Math.max(0, Math.min(totalExpected, availableAdvance));
  const balanceAmount = Math.max(0, totalExpected - amountApplied);
  const status: AdvanceApplication["status"] = totalExpected <= 0 || balanceAmount === 0 ? "PAID" : amountApplied > 0 ? "PARTIAL" : "PENDING";
  return { amountApplied, balanceAmount, status };
}
