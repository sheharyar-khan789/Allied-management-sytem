import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getYearlyFeeStructuresServer } from "@/lib/firebase/server-db";
import { yearlyExpectedFeeFor } from "@/lib/fee-structure-import";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || "";
    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return NextResponse.json({ error: 'A valid academicYear query param (e.g. "2026-2027") is required.' }, { status: 400 });
    }

    const structures = await getYearlyFeeStructuresServer(authUser.schoolId, academicYear);
    const header = ["Admission No", "Student Name", "Class", "Monthly Tuition Fee", "Annual Fee", "Admission Fee", "Other Charges", "Discount", "Yearly Expected Fee", "Last Updated"];
    const rows = structures
      .sort((a, b) => a.admissionNo.localeCompare(b.admissionNo))
      .map((s) => [
        s.admissionNo,
        s.studentName || "",
        s.className || "",
        s.monthlyTuitionFee,
        s.annualFee,
        s.admissionFee,
        s.otherCharges,
        s.discount,
        yearlyExpectedFeeFor(s),
        s.updatedAt,
      ]);

    const csv = buildCsv([header, ...rows]);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`yearly-fee-structure-${academicYear}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fee structure export error:", error?.message || error);
    return NextResponse.json({ error: "Failed to export the yearly fee structure." }, { status: 500 });
  }
}
