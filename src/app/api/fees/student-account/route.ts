import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentByIdServer,
  getYearlyFeeStructureServer,
  getFeeChallansServer,
  getPaymentsByStudentServer,
  getAdvanceBalanceServer,
  getFeeAdjustmentsServer,
} from "@/lib/firebase/server-db";
import { compareMonthYear } from "@/lib/fee-calculations";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get("studentId");
    const academicYear = searchParams.get("academicYear");
    if (!studentId || !academicYear) {
      return NextResponse.json({ error: "studentId and academicYear are required." }, { status: 400 });
    }

    const student = await getStudentByIdServer(authUser.schoolId, studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found in this school." }, { status: 404 });
    }

    const [structure, challans, payments, advanceBalance, adjustments] = await Promise.all([
      getYearlyFeeStructureServer(authUser.schoolId, academicYear, student.admissionNo),
      getFeeChallansServer(authUser.schoolId, studentId),
      getPaymentsByStudentServer(authUser.schoolId, studentId),
      getAdvanceBalanceServer(authUser.schoolId, studentId, academicYear),
      getFeeAdjustmentsServer(authUser.schoolId, studentId),
    ]);

    const sortedChallans = [...challans].sort((a, b) => compareMonthYear({ month: a.month, year: a.year }, { month: b.month, year: b.year }));
    const paymentsByChallan = new Map<string, typeof payments>();
    payments.forEach((p) => {
      if (!paymentsByChallan.has(p.challanId)) paymentsByChallan.set(p.challanId, []);
      paymentsByChallan.get(p.challanId)!.push(p);
    });

    const vouchers = sortedChallans.map((c) => ({
      challan: c,
      payments: (paymentsByChallan.get(c.id) || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }));

    const totalExpected = challans.reduce((sum, c) => sum + (c.totalExpected || 0), 0);
    const totalPaid = challans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
    const totalOutstanding = Math.max(0, totalExpected - totalPaid);

    return NextResponse.json({
      success: true,
      student: {
        id: student.id,
        admissionNo: student.admissionNo,
        fullName: student.fullName,
        classId: student.classId,
        className: student.className,
        section: student.section,
      },
      academicYear,
      structure,
      vouchers,
      advanceBalance: advanceBalance?.balance || 0,
      adjustments,
      totals: { totalExpected, totalPaid, totalOutstanding },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student fee account error:", error);
    return NextResponse.json({ error: "Failed to load student fee account." }, { status: 500 });
  }
}
