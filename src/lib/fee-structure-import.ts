import type { StudentDoc, YearlyFeeStructureDoc } from "./firebase/types";

/**
 * Yearly Fee Structure bulk import: header mapping, row normalization and validation.
 * Pure-functions-only, same split as fee-import.ts and student-import.ts: this file never
 * touches the database — the API route supplies the school's real students/existing structures
 * and does the writes. Imports a school's per-student monthly tuition / annual / admission /
 * other charges / discount for ONE academic year; monthly voucher generation (voucher-generation.ts)
 * reads the committed YearlyFeeStructureDoc rows, never the sheet itself, to plan each month's charges.
 */

export const FEE_STRUCTURE_IMPORT_MAX_ROWS = 2000;
export const FEE_STRUCTURE_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export type FeeStructureImportField =
  | "admissionNo"
  | "studentName"
  | "className"
  | "monthlyTuitionFee"
  | "annualFee"
  | "admissionFee"
  | "otherCharges"
  | "discount";

function normHeader(h: string): string {
  return h.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<FeeStructureImportField, string[]> = {
  admissionNo: ["admission no", "admission number", "admission id", "student id", "reg no", "registration no", "gr no"],
  studentName: ["student name", "name", "full name", "student"],
  className: ["class", "class name", "class section", "section"],
  monthlyTuitionFee: ["monthly tuition fee", "monthly fee", "tuition fee", "tuition", "fee"],
  annualFee: ["annual fee", "annual charges", "yearly fee"],
  admissionFee: ["admission fee"],
  otherCharges: ["other charges", "other fee", "misc fee", "recurring charges", "other recurring charges"],
  discount: ["discount", "concession"],
};

const ALIAS_LOOKUP: Map<string, FeeStructureImportField> = (() => {
  const m = new Map<string, FeeStructureImportField>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [FeeStructureImportField, string[]][]) {
    for (const a of aliases) m.set(normHeader(a), field);
  }
  return m;
})();

export interface FeeStructureHeaderMapping {
  columns: Map<number, FeeStructureImportField>;
  ignored: string[];
}

export function mapFeeStructureHeaders(header: string[]): FeeStructureHeaderMapping {
  const columns = new Map<number, FeeStructureImportField>();
  const used = new Set<FeeStructureImportField>();
  const ignored: string[] = [];
  header.forEach((raw, i) => {
    const label = (raw || "").trim();
    if (!label) return;
    const field = ALIAS_LOOKUP.get(normHeader(label));
    if (field && !used.has(field)) {
      columns.set(i, field);
      used.add(field);
    } else {
      ignored.push(label);
    }
  });
  return { columns, ignored };
}

export type FeeStructureImportRowInput = Partial<Record<FeeStructureImportField, string>>;

