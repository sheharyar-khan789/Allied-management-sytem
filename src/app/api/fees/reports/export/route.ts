import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getReportData, REPORT_TYPES, ReportType } from "@/lib/financial-reports";

// Exports exactly what the on-screen report shows — same dispatcher, same filters, same
// data — as a real .xlsx built from the live query result, never a hand-typed figure.
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

    const sheet = rows.length > 0 ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["No data for the selected filters"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Report");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const label = REPORT_TYPES.find((r) => r.value === type)?.label || type;
    const fileName = `${label.replace(/[^a-z0-9]+/gi, "-")}-${academicYear}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Financial report export error:", error);
    return NextResponse.json({ error: error?.message || "Failed to export report." }, { status: 500 });
  }
}
