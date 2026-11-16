import type { StudentDoc, YearlyFeeLedgerDoc } from "./firebase/types";

/**
 * Yearly Fee Ledger bulk import: header mapping, row normalization and validation.
 * Pure-functions-only (no DB access), mirroring fee-import.ts's existing split: the API route
 * supplies the school's real students/existing ledger entries and does the writes.
 *
 * This records EXPECTED fee only (monthly fee -> yearly expected = monthly*12 + annual). It
 * must never be confused with Daily Import (actual received payments, transaction-import.ts):
 * this file never looks at FeeChallanDoc/PaymentDoc and never computes a Paid/Unpaid status.
 *
 * Student identification: Student Name is the primary match key (the template leads with it).
 * Class is optional and only used to disambiguate when two+ active students share a name. An
 * Admission No column is still accepted (old files keep working) and, when present, is the
 * strongest signal — it resolves the student directly without needing Name or Class at all. A
 * name with no Admission No and no Class that still matches more than one active student is
 * never silently resolved to either one — it is reported AMBIGUOUS and nothing is written for
 * that row, so a rename/duplicate-name situation can never update the wrong student's fees.
 */

export const YEARLY_LEDGER_IMPORT_MAX_ROWS = 2000;
export const YEARLY_LEDGER_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export type YearlyLedgerImportField = "admissionNo" | "studentName" | "className" | "monthlyFee" | "annualFee";

