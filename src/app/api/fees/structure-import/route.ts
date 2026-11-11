import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRecentAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getYearlyFeeStructuresServer,
  saveYearlyFeeStructureServer,
  saveFeeStructureImportBatchServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { YearlyFeeStructureDoc } from "@/lib/firebase/types";
import { neutralizeSpreadsheetFormula, readSpreadsheetUpload, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  FEE_STRUCTURE_IMPORT_MAX_FILE_BYTES,
  FEE_STRUCTURE_IMPORT_MAX_ROWS,
  FeeStructureImportField,
  FeeStructureImportRowInput,
  FeeStructureImportRowResult,
  feeStructureRowsToInputs,
  missingRequiredFeeStructureColumns,
  NormalizedFeeStructure,
  validateFeeStructureImportRows,
} from "@/lib/fee-structure-import";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const IMPORT_FIELDS: FeeStructureImportField[] = [
  "admissionNo", "studentName", "className", "monthlyTuitionFee", "annualFee", "admissionFee", "otherCharges", "discount",
];
const MAX_VALUE_LENGTH = 300;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function isValidAcademicYear(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{4}$/.test(v);
}

/** The school's real data every row is validated against, scoped to one academic year. */
async function buildContext(schoolId: string, academicYear: string) {
  const [students, existingStructures] = await Promise.all([
    // Admission numbers stay unique across sessions, so match against every student ever
    // enrolled, not just the active session's roster.
    getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true }),
    getYearlyFeeStructuresServer(schoolId, academicYear),
  ]);
  return { students, existingStructures };
}

