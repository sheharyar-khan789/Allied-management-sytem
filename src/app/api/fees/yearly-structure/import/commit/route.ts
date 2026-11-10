import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getYearlyFeeStructuresServer,
  commitYearlyFeeStructureDocsServer,
  saveImportBatchServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import {
  parseFeeStructureWorkbook,
  classifyFeeStructureRows,
  summarizeClassifiedRows,
  toImportBatchRowResults,
} from "@/lib/fee-structure-import";
import { YearlyFeeStructureDoc, ImportBatchDoc } from "@/lib/firebase/types";

// Re-parses and re-validates the uploaded file from scratch (never trusts a client-supplied
// classification) so a tampered request cannot write fee amounts that were never actually
// previewed against current student records.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const academicYear = String(form.get("academicYear") || "").trim();

    if (!file) return NextResponse.json({ error: "A file is required." }, { status: 400 });
    if (!academicYear) return NextResponse.json({ error: "Academic Year is required." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsedRows = parseFeeStructureWorkbook(buffer, file.name);
    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the uploaded file." }, { status: 400 });
    }
    if (parsedRows.length > 5000) {
      return NextResponse.json({ error: "File exceeds the 5000-row limit for a single import." }, { status: 400 });
    }

    const [students, existingList] = await Promise.all([
      getStudentsServer(authUser.schoolId),
      getYearlyFeeStructuresServer(authUser.schoolId, academicYear),
    ]);

    const existingByAdmissionNo = new Map(existingList.map((s) => [s.admissionNo.trim().toUpperCase(), s]));
    const classified = classifyFeeStructureRows(parsedRows, students, existingByAdmissionNo);
    const summary = summarizeClassifiedRows(classified);

    const nowIso = new Date().toISOString();
    const writableDocs: YearlyFeeStructureDoc[] = [];
    classified
      .filter((r) => r.action === "CREATED" || r.action === "UPDATED")
      .forEach((r) => {
        const existing = existingByAdmissionNo.get(r.admissionNo.toUpperCase());
        const doc: YearlyFeeStructureDoc = {
          id: `${authUser.schoolId}__${academicYear}__${r.admissionNo.trim().toUpperCase()}`,
          schoolId: authUser.schoolId,
          academicYear,
          studentId: r.studentId!,
          admissionNo: r.admissionNo,
          studentName: r.studentName!,
          classId: r.classId || "",
          className: r.className,
          section: r.section,
          monthlyTuitionFee: r.structure!.monthlyTuitionFee,
          annualFee: r.structure!.annualFee,
          admissionFee: r.structure!.admissionFee,
          otherCharges: r.structure!.otherCharges,
          discount: r.structure!.discount,
          notes: r.structure!.notes,
          source: "IMPORT",
          createdAt: existing?.createdAt || nowIso,
          createdBy: existing?.createdBy || authUser.uid,
          updatedAt: nowIso,
          updatedBy: authUser.uid,
        };
        writableDocs.push(doc);
      });

    const batchId = `ifs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    writableDocs.forEach((d) => (d.importBatchId = batchId));

    await commitYearlyFeeStructureDocsServer(writableDocs);

    const batchDoc: ImportBatchDoc = {
      id: batchId,
      schoolId: authUser.schoolId,
      type: "YEARLY_FEE_STRUCTURE",
      academicYear,
      fileName: file.name,
      totalRows: summary.totalRows,
      createdCount: summary.createdCount,
      updatedCount: summary.updatedCount,
      unchangedCount: summary.unchangedCount,
      errorCount: summary.errorCount,
      rows: toImportBatchRowResults(classified).slice(0, 1000),
      uploadedBy: authUser.uid,
      uploadedByEmail: authUser.email,
      createdAt: nowIso,
    };
    await saveImportBatchServer(batchDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "IMPORT_YEARLY_FEE_STRUCTURE",
      "YEARLY_FEE_STRUCTURE",
      batchId,
      `Imported yearly fee structure for ${academicYear} from "${file.name}": ${summary.createdCount} created, ${summary.updatedCount} updated, ${summary.unchangedCount} unchanged, ${summary.errorCount} errors.`
    );

    return NextResponse.json({ success: true, batchId, academicYear, summary, rows: classified });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fee structure import commit error:", error);
    return NextResponse.json({ error: "Failed to commit the import." }, { status: 500 });
  }
}
