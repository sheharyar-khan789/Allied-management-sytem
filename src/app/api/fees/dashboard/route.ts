import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import { getTransactionsByDateRangeServer, getImportBatchesServer, getExpensesByDateRangeServer, ExpenseDoc } from "@/lib/firebase/transaction-db";
import {
  getPaymentsByDateRangeServer,
  getYearlyFeeLedgerServer,
  getAcademicSessionContextServer,
  getSchoolSettingsServer,
} from "@/lib/firebase/server-db";
import { getDefaultAcademicYear } from "@/lib/school-display";
import { DEFAULT_SCHOOL_TIMEZONE, zonedDateParts } from "@/lib/lesson-plan-schedule";
import type { PaymentDoc } from "@/lib/firebase/types";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const isActive = (p: PaymentDoc) => (p.voucherStatus || "ACTIVE") === "ACTIVE";
const sumAmount = (list: { amount: number }[]) => list.reduce((s, x) => s + (x.amount || 0), 0);

/**
 * Fees & Payments Dashboard (Phase 4 restructuring) — four independent financial blocks, each
 * from exactly one source collection, never cross-counted:
 *
 *  1. Net Collection   — YearlyFeeLedgerDoc.yearlyExpectedFee (expected, never touched by payments)
 *  2. Received Amount  — PaymentDoc, active only (actual money received)
 *  3. Vouchers         — the SAME active PaymentDoc records as (2), presented as counts
 *  4. Other Expenses   — ExpenseDoc only (TransactionDoc is never summed for this anymore,
 *                         so a linked expense+transaction pair can never be double-counted)
 */
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

  const schoolId = authUser.schoolId;

  // Academic year: the school's own configured session (same mechanism every other module in
  // this app uses — see academic-session.ts), never derived from a payment's calendar date. An
  // explicit ?academicYear= query param can still ask for a different (e.g. past) session.
  const [sessionCtx, settings] = await Promise.all([
    getAcademicSessionContextServer(schoolId),
    getSchoolSettingsServer(schoolId),
  ]);
  const academicYear = searchParams.get("academicYear") || sessionCtx.academicYear || getDefaultAcademicYear();

  // "Today" and "this calendar month" in the SCHOOL's own timezone (not the server's UTC
  // clock) — the same timezone resolution Voucher Management's own daily register already uses.
  const timezone = settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
  const todayStr = zonedDateParts(timezone).date;
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;
  const effectiveFrom = from || monthStartStr;
  const effectiveTo = to || todayStr;

  // Every read below is a single, bounded, indexed range query (or one school-scoped read for
  // the ledger, bounded by enrolled-student count) — never an unbounded full-collection scan,
  // and never one query per student/record.
  const [ledgerEntries, rangePayments, todayPayments, monthPayments, rangeExpenses, todayExpenses, monthExpenses, transactions, importBatches] =
    await Promise.all([
      getYearlyFeeLedgerServer(schoolId, academicYear),
      getPaymentsByDateRangeServer(schoolId, effectiveFrom, effectiveTo),
      getPaymentsByDateRangeServer(schoolId, todayStr, todayStr),
      getPaymentsByDateRangeServer(schoolId, monthStartStr, todayStr),
      getExpensesByDateRangeServer(schoolId, effectiveFrom, effectiveTo),
      getExpensesByDateRangeServer(schoolId, todayStr, todayStr),
      getExpensesByDateRangeServer(schoolId, monthStartStr, todayStr),
      getTransactionsByDateRangeServer(schoolId, effectiveFrom, effectiveTo, category, classId),
      getImportBatchesServer(schoolId, 30),
    ]);

  // ---------------------------------------------------------------------
  // BLOCK 1 — Net Collection (expected yearly fee, from the Yearly Fee Ledger only)
  // ---------------------------------------------------------------------
  const ledgerForClass = classId ? ledgerEntries.filter((e) => e.classId === classId) : ledgerEntries;
  const netCollectionAmount = ledgerForClass.reduce((s, e) => s + (e.yearlyExpectedFee || 0), 0);

  // ---------------------------------------------------------------------
  // BLOCK 2 — Received Amount (actual payments, PaymentDoc only, active only)
  // ---------------------------------------------------------------------
  const activeRangePayments = rangePayments.filter((p) => isActive(p) && (!p.academicYear || p.academicYear === academicYear));
  const receivedAmount = sumAmount(activeRangePayments);

  // ---------------------------------------------------------------------
  // BLOCK 3 — Vouchers (the same active payments, presented as counts; daily/monthly are
  // fixed to "today"/"this month" regardless of the selected [from, to] filter)
  // ---------------------------------------------------------------------
  const activeTodayPayments = todayPayments.filter(isActive);
  const activeMonthPayments = monthPayments.filter(isActive);

  // ---------------------------------------------------------------------
  // BLOCK 4 — Other Expenses (ExpenseDoc only — every imported expense already has a linked
  // TransactionDoc via transactionRef, but that TransactionDoc is never separately summed here,
  // so the same imported expense can never be counted twice)
  // ---------------------------------------------------------------------
  const otherExpensesTotal = sumAmount(rangeExpenses);
  const otherExpensesToday = sumAmount(todayExpenses);
  const otherExpensesMonth = sumAmount(monthExpenses);

  const dailyMap = new Map<string, { date: string; fees: number; annual: number; expenses: number }>();
  for (const tx of transactions) {
    const d = tx.date;
    if (!dailyMap.has(d)) dailyMap.set(d, { date: d, fees: 0, annual: 0, expenses: 0 });
    const day = dailyMap.get(d)!;
    if (tx.category === "Fees") day.fees += tx.amount;
    else if (tx.category === "Annual Amount") day.annual += tx.amount;
    else if (tx.category === "Other Expenses") day.expenses += tx.amount;
  }
  const dailyBreakdown = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({
    success: true,
    academicYear,
    timezone,
    from: effectiveFrom,
    to: effectiveTo,
    today: todayStr,
    summary: {
      netCollection: { amount: netCollectionAmount, studentCount: ledgerForClass.length },
      receivedAmount: { amount: receivedAmount, paymentCount: activeRangePayments.length },
      vouchers: {
        totalCount: activeRangePayments.length,
        totalAmount: receivedAmount,
        dailyCount: activeTodayPayments.length,
        dailyAmount: sumAmount(activeTodayPayments),
        dailyDate: todayStr,
        monthlyCount: activeMonthPayments.length,
        monthlyAmount: sumAmount(activeMonthPayments),
        monthlyPeriod: todayStr.slice(0, 7),
      },
      otherExpenses: {
        amount: otherExpensesTotal,
        count: rangeExpenses.length,
        dailyAmount: otherExpensesToday,
        monthlyAmount: otherExpensesMonth,
      },
    },
    expenses: rangeExpenses
      .slice()
      .sort((a: ExpenseDoc, b: ExpenseDoc) => b.date.localeCompare(a.date))
      .slice(0, 100),
    dailyBreakdown,
    transactions: transactions.slice(0, 200),
    importBatches,
  });
}