// ---------------------------------------------------------------------------
// Preview: parse + validate, nothing is written. The file is read in memory and discarded.
// ---------------------------------------------------------------------------
async function preview(authUser: AuthenticatedUser, req: NextRequest, academicYear: string) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Upload a file using multipart/form-data.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return bad("No file was uploaded.");
  if (file.size === 0) return bad("The uploaded file is empty.");
  if (file.size > FEE_STRUCTURE_IMPORT_MAX_FILE_BYTES) {
    return bad(`The file is too large (max ${FEE_STRUCTURE_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
  }

  let rows;
  try {
    rows = readSpreadsheetUpload(file.name || "", Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
    throw e;
  }

  if (rows.length < 2) return bad("The file has no fee structure rows (the first row must be the column headers).");
  if (rows.length - 1 > FEE_STRUCTURE_IMPORT_MAX_ROWS) {
    return bad(`The file has ${rows.length - 1} rows; import at most ${FEE_STRUCTURE_IMPORT_MAX_ROWS} records per file.`);
  }

  const { inputs, mapping } = feeStructureRowsToInputs(rows);
  const missing = missingRequiredFeeStructureColumns(mapping);
  if (missing.length > 0) {
    return bad(`Required column(s) not found: ${missing.join(", ")}. Download the template to see the expected headers.`);
  }

  const ctx = await buildContext(authUser.schoolId, academicYear);
  const result = validateFeeStructureImportRows(inputs, ctx);

  return NextResponse.json({
    success: true,
    fileName: file.name,
    academicYear,
    mappedColumns: Array.from(mapping.columns.values()),
    ignoredColumns: mapping.ignored,
    summary: result.summary,
    rows: result.rows,
  });
}

// ---------------------------------------------------------------------------
// Commit: re-validates every submitted row against fresh database state, then upserts the
// confirmed yearly fee structure rows. A row whose action is "UPDATE" is skipped unless
// allowUpdates=true was explicitly sent — re-uploading the same file is always safe (NEW/
// UNCHANGED commit on their own), but overwriting an already-set structure needs an explicit decision.
// ---------------------------------------------------------------------------
function sanitizeInput(raw: unknown): FeeStructureImportRowInput {
  const input: FeeStructureImportRowInput = {};
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

async function commit(authUser: AuthenticatedUser, body: any, academicYear: string) {
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return bad("No rows were selected for import.");
  if (body.rows.length > FEE_STRUCTURE_IMPORT_MAX_ROWS) return bad(`Import at most ${FEE_STRUCTURE_IMPORT_MAX_ROWS} records at a time.`);
  const allowUpdates = body.allowUpdates === true;

  const submitted = (body.rows as unknown[]).map((r, i) => {
    const rec = (r && typeof r === "object" ? r : {}) as { rowNumber?: unknown; input?: unknown };
    const rowNumber = Number.isInteger(rec.rowNumber) ? (rec.rowNumber as number) : i + 2;
    return { rowNumber, input: sanitizeInput(rec.input) };
  });

  const schoolId = authUser.schoolId;
  const inputs = submitted.map((s) => s.input);
  const ctx = await buildContext(schoolId, academicYear);
  const validated = validateFeeStructureImportRows(inputs, ctx).rows.map((r, i) => ({ ...r, rowNumber: submitted[i].rowNumber }));

  const outcomes: RowOutcome[] = [];
  const accepted: (FeeStructureImportRowResult & { structure: NormalizedFeeStructure })[] = [];
  for (const r of validated) {
    if ((r.status === "VALID" || r.status === "WARNING") && r.structure) {
      accepted.push(r as FeeStructureImportRowResult & { structure: NormalizedFeeStructure });
    } else {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: r.errors.join(" ") || "Row is not valid." });
    }
  }

  const seenThisCommit = new Set<string>();
  const nowIso = new Date().toISOString();
  let created = 0, updated = 0, unchanged = 0;

  for (const r of accepted) {
    const s = r.structure;
    const key = s.admissionNo.trim().toUpperCase();
    if (seenThisCommit.has(key)) {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: `Duplicate of another row in this import for ${s.studentName} (${s.admissionNo}).`, admissionNo: s.admissionNo, studentName: s.studentName });
      continue;
    }
    seenThisCommit.add(key);

    if (r.action === "UPDATE" && !allowUpdates) {
      outcomes.push({
        rowNumber: r.rowNumber,
        status: "SKIPPED",
        reason: `${s.studentName} (${s.admissionNo}) already has a different structure for ${academicYear}. Re-run with "allow updates" to overwrite it.`,
        admissionNo: s.admissionNo,
        studentName: s.studentName,
      });
      continue;
    }
    if (r.action === "UNCHANGED") {
      unchanged++;
      outcomes.push({ rowNumber: r.rowNumber, status: "UNCHANGED", admissionNo: s.admissionNo, studentName: s.studentName });
      continue;
    }

    const doc: YearlyFeeStructureDoc = {
      id: "",
      schoolId,
      academicYear,
      admissionNo: s.admissionNo,
      studentId: s.studentId,
      studentName: s.studentName,
      classId: s.classId,
      className: s.className,
      monthlyTuitionFee: s.monthlyTuitionFee,
      annualFee: s.annualFee,
      admissionFee: s.admissionFee,
      otherCharges: s.otherCharges,
      discount: s.discount,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: authUser.uid,
      updatedBy: authUser.uid,
      importBatchId: undefined,
    };

    try {
      await saveYearlyFeeStructureServer(doc);
    } catch (e: any) {
      console.error("Fee structure import: write failed:", e?.message);
      outcomes.push({ rowNumber: r.rowNumber, status: "FAILED", reason: "Database write failed; nothing was saved for this row.", admissionNo: s.admissionNo, studentName: s.studentName });
      continue;
    }

    if (r.action === "UPDATE") updated++;
    else created++;
    outcomes.push({ rowNumber: r.rowNumber, status: r.action === "UPDATE" ? "UPDATED" : "CREATED", admissionNo: s.admissionNo, studentName: s.studentName });
  }

  outcomes.sort((a, b) => a.rowNumber - b.rowNumber);
  const skipped = outcomes.filter((o) => o.status === "SKIPPED").length;
  const failed = outcomes.filter((o) => o.status === "FAILED").length;
  const summary = { created, updated, unchanged, skipped, failed };

  const batchId = `fsib-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await saveFeeStructureImportBatchServer({
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
    createdByName: authUser.email,
    createdAt: nowIso,
  });

  await createAuditLogServer(
    schoolId,
    authUser.uid,
    authUser.email,
    authUser.role,
    "BULK_IMPORT_FEE_STRUCTURE",
    "FEE",
    "bulk-import",
    `Yearly fee structure import for ${academicYear}${typeof body.fileName === "string" ? ` from "${String(body.fileName).slice(0, 120)}"` : ""}: ` +
      `${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped, ${failed} failed.`
  );

  return NextResponse.json({ success: true, academicYear, batchId, summary, results: outcomes });
}

export async function POST(req: NextRequest) {
  try {
    // ADMIN only; the school is always the session's — nothing in the upload or body can
    // choose a different school.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const contentType = req.headers.get("content-type") || "";
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > FEE_STRUCTURE_IMPORT_MAX_FILE_BYTES + 64 * 1024) {
      return bad(`The upload is too large (max ${FEE_STRUCTURE_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
    }

    if (contentType.includes("multipart/form-data")) {
      const { searchParams } = new URL(req.url);
      const academicYear = searchParams.get("academicYear") || "";
      if (!isValidAcademicYear(academicYear)) return bad('A valid academicYear query param (e.g. "2026-2027") is required.');
      return await preview(authUser, req, academicYear);
    }

    // Committing real fee-structure records is a sensitive financial action, gated the same way
    // a manual challan or payment is (requireRecentAuth) — not just the preview step.
    requireRecentAuth(authUser, "import yearly fee structures", req);
    let body: any;
    try {
      body = await req.json();
    } catch {
      return bad("Invalid JSON request payload.");
    }
    const academicYear = body?.academicYear;
    if (!isValidAcademicYear(academicYear)) return bad('A valid academicYear (e.g. "2026-2027") is required in the request body.');
    return await commit(authUser, body, academicYear);
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/structure-import");
    if (busy) return busy;
    console.error("Fee structure import error:", error?.message || error);
    return NextResponse.json({ error: "Fee structure import failed. No further rows were processed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || "";
    if (!isValidAcademicYear(academicYear)) return bad('A valid academicYear query param (e.g. "2026-2027") is required.');
    const structures = await getYearlyFeeStructuresServer(authUser.schoolId, academicYear);
    return NextResponse.json({ success: true, academicYear, structures });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/fees/structure-import");
    if (busy) return busy;
    console.error("Fee structure list error:", error?.message || error);
    return NextResponse.json({ error: "Failed to load the yearly fee structure." }, { status: 500 });
  }
}
