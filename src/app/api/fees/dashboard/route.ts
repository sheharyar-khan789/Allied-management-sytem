import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import { getTransactionsByDateRangeServer, getImportBatchesServer, getExpensesByDateRangeServer, ExpenseDoc } from "@/lib/firebase/transaction-db";
import {
  getPaymentsByDateRangeServer,
  getFeeTotalsByClassServer,
  getFeeChallansByIdsServer,
  getAcademicSessionContextServer,
  getSchoolSettingsServer,
} from "@/lib/firebase/server-db";
import { getDefaultAcademicYear } from "@/lib/school-display";
import { DEFAULT_SCHOOL_TIMEZONE, zonedDateParts } from "@/lib/lesson-plan-schedule";
import type { FeeChallanDoc, PaymentDoc } from "@/lib/firebase/types";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const isActive = (p: PaymentDoc) => (p.voucherStatus || "ACTIVE") === "ACTIVE";
const sumAmount = (list: { amount: number }[]) => list.reduce((s, x) => s + (x.amount || 0), 0);

/**
 * Splits one payment's amount into its tuition share and its "other" (annual/admission/exam/
 * misc) share, proportional to the linked challan's own fee composition — e.g. a challan billed
 * as 5500 tuition + 6000 annual (totalExpected 11500) attributes 5500/11500 of any payment
 * against it to tuition, the rest to "other". This works for every payment regardless of how it
 * was recorded (Daily Import or a manual single-challan payment), since it reads only the
 * challan's own stored fields — never a transaction/category that may not exist for a manual
 * payment. A challan that can't be found or has no totalExpected is counted entirely as tuition
 * (never silently dropped from either figure).
 */
function splitPaymentByComposition(amount: number, challan: FeeChallanDoc | undefined): { tuitionShare: number; otherShare: number } {
  if (!challan || !challan.totalExpected) return { tuitionShare: amount, otherShare: 0 };
  const tuitionRatio = Math.max(0, Math.min(1, (challan.tuitionFee || 0) / challan.totalExpected));
  const tuitionShare = amount * tuitionRatio;
  return { tuitionShare, otherShare: amount - tuitionShare };
}

