import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getVoucherGenerationBatchByIdServer,
  getFeeChallanByIdServer,
  getSchoolServer,
  getSchoolSettingsServer,
} from "@/lib/firebase/server-db";
import { schoolPrintIdentity } from "@/lib/school-display";

export async function GET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { batchId } = await params;

    const batch = await getVoucherGenerationBatchByIdServer(authUser.schoolId, batchId);
    if (!batch) {
      return NextResponse.json({ error: "Voucher generation batch not found." }, { status: 404 });
    }

    const [school, settings] = await Promise.all([
      getSchoolServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);

    const createdRows = batch.rows.filter((r) => r.action === "CREATED" && r.challanId);
    const challans = await Promise.all(createdRows.map((r) => getFeeChallanByIdServer(authUser.schoolId, r.challanId!)));

    const vouchers = challans
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((challan) => ({
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
      }));

    return NextResponse.json({ success: true, school: schoolPrintIdentity(school, settings), vouchers });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Batch voucher print error:", error);
    return NextResponse.json({ error: "Failed to load batch vouchers." }, { status: 500 });
  }
}
