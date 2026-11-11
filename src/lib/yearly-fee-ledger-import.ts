import type { StudentDoc, YearlyFeeLedgerDoc } from "./firebase/types";

/**
 * Yearly Fee Ledger bulk import: header mapping, row normalization and validation.
 * Pure-functions-only (no DB access), mirroring fee-import.ts's existing split: the API route
 * supplies the school's real students/existing ledger entries and does the writes.
 *
 * This records EXPECTED fee only (monthly fee -> yearly expected = monthly*12 + annual). It
 * must never be confused with Daily Import (actual received payments, transaction-import.ts):
 * this file never looks at FeeChallanDoc/PaymentDoc and never computes a Paid/Unpaid status.
 */

export const YEARLY_LEDGER_IMPORT_MAX_ROWS = 2000;
export const YEARLY_LEDGER_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export type YearlyLedgerImportField = "admissionNo" | "studentName" | "monthlyFee" | "annualFee";

function normHeader(h: string): string {
  return h.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<YearlyLedgerImportField, string[]> = {
  admissionNo: ["admission no", "admission number", "admission id", "student id", "reg no", "registration no", "gr no"],
  studentName: ["student name", "name", "full name", "student"],
  monthlyFee: ["monthly fee", "monthly tuition fee", "tuition fee", "fee"],
  annualFee: ["annual fee", "annual charges", "yearly fee", "yearly charges"],
};

const ALIAS_LOOKUP: Map<string, YearlyLedgerImportField> = (() => {
  const m = new Map<string, YearlyLedgerImportField>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [YearlyLedgerImportField, string[]][]) {
    for (const a of aliases) m.set(normHeader(a), field);
  }
  return m;
})();

export interface YearlyLedgerHeaderMapping {
  columns: Map<number, YearlyLedgerImportField>;
  ignored: string[];
}

