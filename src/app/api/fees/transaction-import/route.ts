import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRecentAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getStudentByIdServer,
  getFeeChallansServer,
  getFeeChallanByIdServer,
  saveFeeChallanServer,
  recordPaymentServer,
  getYearlyFeeLedgerForStudentServer,
  adjustAdvanceCreditServer,
  createAuditLogServer,
  getAcademicSessionContextServer,
} from "@/lib/firebase/server-db";
import { getDefaultAcademicYear } from "@/lib/school-display";
import {
  saveImportBatchServer,
  saveTransactionServer,
  saveExpenseServer,
  getTransactionsByBatchServer,
  getImportBatchesServer,
  getExpensesByDateRangeServer,
  getTransactionsByDateRangeServer,
  generateContentTransactionId,
  generateContentExpenseId,
  ImportBatchDoc,
  TransactionDoc,
  ExpenseDoc,
} from "@/lib/firebase/transaction-db";
import { readSpreadsheetUpload, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  parseTransactionRow,
  validateTransactionRows,
  buildTransactionSummary,
  buildExpenseDedupKey,
  planPaymentAllocation,
  TransactionImportRow,
  TransactionImportResult,
} from "@/lib/transaction-import";
import { FeeChallanDoc, PaymentDoc } from "@/lib/firebase/types";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** Every "Other Expenses" record this school has ever recorded, keyed for duplicate detection — not date-limited, so a re-submitted file is caught no matter how long ago the original import ran. */
async function buildExistingExpenseKeys(schoolId: string): Promise<Set<string>> {
  const existingExpenses = await getExpensesByDateRangeServer(schoolId);
  return new Set(existingExpenses.map((e) => buildExpenseDedupKey(e.date, e.description, e.amount)));
}

/**
 * Everything a fresh validation pass needs, always re-read from the database. Used by BOTH
 * preview and commit — commit never trusts a client-submitted preview's own claimed row
 * statuses, it recomputes them here from current data (Phase 2 requirement).
 */
async function buildValidationContext(schoolId: string) {
  const [students, existingChallans, existingTransactions] = await Promise.all([
    getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true }),
    getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true }),
    getTransactionsByDateRangeServer(schoolId),
  ]);
  const studentLookups = students.map((s) => ({
    id: s.id,
    fullName: s.fullName || "",
    className: s.className || "",
    classId: s.classId || "",
  }));
  // Keyed by the EXACT payment (student+date+category+amount), not just student+month — a
  // student can legitimately make several distinct payments within one month (partial, then
  // the remainder, or an advance); only resubmitting the identical row is a genuine duplicate.
  const existingTxDates = new Set(
    existingTransactions
      .filter((t) => t.category === "Fees" || t.category === "Annual Amount")
      .map((t) => `${t.studentId}|${t.date}|${t.category}|${t.amount}`)
  );
  const existingExpenseKeys = await buildExistingExpenseKeys(schoolId);
  return { studentLookups, existingChallans, existingTxDates, existingExpenseKeys };
}

export async function GET(req: NextRequest) {
  let authUser: AuthenticatedUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return bad("Authentication required.", 401);
  }
  if (authUser.role !== "ADMIN") {
    return bad("Only administrators can manage transaction imports.", 403);
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const batchId = searchParams.get("batchId");

  if (action === "template" || searchParams.has("template")) {
    const csvContent =
      "Day & Date,Category,Details,Class,Amount\n" +
      "15-11-2026,Fees,M. Huzaifa,Nursery,3700\n" +
      "15-11-2026,Annual Amount,M. Laique,Nursery,3000\n" +
      "15-11-2026,Other Expenses,Electricity Bill,General,12000\n";

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="transaction-import-template.csv"',
      },
    });
  }

  if (batchId) {
    const transactions = await getTransactionsByBatchServer(authUser.schoolId, batchId);
    return NextResponse.json({ success: true, transactions });
  }

  const batches = await getImportBatchesServer(authUser.schoolId, 50);
  return NextResponse.json({ success: true, batches });
}

