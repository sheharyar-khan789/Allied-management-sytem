import { parseImportDate } from "./student-import";
import { feeMonthOf } from "./fee-ledger";
import type { FeeChallanDoc, StudentDoc } from "./firebase/types";

/**
 * Bulk fee-challan import from Excel/CSV: header mapping, row normalization and validation.
 * Mirrors the shape of student-import.ts (same pure-functions-only split: this file never
 * touches the database, the API route supplies the school's real students/challans and does the
 * writes). Every row maps onto the EXISTING FeeChallanDoc fields plus, when a row carries an
 * amount already paid, a PaymentDoc recorded through the same transactional path as a counter
 * payment — never by writing `paidAmount`/`status` directly, so payment history stays real.
 */

export const FEE_IMPORT_MAX_ROWS = 1000;
export const FEE_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export type FeeImportField =
  | "admissionNo"
  | "studentName"
  | "month"
  | "year"
  | "tuitionFee"
  | "admissionFee"
  | "examFee"
  | "otherFee"
  | "discount"
  | "amountPaid"
  | "dueDate"
  | "paymentDate"
  | "paymentReference";

function normHeader(h: string): string {
  return h.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<FeeImportField, string[]> = {
  admissionNo: ["admission no", "admission number", "admission id", "student id", "reg no", "registration no", "gr no"],
  studentName: ["student name", "name", "full name", "student"],
  month: ["month", "fee month", "billing month"],
  year: ["year", "fee year", "billing year"],
  tuitionFee: ["tuition fee", "tuition", "fee", "monthly fee"],
  admissionFee: ["admission fee"],
  examFee: ["exam fee"],
  otherFee: ["other fee", "misc fee", "other charges"],
  discount: ["discount", "concession"],
  amountPaid: ["amount paid", "paid amount", "paid", "amount received"],
  dueDate: ["due date", "challan due date"],
  paymentDate: ["payment date", "date paid", "paid on", "paid date"],
  paymentReference: ["payment reference", "receipt no", "receipt number", "transaction ref", "reference", "reference no"],
};

const ALIAS_LOOKUP: Map<string, FeeImportField> = (() => {
  const m = new Map<string, FeeImportField>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [FeeImportField, string[]][]) {
    for (const a of aliases) m.set(normHeader(a), field);
  }
  return m;
})();

export interface FeeHeaderMapping {
  columns: Map<number, FeeImportField>;
  ignored: string[];
}

export function mapFeeHeaders(header: string[]): FeeHeaderMapping {
  const columns = new Map<number, FeeImportField>();
  const used = new Set<FeeImportField>();
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

export type FeeImportRowInput = Partial<Record<FeeImportField, string>>;

export function feeRowsToInputs(rows: string[][]): { inputs: FeeImportRowInput[]; mapping: FeeHeaderMapping } {
  if (rows.length === 0) return { inputs: [], mapping: { columns: new Map(), ignored: [] } };
  const mapping = mapFeeHeaders(rows[0]);
  const inputs = rows.slice(1).map((r) => {
    const input: FeeImportRowInput = {};
    for (const [i, field] of mapping.columns) {
      const v = (r[i] ?? "").toString().trim();
      if (v) input[field] = v;
    }
    return input;
  });
  return { inputs, mapping };
}

/** Accepts a month name/abbreviation ("Oct", "October") or a 1-12 number ("10"). */
export function parseImportMonth(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{1,2}$/.test(v)) {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 12) {
      const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      return MONTH_NAMES[n - 1];
    }
    return null;
  }
  return feeMonthOf(v);
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
export type FeeImportRowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";

/**
 * No `academicYear` field here: `saveFeeChallanServer` derives it itself (from the matched
 * student's current class, the same rule every other challan is stamped with), so an import
 * always lands in the student's real active session rather than trusting a free-text session
 * value from the sheet.
 */
export interface NormalizedImportFee {
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  className: string;
  month: string;
  year: number;
  dueDate: string | null;
  tuitionFee: number;
  admissionFee: number;
  examFee: number;
  otherFee: number;
  discount: number;
  totalExpected: number;
  amountPaid: number;
  paymentDate: string | null;
  paymentReference: string | null;
}

export interface FeeImportRowResult {
  /** 1-based row number as seen in the spreadsheet (header is row 1). */
  rowNumber: number;
  status: FeeImportRowStatus;
  errors: string[];
  warnings: string[];
  input: FeeImportRowInput;
  fee: NormalizedImportFee | null;
}

export interface FeeImportContext {
  /** Every student of the school (all sessions) — admission numbers are unique across sessions. */
  students: Pick<StudentDoc, "id" | "admissionNo" | "fullName" | "classId" | "className" | "status">[];
  /** Every existing fee challan of the school (all sessions), for duplicate detection. */
  existingChallans: Pick<FeeChallanDoc, "studentId" | "month" | "year">[];
}

export interface FeeImportSummary {
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
}

function challanKey(studentId: string, month: string, year: number): string {
  return `${studentId}|${month}|${year}`;
}

