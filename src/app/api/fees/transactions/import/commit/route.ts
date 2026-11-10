import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  recordFeePaymentServer,
  adjustAdvanceBalanceServer,
  saveImportBatchServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import {
  parseTransactionWorkbook,
  prepareClassificationContext,
  classifyTransactionRows,
  summarizeTransactionRows,
} from "@/lib/daily-transaction-import";
import { ImportBatchDoc, PaymentDoc } from "@/lib/firebase/types";

// Re-parses and re-classifies the uploaded file from scratch — including re-fetching every
// matched student's real current balances and advance credit — rather than trusting a
// client-submitted preview, exactly like the yearly fee structure and voucher generation
// commit routes. This also means a row's allocation is only ever computed once, right
// before it is written, against genuinely current data.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const academicYear = String(form.get("academicYear") || "").trim();

    if (!file) return NextResponse.json({ error: "A file is required." }, { status: 400 });
    if (!academicYear) return NextResponse.json({ error: "Academic Year is required." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsedRows = parseTransactionWorkbook(buffer);
    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the uploaded file." }, { status: 400 });
    }
    if (parsedRows.length > 5000) {
      return NextResponse.json({ error: "File exceeds the 5000-row limit for a single import." }, { status: 400 });
    }

    const students = await getStudentsServer(authUser.schoolId);
    const { studentStates, existingDedupKeys } = await prepareClassificationContext(authUser.schoolId, academicYear, parsedRows, students);
    const classified = classifyTransactionRows(parsedRows, students, studentStates, existingDedupKeys, authUser.schoolId);
    const summary = summarizeTransactionRows(classified);

    const batchId = `dtb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    for (const row of classified) {
      if (row.action !== "ALLOCATED" || !row.allocation) continue;
      const allocationGroupId = `agr-${batchId}-${row.rowNumber}`;

      for (const line of row.allocation.lines) {
        const paymentId = `pmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const paymentDoc: PaymentDoc = {
          id: paymentId,
          schoolId: authUser.schoolId,
          challanId: line.challanId,
          studentId: row.studentId!,
          studentName: row.studentName,
          receiptNo: `IMP-${paymentId.slice(-8).toUpperCase()}`,
          amount: line.amountApplied,
          paymentDate: row.paymentDate!,
          paymentMode: row.paymentMethod!,
          transactionRef: row.referenceNumber,
          notes: row.details,
          collectedBy: authUser.uid,
          createdAt: nowIso,
          source: "IMPORT",
          importBatchId: batchId,
          allocationGroupId,
          dedupKey: row.dedupKey,
        };
        await recordFeePaymentServer(paymentDoc);
      }

      if (row.allocation.advanceAmount > 0) {
        await adjustAdvanceBalanceServer(
          authUser.schoolId,
          row.studentId!,
          academicYear,
          row.allocation.advanceAmount,
          "Advance payment from daily transaction import",
          allocationGroupId
        );
      }
    }

    const batchDoc: ImportBatchDoc = {
      id: batchId,
      schoolId: authUser.schoolId,
      type: "DAILY_TRANSACTIONS",
      academicYear,
      fileName: file.name,
      totalRows: summary.totalRows,
      createdCount: summary.allocatedCount,
      updatedCount: 0,
      unchangedCount: 0,
      errorCount: summary.errorCount + summary.duplicateCount,
      rows: classified.slice(0, 1000).map((r) => ({
        rowNumber: r.rowNumber,
        admissionNo: r.admissionNo,
        studentName: r.studentName,
        action: r.action,
        errorReason: r.errorReason,
        details: {
          amount: r.amount,
          paymentDate: r.paymentDate,
          allocation: r.allocation,
        },
      })),
      uploadedBy: authUser.uid,
      uploadedByEmail: authUser.email,
      createdAt: nowIso,
    };
    await saveImportBatchServer(batchDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "IMPORT_DAILY_TRANSACTIONS",
      "PAYMENT_BATCH",
      batchId,
      `Imported daily fee transactions from "${file.name}": ${summary.allocatedCount} allocated (Rs. ${summary.totalAmount}), ${summary.duplicateCount} duplicates skipped, ${summary.errorCount} errors.`
    );

    return NextResponse.json({ success: true, batchId, summary, rows: classified });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Transaction import commit error:", error);
    return NextResponse.json({ error: "Failed to commit the import." }, { status: 500 });
  }
}