export async function POST(req: NextRequest) {
  let authUser: AuthenticatedUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return bad("Authentication required.", 401);
  }
  if (authUser.role !== "ADMIN") {
    return bad("Only administrators can import transactions.", 403);
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "preview";

  if (action === "preview") {
    return handlePreview(authUser, req);
  } else if (action === "commit") {
    return handleCommit(authUser, req);
  }

  return bad("Invalid action. Expected preview or commit.");
}

async function parseUploadedRows(req: NextRequest): Promise<{ fileName: string; parsedRows: TransactionImportRow[] }> {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new Error("No file was uploaded.");
  }
  if (file.size === 0) {
    throw new Error("The uploaded file is empty.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sheetRows = readSpreadsheetUpload(file.name || "upload.xlsx", buffer);

  if (sheetRows.length < 2) {
    throw new Error("The sheet must contain at least a header row and one data row.");
  }

  // Row 0 is header: "Day & Date", "Category", "Details", "Class", "Amount"
  const parsedRows: TransactionImportRow[] = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const cells = sheetRows[i];
    if (cells.every((c) => !c || String(c).trim() === "")) continue; // skip blank lines
    parsedRows.push(parseTransactionRow(i + 1, cells));
  }

  return { fileName: file.name || "upload.xlsx", parsedRows };
}

async function handlePreview(authUser: AuthenticatedUser, req: NextRequest) {
  let fileName = "";
  let parsedRows: TransactionImportRow[] = [];

  try {
    const parsed = await parseUploadedRows(req);
    fileName = parsed.fileName;
    parsedRows = parsed.parsedRows;
  } catch (e: any) {
    if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
    return bad(e?.message || "Failed to parse file.");
  }

  if (parsedRows.length === 0) {
    return bad("No valid data rows found in spreadsheet.");
  }

  const ctx = await buildValidationContext(authUser.schoolId);
  const results = validateTransactionRows(parsedRows, ctx.studentLookups, ctx.existingTxDates, ctx.existingExpenseKeys);
  const summary = buildTransactionSummary(results);

  return NextResponse.json({
    success: true,
    fileName,
    summary,
  });
}

/**
 * Commit always re-derives the parsed rows and re-validates them against freshly read
 * students/challans/expenses — a client-submitted `results` array (from an earlier preview)
 * is used ONLY to recover which rowNumbers the admin selected and the raw cell values, never
 * as the authoritative status of any row. This closes the Phase 1 gap where a stale or
 * tampered preview could be committed as-is.
 */
