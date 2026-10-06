import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  commitStudentImportBatchServer,
  createAuditLogServer,
  getClassesServer,
  getSchoolServer,
  getSchoolSettingsServer,
  getStudentsServer,
  getUsersByEmailsServer,
  STUDENT_IMPORT_BATCH_SIZE,
} from "@/lib/firebase/server-db";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { generateInitialPassword } from "@/lib/password-reset";
import { neutralizeSpreadsheetFormula } from "@/lib/spreadsheet-parser";
import { StudentDoc, UserProfile } from "@/lib/firebase/types";
import { parseCsv, parseXlsx, SheetRows, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  ImportField,
  ImportRowInput,
  ImportRowResult,
  missingRequiredColumns,
  NormalizedImportStudent,
  rowsToInputs,
  validateImportRows,
} from "@/lib/student-import";

export const dynamic = "force-dynamic";

const IMPORT_FIELDS: ImportField[] = [
  "fullName", "firstName", "lastName", "fatherName", "gender", "dob", "admissionDate", "className",
  "section", "rollNo", "admissionNo", "phone", "guardianName", "guardianRelation", "guardianPhone",
  "guardianEmail", "email", "address", "bloodGroup", "bForm", "monthlyFee",
];
const MAX_VALUE_LENGTH = 300;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** The school's real data every row is validated against. Always scoped to the session's school. */
async function buildContext(schoolId: string, inputs: ImportRowInput[]) {
  const emails = inputs.map((i) => (i.email || "").trim().toLowerCase()).filter(Boolean);
  const [classes, existingStudents, takenUsers] = await Promise.all([
    getClassesServer(schoolId),
    getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true }),
    getUsersByEmailsServer(emails),
  ]);
  return { classes, existingStudents, takenEmails: new Set(takenUsers.keys()) };
}

