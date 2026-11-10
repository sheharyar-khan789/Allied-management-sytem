import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { reversePaymentServer, createAuditLogServer } from "@/lib/firebase/server-db";

// Corrects a wrongly applied payment by writing a linked negative-amount reversal entry —
// the original PaymentDoc is never deleted or edited, only flagged reversed=true, so the
// full history (including the mistake) stays permanently reconstructable.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const body = await req.json();
    const { reason } = body;

    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: "A reason is required to reverse a payment." }, { status: 400 });
    }

    const reversal = await reversePaymentServer(authUser.schoolId, id, reason, authUser.uid);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "REVERSE_PAYMENT",
      "PAYMENT",
      id,
      `Reversed payment ${id} for ${reversal.studentName} (Rs. ${Math.abs(reversal.amount)}). Reason: ${reason}`
    );

    return NextResponse.json({ success: true, reversal });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Payment reversal error:", error);
    return NextResponse.json({ error: error?.message || "Failed to reverse payment." }, { status: 400 });
  }
}
