import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getExpensesByDateRangeServer } from "@/lib/firebase/transaction-db";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

/** School Expenses Report: every operational expense record in the given date range. */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;

    const expenses = (await getExpensesByDateRangeServer(authUser.schoolId, from, to)).sort((a, b) => b.date.localeCompare(a.date));
    const rows = expenses.map((e) => [e.date, e.category, e.description, e.amount, e.paymentMethod || "", e.receiptRef || "", e.createdByName || ""]);
    const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const csv = buildCsv([
      ["Date", "Category", "Description", "Amount", "Payment Method", "Reference", "Recorded By"],
      ...rows,
      ["", "", "", total, "", "", "GRAND TOTAL"],
    ]);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`other-expenses${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other expenses export error:", error?.message || error);
    return NextResponse.json({ error: "Failed to export other expenses." }, { status: 500 });
  }
}