export function feeStructureRowsToInputs(
  rows: string[][]
): { inputs: FeeStructureImportRowInput[]; mapping: FeeStructureHeaderMapping } {
  if (rows.length === 0) return { inputs: [], mapping: { columns: new Map(), ignored: [] } };
  const mapping = mapFeeStructureHeaders(rows[0]);
  const inputs = rows.slice(1).map((r) => {
    const input: FeeStructureImportRowInput = {};
    for (const [i, field] of mapping.columns) {
      const v = (r[i] ?? "").toString().trim();
      if (v) input[field] = v;
    }
    return input;
  });
  return { inputs, mapping };
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return 0;
  const n = Number(value.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function slug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export type FeeStructureImportRowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";
/** Independent of status: what committing this row would actually do. */
export type FeeStructureImportAction = "NEW" | "UPDATE" | "UNCHANGED";

export interface NormalizedFeeStructure {
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  className: string;
  monthlyTuitionFee: number;
  annualFee: number;
  admissionFee: number;
  otherCharges: number;
  discount: number;
}

export interface FeeStructureImportRowResult {
  /** 1-based row number as seen in the spreadsheet (header is row 1). */
  rowNumber: number;
  status: FeeStructureImportRowStatus;
  action: FeeStructureImportAction | null;
  errors: string[];
  warnings: string[];
  input: FeeStructureImportRowInput;
  structure: NormalizedFeeStructure | null;
  /** Present only when action is "UPDATE", so the preview/commit UI can show old vs new. */
  previousValues: Pick<
    YearlyFeeStructureDoc,
    "monthlyTuitionFee" | "annualFee" | "admissionFee" | "otherCharges" | "discount"
  > | null;
}

export interface FeeStructureImportContext {
  /** Every student of the school (all sessions) — admission numbers are unique across sessions. */
  students: Pick<StudentDoc, "id" | "admissionNo" | "fullName" | "classId" | "className" | "status">[];
  /** This school's existing structures for the academic year being imported, keyed by admissionNo. */
  existingStructures: Pick<
    YearlyFeeStructureDoc,
    "admissionNo" | "monthlyTuitionFee" | "annualFee" | "admissionFee" | "otherCharges" | "discount"
  >[];
}

export interface FeeStructureImportSummary {
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  newCount: number;
  updateCount: number;
  unchangedCount: number;
}

function sameValues(
  a: Pick<NormalizedFeeStructure, "monthlyTuitionFee" | "annualFee" | "admissionFee" | "otherCharges" | "discount">,
  b: Pick<YearlyFeeStructureDoc, "monthlyTuitionFee" | "annualFee" | "admissionFee" | "otherCharges" | "discount">
): boolean {
  return (
    a.monthlyTuitionFee === b.monthlyTuitionFee &&
    a.annualFee === b.annualFee &&
    a.admissionFee === b.admissionFee &&
    a.otherCharges === b.otherCharges &&
    a.discount === b.discount
  );
}

export function validateFeeStructureImportRows(
  inputs: FeeStructureImportRowInput[],
  ctx: FeeStructureImportContext,
  firstDataRowNumber = 2
): { rows: FeeStructureImportRowResult[]; summary: FeeStructureImportSummary } {
  const studentByAdmission = new Map<string, (typeof ctx.students)[number][]>();
  for (const s of ctx.students) {
    const key = slug(s.admissionNo || "");
    if (!key) continue;
    const list = studentByAdmission.get(key) || [];
    list.push(s);
    studentByAdmission.set(key, list);
  }
  const existingByAdmission = new Map(ctx.existingStructures.map((s) => [slug(s.admissionNo), s]));
  const seenInFile = new Map<string, number>();

  const rows: FeeStructureImportRowResult[] = inputs.map((input, idx) => {
    const rowNumber = idx + firstDataRowNumber;
    const errors: string[] = [];
    const warnings: string[] = [];

    const admissionNo = (input.admissionNo || "").trim();
    if (!admissionNo) errors.push("Admission No is required to match the student.");
    const admissionKey = slug(admissionNo);
    const matches = admissionNo ? studentByAdmission.get(admissionKey) || [] : [];
    if (admissionNo && matches.length === 0) {
      errors.push(`No student found with admission number "${admissionNo}".`);
    }
    if (matches.length > 1) {
      errors.push(`Ambiguous: ${matches.length} students share admission number "${admissionNo}". Fix the student records first.`);
    }
    const student = matches.length === 1 ? matches[0] : undefined;

    if (student && input.studentName) {
      const given = slug(input.studentName);
      const actual = slug(student.fullName);
      if (given !== actual && !actual.includes(given) && !given.includes(actual)) {
        warnings.push(`Student name "${input.studentName}" does not match the record for ${admissionNo} (${student.fullName}). The admission number was used.`);
      }
    }
    if (student && input.className) {
      const given = slug(input.className);
      const actual = slug(student.className || "");
      if (actual && given !== actual && !actual.includes(given) && !given.includes(actual)) {
        warnings.push(`Class "${input.className}" does not match ${student.fullName}'s current class (${student.className || "unknown"}).`);
      }
    }
    if (student && student.status !== "ACTIVE") {
      warnings.push(`Student ${student.fullName} (${admissionNo}) is not an active student.`);
    }

    const monthlyTuitionFee = parseMoney(input.monthlyTuitionFee);
    if (!input.monthlyTuitionFee) errors.push("Monthly Tuition Fee is required.");
    else if (monthlyTuitionFee === null) errors.push(`Monthly Tuition Fee "${input.monthlyTuitionFee}" is not a valid amount.`);

    const annualFee = parseMoney(input.annualFee);
    if (annualFee === null) errors.push(`Annual Fee "${input.annualFee}" is not a valid amount.`);
    const admissionFee = parseMoney(input.admissionFee);
    if (admissionFee === null) errors.push(`Admission Fee "${input.admissionFee}" is not a valid amount.`);
    const otherCharges = parseMoney(input.otherCharges);
    if (otherCharges === null) errors.push(`Other Charges "${input.otherCharges}" is not a valid amount.`);
    const discount = parseMoney(input.discount);
    if (discount === null) errors.push(`Discount "${input.discount}" is not a valid amount.`);

    if (
      monthlyTuitionFee !== null &&
      annualFee !== null &&
      admissionFee !== null &&
      otherCharges !== null &&
      discount !== null &&
      discount > monthlyTuitionFee + annualFee + admissionFee + otherCharges
    ) {
      errors.push("Discount cannot exceed the total of tuition, annual, admission, and other charges.");
    }

    let isDuplicateInFile = false;
    if (admissionNo) {
      if (seenInFile.has(admissionKey)) {
        errors.push(`Another row (row ${seenInFile.get(admissionKey)}) already carries this admission number in this file.`);
        isDuplicateInFile = true;
      } else {
        seenInFile.set(admissionKey, rowNumber);
      }
    }

    const status: FeeStructureImportRowStatus =
      errors.length > 0 ? (isDuplicateInFile ? "DUPLICATE" : "INVALID") : warnings.length > 0 ? "WARNING" : "VALID";

    const structure: NormalizedFeeStructure | null =
      (status === "VALID" || status === "WARNING") &&
      student &&
      monthlyTuitionFee !== null &&
      annualFee !== null &&
      admissionFee !== null &&
      otherCharges !== null &&
      discount !== null
        ? {
            studentId: student.id,
            studentName: student.fullName,
            admissionNo: student.admissionNo,
            classId: student.classId,
            className: student.className || "",
            monthlyTuitionFee,
            annualFee,
            admissionFee,
            otherCharges,
            discount,
          }
        : null;

    const existing = structure ? existingByAdmission.get(slug(structure.admissionNo)) : undefined;
    const action: FeeStructureImportAction | null = !structure
      ? null
      : !existing
        ? "NEW"
        : sameValues(structure, existing)
          ? "UNCHANGED"
          : "UPDATE";
    const previousValues = existing
      ? {
          monthlyTuitionFee: existing.monthlyTuitionFee,
          annualFee: existing.annualFee,
          admissionFee: existing.admissionFee,
          otherCharges: existing.otherCharges,
          discount: existing.discount,
        }
      : null;

    return { rowNumber, status, action, errors, warnings, input, structure, previousValues };
  });

  const summary: FeeStructureImportSummary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "VALID").length,
    warnings: rows.filter((r) => r.status === "WARNING").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    duplicates: rows.filter((r) => r.status === "DUPLICATE").length,
    newCount: rows.filter((r) => r.action === "NEW").length,
    updateCount: rows.filter((r) => r.action === "UPDATE").length,
    unchangedCount: rows.filter((r) => r.action === "UNCHANGED").length,
  };
  return { rows, summary };
}

