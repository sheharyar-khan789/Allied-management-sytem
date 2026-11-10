import {
  getFeeChallansServer,
  getPaymentsServer,
  getStudentsServer,
  getOtherCollectionsServer,
  getOtherExpensesServer,
  getAdvanceBalancesForSchoolServer,
  getImportBatchesServer,
  getVoucherGenerationBatchesServer,
} from "@/lib/firebase/server-db";
import { computeFinancialSummary } from "@/lib/financial-summary";

export type ReportType =
  | "class-wise-collections"
  | "monthly-collections"
  | "student-ledger"
  | "outstanding-dues"
  | "advance-payments"
  | "other-collections"
  | "other-expenses"
  | "net-summary"
  | "import-history";

export const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "net-summary", label: "Net Financial Summary" },
  { value: "monthly-collections", label: "Monthly Fee Collection Report" },
  { value: "class-wise-collections", label: "Class-wise Collection Report" },
  { value: "student-ledger", label: "Student Fee Ledger" },
  { value: "outstanding-dues", label: "Outstanding Dues Report" },
  { value: "advance-payments", label: "Advance Payment Report" },
  { value: "other-collections", label: "Other Collections Report" },
  { value: "other-expenses", label: "School Expenses Report" },
  { value: "import-history", label: "Import Batch History" },
];

export interface ReportFilters {
  classId?: string;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
}

// Single dispatcher so the on-screen report viewer and the Excel export hit exactly the
// same data for the same filters — a report can never show one number on screen and
// export a different one.
export async function getReportData(
  type: ReportType,
  schoolId: string,
  academicYear: string,
  filters: ReportFilters = {}
): Promise<{ rows: Record<string, any>[] }> {
  switch (type) {
    case "net-summary": {
      const summary = await computeFinancialSummary(schoolId, academicYear, filters.dateFrom, filters.dateTo);
      return { rows: [summary] };
    }
    case "monthly-collections":
      return { rows: await getMonthlyCollectionReport(schoolId, academicYear) };
    case "class-wise-collections":
      return { rows: await getClassWiseCollectionReport(schoolId, academicYear) };
    case "student-ledger": {
      let rows = await getStudentFeeLedgerReport(schoolId, academicYear);
      if (filters.classId) rows = rows.filter((r) => r.classId === filters.classId);
      return { rows };
    }
    case "outstanding-dues": {
      let rows = await getOutstandingDuesReport(schoolId, academicYear);
      if (filters.classId) rows = rows.filter((r) => r.classId === filters.classId);
      return { rows };
    }
    case "advance-payments":
      return { rows: await getAdvancePaymentReport(schoolId, academicYear) };
    case "other-collections":
      return { rows: await getOtherCollectionsServer(schoolId, filters.dateFrom, filters.dateTo, filters.category) };
    case "other-expenses":
      return { rows: await getOtherExpensesServer(schoolId, filters.dateFrom, filters.dateTo, filters.category) };
    case "import-history":
      return { rows: await getImportBatchHistoryReport(schoolId, academicYear) };
    default:
      throw new Error(`Unknown report type: ${type}`);
  }
}

export interface ClassWiseCollectionRow {
  classId: string;
  className: string;
  studentCount: number;
  expected: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
}

