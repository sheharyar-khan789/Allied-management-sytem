import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getFeeChallansServer } from "@/lib/firebase/server-db";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

/**
 * Outstanding Dues Report: every student's unpaid balance across their challans for one
 * academic year — reported separately from collected cash, never counted as income.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || "";
    const classId = searchParams.get("classId") || undefined;
    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return NextResponse.json({ error: 'A valid academicYear (e.g. "2026-2027") is required.' }, { status: 400 });
    }

    const challans = await getFeeChallansServer(authUser.schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true });
    const relevant = challans.filter((c) => c.academicYear === academicYear && (!classId || c.classId === classId));

    const byStudent = new Map<string, { studentName: string; admissionNo: string; className: string; expected: number; collected: number; balance: number }>();
    for (const c of relevant) {
      const entry = byStudent.get(c.studentId) || { studentName: c.studentName || "", admissionNo: c.admissionNo || "", className: c.className || "", expected: 0, collected: 0, balance: 0 };
      entry.expected += c.totalExpected || 0;
      entry.collected += c.paidAmount || 0;
      entry.balance += c.balanceAmount || 0;
      byStudent.set(c.studentId, entry);
    }

    const rows = Array.from(byStudent.entries())
      .filter(([, v]) => v.balance > 0)
      .sort((a, b) => b[1].balance - a[1].balance)
      .map(([studentId, v]) => [studentId, v.admissionNo, v.studentName, v.className, v.expected, v.collected, v.balance]);

    const grandTotal = rows.reduce((sum, r) => sum + Number(r[6]), 0);
    const csv = buildCsv([
      ["Student ID", "Admission No", "Student Name", "Class", "Total Expected", "Total Collected", "Outstanding Balance"],
      ...rows,
      ["", "", "", "", "", "GRAND TOTAL", grandTotal],
    ]);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`outstanding-dues-${academicYear}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Outstanding dues report error:", error?.message || error);
    return NextResponse.json({ error: "Failed to build the outstanding dues report." }, { status: 500 });
  }
}