export function missingRequiredFeeStructureColumns(mapping: FeeStructureHeaderMapping): string[] {
  const fields = new Set(mapping.columns.values());
  const missing: string[] = [];
  if (!fields.has("admissionNo")) missing.push("Admission No");
  if (!fields.has("monthlyTuitionFee")) missing.push("Monthly Tuition Fee");
  return missing;
}

/**
 * The full academic year's theoretical expected fee for one student's yearly structure:
 * 12 months of tuition/other charges plus the one-time annual/admission fees, minus 12 months
 * of discount. Used only for the dashboard's "Yearly Expected Fees" figure — never written to
 * any challan, and never confused with what has actually been billed or collected so far.
 */
export function yearlyExpectedFeeFor(
  structure: Pick<YearlyFeeStructureDoc, "monthlyTuitionFee" | "annualFee" | "admissionFee" | "otherCharges" | "discount">
): number {
  const monthly = (structure.monthlyTuitionFee || 0) + (structure.otherCharges || 0) - (structure.discount || 0);
  return Math.max(0, monthly * 12 + (structure.annualFee || 0) + (structure.admissionFee || 0));
}

export const FEE_STRUCTURE_IMPORT_TEMPLATE_HEADERS = [
  "Admission No",
  "Student Name",
  "Class",
  "Monthly Tuition Fee",
  "Annual Fee",
  "Admission Fee",
  "Other Charges",
  "Discount",
];
