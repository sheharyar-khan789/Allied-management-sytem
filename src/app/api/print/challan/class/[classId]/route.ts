import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getFeeChallansServer, getSchoolServer, getSchoolSettingsServer } from "@/lib/firebase/server-db";
import { schoolPrintIdentity } from "@/lib/school-display";

export async function GET(req: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { classId } = await params;
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || undefined;
    const month = searchParams.get("month") || undefined;
    const year = searchParams.get("year") ? Number(searchParams.get("year")) : undefined;

    const [allChallans, school, settings] = await Promise.all([
      getFeeChallansServer(authUser.schoolId, undefined, month, year, undefined, undefined, academicYear),
      getSchoolServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);

    const challans = allChallans.filter((c) => c.classId === classId);

    return NextResponse.json({
      success: true,
      school: schoolPrintIdentity(school, settings),
      vouchers: challans.map((challan) => ({
        student: {
          fullName: challan.studentName || "",
          admissionNo: challan.admissionNo || "",
          className: challan.className || "",
          section: "",
        },
        challan: {
          challanNo: challan.challanNo,
          month: challan.month,
          year: challan.year,
          issueDate: challan.issueDate,
          dueDate: challan.dueDate,
          tuitionFee: challan.tuitionFee,
          admissionFee: challan.admissionFee,
          examFee: challan.examFee,
          otherFee: challan.otherFee,
          annualFeeCharged: challan.annualFeeCharged || 0,
          previousOutstandingDues: challan.previousOutstandingDues || 0,
          discount: challan.discount,
          totalExpected: challan.totalExpected,
          paidAmount: challan.paidAmount,
          outstanding: Math.max(0, (challan.totalExpected || 0) - (challan.paidAmount || 0)),
          status: challan.status,
        },
      })),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Class voucher print error:", error);
    return NextResponse.json({ error: "Failed to load class vouchers." }, { status: 500 });
  }
}
