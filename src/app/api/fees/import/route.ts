import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRecentAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getFeeChallansServer,
  saveFeeChallanServer,
  recordPaymentServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { FeeChallanDoc, PaymentDoc } from "@/lib/firebase/types";
import { neutralizeSpreadsheetFormula, readSpreadsheetUpload, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  FEE_IMPORT_MAX_FILE_BYTES,
  FEE_IMPORT_MAX_ROWS,
  FeeImportField,
  FeeImportRowInput,
  FeeImportRowResult,
  feeRowsToInputs,
  missingRequiredFeeColumns,
  NormalizedImportFee,
  validateFeeImportRows,
} from "@/lib/fee-import";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const IMPORT_FIELDS: FeeImportField[] = [
  "admissionNo", "studentName", "month", "year", "tuitionFee", "admissionFee", "examFee",
  "otherFee", "discount", "amountPaid", "dueDate", "paymentDate", "paymentReference",
];
const MAX_VALUE_LENGTH = 300;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** The school's real data every row is validated against. Always scoped to the session's school. */
async function buildContext(schoolId: string) {
  const [students, existingChallans] = await Promise.all([
    // Admission numbers stay unique across sessions, so match against every student ever
    // enrolled, not just the active session's roster.
    getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true }),
    // Every challan ever issued (all sessions) — the only way to tell a genuine re-upload of
    // the same file apart from a new month's charges, so importing twice never doubles a bill.
    getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true }),
  ]);
  return { students, existingChallans };
}

