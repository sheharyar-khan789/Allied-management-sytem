import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { createAuditLogServer, getAcademicSessionContextServer } from "@/lib/firebase/server-db";
import {
  saveExpenseServer,
  saveTransactionServer,
  updateExpenseServer,
  voidExpenseServer,
  getExpenseByIdServer,
  generateContentExpenseId,
  generateContentTransactionId,
  ExpenseDoc,
  TransactionDoc,
} from "@/lib/firebase/transaction-db";
import { validateDateString } from "@/lib/date-utils";
import { neutralizeSpreadsheetFormula } from "@/lib/spreadsheet-parser";

/**
 * Manual single-entry "Other Expenses" — the Fees Dashboard's quick-add form, alongside the
 * existing bulk Daily Import (5-column CSV) path. Writes the exact same ExpenseDoc + linked
 * TransactionDoc pair Daily Import creates for an "Other Expenses" row, using the same
 * content-derived id scheme, so a manual entry is indistinguishable from an imported one to
 * every other screen (dashboard totals, daily breakdown, duplicate detection) and a manual entry
 * can never silently duplicate one already imported via CSV (or vice versa).
 */

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const MAX_DESCRIPTION_LENGTH = 300;

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json().catch(() => ({}));

    const date = validateDateString(body?.date);
    if (!date) return bad("A valid date is required.");
    const description = typeof body?.description === "string" ? neutralizeSpreadsheetFormula(body.description.trim()).slice(0, MAX_DESCRIPTION_LENGTH) : "";
    if (!description) return bad("A description is required.");
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return bad("Amount must be a positive number.");

    const schoolId = authUser.schoolId;
    const nowIso = new Date().toISOString();
    const sessionCtx = await getAcademicSessionContextServer(schoolId);

    const expId = generateContentExpenseId(schoolId, date, description, amount);
    const txId = generateContentTransactionId(schoolId, date, "Other Expenses", description, "N/A", amount);
    const expDoc: ExpenseDoc = {
      id: expId,
      schoolId,
      date,
      description,
      amount,
      category: "OTHER_EXPENSE",
      transactionRef: txId,
      createdBy: authUser.uid,
      createdAt: nowIso,
      academicYear: sessionCtx.academicYear || undefined,
    };

    try {
      await saveExpenseServer(expDoc);
    } catch (err: any) {
      return bad(err?.message || "This exact expense has already been recorded.", 409);
    }

    const txDoc: TransactionDoc = {
      id: txId,
      schoolId,
      importBatchId: "manual-entry",
      rowNumber: 1,
      date,
      category: "Other Expenses",
      details: description,
      className: "N/A",
      amount,
      academicYear: sessionCtx.academicYear || "",
      createdBy: authUser.uid,
      createdAt: nowIso,
    };
    try {
      await saveTransactionServer(txDoc);
    } catch {
      // The expense itself is already saved and is the source of truth for every dashboard
      // total; a failure to also save its companion transaction only affects the Daily
      // Breakdown table's per-day split, never double-counts, and is not worth failing the
      // whole request over.
    }

    await createAuditLogServer(
      schoolId, authUser.uid, authUser.email, authUser.role,
      "ADD_OTHER_EXPENSE", "FEE", expId,
      `Recorded an Other Expense of Rs. ${amount} on ${date}: "${description}".`
    );

    return NextResponse.json({ success: true, expense: expDoc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other Expense POST error:", error);
    return bad("Failed to record the expense.", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return bad("id is required.");

    const existing = await getExpenseByIdServer(authUser.schoolId, id);
    if (!existing) return bad("Expense not found for this school.", 404);

    const updates: Partial<Pick<ExpenseDoc, "date" | "description" | "amount">> = {};
    if (body.date !== undefined) {
      const date = validateDateString(body.date);
      if (!date) return bad("date must be a valid date.");
      updates.date = date;
    }
    if (body.description !== undefined) {
      const description = neutralizeSpreadsheetFormula(String(body.description).trim()).slice(0, MAX_DESCRIPTION_LENGTH);
      if (!description) return bad("description cannot be empty.");
      updates.description = description;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return bad("amount must be a positive number.");
      updates.amount = amount;
    }
    if (Object.keys(updates).length === 0) return bad("Nothing to update.");

    const updated = await updateExpenseServer(authUser.schoolId, id, updates);
    if (!updated) return bad("Expense not found for this school.", 404);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "UPDATE_OTHER_EXPENSE", "FEE", id,
      `Corrected an Other Expense record: ${JSON.stringify(updates)}.`
    );

    return NextResponse.json({ success: true, expense: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other Expense PUT error:", error);
    return bad("Failed to update the expense.", 500);
  }
}

/**
 * DELETE /api/fees/expenses?id=... — soft-void only, never a hard delete (see voidExpenseServer):
 * the row and its linked transaction are kept so the content-hash dedup guard still blocks a
 * re-import of the exact same original row. Requires a reason.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return bad("id is required.");

    const existing = await getExpenseByIdServer(authUser.schoolId, id);
    if (!existing) return bad("Expense not found for this school.", 404);
    if (existing.voided) return bad("This expense has already been voided.", 409);

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return bad("A reason is required to void an expense.");

    const voided = await voidExpenseServer(authUser.schoolId, id, authUser.uid, reason);
    if (!voided) return bad("Expense not found for this school.", 404);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "VOID_OTHER_EXPENSE", "FEE", id,
      `Voided an Other Expense of Rs. ${existing.amount} on ${existing.date}: "${existing.description}". Reason: ${reason}`
    );

    return NextResponse.json({ success: true, expense: voided });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other Expense DELETE error:", error);
    return bad("Failed to void the expense.", 500);
  }
}