/**
 * Fees & Payments Dashboard — six figures, each from exactly one real data source, built to
 * reconcile exactly with the Student Fee Ledger (the Ledger lists real FeeChallanDoc records;
 * these figures are aggregated from the same collection, never a parallel estimate):
 *
 *  1. Total Fee Amount   — sum of every in-scope challan's totalExpected (snapshot, not
 *                           date-ranged — "how much has been billed for the year")
 *  2. Fee Collected      — the tuition share of active PaymentDoc records in [from,to]
 *  3. Outstanding Amount — Total Fee Amount minus every challan's paidAmount (snapshot)
 *  4. Other Collections  — the non-tuition share (annual/admission/exam/misc) of the SAME
 *                           active payments in [from,to] — together with Fee Collected this
 *                           always sums to exactly the period's total active payments, never
 *                           more or less
 *  5. Other Expenses     — ExpenseDoc only, in [from,to] (unchanged from the previous phase)
 *  6. Net Collection      — (Fee Collected + Other Collections) − Other Expenses for [from,to]:
 *                           the period's real net cash position, not an expected total
 *
 *  Vouchers — the same active payments as (2)+(4) combined, presented as counts (unchanged).
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

  // Every read below is a single, bounded, indexed range query, or a count+sum AGGREGATION
  // query per class (never reading every challan document) — never an unbounded full-collection
  // scan, and never one query per student/record.
  const [feeTotalsByClass, rangePayments, todayPayments, monthPayments, rangeExpensesRaw, todayExpensesRaw, monthExpensesRaw, transactionsRaw, importBatches] =
    await Promise.all([
      getFeeTotalsByClassServer(schoolId, academicYear),
      getPaymentsByDateRangeServer(schoolId, effectiveFrom, effectiveTo),
      getPaymentsByDateRangeServer(schoolId, todayStr, todayStr),
      getPaymentsByDateRangeServer(schoolId, monthStartStr, todayStr),
      getExpensesByDateRangeServer(schoolId, effectiveFrom, effectiveTo),
      getExpensesByDateRangeServer(schoolId, todayStr, todayStr),
      getExpensesByDateRangeServer(schoolId, monthStartStr, todayStr),
      getTransactionsByDateRangeServer(schoolId, effectiveFrom, effectiveTo, category, classId),
      getImportBatchesServer(schoolId, 30),
    ]);

  // A voided expense/transaction (edited or deleted — see voidExpenseServer/updateExpenseServer)
  // is kept, visible, for its content-hash dedup guarantee and for the records list below, but
  // must never count toward any total — every sum uses the *Active variants, never the raw list.
  const rangeExpensesActive = rangeExpensesRaw.filter((e) => !e.voided);
  const todayExpensesActive = todayExpensesRaw.filter((e) => !e.voided);
  const monthExpensesActive = monthExpensesRaw.filter((e) => !e.voided);
  const transactions = transactionsRaw.filter((t) => !t.voided);

  // ---------------------------------------------------------------------
  // BLOCKS 1 & 3 — Total Fee Amount / Outstanding Amount (real challans only, snapshot)
  // ---------------------------------------------------------------------
  const classTotals = classId ? [feeTotalsByClass.get(classId) || { count: 0, expected: 0, collected: 0 }] : Array.from(feeTotalsByClass.values());
  const totalFeeAmount = classTotals.reduce((s, t) => s + t.expected, 0);
  const totalCollectedAllTime = classTotals.reduce((s, t) => s + t.collected, 0);
  const totalChallanCount = classTotals.reduce((s, t) => s + t.count, 0);
  const outstandingAmount = Math.max(0, totalFeeAmount - totalCollectedAllTime);

  // ---------------------------------------------------------------------
  // BLOCKS 2 & 4 — Fee Collected / Other Collections (active payments in range, split by each
  // payment's own linked challan's fee composition — never by the import row's category, so a
  // manually-recorded payment with no originating Daily Import row is still split correctly)
  // ---------------------------------------------------------------------
  const activeRangePayments = rangePayments.filter((p) => isActive(p) && (!p.academicYear || p.academicYear === academicYear));
  const challanMap = await getFeeChallansByIdsServer(schoolId, activeRangePayments.map((p) => p.challanId));
  let feeCollected = 0;
  let otherCollections = 0;
  for (const p of activeRangePayments) {
    const { tuitionShare, otherShare } = splitPaymentByComposition(p.amount, challanMap.get(p.challanId));
    feeCollected += tuitionShare;
    otherCollections += otherShare;
  }
  feeCollected = Math.round(feeCollected * 100) / 100;
  otherCollections = Math.round(otherCollections * 100) / 100;

  // ---------------------------------------------------------------------
  // BLOCK — Vouchers (the same active payments as Fee Collected + Other Collections combined,
  // presented as counts; daily/monthly are fixed to "today"/"this month" regardless of the
  // selected [from, to] filter)
  // ---------------------------------------------------------------------
  const activeTodayPayments = todayPayments.filter(isActive);
  const activeMonthPayments = monthPayments.filter(isActive);
  const receivedAmount = sumAmount(activeRangePayments);

  // ---------------------------------------------------------------------
  // BLOCK 5 — Other Expenses (ExpenseDoc only — every imported expense already has a linked
  // TransactionDoc via transactionRef, but that TransactionDoc is never separately summed here,
  // so the same imported expense can never be counted twice)
  // ---------------------------------------------------------------------
  const otherExpensesTotal = sumAmount(rangeExpensesActive);
  const otherExpensesToday = sumAmount(todayExpensesActive);
  const otherExpensesMonth = sumAmount(monthExpensesActive);

  // ---------------------------------------------------------------------
  // BLOCK 6 — Net Collection: the period's real net cash position, never an expected total.
  // ---------------------------------------------------------------------
  const netCollection = Math.round((feeCollected + otherCollections - otherExpensesTotal) * 100) / 100;

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
      totalFeeAmount: { amount: totalFeeAmount, challanCount: totalChallanCount },
      feeCollected: { amount: feeCollected, paymentCount: activeRangePayments.length },
      outstandingAmount: { amount: outstandingAmount },
      otherCollections: { amount: otherCollections },
      otherExpenses: {
        amount: otherExpensesTotal,
        count: rangeExpensesActive.length,
        dailyAmount: otherExpensesToday,
        monthlyAmount: otherExpensesMonth,
      },
      netCollection: { amount: netCollection },
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
    },
    // Includes voided rows (marked `voided: true`) so the records list below stays a complete
    // history — only the summary totals above exclude them.
    expenses: rangeExpensesRaw
      .slice()
      .sort((a: ExpenseDoc, b: ExpenseDoc) => b.date.localeCompare(a.date))
      .slice(0, 100),
    dailyBreakdown,
    transactions: transactions.slice(0, 200),
    importBatches,
  });
}
