import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRecentAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getYearlyFeeLedgerServer,
  saveYearlyFeeLedgerEntryServer,
  saveYearlyLedgerImportBatchServer,
  getYearlyLedgerImportBatchesServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { YearlyFeeLedgerDoc } from "@/lib/firebase/types";
import { neutralizeSpreadsheetFormula, readSpreadsheetUpload, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  YEARLY_LEDGER_IMPORT_MAX_FILE_BYTES,
  YEARLY_LEDGER_IMPORT_MAX_ROWS,
  YearlyLedgerImportField,
  YearlyLedgerImportRowInput,
  YearlyLedgerImportRowResult,
  yearlyLedgerRowsToInputs,
  missingRequiredYearlyLedgerColumns,
  NormalizedYearlyLedgerEntry,
  validateYearlyLedgerImportRows,
} from "@/lib/yearly-fee-ledger-import";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const IMPORT_FIELDS: YearlyLedgerImportField[] = ["admissionNo", "studentName", "monthlyFee", "annualFee"];
const MAX_VALUE_LENGTH = 300;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function isValidAcademicYear(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{4}$/.test(v);
}

/**
 * The school's real data every row is validated against — always fetched fresh, never trusted
 * from an earlier preview. Used identically by preview and by commit (Phase 2 requirement:
 * never trust client-submitted validation results as authoritative).
 */
async function buildContext(schoolId: string, academicYear: string) {
  const [students, existingEntries] = await Promise.all([
    getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true }),
    getYearlyFeeLedgerServer(schoolId, academicYear),
  ]);
  return { students, existingEntries };
}

async function readUploadedRows(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw new Error("No file was uploaded.");
  if (file.size === 0) throw new Error("The uploaded file is empty.");
  if (file.size > YEARLY_LEDGER_IMPORT_MAX_FILE_BYTES) {
    throw new Error(`The file is too large (max ${YEARLY_LEDGER_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`);
  }
  const rows = readSpreadsheetUpload(file.name || "", Buffer.from(await file.arrayBuffer()));
  if (rows.length < 2) throw new Error("The file has no ledger rows (the first row must be the column headers).");
  if (rows.length - 1 > YEARLY_LEDGER_IMPORT_MAX_ROWS) {
    throw new Error(`The file has ${rows.length - 1} rows; import at most ${YEARLY_LEDGER_IMPORT_MAX_ROWS} records per file.`);
  }
  return { fileName: file.name, rows };
}

async function handlePreview(authUser: AuthenticatedUser, req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const academicYear = searchParams.get("academicYear") || "";
  if (!isValidAcademicYear(academicYear)) return bad('A valid academicYear query param (e.g. "2026-2027") is required.');

  let fileName: string;
  let rows: string[][];
  try {
    const parsed = await readUploadedRows(req);
    fileName = parsed.fileName;
    rows = parsed.rows;
  } catch (e: any) {
    if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
    return bad(e?.message || "Failed to parse file.");
  }

  const { inputs, mapping } = yearlyLedgerRowsToInputs(rows);
  const missing = missingRequiredYearlyLedgerColumns(mapping);
  if (missing.length > 0) {
    return bad(`Required column(s) not found: ${missing.join(", ")}. Download the template to see the expected headers.`);
  }

  const ctx = await buildContext(authUser.schoolId, academicYear);
  const result = validateYearlyLedgerImportRows(inputs, ctx);

  return NextResponse.json({
    success: true,
    fileName,
    academicYear,
    mappedColumns: Array.from(mapping.columns.values()),
    ignoredColumns: mapping.ignored,
    summary: result.summary,
    rows: result.rows,
  });
}

function sanitizeInput(raw: unknown): YearlyLedgerImportRowInput {
  const input: YearlyLedgerImportRowInput = {};
  if (!raw || typeof raw !== "object") return input;
  for (const field of IMPORT_FIELDS) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) input[field] = neutralizeSpreadsheetFormula(v.trim()).slice(0, MAX_VALUE_LENGTH);
  }
  return input;
}

type RowOutcome = {
  rowNumber: number;
  status: "CREATED" | "UPDATED" | "UNCHANGED" | "SKIPPED" | "FAILED";
  reason?: string;
  admissionNo?: string;
  studentName?: string;
};

