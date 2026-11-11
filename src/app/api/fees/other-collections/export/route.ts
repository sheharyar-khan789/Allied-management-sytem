import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getOtherCollectionsByDateRangeServer } from "@/lib/firebase/transaction-db";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

/** Other Collections Report: every non-fee income record in the given date range. */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;

    const collections = await getOtherCollectionsByDateRangeServer(authUser.schoolId, from, to);
    const rows = collections.map((c) => [c.date, c.category, c.description, c.amount, c.paymentMethod || "", c.receiptRef || "", c.createdByName || ""]);
    const total = collections.reduce((sum, c) => sum + (c.amount || 0), 0);

    const csv = buildCsv([
      ["Date", "Category", "Description", "Amount", "Payment Method", "Reference", "Recorded By"],
      ...rows,
      ["", "", "", total, "", "", "GRAND TOTAL"],
    ]);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`other-collections${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other collections export error:", error?.message || error);
    return NextResponse.json({ error: "Failed to export other collections." }, { status: 500 });
  }
}