async function handleCommit(authUser: AuthenticatedUser, req: NextRequest) {
  let fileName = "transaction-import.xlsx";
  let parsedRows: TransactionImportRow[];

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.results)) {
      return bad("Expected JSON payload with 'results' array.");
    }
    if (body.fileName) fileName = body.fileName;
    parsedRows = (body.results as TransactionImportResult[])
      .map((r) => r?.row)
      .filter((r): r is TransactionImportRow => !!r && typeof r.rowNumber === "number");
    if (parsedRows.length === 0) {
      return bad("The submitted payload had no recognizable rows.");
    }
  } else if (contentType.includes("multipart/form-data")) {
    try {
      const parsed = await parseUploadedRows(req);
      fileName = parsed.fileName;
      parsedRows = parsed.parsedRows;
    } catch (e: any) {
      return bad(e?.message || "Failed to parse file.");
    }
  } else {
    return bad("Unsupported request content type.");
  }

  // Committing real fee/expense records is a sensitive financial action, gated the same way
  // every other financial commit in this codebase is (requireRecentAuth) — not just preview.
  requireRecentAuth(authUser, "import daily fee transactions", req);

  const ctx = await buildValidationContext(authUser.schoolId);
  const rowsToCommit = validateTransactionRows(parsedRows, ctx.studentLookups, ctx.existingTxDates, ctx.existingExpenseKeys);

  const validRows = rowsToCommit.filter((r) => r.status === "VALID");
  if (validRows.length === 0) {
    return bad("No valid rows to commit.");
  }

  const nowIso = new Date().toISOString();
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const schoolId = authUser.schoolId;

  // The school's OWN configured academic year (SchoolSettingsDoc.academicYear, via the same
  // active-session mechanism every other module uses — see academic-session.ts) — never
  // derived from a transaction's own calendar date. A November 2026 payment does not
  // automatically mean academic year "2026-2027": the school might be mid-way through
  // "2025-2026", and only the school's own configured value knows that. Resolved once per
  // commit request, not per row.
  const sessionCtx = await getAcademicSessionContextServer(schoolId);
  const configuredAcademicYear = sessionCtx.academicYear || getDefaultAcademicYear();

  // Mutable, kept in sync as rows in this same commit affect it, so later rows in the same
  // file see the challans created/updated by earlier rows.
  const existingChallans = ctx.existingChallans.slice();

  let successCount = 0;
  let failCount = 0;
  const rowOutcomes: { rowNumber: number; status: "IMPORTED" | "FAILED" | "SKIPPED"; reason?: string }[] = [];

  for (const item of validRows) {
    const row = item.row;
    const amount = row.amount || 0;

    try {
      let challanRef: string | undefined;
      let allocations: { challanId: string; amount: number; paymentId: string }[] | undefined;
      let advanceCreditApplied: number | undefined;

      if (row.category === "Fees" || row.category === "Annual Amount") {
        if (!item.resolvedStudentId || !row.date) {
          failCount++;
          rowOutcomes.push({ rowNumber: row.rowNumber, status: "FAILED", reason: "Missing resolved student or date." });
          continue;
        }

        const [yStr, mStr] = row.date.split("-");
        const year = parseInt(yStr, 10);
        const mIdx = parseInt(mStr, 10) - 1;
        const month = MONTH_NAMES[mIdx] || "November";
        const academicYear = configuredAcademicYear;

        let targetChallan = existingChallans.find(
          (c) => c.studentId === item.resolvedStudentId && c.month === month && c.year === year
        );

        if (!targetChallan) {
          // No bill exists yet for this month. Its EXPECTED amount comes only from the Yearly
          // Fee Ledger (never invented from the payment amount) — falling back to the
          // student's own monthlyFee/annualFee record only if no ledger entry exists yet,
          // for backward compatibility with schools that have not run a Yearly Import.
          const [ledgerEntry, student] = await Promise.all([
            getYearlyFeeLedgerForStudentServer(schoolId, item.resolvedStudentId, academicYear),
            getStudentByIdServer(schoolId, item.resolvedStudentId),
          ]);
          let expectedTuition = 0;
          let expectedAnnual = 0;
          if (ledgerEntry) {
            expectedTuition = ledgerEntry.monthlyFee || 0;
            expectedAnnual = ledgerEntry.annualFee || 0;
          } else {
            expectedTuition = student?.monthlyFee || 0;
            expectedAnnual = student?.annualFee || 0;
          }
          const tuitionFee = row.category === "Fees" ? expectedTuition : 0;
          const admissionFee = row.category === "Annual Amount" ? expectedAnnual : 0;
          // If neither the ledger nor the student record has an expected amount on file, the
          // bill is created for exactly the amount received — there is nothing else to go on,
          // and this is still never treated as "the expected fee is whatever was paid" for a
          // month that DOES have a known expected amount.
          const totalExpected = tuitionFee + admissionFee || amount;

          const randomSuffix = Math.random().toString(36).slice(2, 7);
          const chId = `ch-${Date.now()}-${randomSuffix}`;
          const newChallan: FeeChallanDoc = {
            id: chId,
            schoolId,
            studentId: item.resolvedStudentId,
            studentName: item.resolvedStudentName,
            // So the Voucher Management view (which joins a payment's receipt to its challan
            // for the admission number — see /api/vouchers) shows it correctly for a
            // Daily-Import-originated voucher too, not just a manually/bulk-imported one.
            admissionNo: student?.admissionNo,
            classId: item.resolvedClassId || "",
            className: row.className,
            challanNo: `CHL-${year}-${month.substring(0, 3).toUpperCase()}-${randomSuffix}`,
            month,
            year,
            issueDate: row.date,
            dueDate: `${year}-${String(mIdx + 1).padStart(2, "0")}-15`,
            tuitionFee,
            admissionFee,
            examFee: 0,
            otherFee: 0,
            discount: 0,
            totalExpected,
            paidAmount: 0,
            balanceAmount: totalExpected,
            status: "PENDING",
            academicYear,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await saveFeeChallanServer(newChallan);
          existingChallans.push(newChallan);
          targetChallan = newChallan;
        }

        // Oldest-outstanding-first allocation: the targeted month's own challan first, then
        // this student's other currently-outstanding challans oldest first, then advance
        // credit. Never applies to a challan with no outstanding balance, so an unrelated
        // already-paid month is never touched.
        const outstanding = existingChallans
          .filter((c) => c.studentId === item.resolvedStudentId && c.balanceAmount > 0)
          .map((c) => ({ id: c.id, periodKey: c.year * 12 + MONTH_NAMES.indexOf(c.month), balanceAmount: c.balanceAmount }));
        // The target challan may have just been created above with balanceAmount already in
        // `existingChallans`, but include it defensively in case its balance is 0 (fully
        // pre-paid) — then the whole payment correctly becomes advance credit instead.
        if (!outstanding.some((c) => c.id === targetChallan!.id) && targetChallan!.balanceAmount > 0) {
          outstanding.push({ id: targetChallan.id, periodKey: targetChallan.year * 12 + mIdx, balanceAmount: targetChallan.balanceAmount });
        }

        const plan = planPaymentAllocation(targetChallan.id, outstanding, amount);
        const contentId = generateContentTransactionId(schoolId, row.date, row.category, row.details, row.className, amount);

        // A clear, human-readable note of the FULL allocation breakdown is put on every
        // payment line this row produces — not just "this challan's share" — so opening any
        // one of the vouchers this row created shows the whole picture (other months it also
        // paid, and any leftover advance credit), per Phase 3's "transparent receipt" requirement.
        const breakdownParts = plan.lines.map((l, idx) => `${l.challanId === targetChallan!.id ? "this month" : `challan ${l.challanId}`}: Rs. ${l.amount}`);
        if (plan.advanceCredit > 0) breakdownParts.push(`advance credit: Rs. ${plan.advanceCredit}`);
        const allocationNote =
          plan.lines.length > 1 || plan.advanceCredit > 0
            ? `Daily Import payment of Rs. ${amount} on ${row.date} allocated across: ${breakdownParts.join("; ")}.`
            : "Daily Import (5-column transaction import)";

        allocations = [];
        for (let i = 0; i < plan.lines.length; i++) {
          const line = plan.lines[i];
          const paymentId = `pay_${contentId.slice(3)}_a${i}`;
          const paymentDoc: PaymentDoc = {
            id: paymentId,
            schoolId,
            challanId: line.challanId,
            studentId: item.resolvedStudentId,
            studentName: item.resolvedStudentName,
            receiptNo: `RCT-${contentId.slice(3, 11)}-${i}`,
            amount: line.amount,
            paymentDate: row.date,
            paymentMode: "CASH",
            notes: allocationNote,
            collectedBy: authUser.uid,
            createdAt: nowIso,
          };
          await recordPaymentServer(paymentDoc);
          allocations.push({ challanId: line.challanId, amount: line.amount, paymentId });
          // Keep the in-memory list in sync for subsequent rows in this same file by RE-READING
          // the challan recordPaymentServer just updated, rather than incrementally re-deriving
          // paidAmount/balanceAmount ourselves — recordPaymentServer (and its own Firestore
          // transaction / local fallback) is the one source of truth for that math, and
          // re-deriving it a second time here previously double-applied the payment whenever
          // the in-memory array held the very same object reference recordPaymentServer had
          // just mutated.
          const refreshed = await getFeeChallanByIdServer(schoolId, line.challanId);
          if (refreshed) {
            const idx = existingChallans.findIndex((c) => c.id === line.challanId);
            if (idx >= 0) existingChallans[idx] = refreshed;
          }
        }

        if (plan.advanceCredit > 0) {
          await adjustAdvanceCreditServer(schoolId, item.resolvedStudentId, plan.advanceCredit);
          advanceCreditApplied = plan.advanceCredit;
          await createAuditLogServer(
            schoolId, authUser.uid, authUser.email, authUser.role,
            "ADVANCE_CREDIT_FROM_DAILY_IMPORT", "FEE", item.resolvedStudentId,
            `Rs. ${plan.advanceCredit} from a Daily Import payment on ${row.date} exceeded every outstanding due and was recorded as advance credit, not applied to any unrelated month.`
          );
        }

        challanRef = targetChallan.id;
      } else if (row.category === "Other Expenses") {
        // Record as an expense document. transactionRef links it to the TransactionDoc saved
        // for this same row below — the dashboard (/api/fees/dashboard) only adds an expense's
        // amount when it has NO transactionRef, specifically to avoid counting an imported
        // expense twice (once via its TransactionDoc, once via this ExpenseDoc).
        const expId = generateContentExpenseId(schoolId, row.date || nowIso.split("T")[0], row.details, amount);
        const expDoc: ExpenseDoc = {
          id: expId,
          schoolId,
          date: row.date || nowIso.split("T")[0],
          description: row.details,
          amount,
          category: "OTHER_EXPENSE",
          importBatchId: batchId,
          transactionRef: generateContentTransactionId(schoolId, row.date || nowIso.split("T")[0], row.category, row.details, row.className, amount),
          createdBy: authUser.uid,
          createdAt: nowIso,
        };
        await saveExpenseServer(expDoc);
      }

      const txId = generateContentTransactionId(schoolId, row.date || nowIso.split("T")[0], row.category!, row.details, row.className, amount);
      const txDoc: TransactionDoc = {
        id: txId,
        schoolId,
        importBatchId: batchId,
        rowNumber: row.rowNumber,
        date: row.date || nowIso.split("T")[0],
        category: row.category!,
        details: row.details,
        studentId: item.resolvedStudentId,
        studentName: item.resolvedStudentName,
        classId: item.resolvedClassId,
        className: row.className,
        amount,
        academicYear: configuredAcademicYear,
        createdBy: authUser.uid,
        createdAt: nowIso,
        challanRef,
        allocations,
        advanceCreditApplied,
      };

      await saveTransactionServer(txDoc);
      successCount++;
      rowOutcomes.push({ rowNumber: row.rowNumber, status: "IMPORTED" });
    } catch (e: any) {
      console.error(`Failed to process row ${row.rowNumber}:`, e?.message || e);
      failCount++;
      rowOutcomes.push({ rowNumber: row.rowNumber, status: "FAILED", reason: e?.message || "Database write failed." });
    }
  }

  const skippedCount = rowsToCommit.length - validRows.length;

  const batchDoc: ImportBatchDoc = {
    id: batchId,
    schoolId,
    importedBy: authUser.uid,
    importedAt: nowIso,
    fileName,
    fileHash: "",
    rowCount: rowsToCommit.length,
    successCount,
    failCount,
    academicYear: configuredAcademicYear,
    status: failCount === 0 ? "COMMITTED" : successCount > 0 ? "PARTIAL" : "PENDING",
  };

  await saveImportBatchServer(batchDoc);

  return NextResponse.json({
    success: true,
    batchId,
    successCount,
    failCount,
    skippedCount,
    totalCount: rowsToCommit.length,
    rowOutcomes,
  });
}
