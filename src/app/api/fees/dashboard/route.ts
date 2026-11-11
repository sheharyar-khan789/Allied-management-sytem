import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getTransactionsByDateRangeServer,
  getImportBatchesServer,
  getExpensesByDateRangeServer,
  getOtherCollectionsByDateRangeServer,
  TransactionDoc,
} from "@/lib/firebase/transaction-db";
import { getFeeChallanStatsServer, getYearlyFeeStructuresServer, getAdvanceBalancesForSchoolServer } from "@/lib/firebase/server-db";
import { yearlyExpectedFeeFor } from "@/lib/fee-structure-import";
import { getDefaultAcademicYear } from "@/lib/school-display";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: NextRequest) {
  let authUser: AuthenticatedUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return bad("Authentication required.", 401);
  }

  if (authUser.role !== "ADMIN") {
    return bad("Only administrators can view the financial dashboard.", 403);
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const categoryParam = searchParams.get("category");
  const category = categoryParam && categoryParam !== "all" ? categoryParam : undefined;
  const classId = searchParams.get("classId") || undefined;
  const academicYear = searchParams.get("academicYear") || undefined;

  const schoolId = authUser.schoolId;
  const effectiveAcademicYear = academicYear || getDefaultAcademicYear();

  // Fetch transactions and import batches
  const [transactions, importBatches, expenses, otherCollections, challanStats, yearlyStructures, advanceBalances] = await Promise.all([
    getTransactionsByDateRangeServer(schoolId, from, to, category, classId),
    getImportBatchesServer(schoolId, 30),
    getExpensesByDateRangeServer(schoolId, from, to),
    getOtherCollectionsByDateRangeServer(schoolId, from, to),
    // Not date-ranged: the current standing of every fee challan ever issued, regardless of
    // the "from"/"to" transaction window above — a different, period-independent figure.
    getFeeChallanStatsServer(schoolId, {}),
    getYearlyFeeStructuresServer(schoolId, effectiveAcademicYear),
    getAdvanceBalancesForSchoolServer(schoolId, effectiveAcademicYear),
  ]);

  const otherCollectionsTotal = otherCollections.reduce((sum, c) => sum + (c.amount || 0), 0);
  const yearlyExpectedFees = yearlyStructures.reduce((sum, s) => sum + yearlyExpectedFeeFor(s), 0);
  const advancePaymentsTotal = advanceBalances.reduce((sum, b) => sum + (b.balance || 0), 0);

  // Compute financial totals
  let feeCollection = 0;
  let annualCollection = 0;
  let otherExpenses = 0;

  for (const tx of transactions) {
    if (academicYear && tx.academicYear && tx.academicYear !== academicYear) {
      continue;
    }
    if (tx.category === "Fees") {
      feeCollection += tx.amount || 0;
    } else if (tx.category === "Annual Amount") {
      annualCollection += tx.amount || 0;
    } else if (tx.category === "Other Expenses") {
      otherExpenses += tx.amount || 0;
    }
  }

  // Include direct expenses if not already counted via transactions
  if (!category || category === "Other Expenses") {
    for (const exp of expenses) {
      if (!exp.transactionRef) {
        otherExpenses += exp.amount || 0;
      }
    }
  }

  // CRITICAL ACCOUNTING RULE:
  // "Other Expenses" represents money the school SPENT (outgoing expenditure).
  // Net Collection is the revenue collected from students: Fees + Annual Amount.
  // Other Expenses must NOT be added to collection income.
  const netCollection = feeCollection + annualCollection;

  // Total Income = student fee payments (this period) + other, non-fee school income (this period).
  // Net Remaining Balance = Total Income - actual recorded expenses (this period). Outstanding
  // dues and the yearly expected total are reported separately below — neither is collected cash.
  const totalIncome = netCollection + otherCollectionsTotal;
  const netBalance = totalIncome - otherExpenses;

  // Daily breakdown
  const dailyMap = new Map<string, { date: string; fees: number; annual: number; expenses: number }>();
  for (const tx of transactions) {
    const d = tx.date;
    if (!dailyMap.has(d)) {
      dailyMap.set(d, { date: d, fees: 0, annual: 0, expenses: 0 });
    }
    const day = dailyMap.get(d)!;
    if (tx.category === "Fees") day.fees += tx.amount;
    else if (tx.category === "Annual Amount") day.annual += tx.amount;
    else if (tx.category === "Other Expenses") day.expenses += tx.amount;
  }

  const dailyBreakdown = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({
    success: true,
    academicYear: effectiveAcademicYear,
    summary: {
      feeCollection,
      annualCollection,
      otherExpenses,
      netCollection,
      totalTransactions: transactions.length,
      // This period (from/to):
      otherCollections: otherCollectionsTotal,
      totalIncome,
      netBalance,
      // Not period-bound — the school's overall standing for effectiveAcademicYear:
      yearlyExpectedFees,
      totalCollectedOverall: challanStats.totalCollected,
      outstandingDues: challanStats.totalOutstanding,
      advancePayments: advancePaymentsTotal,
    },
    dailyBreakdown,
    transactions: transactions.slice(0, 200), // top 200 recent transactions
    importBatches,
  });
}
