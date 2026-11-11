import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getTransactionsByDateRangeServer, getExpensesByDateRangeServer, getOtherCollectionsByDateRangeServer } from "@/lib/firebase/transaction-db";
import { getFeeChallanStatsServer, getYearlyFeeStructuresServer, getAdvanceBalancesForSchoolServer } from "@/lib/firebase/server-db";
import { yearlyExpectedFeeFor } from "@/lib/fee-structure-import";
import { getDefaultAcademicYear } from "@/lib/school-display";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

/**
 * One-row Financial Summary export: every figure here reconciles directly to the dashboard
 * (/api/fees/dashboard) it mirrors, built from the same underlying record collections — never
 * a separately hardcoded figure.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const schoolId = authUser.schoolId;
    const academicYear = searchParams.get("academicYear") || getDefaultAcademicYear();

    const [transactions, expenses, otherCollections, challanStats, yearlyStructures, advanceBalances] = await Promise.all([
      getTransactionsByDateRangeServer(schoolId, from, to),
      getExpensesByDateRangeServer(schoolId, from, to),
      getOtherCollectionsByDateRangeServer(schoolId, from, to),
      getFeeChallanStatsServer(schoolId, {}),
      getYearlyFeeStructuresServer(schoolId, academicYear),
      getAdvanceBalancesForSchoolServer(schoolId, academicYear),
    ]);

    let feeCollection = 0;
    let annualCollection = 0;
    for (const tx of transactions) {
      if (tx.category === "Fees") feeCollection += tx.amount || 0;
      else if (tx.category === "Annual Amount") annualCollection += tx.amount || 0;
    }
    const otherExpensesTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const otherCollectionsTotal = otherCollections.reduce((sum, c) => sum + (c.amount || 0), 0);
    const netCollection = feeCollection + annualCollection;
    const totalIncome = netCollection + otherCollectionsTotal;
    const netBalance = totalIncome - otherExpensesTotal;
    const yearlyExpectedFees = yearlyStructures.reduce((sum, s) => sum + yearlyExpectedFeeFor(s), 0);
    const advancePaymentsTotal = advanceBalances.reduce((sum, b) => sum + (b.balance || 0), 0);

    const header = ["Period From", "Period To", "Fee Collection", "Annual Collection", "Other Collections", "Other Expenses", "Total Income", "Net Remaining Balance", "Academic Year", "Yearly Expected Fees", "Collected So Far (Overall)", "Outstanding Dues (Overall)", "Advance Payments (Overall)"];
    const row = [
      from || "", to || "", feeCollection, annualCollection, otherCollectionsTotal, otherExpensesTotal, totalIncome, netBalance,
      academicYear, yearlyExpectedFees, challanStats.totalCollected, challanStats.totalOutstanding, advancePaymentsTotal,
    ];

    const csv = buildCsv([header, row]);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`financial-summary-${academicYear}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Financial summary export error:", error?.message || error);
    return NextResponse.json({ error: "Failed to export the financial summary." }, { status: 500 });
  }
}
