import { FeeChallanDoc } from "@/lib/firebase/types";
import { feeMonthOf } from "@/lib/fee-ledger";
import { FEE_MONTHS } from "@/lib/firebase/types";

/**
 * Fee voucher (printed challan) amounts. Pure — no database access — so the same rules are used by
 * the single and the bulk print APIs and can be unit-tested.
 *
 * Template rows (the school's Nursery voucher): Tuition Fee, Annual subscription, Pending Fees,
 * Book Dues, Total, Paid Dues, After Due Date.
 *
 *  - Tuition Fee          = challan.tuitionFee
 *  - Annual subscription  = challan.admissionFee + challan.examFee
 *  - Book Dues            = challan.otherFee
 *  - Pending Fees         = unpaid balance (totalExpected - paidAmount, never negative) of the same
 *                           student's EARLIER challans only (same academic session)
 *  - Total                = max(0, tuition + annual + book - discount) + Pending Fees
 *  - Paid Dues            = challan.paidAmount (the challan's own running total of valid payments;
 *                           reversals/adjustments already reduce it) — shown, NOT subtracted from Total
 *  - After Due Date       = flat surcharge printed on the school's voucher (AFTER_DUE_DATE_FEE)
 */

/** Late-payment surcharge printed on the school's voucher template (Rs. 200 on every student's copy). */
export const AFTER_DUE_DATE_FEE = 200;

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Sortable month index (year*12 + month) or null when the challan's month is not a real month. */
export function challanPeriodKey(c: Pick<FeeChallanDoc, "month" | "year">): number | null {
  const m = feeMonthOf(c.month);
  const year = Number(c.year);
  if (!m || !Number.isFinite(year)) return null;
  return year * 12 + FEE_MONTHS.indexOf(m);
}

/** True when `candidate` is an earlier billing period than `current` for the same student. */
export function isEarlierChallan(candidate: FeeChallanDoc, current: FeeChallanDoc): boolean {
  if (candidate.id === current.id) return false;
  if (candidate.studentId !== current.studentId || candidate.schoolId !== current.schoolId) return false;
  if (candidate.academicYear && current.academicYear && candidate.academicYear !== current.academicYear) return false;
  const a = challanPeriodKey(candidate);
  const b = challanPeriodKey(current);
  if (a !== null && b !== null) return a < b;
  return (candidate.dueDate || "") !== "" && (candidate.dueDate || "") < (current.dueDate || "");
}

export function challanOutstanding(c: Pick<FeeChallanDoc, "totalExpected" | "paidAmount">): number {
  return Math.max(0, n(c.totalExpected) - n(c.paidAmount));
}

/** Carried-over balance of the student's earlier challans (each challan counted once). */
export function pendingFeesFor(current: FeeChallanDoc, studentChallans: FeeChallanDoc[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const c of studentChallans) {
    if (seen.has(c.id) || !isEarlierChallan(c, current)) continue;
    seen.add(c.id);
    sum += challanOutstanding(c);
  }
  return sum;
}

export interface VoucherAmounts {
  tuitionFee: number;
  annualSubscription: number;
  pendingFees: number;
  bookDues: number;
  discount: number;
  total: number;
  paidDues: number;
  afterDueDate: number;
}

export function computeVoucherAmounts(challan: FeeChallanDoc, studentChallans: FeeChallanDoc[]): VoucherAmounts {
  const tuitionFee = n(challan.tuitionFee);
  const annualSubscription = n(challan.admissionFee) + n(challan.examFee);
  const bookDues = n(challan.otherFee);
  const discount = n(challan.discount);
  const pendingFees = pendingFeesFor(challan, studentChallans);
  const total = Math.max(0, tuitionFee + annualSubscription + bookDues - discount) + pendingFees;
  return {
    tuitionFee,
    annualSubscription,
    pendingFees,
    bookDues,
    discount,
    total,
    paidDues: n(challan.paidAmount),
    afterDueDate: AFTER_DUE_DATE_FEE,
  };
}

/** What both print APIs return and the voucher component renders. */
export interface VoucherData {
  school: { name: string; campusName: string; address: string; phone: string };
  student: { id: string; fullName: string; fatherName: string; admissionNo: string; className: string; section: string };
  challan: { id: string; challanNo: string; month: string; year: number; issueDate: string; dueDate: string };
  amounts: VoucherAmounts;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-01" -> "01-Nov-2026" (the voucher's date format); anything else -> "" so nothing is invented. */
export function voucherDate(value: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!m) return "";
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return "";
  return `${m[3]}-${MONTH_ABBR[idx]}-${m[1]}`;
}
