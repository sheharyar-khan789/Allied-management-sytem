import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import {
  editVoucherPaymentServer,
  getPaymentByIdServer,
  getVoucherAdjustmentsForPaymentServer,
  isVoucherLocked,
  netVoucherAmount,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { parseJsonBody, money } from "@/lib/input-validation";
import { validateDateString } from "@/lib/date-utils";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

const voucherEditSchema = z.object({
  amount: money.optional(),
  paymentDate: z.string().trim().max(20).optional(),
  paymentMode: z.enum(["CASH", "BANK_TRANSFER", "ONLINE", "CHEQUE"]).optional(),
  transactionRef: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

const EDIT_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "Voucher not found.",
  LOCKED: "This voucher is more than 24 hours old and is locked. Use a reversal/adjustment instead.",
  REVERSED: "This voucher has been reversed and cannot be edited.",
  INVALID_AMOUNT: "Amount must be a positive number.",
};

/** GET /api/vouchers/[id] — one voucher with its full adjustment/reversal audit trail. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const payment = await getPaymentByIdServer(authUser.schoolId, id);
    if (!payment) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
    const adjustments = await getVoucherAdjustmentsForPaymentServer(authUser.schoolId, id);
    return NextResponse.json({
      success: true,
      voucher: { ...payment, locked: isVoucherLocked(payment), netAmount: netVoucherAmount(payment, adjustments) },
      adjustments,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/vouchers/[id]");
    if (busy) return busy;
    console.error("Voucher GET error:", error);
    return NextResponse.json({ error: "Failed to load the voucher." }, { status: 500 });
  }
}

/**
 * PUT /api/vouchers/[id] — direct edit, only while the voucher is within its 24-hour window.
 * The lock is enforced inside editVoucherPaymentServer against the server's own clock on every
 * call; nothing here (or in the client) can widen it.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, voucherEditSchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "edit a fee voucher", req);

    const body = parsed.data;
    let paymentDate: string | undefined;
    if (body.paymentDate !== undefined) {
      const valid = validateDateString(body.paymentDate);
      if (!valid) return NextResponse.json({ error: "Invalid payment date." }, { status: 400 });
      paymentDate = valid;
    }

    const existing = await getPaymentByIdServer(authUser.schoolId, id);
    if (!existing) return NextResponse.json({ error: "Voucher not found." }, { status: 404 });

    const result = await editVoucherPaymentServer(
      authUser.schoolId,
      id,
      {
        amount: body.amount,
        paymentDate,
        paymentMode: body.paymentMode,
        transactionRef: body.transactionRef,
        notes: body.notes,
      },
      { uid: authUser.uid }
    );

    if (!result.ok) {
      const status = result.error === "NOT_FOUND" ? 404 : result.error === "INVALID_AMOUNT" ? 400 : 409;
      return NextResponse.json({ error: EDIT_ERROR_MESSAGES[result.error] }, { status });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "EDIT_VOUCHER",
      "FEE_VOUCHER",
      id,
      `Edited voucher ${existing.receiptNo} for ${existing.studentName || existing.studentId}: Rs. ${existing.amount} -> Rs. ${result.payment.amount}.`
    );

    return NextResponse.json({ success: true, voucher: result.payment });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/vouchers/[id]");
    if (busy) return busy;
    console.error("Voucher PUT error:", error);
    return NextResponse.json({ error: "Failed to update the voucher." }, { status: 500 });
  }
}
