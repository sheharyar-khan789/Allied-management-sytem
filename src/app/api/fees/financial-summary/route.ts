import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { computeFinancialSummary } from "@/lib/financial-summary";

// The single source of truth for every "total income / net balance / outstanding dues"
// figure shown anywhere in the app (dashboard, reports, exports) — Phase 7's centralized
// ledger: one calculation, every consumer reads the same numbers.
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear");
    if (!academicYear) {
      return NextResponse.json({ error: "academicYear is required." }, { status: 400 });
    }
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;

    const summary = await computeFinancialSummary(authUser.schoolId, academicYear, dateFrom, dateTo);
    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Financial summary error:", error);
    return NextResponse.json({ error: "Failed to compute financial summary." }, { status: 500 });
  }
}
