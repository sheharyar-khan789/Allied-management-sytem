import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import {
  getStudentByIdServer,
  getYearlyFeeStructureForStudentServer,
  saveYearlyFeeStructureServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { YearlyFeeStructureDoc } from "@/lib/firebase/types";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Individual Student Fee Update — a single, reasoned adjustment to one student's Yearly Fee
 * Structure (see fee-structure-import.ts / YearlyFeeStructureDoc), distinct from the bulk
 * import's row-level update: every field changed here is recorded in the audit log with its
 * previous value, new value, reason, admin user and timestamp. It writes through the exact
 * same saveYearlyFeeStructureServer as the bulk import, so there is only ever one stored
 * structure per student/academic year — never a second, disconnected record.
 */
const putSchema = z
  .object({
    studentId: idString,
    academicYear: z.string().regex(/^\d{4}-\d{4}$/, "academicYear must look like 2026-2027"),
    monthlyTuitionFee: z.coerce.number().min(0).max(10_000_000).optional(),
    annualFee: z.coerce.number().min(0).max(10_000_000).optional(),
    admissionFee: z.coerce.number().min(0).max(10_000_000).optional(),
    otherCharges: z.coerce.number().min(0).max(10_000_000).optional(),
    discount: z.coerce.number().min(0).max(10_000_000).optional(),
    reason: z.string().trim().min(3).max(500),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const studentId = idString.safeParse(searchParams.get("studentId") || "");
    const academicYear = searchParams.get("academicYear") || "";
    if (!studentId.success) return bad("A valid studentId is required.");
    if (!/^\d{4}-\d{4}$/.test(academicYear)) return bad('A valid academicYear (e.g. "2026-2027") is required.');

    const student = await getStudentByIdServer(authUser.schoolId, studentId.data);
    if (!student || student.schoolId !== authUser.schoolId) return bad("Student not found for this school.", 404);

    const structure = await getYearlyFeeStructureForStudentServer(authUser.schoolId, student.id, academicYear);
    return NextResponse.json({ success: true, academicYear, structure }, { headers: NO_STORE });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/student-structure");
    if (busy) return busy;
    console.error("Student structure GET error:", error?.message || error);
    return bad("Failed to load the student's fee structure.", 500);
  }
}

const FIELD_LABELS: Record<string, string> = {
  monthlyTuitionFee: "Monthly Tuition Fee",
  annualFee: "Annual Fee",
  admissionFee: "Admission Fee",
  otherCharges: "Other Charges",
  discount: "Discount",
};

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    // A direct per-student financial override, same sensitivity tier as a manual challan/payment.
    requireRecentAuth(authUser, "adjust a student's yearly fee structure", req);

    const parsed = await parseJsonBody(req, putSchema);
    if (!parsed.ok) return parsed.response;
    const { studentId, academicYear, reason, effectiveDate, ...fields } = parsed.data;

    const changedFields = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => fields[k] !== undefined);
    if (changedFields.length === 0) return bad("Provide at least one field to adjust.");

    const student = await getStudentByIdServer(authUser.schoolId, studentId);
    if (!student || student.schoolId !== authUser.schoolId) return bad("Student not found for this school.", 404);

    const existing = await getYearlyFeeStructureForStudentServer(authUser.schoolId, student.id, academicYear);
    const nowIso = new Date().toISOString();

    const diffLines: string[] = [];
    for (const field of changedFields) {
      const before = existing ? existing[field] : 0;
      const after = fields[field]!;
      diffLines.push(`${FIELD_LABELS[field]}: ${before} -> ${after}`);
    }
    if (diffLines.length === 0) return bad("No actual change was given.");

    const doc: YearlyFeeStructureDoc = {
      id: existing?.id || "",
      schoolId: authUser.schoolId,
      academicYear,
      admissionNo: student.admissionNo,
      studentId: student.id,
      studentName: student.fullName,
      classId: student.classId,
      className: student.className,
      monthlyTuitionFee: fields.monthlyTuitionFee ?? existing?.monthlyTuitionFee ?? 0,
      annualFee: fields.annualFee ?? existing?.annualFee ?? 0,
      admissionFee: fields.admissionFee ?? existing?.admissionFee ?? 0,
      otherCharges: fields.otherCharges ?? existing?.otherCharges ?? 0,
      discount: fields.discount ?? existing?.discount ?? 0,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      createdBy: existing?.createdBy || authUser.uid,
      updatedBy: authUser.uid,
      importBatchId: existing?.importBatchId,
    };
    await saveYearlyFeeStructureServer(doc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ADJUST_FEE_STRUCTURE",
      "FEE",
      student.id,
      `Fee structure adjustment for ${student.fullName} (${student.admissionNo}), ${academicYear}` +
        `${effectiveDate ? ` effective ${effectiveDate}` : ""}: ${diffLines.join("; ")}. Reason: ${reason}.`
    );

    return NextResponse.json({ success: true, structure: doc }, { headers: NO_STORE });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/student-structure");
    if (busy) return busy;
    console.error("Student structure PUT error:", error?.message || error);
    return bad("Failed to save the fee structure adjustment.", 500);
  }
}