// ---------------------------------------------------------------------------
// Preview: parse + validate, nothing is written. The file is read in memory and discarded.
// ---------------------------------------------------------------------------
async function preview(authUser: AuthenticatedUser, req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Upload a file using multipart/form-data.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return bad("No file was uploaded.");
  if (file.size === 0) return bad("The uploaded file is empty.");
  if (file.size > FEE_IMPORT_MAX_FILE_BYTES) {
    return bad(`The file is too large (max ${FEE_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
  }

  let rows;
  try {
    rows = readSpreadsheetUpload(file.name || "", Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
    throw e;
  }

  if (rows.length < 2) return bad("The file has no fee rows (the first row must be the column headers).");
  if (rows.length - 1 > FEE_IMPORT_MAX_ROWS) {
    return bad(`The file has ${rows.length - 1} rows; import at most ${FEE_IMPORT_MAX_ROWS} fee records per file.`);
  }

  const { inputs, mapping } = feeRowsToInputs(rows);
  const missing = missingRequiredFeeColumns(mapping);
  if (missing.length > 0) {
    return bad(`Required column(s) not found: ${missing.join(", ")}. Download the template to see the expected headers.`);
  }

  const ctx = await buildContext(authUser.schoolId);
  const result = validateFeeImportRows(inputs, ctx);

  return NextResponse.json({
    success: true,
    fileName: file.name,
    mappedColumns: Array.from(mapping.columns.values()),
    ignoredColumns: mapping.ignored,
    summary: result.summary,
    rows: result.rows,
  });
}

// ---------------------------------------------------------------------------
// Commit: re-validates every submitted row against fresh database state (the preview is never
// trusted — a row accepted a minute ago may since have become a duplicate), then creates the
// confirmed challans (and, where a row carries a paid amount, a matching real payment).
// ---------------------------------------------------------------------------
function sanitizeInput(raw: unknown): FeeImportRowInput {
  const input: FeeImportRowInput = {};
  if (!raw || typeof raw !== "object") return input;
  for (const field of IMPORT_FIELDS) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) input[field] = neutralizeSpreadsheetFormula(v.trim()).slice(0, MAX_VALUE_LENGTH);
  }
  return input;
}

type RowOutcome = {
  rowNumber: number;
  status: "IMPORTED" | "SKIPPED" | "FAILED";
  reason?: string;
  challanId?: string;
  challanNo?: string;
  studentName?: string;
  month?: string;
  year?: number;
  totalExpected?: number;
  amountPaid?: number;
};

/** Due date default when the sheet gives none: the 10th of the billed month. */
function defaultDueDate(month: string, year: number): string {
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const idx = MONTH_NAMES.indexOf(month);
  return `${year}-${String(idx + 1).padStart(2, "0")}-10`;
}

async function commit(authUser: AuthenticatedUser, req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON request payload.");
  }
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return bad("No rows were selected for import.");
  if (body.rows.length > FEE_IMPORT_MAX_ROWS) return bad(`Import at most ${FEE_IMPORT_MAX_ROWS} fee records at a time.`);

  const submitted = (body.rows as unknown[]).map((r, i) => {
    const rec = (r && typeof r === "object" ? r : {}) as { rowNumber?: unknown; input?: unknown };
    const rowNumber = Number.isInteger(rec.rowNumber) ? (rec.rowNumber as number) : i + 2;
    return { rowNumber, input: sanitizeInput(rec.input) };
  });

  const schoolId = authUser.schoolId;
  const inputs = submitted.map((s) => s.input);
  const ctx = await buildContext(schoolId);
  const validated = validateFeeImportRows(inputs, ctx).rows.map((r, i) => ({ ...r, rowNumber: submitted[i].rowNumber }));

  const outcomes: RowOutcome[] = [];
  const accepted: (FeeImportRowResult & { fee: NormalizedImportFee })[] = [];
  for (const r of validated) {
    if ((r.status === "VALID" || r.status === "WARNING") && r.fee) {
      accepted.push(r as FeeImportRowResult & { fee: NormalizedImportFee });
    } else {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: r.errors.join(" ") || "Row is not valid." });
    }
  }

  // Re-check duplicates against each other within this very commit too: two accepted rows for
  // the same student/month/year (e.g. the admin re-selected an already-imported row) must not
  // both create a challan.
  const seenThisCommit = new Set<string>();
  const nowIso = new Date().toISOString();

  let importedCount = 0;
  for (const r of accepted) {
    const fee = r.fee;
    const key = `${fee.studentId}|${fee.month}|${fee.year}`;
    if (seenThisCommit.has(key)) {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: `Duplicate of another row in this import for ${fee.studentName}, ${fee.month} ${fee.year}.` });
      continue;
    }
    seenThisCommit.add(key);

    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const challanId = `ch-${uniqueSuffix}`;
    const challanNo = `CHL-${fee.year}-${fee.month.substring(0, 3).toUpperCase()}-${uniqueSuffix}`;
    const dueDate = fee.dueDate || defaultDueDate(fee.month, fee.year);

    const challanDoc: FeeChallanDoc = {
      id: challanId,
      schoolId,
      studentId: fee.studentId,
      studentName: fee.studentName,
      admissionNo: fee.admissionNo,
      classId: fee.classId,
      className: fee.className,
      challanNo,
      month: fee.month,
      year: fee.year,
      issueDate: nowIso.split("T")[0],
      dueDate,
      tuitionFee: fee.tuitionFee,
      admissionFee: fee.admissionFee,
      examFee: fee.examFee,
      otherFee: fee.otherFee,
      discount: fee.discount,
      totalExpected: fee.totalExpected,
      // Written as 0 and never anything else here: a paid amount is always applied right after
      // through recordPaymentServer, the same transactional path a counter payment uses, so a
      // real PaymentDoc (receipt number, date, collector) backs every rupee marked paid — an
      // imported row is never marked PAID merely because the spreadsheet said so.
      paidAmount: 0,
      balanceAmount: fee.totalExpected,
      status: "PENDING",
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      await saveFeeChallanServer(challanDoc);
    } catch (e: any) {
      console.error("Fee import: challan write failed:", e?.message);
      outcomes.push({ rowNumber: r.rowNumber, status: "FAILED", reason: "Database write failed; nothing was saved for this row." });
      continue;
    }

    if (fee.amountPaid > 0) {
      const receiptNo = `RCT-IMP-${fee.year}-${uniqueSuffix}`;
      const paymentDoc: PaymentDoc = {
        id: `pay-${uniqueSuffix}-${Math.random().toString(36).slice(2, 6)}`,
        schoolId,
        challanId,
        studentId: fee.studentId,
        studentName: fee.studentName,
        receiptNo,
        amount: fee.amountPaid,
        paymentDate: fee.paymentDate || nowIso.split("T")[0],
        paymentMode: "BANK_TRANSFER",
        transactionRef: fee.paymentReference || undefined,
        notes: "Imported from spreadsheet",
        collectedBy: authUser.uid,
        createdAt: nowIso,
      };
      try {
        await recordPaymentServer(paymentDoc);
      } catch (e: any) {
        // The challan itself was saved; only the payment failed. Reported as imported (the
        // challan is real and correct) but flagged so the admin can record the payment by hand.
        console.error("Fee import: payment write failed:", e?.message);
        outcomes.push({
          rowNumber: r.rowNumber,
          status: "IMPORTED",
          reason: "Challan created, but the paid amount could not be recorded automatically — add the payment manually.",
          challanId,
          challanNo,
          studentName: fee.studentName,
          month: fee.month,
          year: fee.year,
          totalExpected: fee.totalExpected,
          amountPaid: 0,
        });
        importedCount++;
        continue;
      }
    }

    importedCount++;
    outcomes.push({
      rowNumber: r.rowNumber,
      status: "IMPORTED",
      challanId,
      challanNo,
      studentName: fee.studentName,
      month: fee.month,
      year: fee.year,
      totalExpected: fee.totalExpected,
      amountPaid: fee.amountPaid,
    });
  }

  outcomes.sort((a, b) => a.rowNumber - b.rowNumber);
  const summary = {
    imported: importedCount,
    skipped: outcomes.filter((o) => o.status === "SKIPPED").length,
    failed: outcomes.filter((o) => o.status === "FAILED").length,
  };

  await createAuditLogServer(
    schoolId,
    authUser.uid,
    authUser.email,
    authUser.role,
    "BULK_IMPORT_FEES",
    "FEE",
    "bulk-import",
    `Bulk fee import${typeof body.fileName === "string" ? ` from "${String(body.fileName).slice(0, 120)}"` : ""}: ` +
      `${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed.`
  );

  return NextResponse.json({ success: true, summary, results: outcomes });
}

export async function POST(req: NextRequest) {
  try {
    // ADMIN only; the school is always the session's — nothing in the upload or body can
    // choose a different school.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const contentType = req.headers.get("content-type") || "";
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > FEE_IMPORT_MAX_FILE_BYTES + 64 * 1024) {
      return bad(`The upload is too large (max ${FEE_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
    }
    if (contentType.includes("multipart/form-data")) return await preview(authUser, req);
    // Committing real fee records is a sensitive financial action, gated the same way a manual
    // challan or payment is (requireRecentAuth) — not just the preview step.
    requireRecentAuth(authUser, "import fee records", req);
    return await commit(authUser, req);
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/import");
    if (busy) return busy;
    console.error("Fee import error:", error?.message || error);
    return NextResponse.json({ error: "Fee import failed. No further rows were processed." }, { status: 500 });
  }
}
