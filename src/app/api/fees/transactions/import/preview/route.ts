import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getStudentsServer } from "@/lib/firebase/server-db";
import {
  parseTransactionWorkbook,
  prepareClassificationContext,
  classifyTransactionRows,
  summarizeTransactionRows,
} from "@/lib/daily-transaction-import";

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const academicYear = String(form.get("academicYear") || "").trim();

    if (!file) return NextResponse.json({ error: "A file is required." }, { status: 400 });
    if (!academicYear) return NextResponse.json({ error: "Academic Year is required." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsedRows = parseTransactionWorkbook(buffer);
    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the uploaded file." }, { status: 400 });
    }
    if (parsedRows.length > 5000) {
      return NextResponse.json({ error: "File exceeds the 5000-row limit for a single import." }, { status: 400 });
    }

    const students = await getStudentsServer(authUser.schoolId);
    const { studentStates, existingDedupKeys } = await prepareClassificationContext(authUser.schoolId, academicYear, parsedRows, students);
    const classified = classifyTransactionRows(parsedRows, students, studentStates, existingDedupKeys, authUser.schoolId);
    const summary = summarizeTransactionRows(classified);

    return NextResponse.json({ success: true, academicYear, fileName: file.name, summary, rows: classified });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Transaction import preview error:", error);
    return NextResponse.json({ error: "Failed to preview the import file." }, { status: 500 });
  }
}
