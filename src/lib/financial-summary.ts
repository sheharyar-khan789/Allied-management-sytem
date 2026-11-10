import {
  getFeeChallansServer,
  getYearlyFeeStructuresServer,
  getOtherCollectionsServer,
  getOtherExpensesServer,
  getAdvanceBalancesForSchoolServer,
} from "@/lib/firebase/server-db";

// Assumption, documented: a school year runs 12 billing months. If a school's academic
// calendar actually generates fewer/more monthly vouchers, "Yearly Expected Fees" here is
// a planning estimate from the fee structure, not a count of vouchers actually generated.
const MONTHS_PER_ACADEMIC_YEAR = 12;

export interface FinancialSummary {
  academicYear: string;
  // Fee-structure driven, independent of what's actually been collected.
  yearlyExpectedFees: number;
  // Student fee collections (Centralized Ledger, Phase 7):
  //   sum of every challan's current paidAmount (already net of any reversal, since
  //   reversePaymentServer decrements paidAmount directly)
  // + every student's currently UNCONSUMED advance balance (real cash already received
  //   that hasn't been matched to a specific voucher yet — counting it only once, either
  //   here or later as challan.paidAmount once a future voucher consumes it, never both).
  totalStudentFeeCollections: number;
  outstandingStudentDues: number;
  advancePaymentsTotal: number;
  otherCollectionsTotal: number;
  otherExpensesTotal: number;
  // Total Income = Student Fee Payments + Other Collections
  totalIncome: number;
  // Net Remaining Balance = Total Income - Actual Recorded Expenses
  netRemainingBalance: number;
}

export async function computeFinancialSummary(
  schoolId: string,
  academicYear: string,
  dateFrom?: string,
  dateTo?: string
): Promise<FinancialSummary> {
  const [challans, structures, otherCollections, otherExpenses, advanceBalances] = await Promise.all([
    getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, academicYear),
    getYearlyFeeStructuresServer(schoolId, academicYear),
    getOtherCollectionsServer(schoolId, dateFrom, dateTo),
    getOtherExpensesServer(schoolId, dateFrom, dateTo),
    getAdvanceBalancesForSchoolServer(schoolId, academicYear),
  ]);

  const yearlyExpectedFees = structures.reduce((sum, s) => {
    const recurring = (s.monthlyTuitionFee || 0) + (s.otherCharges || 0) - (s.discount || 0);
    return sum + recurring * MONTHS_PER_ACADEMIC_YEAR + (s.annualFee || 0) + (s.admissionFee || 0);
  }, 0);

  const totalPaidOnChallans = challans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
  const advancePaymentsTotal = advanceBalances.reduce((sum, a) => sum + (a.balance || 0), 0);
  const totalStudentFeeCollections = totalPaidOnChallans + advancePaymentsTotal;

  const outstandingStudentDues = challans.reduce((sum, c) => sum + Math.max(0, c.balanceAmount || 0), 0);

  const otherCollectionsTotal = otherCollections.filter((c) => !c.reversed).reduce((sum, c) => sum + c.amount, 0);
  const otherExpensesTotal = otherExpenses.filter((e) => !e.reversed).reduce((sum, e) => sum + e.amount, 0);

  const totalIncome = totalStudentFeeCollections + otherCollectionsTotal;
  const netRemainingBalance = totalIncome - otherExpensesTotal;

  return {
    academicYear,
    yearlyExpectedFees,
    totalStudentFeeCollections,
    outstandingStudentDues,
    advancePaymentsTotal,
    otherCollectionsTotal,
    otherExpensesTotal,
    totalIncome,
    netRemainingBalance,
  };
}
