import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getOtherCollectionsServer, saveOtherCollectionServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { OtherCollectionDoc, OtherCollectionCategory } from "@/lib/firebase/types";

const CATEGORIES: OtherCollectionCategory[] = ["REGISTRATION", "CERTIFICATE", "FINE", "EVENT", "OTHER"];

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search")?.toLowerCase() || "";

    let records = await getOtherCollectionsServer(authUser.schoolId, dateFrom, dateTo, category);
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
    console.error("Other collections GET error:", error);
    return NextResponse.json({ error: "Failed to load other collections." }, { status: 500 });
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
    const doc: OtherCollectionDoc = {
      id: `oc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    await saveOtherCollectionServer(doc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "RECORD_OTHER_COLLECTION",
      "OTHER_COLLECTION",
      doc.id,
      `Recorded ${category} income of Rs. ${amount}: ${description}`
    );

    return NextResponse.json({ success: true, record: doc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other collections POST error:", error);
    return NextResponse.json({ error: "Failed to record collection." }, { status: 500 });
  }
}
