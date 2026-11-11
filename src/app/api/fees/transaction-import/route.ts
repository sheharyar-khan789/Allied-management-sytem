import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getFeeChallansServer,
  saveFeeChallanServer,
} from "@/lib/firebase/server-db";
import {
  saveImportBatchServer,
  saveTransactionServer,
  saveExpenseServer,
  getTransactionsByBatchServer,
  getImportBatchesServer,
  generateTransactionId,
  ImportBatchDoc,
  TransactionDoc,
  ExpenseDoc,
} from "@/lib/firebase/transaction-db";
import { readSpreadsheetUpload, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  parseTransactionRow,
  validateTransactionRows,
  buildTransactionSummary,
  TransactionImportRow,
  TransactionImportResult,
} from "@/lib/transaction-import";
import { FeeChallanDoc } from "@/lib/firebase/types";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: NextRequest) {
  let authUser: AuthenticatedUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return bad("Authentication required.", 401);
  }
  if (authUser.role !== "ADMIN") {
    return bad("Only administrators can manage transaction imports.", 403);
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const batchId = searchParams.get("batchId");

  if (action === "template" || searchParams.has("template")) {
    const csvContent =
      "Day & Date,Category,Details,Class,Amount\n" +
      "15-11-2026,Fees,M. Huzaifa,Nursery,3700\n" +
      "15-11-2026,Annual Amount,M. Laique,Nursery,3000\n" +
      "15-11-2026,Other Expenses,Electricity Bill,General,12000\n";

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="transaction-import-template.csv"',
      },
    });
  }

  if (batchId) {
    const transactions = await getTransactionsByBatchServer(authUser.schoolId, batchId);
    return NextResponse.json({ success: true, transactions });
  }

  const batches = await getImportBatchesServer(authUser.schoolId, 50);
  return NextResponse.json({ success: true, batches });
}

export async function POST(req: NextRequest) {
  let authUser: AuthenticatedUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return bad("Authentication required.", 401);
  }
  if (authUser.role !== "ADMIN") {
    return bad("Only administrators can import transactions.", 403);
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "preview";

  if (action === "preview") {
    return handlePreview(authUser, req);
  } else if (action === "commit") {
    return handleCommit(authUser, req);
  }

  return bad("Invalid action. Expected preview or commit.");
}

async function parseUploadedRows(req: NextRequest): Promise<{ fileName: string; parsedRows: TransactionImportRow[] }> {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new Error("No file was uploaded.");
  }
  if (file.size === 0) {
    throw new Error("The uploaded file is empty.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sheetRows = readSpreadsheetUpload(file.name || "upload.xlsx", buffer);

  if (sheetRows.length < 2) {
    throw new Error("The sheet must contain at least a header row and one data row.");
  }

  // Row 0 is header: "Day & Date", "Category", "Details", "Class", "Amount"
  const parsedRows: TransactionImportRow[] = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const cells = sheetRows[i];
    if (cells.every((c) => !c || String(c).trim() === "")) continue; // skip blank lines
    parsedRows.push(parseTransactionRow(i + 1, cells));
  }

  return { fileName: file.name || "upload.xlsx", parsedRows };
}

