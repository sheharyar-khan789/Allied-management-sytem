import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getStudentByIdServer,
  getStudentChargeByIdServer,
  saveStudentChargeServer,
} from "@/lib/firebase/server-db";
import { STUDENT_CHARGE_TYPES, StudentChargeDoc } from "@/lib/firebase/types";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { validateDateString } from "@/lib/date-utils";

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
    console.error("Student charge PUT error:", error);
    return jsonError("Failed to update the payment.", 500);
  }
}
