import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getFeeChallanByIdServer,
  applyChallanBalanceAdjustmentServer,
  saveFeeAdjustmentServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { FeeAdjustmentDoc, FeeAdjustmentType } from "@/lib/firebase/types";

const ALLOWED_TYPES: FeeAdjustmentType[] = ["ADDITIONAL_CHARGE", "CONCESSION", "PREVIOUS_BALANCE_CORRECTION"];

// Applies a one-off signed delta to a single voucher's totalExpected/balanceAmount —
// e.g. a late fine, a one-time concession, or correcting a wrongly carried-forward balance.
// Never touches paidAmount or any existing PaymentDoc: adjustments and payments are
// separate, independently auditable layers on top of the same voucher.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const body = await req.json();
    const { amount, adjustmentType, reason, effectiveDate } = body;

    if (amount === undefined || amount === null || Number(amount) === 0) {
      return NextResponse.json({ error: "A non-zero adjustment amount is required." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(adjustmentType)) {
      return NextResponse.json({ error: `adjustmentType must be one of ${ALLOWED_TYPES.join(", ")}.` }, { status: 400 });
    }
    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: "A reason is required for every adjustment." }, { status: 400 });
    }
    if (!effectiveDate) {
      return NextResponse.json({ error: "An effective date is required." }, { status: 400 });
    }

    const challan = await getFeeChallanByIdServer(authUser.schoolId, id);
    if (!challan) {
      return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
    }

    const previousValue = challan.totalExpected;
    // CONCESSION is always a reduction and ADDITIONAL_CHARGE always an increase — the sign
    // is implied by the type so the admin can't accidentally flip which direction they meant.
    // PREVIOUS_BALANCE_CORRECTION can go either way, so its sign comes directly from the input.
    const delta =
      adjustmentType === "CONCESSION"
        ? -Math.abs(Number(amount))
        : adjustmentType === "ADDITIONAL_CHARGE"
        ? Math.abs(Number(amount))
        : Number(amount);

    const updatedChallan = await applyChallanBalanceAdjustmentServer(authUser.schoolId, id, delta);

    const adjustmentId = `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const adjustment: FeeAdjustmentDoc = {
      id: adjustmentId,
      schoolId: authUser.schoolId,
      studentId: challan.studentId,
      admissionNo: challan.admissionNo || "",
      studentName: challan.studentName || "",
      academicYear: challan.academicYear || "",
      effectiveDate,
      adjustmentType,
      previousValue,
      newValue: updatedChallan.totalExpected,
      challanId: id,
      reason,
      adminUserId: authUser.uid,
      adminEmail: authUser.email,
      createdAt: new Date().toISOString(),
    };
    await saveFeeAdjustmentServer(adjustment);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ADJUST_VOUCHER_BALANCE",
      "FEE_CHALLAN",
      id,
      `${adjustmentType} of Rs. ${Math.abs(Number(amount))} on voucher ${challan.challanNo} for ${challan.studentName}: total Rs. ${previousValue} -> Rs. ${updatedChallan.totalExpected}. Reason: ${reason}`
    );

    return NextResponse.json({ success: true, challan: updatedChallan, adjustment });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Voucher adjustment error:", error);
    return NextResponse.json({ error: error?.message || "Failed to apply adjustment." }, { status: 500 });
  }
}