async function handlePreview(authUser: AuthenticatedUser, req: NextRequest) {
  let fileName = "";
  let parsedRows: TransactionImportRow[] = [];

  try {
    const parsed = await parseUploadedRows(req);
    fileName = parsed.fileName;
    parsedRows = parsed.parsedRows;
  } catch (e: any) {
    if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
    return bad(e?.message || "Failed to parse file.");
  }

  if (parsedRows.length === 0) {
    return bad("No valid data rows found in spreadsheet.");
  }

  // Load students for matching
  const students = await getStudentsServer(
    authUser.schoolId,
    undefined,
    undefined,
    undefined,
    undefined,
    { allSessions: true }
  );

  const studentLookups = students.map((s) => ({
    id: s.id,
    fullName: s.fullName || "",
    className: s.className || "",
    classId: s.classId || "",
    admissionNo: s.admissionNo || "",
  }));

  // Load existing challans to detect month duplicates
  const existingChallans = await getFeeChallansServer(
    authUser.schoolId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { allSessions: true }
  );

  const existingTxDates = new Set<string>();
  for (const ch of existingChallans) {
    const monthIndex = MONTH_NAMES.indexOf(ch.month);
    if (monthIndex >= 0 && ch.year) {
      const ym = `${ch.year}-${String(monthIndex + 1).padStart(2, "0")}`;
      existingTxDates.add(`${ch.studentId}_${ym}`);
    }
  }

  const results = validateTransactionRows(parsedRows, studentLookups, existingTxDates);
  const summary = buildTransactionSummary(results);

  return NextResponse.json({
    success: true,
    fileName,
    summary,
  });
}

