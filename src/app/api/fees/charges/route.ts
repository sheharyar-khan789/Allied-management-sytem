import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getStudentByIdServer,
  getStudentChargeByIdServer,
  saveStudentChargeServer,
  deleteStudentChargeServer,
} from "@/lib/firebase/server-db";
import { STUDENT_CHARGE_TYPES, StudentChargeDoc } from "@/lib/firebase/types";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { validateDateString } from "@/lib/date-utils";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

/**
 * Additional / event payments (event, trip, sports, exam, activity, other) — one document per
 * charge in `studentCharges`, so new kinds of charges never need new student fields.
 */
const chargeFields = {
  type: z.enum(STUDENT_CHARGE_TYPES),
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().finite().positive().max(100_000_000),
  date: z.string().trim().min(8).max(20),
  status: z.enum(["PAID", "UNPAID"]),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
};

const createSchema = z.object({ studentId: idString, ...chargeFields }).strict();
const updateSchema = z.object({ id: idString, ...chargeFields }).strict();

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const date = validateDateString(body.date);
    if (!date) return jsonError("date must be a valid YYYY-MM-DD date.", 400);

    const student = await getStudentByIdServer(authUser.schoolId, body.studentId);
    if (!student || student.schoolId !== authUser.schoolId) return jsonError("Student not found for this school.", 404);

    const nowIso = new Date().toISOString();
    const charge = await saveStudentChargeServer({
      id: `chg-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`,
      schoolId: authUser.schoolId,
      studentId: student.id,
      studentName: student.fullName,
      type: body.type,
      description: body.description,
      amount: Number(body.amount),
      date,
      status: body.status,
      notes: body.notes || undefined,
      createdBy: authUser.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "CREATE_STUDENT_CHARGE", "FEE", charge.id,
      `Added ${charge.type} charge "${charge.description}" of Rs. ${charge.amount} (${charge.status}) for ${student.fullName}.`
    );
    return NextResponse.json({ success: true, charge }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/charges");
    if (busy) return busy;
    console.error("Student charge POST error:", error);
    return jsonError("Failed to add the payment.", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, updateSchema, ["studentId"]);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const date = validateDateString(body.date);
    if (!date) return jsonError("date must be a valid YYYY-MM-DD date.", 400);

    // Resolved inside the caller's school; the student a charge belongs to never changes.
    const existing = await getStudentChargeByIdServer(authUser.schoolId, body.id);
    if (!existing) return jsonError("Payment record not found.", 404);

    const updated: StudentChargeDoc = {
      ...existing,
      type: body.type,
      description: body.description,
      amount: Number(body.amount),
      date,
      status: body.status,
      notes: body.notes || undefined,
      updatedBy: authUser.uid,
    };
    const charge = await saveStudentChargeServer(updated);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "UPDATE_STUDENT_CHARGE", "FEE", charge.id,
      `Updated ${charge.type} charge "${charge.description}" to Rs. ${charge.amount} (${charge.status}) for ${charge.studentName || charge.studentId}.`
    );
    return NextResponse.json({ success: true, charge });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/charges");
    if (busy) return busy;
    console.error("Student charge PUT error:", error);
    return jsonError("Failed to update the payment.", 500);
  }
}

/**
 * DELETE /api/fees/charges?id=... — an UNPAID charge (no payment history) is hard-deleted; a
 * PAID charge is voided instead (status flips to "VOID", the row and its history are kept) and
 * requires a `reason` in the request body, since there is no PaymentDoc backing it the way a
 * voucher has — the charge itself is the only record of what/when/how it was paid.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return jsonError("id is required.", 400);

    const existing = await getStudentChargeByIdServer(authUser.schoolId, id);
    if (!existing) return jsonError("Payment record not found.", 404);

    if (existing.status === "PAID") {
      const body = await req.json().catch(() => ({}));
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        return jsonError("A reason is required to void a payment that was already marked PAID.", 400);
      }
      const voided = await saveStudentChargeServer({
        ...existing,
        status: "VOID",
        voidReason: reason,
        voidedAt: new Date().toISOString(),
        voidedBy: authUser.uid,
      });
      await createAuditLogServer(
        authUser.schoolId, authUser.uid, authUser.email, authUser.role,
        "VOID_STUDENT_CHARGE", "FEE", id,
        `Voided ${existing.type} charge "${existing.description}" of Rs. ${existing.amount} for ${existing.studentName || existing.studentId}. Reason: ${reason}`
      );
      return NextResponse.json({ success: true, charge: voided });
    }

    const deleted = await deleteStudentChargeServer(authUser.schoolId, id);
    if (!deleted) return jsonError("Failed to delete the payment record.", 500);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "DELETE_STUDENT_CHARGE", "FEE", id,
      `Deleted unpaid ${existing.type} charge "${existing.description}" of Rs. ${existing.amount} for ${existing.studentName || existing.studentId}.`
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/charges");
    if (busy) return busy;
    console.error("Student charge DELETE error:", error);
    return jsonError("Failed to delete the payment.", 500);
  }
}