export async function getClassWiseCollectionReport(schoolId: string, academicYear: string): Promise<ClassWiseCollectionRow[]> {
  const challans = await getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, academicYear);
  const byClass = new Map<string, { className: string; studentIds: Set<string>; expected: number; collected: number; outstanding: number }>();

  challans.forEach((c) => {
    const key = c.classId || "unassigned";
    if (!byClass.has(key)) {
      byClass.set(key, { className: c.className || "Unassigned", studentIds: new Set(), expected: 0, collected: 0, outstanding: 0 });
    }
    const entry = byClass.get(key)!;
    entry.studentIds.add(c.studentId);
    entry.expected += c.totalExpected || 0;
    entry.collected += c.paidAmount || 0;
    entry.outstanding += Math.max(0, c.balanceAmount || 0);
  });

  return Array.from(byClass.entries())
    .map(([classId, v]) => ({
      classId,
      className: v.className,
      studentCount: v.studentIds.size,
      expected: v.expected,
      collected: v.collected,
      outstanding: v.outstanding,
      collectionRate: v.expected > 0 ? Number(((v.collected / v.expected) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => a.className.localeCompare(b.className));
}

export interface MonthlyCollectionRow {
  period: string; // YYYY-MM, by actual payment date
  amount: number;
}

// Grouped by when the cash actually arrived (PaymentDoc.paymentDate), scoped to payments
// against this academic year's vouchers — not by which voucher-month the money paid off.
export async function getMonthlyCollectionReport(schoolId: string, academicYear: string): Promise<MonthlyCollectionRow[]> {
  const [challans, payments] = await Promise.all([
    getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, academicYear),
    getPaymentsServer(schoolId),
  ]);
  const challanIds = new Set(challans.map((c) => c.id));
  const relevant = payments.filter((p) => challanIds.has(p.challanId));

  const byPeriod = new Map<string, number>();
  relevant.forEach((p) => {
    const period = (p.paymentDate || "").slice(0, 7);
    if (!period) return;
    byPeriod.set(period, (byPeriod.get(period) || 0) + p.amount);
  });

  return Array.from(byPeriod.entries())
    .map(([period, amount]) => ({ period, amount }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export interface StudentLedgerRow {
  admissionNo: string;
  studentName: string;
  classId: string;
  className: string;
  section: string;
  totalExpected: number;
  totalPaid: number;
  outstanding: number;
  advanceBalance: number;
}

export async function getStudentFeeLedgerReport(schoolId: string, academicYear: string): Promise<StudentLedgerRow[]> {
  const [students, challans, advanceBalances] = await Promise.all([
    getStudentsServer(schoolId),
    getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, academicYear),
    getAdvanceBalancesForSchoolServer(schoolId, academicYear),
  ]);

  const advanceByStudent = new Map(advanceBalances.map((a) => [a.studentId, a.balance]));
  const challansByStudent = new Map<string, typeof challans>();
  challans.forEach((c) => {
    if (!challansByStudent.has(c.studentId)) challansByStudent.set(c.studentId, []);
    challansByStudent.get(c.studentId)!.push(c);
  });

  return students
    .filter((s) => challansByStudent.has(s.id) || advanceByStudent.has(s.id))
    .map((s) => {
      const studentChallans = challansByStudent.get(s.id) || [];
      const totalExpected = studentChallans.reduce((sum, c) => sum + (c.totalExpected || 0), 0);
      const totalPaid = studentChallans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
      const outstanding = studentChallans.reduce((sum, c) => sum + Math.max(0, c.balanceAmount || 0), 0);
      return {
        admissionNo: s.admissionNo,
        studentName: s.fullName,
        classId: s.classId,
        className: s.className || "",
        section: s.section || "",
        totalExpected,
        totalPaid,
        outstanding,
        advanceBalance: advanceByStudent.get(s.id) || 0,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

export interface OutstandingDuesRow {
  admissionNo: string;
  studentName: string;
  classId: string;
  className: string;
  challanNo: string;
  month: string;
  year: number;
  dueDate: string;
  totalExpected: number;
  paidAmount: number;
  balanceAmount: number;
}

export async function getOutstandingDuesReport(schoolId: string, academicYear: string): Promise<OutstandingDuesRow[]> {
  const challans = await getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, academicYear);
  return challans
    .filter((c) => (c.balanceAmount || 0) > 0)
    .map((c) => ({
      admissionNo: c.admissionNo || "",
      studentName: c.studentName || "",
      classId: c.classId,
      className: c.className || "",
      challanNo: c.challanNo,
      month: c.month,
      year: c.year,
      dueDate: c.dueDate,
      totalExpected: c.totalExpected,
      paidAmount: c.paidAmount,
      balanceAmount: c.balanceAmount,
    }))
    .sort((a, b) => b.balanceAmount - a.balanceAmount);
}

export interface AdvancePaymentRow {
  admissionNo: string;
  studentName: string;
  className: string;
  balance: number;
}

export async function getAdvancePaymentReport(schoolId: string, academicYear: string): Promise<AdvancePaymentRow[]> {
  const [students, advanceBalances] = await Promise.all([
    getStudentsServer(schoolId),
    getAdvanceBalancesForSchoolServer(schoolId, academicYear),
  ]);
  const studentsById = new Map(students.map((s) => [s.id, s]));

  return advanceBalances
    .filter((a) => a.balance > 0)
    .map((a) => {
      const student = studentsById.get(a.studentId);
      return {
        admissionNo: student?.admissionNo || a.studentId,
        studentName: student?.fullName || "Unknown",
        className: student?.className || "",
        balance: a.balance,
      };
    })
    .sort((a, b) => b.balance - a.balance);
}

export interface ImportBatchHistoryRow {
  batchType: "YEARLY_FEE_STRUCTURE" | "DAILY_TRANSACTIONS" | "VOUCHER_GENERATION";
  id: string;
  date: string;
  label: string;
  successCount: number;
  issueCount: number;
}

export async function getImportBatchHistoryReport(schoolId: string, academicYear: string): Promise<ImportBatchHistoryRow[]> {
  const [structureBatches, transactionBatches, voucherBatches] = await Promise.all([
    getImportBatchesServer(schoolId, "YEARLY_FEE_STRUCTURE", academicYear),
    getImportBatchesServer(schoolId, "DAILY_TRANSACTIONS", academicYear),
    getVoucherGenerationBatchesServer(schoolId, academicYear),
  ]);

  const rows: ImportBatchHistoryRow[] = [
    ...structureBatches.map((b) => ({
      batchType: "YEARLY_FEE_STRUCTURE" as const,
      id: b.id,
      date: b.createdAt,
      label: `Yearly structure import: ${b.fileName}`,
      successCount: b.createdCount + b.updatedCount,
      issueCount: b.errorCount,
    })),
    ...transactionBatches.map((b) => ({
      batchType: "DAILY_TRANSACTIONS" as const,
      id: b.id,
      date: b.createdAt,
      label: `Daily transactions import: ${b.fileName}`,
      successCount: b.createdCount,
      issueCount: b.errorCount,
    })),
    ...voucherBatches.map((b) => ({
      batchType: "VOUCHER_GENERATION" as const,
      id: b.id,
      date: b.createdAt,
      label: `Voucher generation: ${b.month} ${b.year} (${b.scope})`,
      successCount: b.createdCount,
      issueCount: b.errorCount,
    })),
  ];

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