function normHeader(h: string): string {
  return h.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<YearlyLedgerImportField, string[]> = {
  admissionNo: ["admission no", "admission number", "admission id", "student id", "reg no", "registration no", "gr no"],
  studentName: ["student name", "name", "full name", "student"],
  className: ["class", "class section", "class name", "grade", "grade section"],
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

export type YearlyLedgerImportRowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE" | "AMBIGUOUS";
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
  ambiguous: number;
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  totalMonthlyExpected: number;
  totalYearlyExpected: number;
}

export function yearlyExpectedFeeFor(monthlyFee: number, annualFee: number): number {
  return Math.max(0, monthlyFee * 12 + annualFee);
}

type StudentCandidate = YearlyLedgerImportContext["students"][number];

/** A student's class label as it would appear in an uploaded sheet ("Class 5-A"). */
function studentClassLabel(s: Pick<StudentDoc, "className">): string {
  return (s.className || "").trim();
}

/**
 * Resolves one row's student from Admission No (if given, decisive on its own) or Student Name
 * (optionally narrowed by Class when the name alone is ambiguous). Never guesses: a name that
 * still matches more than one active student after applying Class returns every remaining
 * candidate so the caller can report them, rather than picking one.
 */
function resolveStudent(
  admissionNo: string,
  studentName: string,
  className: string,
  studentByAdmission: Map<string, StudentCandidate[]>,
  studentsByName: Map<string, StudentCandidate[]>
): { student: StudentCandidate | null; candidates: StudentCandidate[]; usedAdmission: boolean } {
  if (admissionNo) {
    const matches = studentByAdmission.get(slug(admissionNo)) || [];
    if (matches.length === 1) return { student: matches[0], candidates: matches, usedAdmission: true };
    return { student: null, candidates: matches, usedAdmission: true };
  }
  const byName = studentsByName.get(slug(studentName)) || [];
  if (byName.length <= 1) return { student: byName[0] || null, candidates: byName, usedAdmission: false };
  // Duplicate names: narrow by class, if given.
  if (className) {
    const classKey = slug(className);
    const narrowed = byName.filter((s) => {
      const label = slug(studentClassLabel(s));
      return label === classKey || label.endsWith(classKey) || classKey.endsWith(label);
    });
    if (narrowed.length === 1) return { student: narrowed[0], candidates: narrowed, usedAdmission: false };
    return { student: null, candidates: narrowed.length > 0 ? narrowed : byName, usedAdmission: false };
  }
  return { student: null, candidates: byName, usedAdmission: false };
}

export function validateYearlyLedgerImportRows(
  inputs: YearlyLedgerImportRowInput[],
  ctx: YearlyLedgerImportContext,
  firstDataRowNumber = 2
): { rows: YearlyLedgerImportRowResult[]; summary: YearlyLedgerImportSummary } {
  const studentByAdmission = new Map<string, StudentCandidate[]>();
  const studentsByName = new Map<string, StudentCandidate[]>();
  for (const s of ctx.students) {
    const admKey = slug(s.admissionNo || "");
    if (admKey) {
      const list = studentByAdmission.get(admKey) || [];
      list.push(s);
      studentByAdmission.set(admKey, list);
    }
    const nameKey = slug(s.fullName || "");
    if (nameKey) {
      const list = studentsByName.get(nameKey) || [];
      list.push(s);
      studentsByName.set(nameKey, list);
    }
  }
  const existingByAdmission = new Map(ctx.existingEntries.map((e) => [slug(e.admissionNo), e]));
  const seenInFile = new Map<string, number>();

  const rows: YearlyLedgerImportRowResult[] = inputs.map((input, idx) => {
    const rowNumber = idx + firstDataRowNumber;
    const errors: string[] = [];
    const warnings: string[] = [];

    const admissionNo = (input.admissionNo || "").trim();
    const studentName = (input.studentName || "").trim();
    const className = (input.className || "").trim();
    let isAmbiguous = false;

    if (!admissionNo && !studentName) {
      errors.push("Student Name (or Admission No) is required to match the student.");
    }

    const { student, candidates, usedAdmission } = resolveStudent(
      admissionNo, studentName, className, studentByAdmission, studentsByName
    );

    if (admissionNo && !studentName && !student) {
      if (candidates.length === 0) errors.push(`No student found with admission number "${admissionNo}".`);
      else errors.push(`Ambiguous: ${candidates.length} students share admission number "${admissionNo}". Fix the student records first.`);
    } else if (!usedAdmission && studentName && !student) {
      if (candidates.length === 0) {
        errors.push(`No student found named "${studentName}"${className ? ` in class "${className}"` : ""}.`);
      } else {
        isAmbiguous = true;
        const list = candidates
          .map((c) => `${c.fullName} (Admission No ${c.admissionNo || "—"}, ${studentClassLabel(c) || "no class on record"})`)
          .join("; ");
        errors.push(
          `Ambiguous: ${candidates.length} students are named "${studentName}"${className ? ` in class "${className}"` : ""} — ${list}. Add the Admission No column, or a more specific Class, to resolve.`
        );
      }
    }

    if (student && admissionNo && studentName) {
      const given = slug(studentName);
      const actual = slug(student.fullName);
      if (given !== actual && !actual.includes(given) && !given.includes(actual)) {
        warnings.push(`Student name "${studentName}" does not match the record for ${admissionNo} (${student.fullName}). The admission number was used.`);
      }
    }
    if (student && student.status !== "ACTIVE") {
      warnings.push(`Student ${student.fullName} (${student.admissionNo || "no admission no"}) is not an active student.`);
    }

    const monthlyFee = parseMoney(input.monthlyFee);
    if (!input.monthlyFee) errors.push("Monthly Fee is required.");
    else if (monthlyFee === null) errors.push(`Monthly Fee "${input.monthlyFee}" is not a valid amount.`);

    const annualFee = parseMoney(input.annualFee);
    if (annualFee === null) errors.push(`Annual Fee "${input.annualFee}" is not a valid amount.`);

    // Duplicate-in-file detection keys on the resolved student id when known (name OR admission
    // no both ultimately resolve to the same real student, so two differently-written rows for
    // the same person are still caught), falling back to the raw admission no when the student
    // couldn't be resolved at all (e.g. two unmatched rows for the same typo'd admission no).
    let isDuplicateInFile = false;
    const dedupeKey = student ? `id:${student.id}` : admissionNo ? `adm:${slug(admissionNo)}` : "";
    if (dedupeKey) {
      if (seenInFile.has(dedupeKey)) {
        errors.push(`Another row (row ${seenInFile.get(dedupeKey)}) already carries this student in this file.`);
        isDuplicateInFile = true;
      } else {
        seenInFile.set(dedupeKey, rowNumber);
      }
    }

    const status: YearlyLedgerImportRowStatus =
      isDuplicateInFile ? "DUPLICATE"
        : isAmbiguous ? "AMBIGUOUS"
        : errors.length > 0 ? "INVALID"
        : warnings.length > 0 ? "WARNING"
        : "VALID";

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
    ambiguous: rows.filter((r) => r.status === "AMBIGUOUS").length,
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
  if (!fields.has("studentName") && !fields.has("admissionNo")) missing.push("Student Name (or Admission No)");
  if (!fields.has("monthlyFee")) missing.push("Monthly Fee");
  return missing;
}

export const YEARLY_LEDGER_IMPORT_TEMPLATE_HEADERS = ["Student Name", "Class", "Monthly Fee", "Annual Fee"];
