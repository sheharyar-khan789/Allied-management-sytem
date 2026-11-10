import { compareMonthYear } from "@/lib/fee-calculations";
import { FeeChallanDoc } from "@/lib/firebase/types";

export interface WorkingChallanState {
  id: string;
  month: string;
  year: number;
  balanceAmount: number;
}

export interface StudentPaymentState {
  challans: WorkingChallanState[];
  advanceBalance: number;
}

export function buildInitialStudentState(challans: FeeChallanDoc[], advanceBalance: number): StudentPaymentState {
  return {
    challans: challans.map((c) => ({ id: c.id, month: c.month, year: c.year, balanceAmount: c.balanceAmount || 0 })),
    advanceBalance,
  };
}

export interface AllocationLine {
  challanId: string;
  challanLabel: string;
  amountApplied: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
  advanceAmount: number;
}

/**
 * Allocation strategy (documented, single rule for the whole system):
 *   1. Oldest unpaid/partial voucher first (chronological order), fully settling each
 *      before moving to the next — this is how "previous outstanding dues" get paid off.
 *   2. Any amount left over after every due voucher is settled becomes an advance credit,
 *      automatically consumed by the student's next generated voucher (see advance-balance.ts).
 *
 * Mutates `state` in place (decrements challan balances, credits advance) so that calling
 * this twice in a row for the same student — because a file has two payment rows for them —
 * correctly sees the first payment's effect before planning the second.
 */
export function allocateAndApply(state: StudentPaymentState, amount: number): AllocationResult {
  const unpaid = state.challans
    .filter((c) => c.balanceAmount > 0)
    .sort((a, b) => compareMonthYear({ month: a.month, year: a.year }, { month: b.month, year: b.year }));

  let remaining = amount;
  const lines: AllocationLine[] = [];
  for (const c of unpaid) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, c.balanceAmount);
    lines.push({ challanId: c.id, challanLabel: `${c.month} ${c.year}`, amountApplied: applied });
    c.balanceAmount -= applied;
    remaining -= applied;
  }

  const advanceAmount = Math.max(0, remaining);
  state.advanceBalance += advanceAmount;
  return { lines, advanceAmount };
}

/**
 * Dedup key for a daily transaction row. When a real receipt/reference number is present it
 * is authoritative (two rows with the same reference for the same student are the same
 * payment). Otherwise falls back to a content hash of (student, date, amount, category) —
 * a deliberate, documented tradeoff: a false-positive duplicate flag on two genuinely
 * separate same-day/same-amount payments is far safer than silently double-counting money.
 */
export function computeDedupKey(
  schoolId: string,
  admissionNo: string,
  paymentDate: string,
  amount: number,
  category: string,
  referenceNumber?: string
): string {
  if (referenceNumber && referenceNumber.trim().length > 0) {
    return `ref:${schoolId}__${admissionNo.trim().toUpperCase()}__${referenceNumber.trim().toUpperCase()}`;
  }
  return `auto:${schoolId}__${admissionNo.trim().toUpperCase()}__${paymentDate}__${amount}__${category.trim().toLowerCase()}`;
}
