import { FeeChallanDoc, YearlyFeeStructureDoc } from "@/lib/firebase/types";

const MONTH_ORDER = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function monthIndex(month: string): number {
  const idx = MONTH_ORDER.indexOf(month.trim().toLowerCase());
  return idx === -1 ? 0 : idx;
}

// Chronological comparator (ascending). Works regardless of which month the academic
// year starts in, because calendar year is compared first.
export function compareMonthYear(a: { month: string; year: number }, b: { month: string; year: number }): number {
  if (a.year !== b.year) return a.year - b.year;
  return monthIndex(a.month) - monthIndex(b.month);
}

/**
 * Single source of truth for a monthly voucher's total payable amount:
 *   totalExpected = tuitionFee + admissionFee + annualFeeCharged + otherFee + examFee
 *                    - discount + previousOutstandingDues
 *
 * previousOutstandingDues must be the immediately-preceding voucher's balanceAmount
 * (not a sum across all prior vouchers) because each voucher already carries forward
 * everything owed before it — summing would double-count.
 */
export function computeChallanTotal(input: {
  tuitionFee: number;
  admissionFee: number;
  annualFeeCharged: number;
  otherFee: number;
  examFee: number;
  discount: number;
  previousOutstandingDues: number;
}): number {
  const total =
    (input.tuitionFee || 0) +
    (input.admissionFee || 0) +
    (input.annualFeeCharged || 0) +
    (input.otherFee || 0) +
    (input.examFee || 0) -
    (input.discount || 0) +
    (input.previousOutstandingDues || 0);
  return Math.max(0, total);
}

export interface VoucherPlan {
  tuitionFee: number;
  admissionFee: number;
  annualFeeCharged: number;
  otherFee: number;
  discount: number;
  previousOutstandingDues: number;
  oneTimeChargesApplied: boolean;
  totalExpected: number;
}

/**
 * Decides what a new monthly voucher for (structure, month/year) should contain, given
 * every voucher already generated for this student in this academic year.
 * - One-time admission/annual fees are applied only once per student per academic year.
 * - previousOutstandingDues is carried from the single chronologically-latest prior
 *   voucher's balance, never summed across all prior vouchers (see computeChallanTotal).
 */
export function planMonthlyVoucher(
  structure: YearlyFeeStructureDoc,
  existingVouchersForStudentThisYear: FeeChallanDoc[]
): VoucherPlan {
  const oneTimeAlreadyApplied = existingVouchersForStudentThisYear.some((v) => v.oneTimeChargesApplied);

  const priorVouchers = [...existingVouchersForStudentThisYear].sort((a, b) =>
    compareMonthYear({ month: a.month, year: a.year }, { month: b.month, year: b.year })
  );
  const latestPrior = priorVouchers[priorVouchers.length - 1];
  const previousOutstandingDues = latestPrior ? Math.max(0, latestPrior.balanceAmount || 0) : 0;

  const admissionFee = oneTimeAlreadyApplied ? 0 : structure.admissionFee || 0;
  const annualFeeCharged = oneTimeAlreadyApplied ? 0 : structure.annualFee || 0;

  const totalExpected = computeChallanTotal({
    tuitionFee: structure.monthlyTuitionFee || 0,
    admissionFee,
    annualFeeCharged,
    otherFee: structure.otherCharges || 0,
    examFee: 0,
    discount: structure.discount || 0,
    previousOutstandingDues,
  });

  return {
    tuitionFee: structure.monthlyTuitionFee || 0,
    admissionFee,
    annualFeeCharged,
    otherFee: structure.otherCharges || 0,
    discount: structure.discount || 0,
    previousOutstandingDues,
    oneTimeChargesApplied: !oneTimeAlreadyApplied,
    totalExpected,
  };
}

export function monthlyVoucherId(schoolId: string, academicYear: string, admissionNo: string, month: string, year: number): string {
  return `mv-${schoolId}__${academicYear}__${admissionNo.trim().toUpperCase()}__${year}-${String(monthIndex(month) + 1).padStart(2, "0")}`;
}
