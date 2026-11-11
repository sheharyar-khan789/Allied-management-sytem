import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getStudentByIdServer,
  getYearlyFeeStructureForStudentServer,
  getFeeChallansServer,
  getAdvanceBalanceServer,
  adjustAdvanceBalanceServer,
  saveFeeChallanServer,
  recordPaymentServer,
  createAuditLogServer,
  saveVoucherGenerationBatchServer,
  getVoucherGenerationBatchesServer,
} from "@/lib/firebase/server-db";
import { FEE_MONTHS, FeeChallanDoc, PaymentDoc, StudentDoc } from "@/lib/firebase/types";
import { applyAdvanceToVoucher, planMonthlyVoucher, voucherAlreadyExists, VoucherGenerationAction } from "@/lib/voucher-generation";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    academicYear: z.string().regex(/^\d{4}-\d{4}$/, "academicYear must look like 2026-2027"),
    month: z.enum(FEE_MONTHS),
    year: z.coerce.number().int().min(2000).max(2100),
    scope: z.enum(["SCHOOL", "CLASS", "STUDENT"]),
    classId: idString.optional(),
    studentId: idString.optional(),
  })
  .strict()
  .refine((v) => v.scope !== "CLASS" || !!v.classId, { message: "classId is required for CLASS scope." })
  .refine((v) => v.scope !== "STUDENT" || !!v.studentId, { message: "studentId is required for STUDENT scope." });

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

interface GenerationRow {
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  className: string;
  action: VoucherGenerationAction;
  reason?: string;
  tuitionFee?: number;
  admissionFee?: number;
  annualFeeCharged?: number;
  otherFee?: number;
  discount?: number;
  totalExpected?: number;
  advanceApplied?: number;
  challanId?: string;
}

async function resolveTargetStudents(schoolId: string, scope: string, classId?: string, studentId?: string): Promise<StudentDoc[]> {
  if (scope === "STUDENT") {
    const student = await getStudentByIdServer(schoolId, studentId!);
    return student ? [student] : [];
  }
  if (scope === "CLASS") {
    return getStudentsServer(schoolId, classId, undefined, undefined, "ACTIVE");
  }
  return getStudentsServer(schoolId, undefined, undefined, undefined, "ACTIVE");
}

