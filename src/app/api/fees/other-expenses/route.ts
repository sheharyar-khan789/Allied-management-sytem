import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import { createAuditLogServer } from "@/lib/firebase/server-db";
import {
  saveExpenseServer,
  getExpensesByDateRangeServer,
  OTHER_EXPENSE_CATEGORIES,
  ExpenseDoc,
} from "@/lib/firebase/transaction-db";
import { parseJsonBody } from "@/lib/input-validation";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const createSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    category: z.enum(OTHER_EXPENSE_CATEGORIES),
    description: z.string().trim().min(1).max(300),
    amount: z.coerce.number().positive().max(100_000_000),
    paymentMethod: z.string().trim().max(60).optional(),
    receiptRef: z.string().trim().max(120).optional(),
    academicYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const expenses = (await getExpensesByDateRangeServer(authUser.schoolId, from, to)).sort((a, b) => b.date.localeCompare(a.date));
    const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    return NextResponse.json({ success: true, expenses, total });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other expenses list error:", error?.message || error);
    return bad("Failed to load other expenses.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const { date, category, description, amount, paymentMethod, receiptRef, academicYear } = parsed.data;

    const nowIso = new Date().toISOString();
    const id = `exp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const doc: ExpenseDoc = {
      id,
      schoolId: authUser.schoolId,
      date,
      description,
      amount,
      category,
      paymentMethod,
      receiptRef,
      createdBy: authUser.uid,
      createdByName: authUser.email,
      createdAt: nowIso,
      academicYear,
    };
    await saveExpenseServer(doc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_OTHER_EXPENSE",
      "OTHER_EXPENSE",
      id,
      `Recorded expense: ${category} — ${description} — Rs. ${amount}.`
    );

    return NextResponse.json({ success: true, expense: doc });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other expense create error:", error?.message || error);
    return bad("Failed to record the expense.", 500);
  }
}
