import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getSchoolServer, getSchoolSettingsServer, getStudentFeeChallansServer } from "@/lib/firebase/server-db";
import { assertCanViewChallan } from "@/lib/academic-access";
import { schoolPrintIdentity } from "@/lib/school-display";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "STUDENT", "PARENT"]);
    const { id } = await params;
    const { challan, student } = await assertCanViewChallan(authUser, id);
    const [school, settings, studentChallans] = await Promise.all([
      getSchoolServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
      getStudentFeeChallansServer(authUser.schoolId, student.id),
    ]);
    // "Pending Fees" on the voucher = unpaid balance carried over from the student's OTHER challans.
    const pendingFees = studentChallans
      .filter((c) => c.id !== challan.id)
      .reduce((sum, c) => sum + Math.max(0, (c.totalExpected || 0) - (c.paidAmount || 0)), 0);

    return NextResponse.json({
      success: true,
      school: schoolPrintIdentity(school, settings),
      student: {
        id: student.id,
        fullName: student.fullName,
        fatherName: student.fatherName || "",
        admissionNo: student.admissionNo,
        className: student.className || challan.className || "",
        section: student.section || "",
      },
      challan: {
        id: challan.id,
        challanNo: challan.challanNo,
        month: challan.month,
        year: challan.year,
        issueDate: challan.issueDate,
        dueDate: challan.dueDate,
        tuitionFee: challan.tuitionFee,
        admissionFee: challan.admissionFee,
        examFee: challan.examFee,
        otherFee: challan.otherFee,
        discount: challan.discount,
        totalExpected: challan.totalExpected,
        paidAmount: challan.paidAmount,
        pendingFees,
        outstanding: Math.max(0, (challan.totalExpected || 0) - (challan.paidAmount || 0)),
        status: challan.status,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/print/challan/[id]");
    if (busy) return busy;
    console.error("Print challan error:", error);
    return NextResponse.json({ error: "Failed to load fee challan." }, { status: 500 });
  }
}
