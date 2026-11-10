import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getStudentsServer, getYearlyFeeStructuresServer } from "@/lib/firebase/server-db";
import { parseFeeStructureWorkbook, classifyFeeStructureRows, summarizeClassifiedRows } from "@/lib/fee-structure-import";

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const academicYear = String(form.get("academicYear") || "").trim();

    if (!file) {
      return NextResponse.json({ error: "A file is required." }, { status: 400 });
    }
    if (!academicYear) {
      return NextResponse.json({ error: "Academic Year is required." }, { status: 400 });
    }

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

    return NextResponse.json({
      success: true,
      academicYear,
      fileName: file.name,
      summary,
      rows: classified,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fee structure import preview error:", error);
    return NextResponse.json({ error: "Failed to preview the import file." }, { status: 500 });
  }
}