async function handleCommit(authUser: AuthenticatedUser, req: NextRequest) {
  let rowsToCommit: TransactionImportResult[] = [];
  let fileName = "transaction-import.xlsx";

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.results)) {
      return bad("Expected JSON payload with 'results' array.");
    }
    rowsToCommit = body.results;
    if (body.fileName) fileName = body.fileName;
  } else if (contentType.includes("multipart/form-data")) {
    let parsed;
    try {
      parsed = await parseUploadedRows(req);
    } catch (e: any) {
      return bad(e?.message || "Failed to parse file.");
    }
    fileName = parsed.fileName;

    const students = await getStudentsServer(
      authUser.schoolId,
      undefined,
      undefined,
      undefined,
      undefined,
      { allSessions: true }
    );
    const studentLookups = students.map((s) => ({
      id: s.id,
      fullName: s.fullName || "",
      className: s.className || "",
      classId: s.classId || "",
      admissionNo: s.admissionNo || "",
    }));

    const existingChallans = await getFeeChallansServer(
      authUser.schoolId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { allSessions: true }
    );

    const existingTxDates = new Set<string>();
    for (const ch of existingChallans) {
      const monthIndex = MONTH_NAMES.indexOf(ch.month);
      if (monthIndex >= 0 && ch.year) {
        const ym = `${ch.year}-${String(monthIndex + 1).padStart(2, "0")}`;
        existingTxDates.add(`${ch.studentId}_${ym}`);
      }
    }

    rowsToCommit = validateTransactionRows(parsed.parsedRows, studentLookups, existingTxDates);
  } else {
    return bad("Unsupported request content type.");
  }

  const validRows = rowsToCommit.filter((r) => r.status === "VALID");
  if (validRows.length === 0) {
    return bad("No valid rows to commit.");
  }

  const nowIso = new Date().toISOString();
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const schoolId = authUser.schoolId;

  // Load existing challans again to ensure idempotency and prevent duplicates
  const existingChallans = await getFeeChallansServer(
    schoolId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { allSessions: true }
  );

  let successCount = 0;
  let failCount = 0;

  for (const item of validRows) {
    const row = item.row;
    const amount = row.amount || 0;
    const txId = generateTransactionId(schoolId, batchId, row.rowNumber);

    try {
      let challanRef: string | undefined;

      if (row.category === "Fees" || row.category === "Annual Amount") {
        if (!item.resolvedStudentId || !row.date) {
          failCount++;
          continue;
        }

        const [yStr, mStr] = row.date.split("-");
        const year = parseInt(yStr, 10);
        const mIdx = parseInt(mStr, 10) - 1;
        const month = MONTH_NAMES[mIdx] || "November";

        // Check if an existing challan for this student, month, and year exists
        const matchChallan = existingChallans.find(
          (c) => c.studentId === item.resolvedStudentId && c.month === month && c.year === year
        );

        if (matchChallan) {
          challanRef = matchChallan.id;
          const updatedTuition = row.category === "Fees" ? amount : matchChallan.tuitionFee;
          const updatedAdmission = row.category === "Annual Amount" ? amount : matchChallan.admissionFee;
          const totalExpected =
            updatedTuition +
            updatedAdmission +
            (matchChallan.examFee || 0) +
            (matchChallan.otherFee || 0) -
            (matchChallan.discount || 0);
          const balance = totalExpected - (matchChallan.paidAmount || 0);

          await saveFeeChallanServer({
            ...matchChallan,
            tuitionFee: updatedTuition,
            admissionFee: updatedAdmission,
            totalExpected,
            balanceAmount: balance,
            status: balance <= 0 ? "PAID" : matchChallan.paidAmount > 0 ? "PARTIAL" : "PENDING",
            updatedAt: nowIso,
          });
        } else {
          // Create new challan
          const randomSuffix = Math.random().toString(36).slice(2, 7);
          const chId = `ch-${Date.now()}-${randomSuffix}`;
          const challanNo = `CHL-${year}-${month.substring(0, 3).toUpperCase()}-${randomSuffix}`;
          challanRef = chId;

          const tuitionFee = row.category === "Fees" ? amount : 0;
          const admissionFee = row.category === "Annual Amount" ? amount : 0;
          const totalExpected = tuitionFee + admissionFee;

          const newChallan: FeeChallanDoc = {
            id: chId,
            schoolId,
            studentId: item.resolvedStudentId,
            studentName: item.resolvedStudentName,
            classId: item.resolvedClassId || "",
            className: row.className,
            challanNo,
            month,
            year,
            issueDate: row.date,
            dueDate: `${year}-${String(mIdx + 1).padStart(2, "0")}-15`,
            tuitionFee,
            admissionFee,
            examFee: 0,
            otherFee: 0,
            discount: 0,
            totalExpected,
            paidAmount: 0,
            balanceAmount: totalExpected,
            status: "PENDING",
            createdAt: nowIso,
            updatedAt: nowIso,
          };

          await saveFeeChallanServer(newChallan);
          existingChallans.push(newChallan); // add to in-memory list for subsequent rows in same batch
        }
      } else if (row.category === "Other Expenses") {
        // Record as an expense document
        const expId = `exp_${Date.now()}_${row.rowNumber}`;
        const expDoc: ExpenseDoc = {
          id: expId,
          schoolId,
          date: row.date || nowIso.split("T")[0],
          description: row.details,
          amount,
          category: "OTHER_EXPENSE",
          importBatchId: batchId,
          createdBy: authUser.uid,
          createdAt: nowIso,
        };
        await saveExpenseServer(expDoc);
      }

      // Record transaction
      const txDoc: TransactionDoc = {
        id: txId,
        schoolId,
        importBatchId: batchId,
        rowNumber: row.rowNumber,
        date: row.date || nowIso.split("T")[0],
        category: row.category!,
        details: row.details,
        studentId: item.resolvedStudentId,
        studentName: item.resolvedStudentName,
        classId: item.resolvedClassId,
        className: row.className,
        amount,
        academicYear: row.date ? `${row.date.substring(0, 4)}-${parseInt(row.date.substring(0, 4), 10) + 1}` : "2026-2027",
        createdBy: authUser.uid,
        createdAt: nowIso,
        challanRef,
      };

      await saveTransactionServer(txDoc);
      successCount++;
    } catch (e: any) {
      console.error(`Failed to process row ${row.rowNumber}:`, e);
      failCount++;
    }
  }

  const batchDoc: ImportBatchDoc = {
    id: batchId,
    schoolId,
    importedBy: authUser.uid,
    importedAt: nowIso,
    fileName,
    fileHash: "",
    rowCount: rowsToCommit.length,
    successCount,
    failCount,
    academicYear: "2026-2027",
    status: failCount === 0 ? "COMMITTED" : successCount > 0 ? "PARTIAL" : "PENDING",
  };

  await saveImportBatchServer(batchDoc);

  return NextResponse.json({
    success: true,
    batchId,
    successCount,
    failCount,
    totalCount: rowsToCommit.length,
  });
}
