import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import { createVoucherAdjustmentServer, getPaymentByIdServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { parseJsonBody } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

const adjustmentSchema = z.object({
  type: z.enum(["REVERSAL", "ADJUSTMENT"]),
  // Ignored for REVERSAL (the server derives the exact amount that zeroes the voucher's net);
  // required for ADJUSTMENT. A non-zero finite number, positive or negative.
  amount: z.coerce.number().finite().optional(),
  reason: z.string().trim().min(5).max(500),
});

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  NOT_FOUND: { message: "Voucher not found.", status: 404 },
  ALREADY_REVERSED: { message: "This voucher has already been reversed.", status: 409 },
  MISSING_REASON: { message: "A reason is required.", status: 400 },
  INVALID_AMOUNT: { message: "Adjustment amount must be a non-zero number.", status: 400 },
};

/**
 * POST /api/vouchers/[id]/adjust — the auditable correction workflow (Phase 10C/D). This is the
 * ONLY way to change a voucher's financial standing once it is locked (24h past entry): the
 * original payment record is never rewritten. A REVERSAL zeroes the voucher's net contribution
 * exactly and excludes it from net daily totals; an ADJUSTMENT applies a signed correction.
 * Usable on an unlocked voucher too, when an audit trail is wanted instead of a silent edit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, adjustmentSchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "reverse or adjust a fee voucher", req);

    const { type, amount, reason } = parsed.data;
    if (type === "ADJUSTMENT" && (amount === undefined || amount === 0)) {
      return NextResponse.json({ error: ERROR_MESSAGES.INVALID_AMOUNT.message }, { status: 400 });
    }

    const existing = await getPaymentByIdServer(authUser.schoolId, id);
    if (!existing) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });

    const result = await createVoucherAdjustmentServer(
      authUser.schoolId,
      id,
      { type, amount, reason },
      { uid: authUser.uid, name: authUser.name }
    );

    if (!result.ok) {
      const err = ERROR_MESSAGES[result.error];
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      type === "REVERSAL" ? "REVERSE_VOUCHER" : "ADJUST_VOUCHER",
      "FEE_VOUCHER",
      id,
      `${type === "REVERSAL" ? "Reversed" : "Adjusted"} voucher ${existing.receiptNo} for ${existing.studentName || existing.studentId} by Rs. ${result.adjustment.amount}. Reason: ${reason}`
    );

    return NextResponse.json({ success: true, adjustment: result.adjustment, voucher: result.payment });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/vouchers/[id]/adjust");
    if (busy) return busy;
    console.error("Voucher adjust error:", error);
    return NextResponse.json({ error: "Failed to record the voucher adjustment." }, { status: 500 });
  }
}
