import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getOtherExpensesServer, saveOtherExpenseServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { OtherExpenseDoc, OtherExpenseCategory } from "@/lib/firebase/types";

const CATEGORIES: OtherExpenseCategory[] = ["ELECTRICITY", "MAINTENANCE", "STATIONERY", "STAFF", "TRANSPORT", "OTHER"];

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search")?.toLowerCase() || "";

    let records = await getOtherExpensesServer(authUser.schoolId, dateFrom, dateTo, category);
    if (search) {
      records = records.filter((r) => r.description.toLowerCase().includes(search) || (r.reference || "").toLowerCase().includes(search));
    }

    const active = records.filter((r) => !r.reversed);
    const totalAmount = active.reduce((sum, r) => sum + r.amount, 0);
    const byCategory: Record<string, number> = {};
    CATEGORIES.forEach((c) => (byCategory[c] = 0));
    active.forEach((r) => (byCategory[r.category] = (byCategory[r.category] || 0) + r.amount));

    return NextResponse.json({ success: true, records, stats: { totalAmount, byCategory, count: active.length } });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other expenses GET error:", error);
    return NextResponse.json({ error: "Failed to load other expenses." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { date, category, description, amount, paymentMethod, reference } = body;

    if (!date || !category || !description || amount === undefined || amount === null) {
      return NextResponse.json({ error: "date, category, description and amount are required." }, { status: 400 });
    }
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `category must be one of ${CATEGORIES.join(", ")}.` }, { status: 400 });
    }
    if (Number(amount) <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const doc: OtherExpenseDoc = {
      id: `oe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      schoolId: authUser.schoolId,
      date,
      category,
      description,
      amount: Number(amount),
      paymentMethod,
      reference,
      createdBy: authUser.uid,
      createdByEmail: authUser.email,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await saveOtherExpenseServer(doc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "RECORD_OTHER_EXPENSE",
      "OTHER_EXPENSE",
      doc.id,
      `Recorded ${category} expense of Rs. ${amount}: ${description}`
    );

    return NextResponse.json({ success: true, record: doc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other expenses POST error:", error);
    return NextResponse.json({ error: "Failed to record expense." }, { status: 500 });
  }
}
