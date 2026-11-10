import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getReportData, ReportType } from "@/lib/financial-reports";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") as ReportType | null;
    const academicYear = searchParams.get("academicYear");
    if (!type || !academicYear) {
      return NextResponse.json({ error: "type and academicYear are required." }, { status: 400 });
    }

    const { rows } = await getReportData(type, authUser.schoolId, academicYear, {
      classId: searchParams.get("classId") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      category: searchParams.get("category") || undefined,
    });

    return NextResponse.json({ success: true, type, academicYear, rows });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Financial report error:", error);
    return NextResponse.json({ error: error?.message || "Failed to generate report." }, { status: 500 });
  }
}