export function validateFeeImportRows(
  inputs: FeeImportRowInput[],
  ctx: FeeImportContext,
  firstDataRowNumber = 2
): { rows: FeeImportRowResult[]; summary: FeeImportSummary } {
  const studentByAdmission = new Map(ctx.students.map((s) => [slug(s.admissionNo || ""), s]));
  const existingKeys = new Set(ctx.existingChallans.map((c) => challanKey(c.studentId, c.month, c.year)));
  const seenInFile = new Map<string, number>();

  const rows: FeeImportRowResult[] = inputs.map((input, idx) => {
    const rowNumber = idx + firstDataRowNumber;
    const errors: string[] = [];
    const warnings: string[] = [];
    const duplicates: string[] = [];

    const admissionNo = (input.admissionNo || "").trim();
    if (!admissionNo) errors.push("Admission No is required to match the student.");
    const student = admissionNo ? studentByAdmission.get(slug(admissionNo)) : undefined;
    if (admissionNo && !student) {
      errors.push(`No student found with admission number "${admissionNo}".`);
    }
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

    const month = parseImportMonth(input.month);
    if (!input.month) errors.push("Month is required.");
    else if (!month) errors.push(`Month "${input.month}" is not recognised (use a month name or 1-12).`);

    let year: number | null = null;
    if (!input.year) errors.push("Year is required.");
    else {
      const y = parseInt(input.year, 10);
      if (!Number.isInteger(y) || y < 2000 || y > 2100 || String(y) !== input.year.trim()) {
        errors.push(`Year "${input.year}" is not a valid 4-digit year.`);
      } else {
        year = y;
      }
    }

    const tuitionFee = parseMoney(input.tuitionFee);
    if (!input.tuitionFee) errors.push("Tuition Fee is required.");
    else if (tuitionFee === null) errors.push(`Tuition Fee "${input.tuitionFee}" is not a valid amount.`);

    const admissionFee = parseMoney(input.admissionFee);
    if (admissionFee === null) errors.push(`Admission Fee "${input.admissionFee}" is not a valid amount.`);
    const examFee = parseMoney(input.examFee);
    if (examFee === null) errors.push(`Exam Fee "${input.examFee}" is not a valid amount.`);
    const otherFee = parseMoney(input.otherFee);
    if (otherFee === null) errors.push(`Other Fee "${input.otherFee}" is not a valid amount.`);
    const discount = parseMoney(input.discount);
    if (discount === null) errors.push(`Discount "${input.discount}" is not a valid amount.`);

    let totalExpected = 0;
    if (tuitionFee !== null && admissionFee !== null && examFee !== null && otherFee !== null && discount !== null) {
      totalExpected = tuitionFee + admissionFee + examFee + otherFee - discount;
      if (totalExpected < 0) {
        errors.push("Discount cannot exceed the total of tuition, admission, exam, and other fees.");
      }
    }

    const amountPaid = parseMoney(input.amountPaid);
    if (amountPaid === null) errors.push(`Amount Paid "${input.amountPaid}" is not a valid amount.`);
    else if (amountPaid > totalExpected) {
      errors.push(`Amount Paid (${amountPaid}) cannot exceed the total expected fee (${totalExpected}).`);
    }

    let dueDate: string | null = null;
    if (input.dueDate) {
      dueDate = parseImportDate(input.dueDate);
      if (!dueDate) errors.push(`Due Date "${input.dueDate}" is not a valid date.`);
    }
    let paymentDate: string | null = null;
    if (input.paymentDate) {
      paymentDate = parseImportDate(input.paymentDate);
      if (!paymentDate) errors.push(`Payment Date "${input.paymentDate}" is not a valid date.`);
    } else if (amountPaid && amountPaid > 0) {
      warnings.push("Payment Date not given; today's date will be used for the recorded payment.");
    }

    if (student && month && year !== null) {
      const key = challanKey(student.id, month, year);
      if (existingKeys.has(key)) {
        duplicates.push(`A fee challan already exists for ${student.fullName} for ${month} ${year}. Re-importing will not change it.`);
      } else if (seenInFile.has(key)) {
        duplicates.push(`Same student/month/year as row ${seenInFile.get(key)}.`);
      } else {
        seenInFile.set(key, rowNumber);
      }
    }

    const status: FeeImportRowStatus =
      errors.length > 0 ? "INVALID" : duplicates.length > 0 ? "DUPLICATE" : warnings.length > 0 ? "WARNING" : "VALID";

    const fee: NormalizedImportFee | null =
      (status === "VALID" || status === "WARNING") && student && month && year !== null
        ? {
            studentId: student.id,
            studentName: student.fullName,
            admissionNo: student.admissionNo,
            classId: student.classId,
            className: student.className || "",
            month,
            year,
            dueDate,
            tuitionFee: tuitionFee!,
            admissionFee: admissionFee!,
            examFee: examFee!,
            otherFee: otherFee!,
            discount: discount!,
            totalExpected,
            amountPaid: amountPaid!,
            paymentDate,
            paymentReference: input.paymentReference ? input.paymentReference.trim().slice(0, 120) : null,
          }
        : null;

    return { rowNumber, status, errors: [...errors, ...duplicates], warnings, input, fee };
  });

  const summary: FeeImportSummary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "VALID").length,
    warnings: rows.filter((r) => r.status === "WARNING").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    duplicates: rows.filter((r) => r.status === "DUPLICATE").length,
  };
  return { rows, summary };
}

export function missingRequiredFeeColumns(mapping: FeeHeaderMapping): string[] {
  const fields = new Set(mapping.columns.values());
  const missing: string[] = [];
  if (!fields.has("admissionNo")) missing.push("Admission No");
  if (!fields.has("month")) missing.push("Month");
  if (!fields.has("year")) missing.push("Year");
  if (!fields.has("tuitionFee")) missing.push("Tuition Fee");
  return missing;
}

export const FEE_IMPORT_TEMPLATE_HEADERS = [
  "Admission No",
  "Student Name",
  "Month",
  "Year",
  "Tuition Fee",
  "Admission Fee",
  "Exam Fee",
  "Other Fee",
  "Discount",
  "Amount Paid",
  "Due Date",
  "Payment Date",
  "Payment Reference",
];
