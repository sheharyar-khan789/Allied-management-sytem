import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getAdvanceBalancesForSchoolServer, getStudentByIdServer } from "@/lib/firebase/server-db";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

/** Advance Payment Report: every student with an unapplied credit for one academic year. */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || "";
    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return NextResponse.json({ error: 'A valid academicYear (e.g. "2026-2027") is required.' }, { status: 400 });
    }

    const balances = (await getAdvanceBalancesForSchoolServer(authUser.schoolId, academicYear)).filter((b) => b.balance > 0);
    const students = await Promise.all(balances.map((b) => getStudentByIdServer(authUser.schoolId, b.studentId)));

    const rows = balances
      .map((b, i) => [b.studentId, students[i]?.admissionNo || "", students[i]?.fullName || "", students[i]?.className || "", b.balance])
      .sort((a, b) => Number(b[4]) - Number(a[4]));
    const grandTotal = rows.reduce((sum, r) => sum + Number(r[4]), 0);

    const csv = buildCsv([
      ["Student ID", "Admission No", "Student Name", "Class", "Advance Balance"],
      ...rows,
      ["", "", "", "GRAND TOTAL", grandTotal],
    ]);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`advance-payments-${academicYear}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Advance payments report error:", error?.message || error);
    return NextResponse.json({ error: "Failed to build the advance payments report." }, { status: 500 });
  }
}
