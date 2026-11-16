import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import {
  getFeeChallanByIdServer,
  saveFeeChallanServer,
  statusFromPaidAmount,
  getPaymentsByChallanIdServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { parseJsonBody, money } from "@/lib/input-validation";
import { validateDateString } from "@/lib/date-utils";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

/**
 * Admin-only edit/void for a FeeChallanDoc (the billed invoice, distinct from the PaymentDoc
 * "voucher" receipts recorded against it — see /api/vouchers for that side). Nothing else in the
 * app can edit a challan's own fee composition or dueDate; PUT /api/fees only ever records a
 * payment against one (see that route's explicit field-stripping).
 */
const editSchema = z.object({
  tuitionFee: money.optional(),
  admissionFee: money.optional(),
  examFee: money.optional(),
  otherFee: money.optional(),
  discount: money.optional(),
  dueDate: z.string().trim().max(20).optional(),
});

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, editSchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "edit a fee challan", req);
    const body = parsed.data;

    const existing = await getFeeChallanByIdServer(authUser.schoolId, id);
    if (!existing) return bad("Challan not found.", 404);
    if (existing.status === "VOID") return bad("This challan has been voided and can no longer be edited.", 409);

    let dueDate = existing.dueDate;
    if (body.dueDate !== undefined) {
      const valid = validateDateString(body.dueDate);
      if (!valid) return bad("Invalid due date.");
      dueDate = valid;
    }

    const tuitionFee = body.tuitionFee ?? existing.tuitionFee;
    const admissionFee = body.admissionFee ?? existing.admissionFee;
    const examFee = body.examFee ?? existing.examFee;
    const otherFee = body.otherFee ?? existing.otherFee;
    const discount = body.discount ?? existing.discount;
    const totalExpected = Math.max(0, tuitionFee + admissionFee + examFee + otherFee - discount);

    // Never allow an edit to drop the billed total below what has already been paid — that
    // would misrepresent a partly/fully paid challan as having a negative or zero balance.
    if (totalExpected < existing.paidAmount) {
      return bad(
        `This edit would set the billed total (Rs. ${totalExpected}) below the amount already paid (Rs. ${existing.paidAmount}). Reduce the discount or increase a fee component instead.`,
        409
      );
    }

    const updated = {
      ...existing,
      tuitionFee,
      admissionFee,
      examFee,
      otherFee,
      discount,
      dueDate,
      totalExpected,
      balanceAmount: Math.max(0, totalExpected - existing.paidAmount),
      status: statusFromPaidAmount(totalExpected, existing.paidAmount),
    };

    await saveFeeChallanServer(updated);

    // Dashboard totals that split a payment by "this challan's CURRENT fee composition" (see
    // splitPaymentByComposition in /api/fees/dashboard) re-read the challan at query time, so
    // this edit retroactively changes how already-recorded payments are categorized there —
    // logged explicitly so that effect is at least traceable, not silently invisible.
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_FEE_CHALLAN",
      "FEE_CHALLAN",
      id,
      `Edited fee composition for challan ${existing.challanNo} (${existing.studentName || existing.studentId}): billed total Rs. ${existing.totalExpected} -> Rs. ${totalExpected}. Already-recorded payments on the dashboard will re-split against this new composition retroactively.`
    );

    return NextResponse.json({ success: true, challan: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/challans/[id]");
    if (busy) return busy;
    console.error("Fee challan PUT error:", error);
    return bad("Failed to update the challan.", 500);
  }
}

/**
 * Void-only "delete". Blocked outright if the challan has ANY real payment against it — checked
 * against actual PaymentDoc records (getPaymentsByChallanIdServer), never the challan's own
 * cached paidAmount alone. A challan with zero payments is flipped to status VOID with
 * totalExpected/balanceAmount zeroed (so every existing totalExpected-summing aggregate —
 * getFeeTotalsByClassServer, computeFeeChallanStats — naturally excludes it with no query
 * changes needed), never hard-deleted.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    requireRecentAuth(authUser, "void a fee challan", req);

    const existing = await getFeeChallanByIdServer(authUser.schoolId, id);
    if (!existing) return bad("Challan not found.", 404);
    if (existing.status === "VOID") return bad("This challan has already been voided.", 409);

    const payments = await getPaymentsByChallanIdServer(authUser.schoolId, id);
    if (existing.paidAmount > 0 || payments.length > 0) {
      return bad("This challan has payments recorded against it and cannot be voided. Reverse or adjust the payment(s) first.", 409);
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) return bad("A reason is required to void a challan.");

    const voided = {
      ...existing,
      status: "VOID" as const,
      totalExpected: 0,
      balanceAmount: 0,
      voidReason: reason,
      voidedAt: new Date().toISOString(),
      voidedBy: authUser.uid,
    };
    await saveFeeChallanServer(voided);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "VOID_FEE_CHALLAN",
      "FEE_CHALLAN",
      id,
      `Voided challan ${existing.challanNo} for ${existing.studentName || existing.studentId} (no payments recorded). Reason: ${reason}`
    );

    return NextResponse.json({ success: true, challan: voided });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/challans/[id]");
    if (busy) return busy;
    console.error("Fee challan DELETE error:", error);
    return bad("Failed to void the challan.", 500);
  }
}
