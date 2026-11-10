import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { planVoucherGeneration } from "@/lib/voucher-generation";
import { summarizeRows } from "@/lib/voucher-generation";

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { academicYear, month, year, scope, classId, studentId } = body;

    if (!academicYear || !month || !year || !scope) {
      return NextResponse.json({ error: "academicYear, month, year and scope are required." }, { status: 400 });
    }

    const rows = await planVoucherGeneration(authUser.schoolId, academicYear, month, Number(year), {
      scope,
      classId,
      studentId,
    });
    const summary = summarizeRows(rows);

    const safeRows = rows.map((r) => ({
      studentId: r.studentId,
      admissionNo: r.admissionNo,
      studentName: r.studentName,
      classId: r.classId,
      className: r.className,
      action: r.action,
      errorReason: r.errorReason,
      challanId: r.challanId,
      totalExpected: r.totalExpected,
    }));

    return NextResponse.json({ success: true, academicYear, month, year, scope, summary, rows: safeRows });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Voucher generation preview error:", error);
    return NextResponse.json({ error: error?.message || "Failed to preview voucher generation." }, { status: 500 });
  }
}