async function handle(req: NextRequest, doCommit: boolean) {
  const authUser = await requireAuth(req, ["ADMIN"]);
  const parsed = await parseJsonBody(req, requestSchema);
  if (!parsed.ok) return parsed.response;
  const { academicYear, month, year, scope, classId, studentId } = parsed.data;
  const schoolId = authUser.schoolId;

  if (doCommit) {
    // Generating real vouchers (and spending real advance balances) is a sensitive financial
    // action, gated the same way a manual challan/payment/import commit is.
    requireRecentAuth(authUser, "generate monthly fee vouchers", req);
  }

  if (scope === "STUDENT" && studentId) {
    const student = await getStudentByIdServer(schoolId, studentId);
    if (!student || student.schoolId !== schoolId) return bad("Student not found for this school.", 404);
  }

  const targetStudents = await resolveTargetStudents(schoolId, scope, classId, studentId);
  const rows: GenerationRow[] = [];
  let generated = 0;

  for (const student of targetStudents) {
    const base = {
      studentId: student.id,
      studentName: student.fullName,
      admissionNo: student.admissionNo,
      classId: student.classId,
      className: student.className || "",
    };

    const structure = await getYearlyFeeStructureForStudentServer(schoolId, student.id, academicYear);
    if (!structure) {
      rows.push({ ...base, action: "SKIPPED_NO_STRUCTURE", reason: "No yearly fee structure set for this student/academic year." });
      continue;
    }

    // Every challan this student has in this exact academic year, regardless of class/session
    // changes since — the only reliable way to tell whether this month was already billed and
    // whether the one-time admission/annual charges were already applied this year.
    const allChallansThisYear = (
      await getFeeChallansServer(schoolId, student.id, undefined, undefined, undefined, undefined, { allSessions: true })
    ).filter((c) => c.academicYear === academicYear);

    if (voucherAlreadyExists(allChallansThisYear, month, year)) {
      rows.push({ ...base, action: "SKIPPED_EXISTS", reason: `A ${month} ${year} voucher already exists for this student.` });
      continue;
    }

    const plan = planMonthlyVoucher(structure, allChallansThisYear);
    const advanceDoc = await getAdvanceBalanceServer(schoolId, student.id, academicYear);
    const advancePreview = applyAdvanceToVoucher(plan.totalExpected, advanceDoc?.balance || 0);

    if (!doCommit) {
      rows.push({
        ...base,
        action: "GENERATED",
        tuitionFee: plan.tuitionFee,
        admissionFee: plan.admissionFee,
        annualFeeCharged: plan.annualFeeCharged,
        otherFee: plan.otherFee,
        discount: plan.discount,
        totalExpected: plan.totalExpected,
        advanceApplied: advancePreview.amountApplied,
      });
      continue;
    }

    const nowIso = new Date().toISOString();
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const challanId = `ch-${uniqueSuffix}`;
    const monthAbbr = month.substring(0, 3).toUpperCase();
    const challanNo = `CHL-${year}-${monthAbbr}-${uniqueSuffix}`;
    const dueDate = `${year}-${String(FEE_MONTHS.indexOf(month) + 1).padStart(2, "0")}-10`;

    const challanDoc: FeeChallanDoc = {
      id: challanId,
      schoolId,
      studentId: student.id,
      studentName: student.fullName,
      admissionNo: student.admissionNo,
      classId: student.classId,
      className: student.className,
      challanNo,
      month,
      year,
      issueDate: nowIso.split("T")[0],
      dueDate,
      tuitionFee: plan.tuitionFee,
      admissionFee: plan.admissionFee,
      examFee: 0,
      otherFee: plan.otherFee,
      discount: plan.discount,
      totalExpected: plan.totalExpected,
      paidAmount: 0,
      balanceAmount: plan.totalExpected,
      status: plan.totalExpected === 0 ? "PAID" : "PENDING",
      academicYear,
      createdAt: nowIso,
      updatedAt: nowIso,
      annualFeeCharged: plan.annualFeeCharged,
      oneTimeChargesApplied: plan.oneTimeChargesApplied,
      generatedFromStructure: true,
    };

    try {
      await saveFeeChallanServer(challanDoc);
    } catch (e: any) {
      console.error("Voucher generation: challan write failed:", e?.message);
      rows.push({ ...base, action: "FAILED", reason: "Database write failed; nothing was saved for this student." });
      continue;
    }

    let advanceApplied = 0;
    if (advancePreview.amountApplied > 0) {
      const paymentDoc: PaymentDoc = {
        id: `pay-${uniqueSuffix}-${Math.random().toString(36).slice(2, 6)}`,
        schoolId,
        challanId,
        studentId: student.id,
        studentName: student.fullName,
        receiptNo: `ADV-${year}-${uniqueSuffix}`,
        amount: advancePreview.amountApplied,
        paymentDate: nowIso.split("T")[0],
        paymentMode: "ADVANCE_CREDIT",
        notes: "Auto-applied from the student's existing advance balance.",
        collectedBy: authUser.uid,
        createdAt: nowIso,
      };
      try {
        await recordPaymentServer(paymentDoc);
        await adjustAdvanceBalanceServer(schoolId, student.id, academicYear, -advancePreview.amountApplied);
        advanceApplied = advancePreview.amountApplied;
      } catch (e: any) {
        // The voucher itself is real and correct either way; only the advance auto-application
        // failed, so it's reported but never blocks the voucher from counting as generated.
        console.error("Voucher generation: advance application failed:", e?.message);
      }
    }

    generated++;
    rows.push({
      ...base,
      action: "GENERATED",
      tuitionFee: plan.tuitionFee,
      admissionFee: plan.admissionFee,
      annualFeeCharged: plan.annualFeeCharged,
      otherFee: plan.otherFee,
      discount: plan.discount,
      totalExpected: plan.totalExpected,
      advanceApplied,
      challanId,
    });
  }

  const summary = {
    totalStudents: targetStudents.length,
    generated: doCommit ? generated : rows.filter((r) => r.action === "GENERATED").length,
    skippedExists: rows.filter((r) => r.action === "SKIPPED_EXISTS").length,
    skippedNoStructure: rows.filter((r) => r.action === "SKIPPED_NO_STRUCTURE").length,
    failed: rows.filter((r) => r.action === "FAILED").length,
  };

  let batchId: string | undefined;
  if (doCommit) {
    batchId = `vgb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await saveVoucherGenerationBatchServer({
      id: batchId,
      schoolId,
      academicYear,
      month,
      year,
      scope,
      classId,
      studentId,
      totalStudents: summary.totalStudents,
      generated: summary.generated,
      skippedExists: summary.skippedExists,
      skippedNoStructure: summary.skippedNoStructure,
      failed: summary.failed,
      createdBy: authUser.uid,
      createdByName: authUser.email,
      createdAt: new Date().toISOString(),
    });

    await createAuditLogServer(
      schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "GENERATE_MONTHLY_VOUCHERS",
      "FEE",
      batchId,
      `Generated ${month} ${year} vouchers (${academicYear}, scope ${scope}${classId ? ` ${classId}` : ""}${studentId ? ` ${studentId}` : ""}): ` +
        `${summary.generated} generated, ${summary.skippedExists} already existed, ${summary.skippedNoStructure} had no structure, ${summary.failed} failed.`
    );
  }

  return NextResponse.json({ success: true, academicYear, month, year, scope, committed: doCommit, batchId, summary, rows });
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const doCommit = searchParams.get("commit") === "true";
    return await handle(req, doCommit);
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/vouchers/generate");
    if (busy) return busy;
    console.error("Voucher generation error:", error?.message || error);
    return NextResponse.json({ error: "Voucher generation failed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || undefined;
    const batches = await getVoucherGenerationBatchesServer(authUser.schoolId, academicYear);
    return NextResponse.json({ success: true, batches });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/vouchers/generate");
    if (busy) return busy;
    console.error("Voucher generation history error:", error?.message || error);
    return NextResponse.json({ error: "Failed to load generation history." }, { status: 500 });
  }
}
