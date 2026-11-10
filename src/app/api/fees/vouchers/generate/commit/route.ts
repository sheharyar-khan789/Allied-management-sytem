import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { planVoucherGeneration, buildChallanDoc, summarizeRows } from "@/lib/voucher-generation";
import { applyAdvanceCreditsToNewVouchers } from "@/lib/advance-balance";
import { commitFeeChallanDocsServer, saveVoucherGenerationBatchServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { FeeChallanDoc, VoucherGenerationBatchDoc } from "@/lib/firebase/types";

// Re-plans generation from scratch server-side (never trusts a client-submitted preview)
// so a stale or tampered request can't write voucher amounts that were never actually
// previewed against the current yearly fee structure and existing vouchers.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { academicYear, month, year, scope, classId, studentId } = body;

    if (!academicYear || !month || !year || !scope) {
      return NextResponse.json({ error: "academicYear, month, year and scope are required." }, { status: 400 });
    }

    const rows = await planVoucherGeneration(authUser.schoolId, academicYear, month, Number(year), {
      scope,
      classId,
      studentId,
    });

    const batchId = `vgb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const challanDocs: FeeChallanDoc[] = rows
      .filter((r) => r.action === "CREATED")
      .map((r) => buildChallanDoc(authUser.schoolId, academicYear, month, Number(year), r, batchId));

    await applyAdvanceCreditsToNewVouchers(authUser.schoolId, academicYear, challanDocs);
    await commitFeeChallanDocsServer(challanDocs);

    const summary = summarizeRows(rows);
    const batchDoc: VoucherGenerationBatchDoc = {
      id: batchId,
      schoolId: authUser.schoolId,
      academicYear,
      month,
      year: Number(year),
      scope,
      classId,
      studentId,
      totalRows: summary.totalRows,
      createdCount: summary.createdCount,
      skippedCount: summary.skippedCount,
      errorCount: summary.errorCount,
      rows: rows.map((r) => ({
        studentId: r.studentId,
        admissionNo: r.admissionNo,
        studentName: r.studentName,
        classId: r.classId,
        className: r.className,
        action: r.action,
        errorReason: r.errorReason,
        challanId: r.challanId,
        totalExpected: r.totalExpected,
      })),
      generatedBy: authUser.uid,
      generatedByEmail: authUser.email,
      createdAt: new Date().toISOString(),
    };
    await saveVoucherGenerationBatchServer(batchDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "GENERATE_MONTHLY_VOUCHERS",
      "FEE_CHALLAN_BATCH",
      batchId,
      `Generated ${month} ${year} vouchers (${academicYear}, scope ${scope}): ${summary.createdCount} created, ${summary.skippedCount} already existed, ${summary.errorCount} errors.`
    );

    return NextResponse.json({ success: true, batchId, summary, rows: batchDoc.rows });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Voucher generation commit error:", error);
    return NextResponse.json({ error: error?.message || "Failed to generate vouchers." }, { status: 500 });
  }
}