export function mapYearlyLedgerHeaders(header: string[]): YearlyLedgerHeaderMapping {
  const columns = new Map<number, YearlyLedgerImportField>();
  const used = new Set<YearlyLedgerImportField>();
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

export type YearlyLedgerImportRowInput = Partial<Record<YearlyLedgerImportField, string>>;

export function yearlyLedgerRowsToInputs(
  rows: string[][]
): { inputs: YearlyLedgerImportRowInput[]; mapping: YearlyLedgerHeaderMapping } {
  if (rows.length === 0) return { inputs: [], mapping: { columns: new Map(), ignored: [] } };
  const mapping = mapYearlyLedgerHeaders(rows[0]);
  const inputs = rows.slice(1).map((r) => {
    const input: YearlyLedgerImportRowInput = {};
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

export type YearlyLedgerImportRowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";
export type YearlyLedgerImportAction = "NEW" | "UPDATE" | "UNCHANGED";

export interface NormalizedYearlyLedgerEntry {
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  className: string;
  monthlyFee: number;
  annualFee: number;
  yearlyExpectedFee: number;
}

export interface YearlyLedgerImportRowResult {
  rowNumber: number;
  status: YearlyLedgerImportRowStatus;
  action: YearlyLedgerImportAction | null;
  errors: string[];
  warnings: string[];
  input: YearlyLedgerImportRowInput;
  entry: NormalizedYearlyLedgerEntry | null;
}

export interface YearlyLedgerImportContext {
  students: Pick<StudentDoc, "id" | "admissionNo" | "fullName" | "classId" | "className" | "status">[];
  existingEntries: Pick<YearlyFeeLedgerDoc, "admissionNo" | "monthlyFee" | "annualFee">[];
}

export interface YearlyLedgerImportSummary {
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  totalMonthlyExpected: number;
  totalYearlyExpected: number;
}

export function yearlyExpectedFeeFor(monthlyFee: number, annualFee: number): number {
  return Math.max(0, monthlyFee * 12 + annualFee);
}

export function validateYearlyLedgerImportRows(
  inputs: YearlyLedgerImportRowInput[],
  ctx: YearlyLedgerImportContext,
  firstDataRowNumber = 2
): { rows: YearlyLedgerImportRowResult[]; summary: YearlyLedgerImportSummary } {
  const studentByAdmission = new Map<string, (typeof ctx.students)[number][]>();
  for (const s of ctx.students) {
    const key = slug(s.admissionNo || "");
    if (!key) continue;
    const list = studentByAdmission.get(key) || [];
    list.push(s);
    studentByAdmission.set(key, list);
  }
  const existingByAdmission = new Map(ctx.existingEntries.map((e) => [slug(e.admissionNo), e]));
  const seenInFile = new Map<string, number>();

  const rows: YearlyLedgerImportRowResult[] = inputs.map((input, idx) => {
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
    if (student && student.status !== "ACTIVE") {
      warnings.push(`Student ${student.fullName} (${admissionNo}) is not an active student.`);
    }

    const monthlyFee = parseMoney(input.monthlyFee);
    if (!input.monthlyFee) errors.push("Monthly Fee is required.");
    else if (monthlyFee === null) errors.push(`Monthly Fee "${input.monthlyFee}" is not a valid amount.`);

    const annualFee = parseMoney(input.annualFee);
    if (annualFee === null) errors.push(`Annual Fee "${input.annualFee}" is not a valid amount.`);

    let isDuplicateInFile = false;
    if (admissionNo) {
      if (seenInFile.has(admissionKey)) {
        errors.push(`Another row (row ${seenInFile.get(admissionKey)}) already carries this admission number in this file.`);
        isDuplicateInFile = true;
      } else {
        seenInFile.set(admissionKey, rowNumber);
      }
    }

    const status: YearlyLedgerImportRowStatus =
      errors.length > 0 ? (isDuplicateInFile ? "DUPLICATE" : "INVALID") : warnings.length > 0 ? "WARNING" : "VALID";

    const entry: NormalizedYearlyLedgerEntry | null =
      (status === "VALID" || status === "WARNING") && student && monthlyFee !== null && annualFee !== null
        ? {
            studentId: student.id,
            studentName: student.fullName,
            admissionNo: student.admissionNo,
            classId: student.classId,
            className: student.className || "",
            monthlyFee,
            annualFee,
            yearlyExpectedFee: yearlyExpectedFeeFor(monthlyFee, annualFee),
          }
        : null;

    const existing = entry ? existingByAdmission.get(slug(entry.admissionNo)) : undefined;
    const action: YearlyLedgerImportAction | null = !entry
      ? null
      : !existing
        ? "NEW"
        : existing.monthlyFee === entry.monthlyFee && existing.annualFee === entry.annualFee
          ? "UNCHANGED"
          : "UPDATE";

    return { rowNumber, status, action, errors, warnings, input, entry };
  });

  const summary: YearlyLedgerImportSummary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "VALID").length,
    warnings: rows.filter((r) => r.status === "WARNING").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    duplicates: rows.filter((r) => r.status === "DUPLICATE").length,
    newCount: rows.filter((r) => r.action === "NEW").length,
    updateCount: rows.filter((r) => r.action === "UPDATE").length,
    unchangedCount: rows.filter((r) => r.action === "UNCHANGED").length,
    totalMonthlyExpected: rows.reduce((sum, r) => sum + (r.entry?.monthlyFee || 0), 0),
    totalYearlyExpected: rows.reduce((sum, r) => sum + (r.entry?.yearlyExpectedFee || 0), 0),
  };
  return { rows, summary };
}

export function missingRequiredYearlyLedgerColumns(mapping: YearlyLedgerHeaderMapping): string[] {
  const fields = new Set(mapping.columns.values());
  const missing: string[] = [];
  if (!fields.has("admissionNo")) missing.push("Admission No");
  if (!fields.has("monthlyFee")) missing.push("Monthly Fee");
  return missing;
}

export const YEARLY_LEDGER_IMPORT_TEMPLATE_HEADERS = ["Admission No", "Student Name", "Monthly Fee", "Annual Fee"];