function readUpload(fileName: string, buf: Buffer): SheetRows {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    throw new SpreadsheetParseError(
      "PDF files can't be imported reliably (their tables are positioned text, not rows and columns). " +
        "Open the list in Excel or Google Sheets and upload it as .xlsx or .csv instead."
    );
  }
  if (lower.endsWith(".xlsx")) {
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new SpreadsheetParseError("The file is not a valid .xlsx workbook.");
    return parseXlsx(buf);
  }
  if (lower.endsWith(".csv")) {
    if (buf.includes(0)) throw new SpreadsheetParseError("The file is not a text CSV file.");
    return parseCsv(buf.toString("utf8"));
  }
  if (lower.endsWith(".xls")) {
    throw new SpreadsheetParseError("Old .xls workbooks aren't supported. Save the file as .xlsx or .csv and upload again.");
  }
  throw new SpreadsheetParseError("Unsupported file type. Upload a .csv or .xlsx file.");
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
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    return bad(`The file is too large (max ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
  }

  let rows: SheetRows;
  try {
    rows = readUpload(file.name || "", Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
    throw e;
  }

  if (rows.length < 2) return bad("The file has no student rows (the first row must be the column headers).");
  if (rows.length - 1 > IMPORT_MAX_ROWS) {
    return bad(`The file has ${rows.length - 1} rows; import at most ${IMPORT_MAX_ROWS} students per file.`);
  }

  const { inputs, mapping } = rowsToInputs(rows);
  const missing = missingRequiredColumns(mapping);
  if (missing.length > 0) {
    return bad(`Required column(s) not found: ${missing.join(", ")}. Download the template to see the expected headers.`);
  }

  const ctx = await buildContext(authUser.schoolId, inputs);
  const result = validateImportRows(inputs, ctx);

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
// trusted), then creates the confirmed rows in batches.
// ---------------------------------------------------------------------------
function sanitizeInput(raw: unknown): ImportRowInput {
  const input: ImportRowInput = {};
  if (!raw || typeof raw !== "object") return input;
  for (const field of IMPORT_FIELDS) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) input[field] = neutralizeSpreadsheetFormula(v.trim()).slice(0, MAX_VALUE_LENGTH);
  }
  return input;
}

function emailSlug(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

type RowOutcome = {
  rowNumber: number;
  status: "IMPORTED" | "SKIPPED" | "FAILED";
  reason?: string;
  studentId?: string;
  admissionNo?: string;
  fullName?: string;
  className?: string;
  loginEmail?: string;
  /** Returned once so the admin can hand it to the student; never stored in clear. */
  initialPassword?: string;
};

async function commit(authUser: AuthenticatedUser, req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON request payload.");
  }
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return bad("No rows were selected for import.");
  if (body.rows.length > IMPORT_MAX_ROWS) return bad(`Import at most ${IMPORT_MAX_ROWS} students at a time.`);

  const submitted = (body.rows as unknown[]).map((r, i) => {
    const rec = (r && typeof r === "object" ? r : {}) as { rowNumber?: unknown; input?: unknown };
    const rowNumber = Number.isInteger(rec.rowNumber) ? (rec.rowNumber as number) : i + 2;
    return { rowNumber, input: sanitizeInput(rec.input) };
  });

  const schoolId = authUser.schoolId;
  const inputs = submitted.map((s) => s.input);
  const ctx = await buildContext(schoolId, inputs);
  const validated = validateImportRows(inputs, ctx).rows.map((r, i) => ({ ...r, rowNumber: submitted[i].rowNumber }));

  const outcomes: RowOutcome[] = [];
  const accepted: (ImportRowResult & { student: NormalizedImportStudent })[] = [];
  for (const r of validated) {
    if ((r.status === "VALID" || r.status === "WARNING") && r.student) {
      accepted.push(r as ImportRowResult & { student: NormalizedImportStudent });
    } else {
      outcomes.push({ rowNumber: r.rowNumber, status: "SKIPPED", reason: r.errors.join(" ") || "Row is not valid." });
    }
  }

  // Admission numbers: given ones are kept; the rest continue the school-wide STD-YYYY-NNN
  // sequence from the highest number already issued (same rule as single enrollment).
  const currentYear = new Date().getFullYear();
  let sequence = ctx.existingStudents.reduce((max, st) => {
    const m = /^STD-\d{4}-(\d+)$/.exec(st.admissionNo || "");
    const n = m ? parseInt(m[1], 10) : 0;
    return n > max ? n : max;
  }, 0);
  const usedAdmission = new Set(ctx.existingStudents.map((s) => (s.admissionNo || "").toLowerCase()));
  for (const r of accepted) if (r.student.admissionNo) usedAdmission.add(r.student.admissionNo.toLowerCase());
  const nextAdmissionNo = () => {
    let candidate: string;
    do {
      sequence += 1;
      candidate = `STD-${currentYear}-${sequence.toString().padStart(3, "0")}`;
    } while (usedAdmission.has(candidate.toLowerCase()));
    usedAdmission.add(candidate.toLowerCase());
    return candidate;
  };

  // Login emails: the row's own email, else the same student.first.last@<school domain> pattern
  // as single enrollment. All candidates are checked in batched lookups, not one query per row.
  const [schoolSettings, school] = await Promise.all([getSchoolSettingsServer(schoolId), getSchoolServer(schoolId)]);
  const schoolEmail = schoolSettings?.email || school?.email || authUser.email || "";
  const domain = schoolEmail.includes("@") ? schoolEmail.split("@")[1].trim().toLowerCase() : "alliedschool.edu";

  const planned = accepted.map((r) => {
    const admissionNo = r.student.admissionNo || nextAdmissionNo();
    const parts = r.student.fullName.toLowerCase().split(/\s+/).map(emailSlug).filter(Boolean);
    const base = `student.${parts[0] || "student"}${parts.length > 1 ? `.${parts[parts.length - 1]}` : ""}`;
    const candidates = r.student.email
      ? [r.student.email]
      : [`${base}@${domain}`, `${base}.${emailSlug(admissionNo)}@${domain}`];
    return { row: r, admissionNo, candidates };
  });
  const taken = await getUsersByEmailsServer(planned.flatMap((p) => p.candidates));
  const assigned = new Set<string>();
  const ready: { row: (typeof planned)[number]["row"]; admissionNo: string; loginEmail: string }[] = [];
  for (const p of planned) {
    const loginEmail = p.candidates.find((c) => !taken.has(c) && !assigned.has(c));
    if (!loginEmail) {
      outcomes.push({ rowNumber: p.row.rowNumber, status: "FAILED", reason: "Could not allocate a unique login email." });
      continue;
    }
    assigned.add(loginEmail);
    ready.push({ row: p.row, admissionNo: p.admissionNo, loginEmail });
  }

  // Every imported student gets their own random initial password (returned once, for the
  // admin's "Download login list"). It replaces a shared default ("Student@123", published in the
  // repository) that, with predictable login emails, let any student sign in as any classmate.
  // The work factor is lower than for user-chosen passwords only because these are 120-bit
  // random values (infeasible to brute-force at any cost) and 500 rows must hash in seconds;
  // the password the student sets later uses BCRYPT_COST.
  const IMPORT_INITIAL_PASSWORD_COST = 6;
  const initialPasswords = new Map<number, string>();
  const hashes = new Map<number, string>();
  for (const item of ready) {
    const pwd = generateInitialPassword();
    initialPasswords.set(item.row.rowNumber, pwd);
    hashes.set(item.row.rowNumber, await bcrypt.hash(pwd, IMPORT_INITIAL_PASSWORD_COST));
  }
  const nowIso = new Date().toISOString();
  const today = nowIso.split("T")[0];

  let importedCount = 0;
  for (let i = 0; i < ready.length; i += STUDENT_IMPORT_BATCH_SIZE) {
    const chunk = ready.slice(i, i + STUDENT_IMPORT_BATCH_SIZE).map((item) => {
      const suffix = `${Date.now().toString(36)}${crypto.randomBytes(5).toString("hex")}`;
      const studentId = `std_${suffix}`;
      const uid = `user_std_${suffix}`;
      const s = item.row.student;
      const student: StudentDoc = {
        id: studentId,
        schoolId,
        userId: uid,
        admissionNo: item.admissionNo,
        fullName: s.fullName,
        fatherName: s.fatherName,
        gender: s.gender,
        dob: s.dob || undefined,
        admissionDate: s.admissionDate || today,
        phone: s.phone || s.guardianPhone,
        address: s.address || "Not Provided",
        email: item.loginEmail,
        classId: s.classId,
        className: s.className,
        academicYear: s.academicYear,
        section: s.section,
        rollNo: s.rollNo || "",
        status: "ACTIVE",
        guardianName: s.guardianName,
        guardianPhone: s.guardianPhone,
        guardianRelation: s.guardianRelation,
        guardianEmail: s.guardianEmail || "",
        parentUserIds: [],
        bloodGroup: s.bloodGroup || "Not Specified",
        bForm: s.bForm || undefined,
        monthlyFee: s.monthlyFee,
        discount: 0,
        documents: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const user: UserProfile = {
        uid,
        name: s.fullName,
        email: item.loginEmail,
        role: "STUDENT",
        schoolId,
        studentId,
        status: "ACTIVE",
        passwordHash: hashes.get(item.row.rowNumber)!,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      return { item, student, user };
    });

    // 1. Login accounts for the whole chunk in one Firebase Auth call (bcrypt hash, no
    //    per-student request). Rows Firebase rejects are reported and not written.
    let writable = chunk;
    if (hasAdminCredentials) {
      try {
        const result = await adminAuth.importUsers(
          chunk.map(({ user, student }) => ({
            uid: user.uid,
            email: user.email,
            emailVerified: true,
            displayName: user.name,
            // Firebase's BCRYPT importer, in the widely supported $2a$ form.
            passwordHash: Buffer.from(user.passwordHash!.replace(/^\$2b\$/, "$2a$")),
            customClaims: { role: "STUDENT", schoolId, studentId: student.id },
          })),
          { hash: { algorithm: "BCRYPT" } }
        );
        const failedIdx = new Map(result.errors.map((e) => [e.index, e.error?.message || "Login account could not be created."]));
        for (const [idx, reason] of failedIdx) {
          outcomes.push({ rowNumber: chunk[idx].item.row.rowNumber, status: "FAILED", reason });
        }
        writable = chunk.filter((_c, idx) => !failedIdx.has(idx));
      } catch (e: any) {
        console.error("Bulk import: Firebase Auth importUsers failed:", e?.code || e?.message);
        for (const c of chunk) {
          outcomes.push({ rowNumber: c.item.row.rowNumber, status: "FAILED", reason: "Login accounts could not be created." });
        }
        continue;
      }
    }

    // 2. Student + profile documents in one atomic batch.
    try {
      if (writable.length > 0) {
        await commitStudentImportBatchServer(schoolId, writable.map(({ student, user }) => ({ student, user })));
      }
      for (const { item, student } of writable) {
        importedCount++;
        outcomes.push({
          rowNumber: item.row.rowNumber,
          status: "IMPORTED",
          studentId: student.id,
          admissionNo: student.admissionNo,
          fullName: student.fullName,
          className: student.className,
          loginEmail: student.email,
          initialPassword: initialPasswords.get(item.row.rowNumber),
        });
      }
    } catch (e: any) {
      console.error("Bulk import: Firestore batch failed:", e?.message);
      if (hasAdminCredentials && writable.length > 0) {
        await adminAuth.deleteUsers(writable.map((w) => w.user.uid)).catch(() => undefined);
      }
      for (const { item } of writable) {
        outcomes.push({ rowNumber: item.row.rowNumber, status: "FAILED", reason: "Database write failed; nothing was saved for this row." });
      }
    }
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
    "BULK_IMPORT_STUDENTS",
    "STUDENT",
    "bulk-import",
    `Bulk student import${typeof body.fileName === "string" ? ` from "${String(body.fileName).slice(0, 120)}"` : ""}: ` +
      `${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed.`
  );

  return NextResponse.json({
    success: true,
    summary,
    results: outcomes,
    initialPasswordNote:
      summary.imported > 0
        ? "Each imported student has their own initial password. Use \"Download login list\" now (passwords are shown only once) and ask students to change it after first sign-in."
        : undefined,
  });
}

export async function POST(req: NextRequest) {
  try {
    // ADMIN only; the school is always the session's — nothing in the upload or body can
    // choose a different school.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const contentType = req.headers.get("content-type") || "";
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > IMPORT_MAX_FILE_BYTES + 64 * 1024) {
      return bad(`The upload is too large (max ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
    }
    if (contentType.includes("multipart/form-data")) return await preview(authUser, req);
    return await commit(authUser, req);
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student import error:", error?.message || error);
    return NextResponse.json({ error: "Student import failed. No further rows were processed." }, { status: 500 });
  }
}