async function handleCommit(authUser: AuthenticatedUser, req: NextRequest) {
  requireRecentAuth(authUser, "import the yearly fee ledger", req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON request payload.");
  }
  const academicYear = body?.academicYear;
  if (!isValidAcademicYear(academicYear)) return bad('A valid academicYear (e.g. "2026-2027") is required in the request body.');
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return bad("No rows were selected for import.");
  if (body.rows.length > YEARLY_LEDGER_IMPORT_MAX_ROWS) return bad(`Import at most ${YEARLY_LEDGER_IMPORT_MAX_ROWS} records at a time.`);
  const allowUpdates = body.allowUpdates === true;

  const submitted = (body.rows as unknown[]).map((r, i) => {
    const rec = (r && typeof r === "object" ? r : {}) as { rowNumber?: unknown; input?: unknown };
    const rowNumber = Number.isInteger(rec.rowNumber) ? (rec.rowNumber as number) : i + 2;
    return { rowNumber, input: sanitizeInput(rec.input) };
  });

  const schoolId = authUser.schoolId;
  const inputs = submitted.map((s) => s.input);
  // Server-side revalidation against fresh data — the client's own claimed row statuses
  // (from an earlier preview) are never trusted here.
  const ctx = await buildContext(schoolId, academicYear);
  const validated = validateYearlyLedgerImportRows(inputs, ctx).rows.map((r, i) => ({ ...r, rowNumber: submitted[i].rowNumber }));

  const outcomes: RowOutcome[] = [];
  const accepted: (YearlyLedgerImportRowResult & { entry: NormalizedYearlyLedgerEntry })[] = [];
  for (const r of validated) {
    if ((r.status === "VALID" || r.status === "WARNING") && r.entry) {
      accepted.push(r as YearlyLedgerImportRowResult & { entry: NormalizedYearlyLedgerEntry });
    } else {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: r.errors.join(" ") || "Row is not valid." });
    }
  }

  const seenThisCommit = new Set<string>();
  const nowIso = new Date().toISOString();
  let created = 0, updated = 0, unchanged = 0;

  for (const r of accepted) {
    const e = r.entry;
    const key = e.admissionNo.trim().toUpperCase();
    if (seenThisCommit.has(key)) {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: `Duplicate of another row in this import for ${e.studentName} (${e.admissionNo}).`, admissionNo: e.admissionNo, studentName: e.studentName });
      continue;
    }
    seenThisCommit.add(key);

    if (r.action === "UPDATE" && !allowUpdates) {
      outcomes.push({
        rowNumber: r.rowNumber,
        status: "SKIPPED",
        reason: `${e.studentName} (${e.admissionNo}) already has a different yearly fee for ${academicYear}. Re-run with "allow updates" to overwrite it.`,
        admissionNo: e.admissionNo,
        studentName: e.studentName,
      });
      continue;
    }
    if (r.action === "UNCHANGED") {
      unchanged++;
      outcomes.push({ rowNumber: r.rowNumber, status: "UNCHANGED", admissionNo: e.admissionNo, studentName: e.studentName });
      continue;
    }

    const doc: YearlyFeeLedgerDoc = {
      id: "",
      schoolId,
      academicYear,
      admissionNo: e.admissionNo,
      studentId: e.studentId,
      studentName: e.studentName,
      classId: e.classId,
      className: e.className,
      monthlyFee: e.monthlyFee,
      annualFee: e.annualFee,
      yearlyExpectedFee: e.yearlyExpectedFee,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: authUser.uid,
      updatedBy: authUser.uid,
    };

    try {
      await saveYearlyFeeLedgerEntryServer(doc);
    } catch (err: any) {
      console.error("Yearly ledger import: write failed:", err?.message);
      outcomes.push({ rowNumber: r.rowNumber, status: "FAILED", reason: "Database write failed; nothing was saved for this row.", admissionNo: e.admissionNo, studentName: e.studentName });
      continue;
    }

    if (r.action === "UPDATE") updated++;
    else created++;
    outcomes.push({ rowNumber: r.rowNumber, status: r.action === "UPDATE" ? "UPDATED" : "CREATED", admissionNo: e.admissionNo, studentName: e.studentName });
  }

  outcomes.sort((a, b) => a.rowNumber - b.rowNumber);
  const skipped = outcomes.filter((o) => o.status === "SKIPPED").length;
  const failed = outcomes.filter((o) => o.status === "FAILED").length;
  const summary = { created, updated, unchanged, skipped, failed };

  const batchId = `ylib-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await saveYearlyLedgerImportBatchServer({
    id: batchId,
    schoolId,
    academicYear,
    fileName: typeof body.fileName === "string" ? String(body.fileName).slice(0, 200) : undefined,
    totalRows: validated.length,
    created,
    updated,
    unchanged,
    skipped: skipped + failed,
    createdBy: authUser.uid,
    createdAt: nowIso,
  });

  await createAuditLogServer(
    schoolId,
    authUser.uid,
    authUser.email,
    authUser.role,
    "BULK_IMPORT_YEARLY_FEE_LEDGER",
    "FEE",
    "bulk-import",
    `Yearly fee ledger import for ${academicYear}${typeof body.fileName === "string" ? ` from "${String(body.fileName).slice(0, 120)}"` : ""}: ` +
      `${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped, ${failed} failed.`
  );

  return NextResponse.json({ success: true, academicYear, batchId, summary, results: outcomes });
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "preview";
    if (action === "preview") return await handlePreview(authUser, req);
    if (action === "commit") return await handleCommit(authUser, req);
    return bad("Invalid action. Expected preview or commit.");
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/yearly-ledger-import");
    if (busy) return busy;
    console.error("Yearly ledger import error:", error?.message || error);
    return NextResponse.json({ error: "Yearly fee ledger import failed. No further rows were processed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || "";
    if (!isValidAcademicYear(academicYear)) return bad('A valid academicYear query param (e.g. "2026-2027") is required.');
    if (searchParams.get("history") === "true") {
      const batches = await getYearlyLedgerImportBatchesServer(authUser.schoolId, academicYear);
      return NextResponse.json({ success: true, academicYear, batches });
    }
    const entries = await getYearlyFeeLedgerServer(authUser.schoolId, academicYear);
    return NextResponse.json({ success: true, academicYear, entries });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/yearly-ledger-import");
    if (busy) return busy;
    console.error("Yearly ledger list error:", error?.message || error);
    return NextResponse.json({ error: "Failed to load the yearly fee ledger." }, { status: 500 });
  }
}
