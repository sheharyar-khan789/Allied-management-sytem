import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getSchoolServer, getSchoolSettingsServer, getFeeChallansForStudentsServer } from "@/lib/firebase/server-db";
import { assertCanViewChallan } from "@/lib/academic-access";
import { schoolPrintIdentity } from "@/lib/school-display";
import { buildVoucher } from "@/lib/fee-voucher-server";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "STUDENT", "PARENT"]);
    const { id } = await params;
    const { challan, student } = await assertCanViewChallan(authUser, id);
    const [school, settings, studentChallans] = await Promise.all([
      getSchoolServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
      // Pending balances come from the challan's own academic session.
      getFeeChallansForStudentsServer(authUser.schoolId, [student.id], challan.academicYear ? { academicYear: challan.academicYear } : undefined),
    ]);
    return NextResponse.json({
      success: true,
      voucher: buildVoucher(schoolPrintIdentity(school, settings), student, challan, studentChallans),
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/print/challan/[id]");
    if (busy) return busy;
    console.error("Print challan error:", error);
    return NextResponse.json({ error: "Failed to load fee challan." }, { status: 500 });
  }
}
