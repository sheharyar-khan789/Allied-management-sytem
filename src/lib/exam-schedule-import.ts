import type { ClassDoc, SubjectDoc } from "./firebase/types";
import { parseImportDate } from "./student-import";

/**
 * Bulk exam-schedule import from Excel/CSV: header mapping, row normalization and validation.
 * Mirrors the shape of fee-import.ts (pure functions only; the API route supplies the school's
 * real classes/subjects and does the writes via the existing POST /api/exams `schedules` array —
 * this file never touches the database). One uploaded file describes every class/subject
 * schedule of ONE exam; the exam's own title/term/category/dates are a separate form, not a
 * column in this sheet, since they are the same for every row.
 */

export const EXAM_SCHEDULE_IMPORT_MAX_ROWS = 1000;
export const EXAM_SCHEDULE_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const DEFAULT_SCHEDULE_START_TIME = "09:00";
export const DEFAULT_SCHEDULE_END_TIME = "11:00";

export type ExamScheduleImportField =
  | "className"
  | "subjectName"
  | "examDate"
  | "startTime"
  | "endTime"
  | "totalMarks"
  | "passingMarks";

function normHeader(h: string): string {
  return h.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<ExamScheduleImportField, string[]> = {
  className: ["class", "class name", "class section", "grade", "grade section"],
  subjectName: ["subject", "subject name"],
  examDate: ["exam date", "date", "test date"],
  startTime: ["starting time", "start time", "from time", "time from"],
  endTime: ["ending time", "end time", "to time", "time to"],
  totalMarks: ["total marks", "max marks", "maximum marks", "marks"],
  passingMarks: ["passing marks", "pass marks", "minimum passing marks"],
};

const ALIAS_LOOKUP: Map<string, ExamScheduleImportField> = (() => {
  const m = new Map<string, ExamScheduleImportField>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ExamScheduleImportField, string[]][]) {
    for (const a of aliases) m.set(normHeader(a), field);
  }
  return m;
})();

export interface ScheduleHeaderMapping {
  columns: Map<number, ExamScheduleImportField>;
  ignored: string[];
}

export function mapScheduleHeaders(header: string[]): ScheduleHeaderMapping {
  const columns = new Map<number, ExamScheduleImportField>();
  const used = new Set<ExamScheduleImportField>();
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

export type ScheduleImportRowInput = Partial<Record<ExamScheduleImportField, string>>;

export function scheduleRowsToInputs(rows: string[][]): { inputs: ScheduleImportRowInput[]; mapping: ScheduleHeaderMapping } {
  if (rows.length === 0) return { inputs: [], mapping: { columns: new Map(), ignored: [] } };
  const mapping = mapScheduleHeaders(rows[0]);
  const inputs = rows.slice(1).map((r) => {
    const input: ScheduleImportRowInput = {};
    for (const [i, field] of mapping.columns) {
      const v = (r[i] ?? "").toString().trim();
      if (v) input[field] = v;
    }
    return input;
  });
  return { inputs, mapping };
}

export function missingRequiredScheduleColumns(mapping: ScheduleHeaderMapping): string[] {
  const fields = new Set(mapping.columns.values());
  const missing: string[] = [];
  if (!fields.has("className")) missing.push("Class");
  if (!fields.has("subjectName")) missing.push("Subject Name");
  if (!fields.has("examDate")) missing.push("Exam Date");
  if (!fields.has("totalMarks")) missing.push("Total Marks");
  if (!fields.has("passingMarks")) missing.push("Passing Marks");
  return missing;
}

function slug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "09:00", "9:00 AM", "9am" -> "09:00" (24-hour). null if not recognisable. */
export function parseImportTime(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const ampm = v.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (h < 1 || h > 12 || m > 59) return null;
    if (ampm[3] === "pm" && h !== 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const h24 = v.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

function parseMarks(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

export type ScheduleImportRowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";

export interface NormalizedImportSchedule {
  classId: string;
  className: string;
  /** Empty string when the subject doesn't exist yet for this class/session — the commit step
   *  (POST/PATCH /api/exams) creates a real, permanent, unregistered SubjectDoc for it using
   *  `subjectName`, exactly like an Admin creating one by hand, just without a teacher yet. */
  subjectId: string;
  subjectName: string;
  examDate: string;
  startTime: string;
  endTime: string;
  totalMarks: number;
  passingMarks: number;
}

export interface ScheduleImportRowResult {
  /** 1-based row number as seen in the spreadsheet (header is row 1). */
  rowNumber: number;
  status: ScheduleImportRowStatus;
  errors: string[];
  warnings: string[];
  input: ScheduleImportRowInput;
  schedule: NormalizedImportSchedule | null;
}

export interface ScheduleImportContext {
  classes: Pick<ClassDoc, "id" | "name" | "section" | "numericLevel">[];
  subjects: Pick<SubjectDoc, "id" | "classId" | "name">[];
  /** The exam's own start/end dates — a row dated outside this range is a warning, not an error:
   *  a school may legitimately run one subject slightly outside the nominal window. */
  examStartDate?: string;
  examEndDate?: string;
}

/**
 * Matches a free-text class label against the school's real classes. Accepts either the class's
 * own name ("Class 9", "Class 9-A") or its short numeric-level form ("9", "9-A", "9 A") — the
 * form most admins actually type into a spreadsheet — never a fuzzy/partial match that could
 * silently pick the wrong class.
 *
 * The short numeric-level candidates are derived from digits actually present in the class's OWN
 * name (e.g. "Class 9" -> "9"), never from the stored `numericLevel` field directly: a class whose
 * name has no digits at all (Nursery, KG, Prep) gets an arbitrary fallback numericLevel assigned
 * at creation time (see POST /api/classes: `parseInt(name...) || count`), which can coincidentally
 * equal a genuinely numbered class's real level. Trusting that field here previously made an
 * admin's exact, unambiguous label (e.g. "1-A") wrongly match BOTH "Class 1-A" and a same-level
 * "Nursery-A" purely because of that coincidence.
 */
function matchClass(label: string, classes: ScheduleImportContext["classes"]): Pick<ClassDoc, "id" | "name" | "section">[] {
  const target = slug(label);
  return classes.filter((c) => {
    const section = c.section || "";
    const candidates = [c.name, `${c.name}${section}`, `${c.name} ${section}`, `${c.name}-${section}`];
    const digitsInName = c.name.match(/\d+/)?.[0];
    if (digitsInName) {
      candidates.push(digitsInName, `${digitsInName}${section}`, `${digitsInName} ${section}`, `${digitsInName}-${section}`);
    }
    return candidates.some((candidate) => slug(candidate) === target);
  });
}

export function validateScheduleImportRows(
  inputs: ScheduleImportRowInput[],
  ctx: ScheduleImportContext,
  firstDataRowNumber = 2
): { rows: ScheduleImportRowResult[]; summary: { total: number; valid: number; warnings: number; invalid: number; duplicates: number } } {
  const seenInFile = new Set<string>();

  const rows: ScheduleImportRowResult[] = inputs.map((input, idx) => {
    const rowNumber = idx + firstDataRowNumber;
    const errors: string[] = [];
    const warnings: string[] = [];

    const classLabel = (input.className || "").trim();
    if (!classLabel) errors.push("Class is required.");
    const classMatches = classLabel ? matchClass(classLabel, ctx.classes) : [];
    if (classLabel && classMatches.length === 0) errors.push(`No class found matching "${classLabel}".`);
    if (classLabel && classMatches.length > 1) {
      errors.push(`"${classLabel}" matches more than one class — use the exact class and section (e.g. "9-A").`);
    }
    const cls = classMatches.length === 1 ? classMatches[0] : undefined;

    const subjectLabel = (input.subjectName || "").trim();
    if (!subjectLabel) errors.push("Subject Name is required.");
    let subject: Pick<SubjectDoc, "id" | "classId" | "name"> | undefined;
    // An unmatched subject is NOT an error: the school may run a special test, a temporary
    // examination, or an additional subject that was never registered in Subject Allocation, and
    // teacher assignment is never a precondition for scheduling an exam. It becomes a WARNING —
    // the row still imports, and the commit step creates a real (unregistered) subject for it.
    if (subjectLabel && cls) {
      const subjMatches = ctx.subjects.filter((s) => s.classId === cls.id && slug(s.name) === slug(subjectLabel));
      if (subjMatches.length === 0) {
        warnings.push(`Subject "${subjectLabel}" is not registered for class ${cls.name}-${cls.section}. It will be saved as an unregistered exam subject — assign a teacher or link it to a real subject later.`);
      } else {
        subject = subjMatches[0];
      }
    }

    const examDate = input.examDate ? parseImportDate(input.examDate) : null;
    if (!input.examDate) errors.push("Exam Date is required.");
    else if (!examDate) errors.push(`Exam Date "${input.examDate}" is not a valid date.`);
    else if (ctx.examStartDate && ctx.examEndDate && (examDate < ctx.examStartDate || examDate > ctx.examEndDate)) {
      warnings.push(`Exam Date ${examDate} is outside the exam's own ${ctx.examStartDate} to ${ctx.examEndDate} window.`);
    }

    // Starting Time 09:00 / Ending Time 11:00 when the sheet leaves the cell blank; an explicit
    // value (e.g. 11:30) in the sheet is always honoured over the default.
    const startTime = input.startTime ? parseImportTime(input.startTime) : DEFAULT_SCHEDULE_START_TIME;
    if (input.startTime && !startTime) errors.push(`Starting Time "${input.startTime}" is not a recognisable time.`);
    const endTime = input.endTime ? parseImportTime(input.endTime) : DEFAULT_SCHEDULE_END_TIME;
    if (input.endTime && !endTime) errors.push(`Ending Time "${input.endTime}" is not a recognisable time.`);
    if (startTime && endTime && endTime <= startTime) {
      errors.push(`Ending Time (${endTime}) must be after Starting Time (${startTime}).`);
    }

    const totalMarks = parseMarks(input.totalMarks);
    if (!input.totalMarks) errors.push("Total Marks is required.");
    else if (totalMarks === null || totalMarks <= 0) errors.push(`Total Marks "${input.totalMarks}" must be a positive number.`);

    const passingMarks = parseMarks(input.passingMarks);
    if (!input.passingMarks) errors.push("Passing Marks is required.");
    else if (passingMarks === null || passingMarks < 0) errors.push(`Passing Marks "${input.passingMarks}" must be zero or more.`);
    if (totalMarks !== null && passingMarks !== null && passingMarks > totalMarks) {
      errors.push(`Passing Marks (${passingMarks}) cannot exceed Total Marks (${totalMarks}).`);
    }

    // Duplicate-in-file detection keys on the real subject id when registered, or the
    // normalized subject name when not — either way, two rows scheduling "the same" subject for
    // the same class in one file are caught, not just two rows sharing a real subjectId.
    let isDuplicate = false;
    if (cls && subjectLabel) {
      const key = `${cls.id}|${subject ? subject.id : `name:${slug(subjectLabel)}`}`;
      if (seenInFile.has(key)) {
        errors.push(`Another row already schedules ${subject?.name || subjectLabel} for ${cls.name}-${cls.section} in this file.`);
        isDuplicate = true;
      } else {
        seenInFile.add(key);
      }
    }

    const status: ScheduleImportRowStatus =
      errors.length > 0 ? (isDuplicate ? "DUPLICATE" : "INVALID") : warnings.length > 0 ? "WARNING" : "VALID";

    const schedule: NormalizedImportSchedule | null =
      (status === "VALID" || status === "WARNING") && cls && subjectLabel && examDate && startTime && endTime && totalMarks !== null && passingMarks !== null
        ? {
            classId: cls.id,
            className: `${cls.name}-${cls.section}`,
            subjectId: subject?.id || "",
            subjectName: subject?.name || subjectLabel,
            examDate,
            startTime,
            endTime,
            totalMarks,
            passingMarks,
          }
        : null;

    return { rowNumber, status, errors, warnings, input, schedule };
  });

  const summary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "VALID").length,
    warnings: rows.filter((r) => r.status === "WARNING").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    duplicates: rows.filter((r) => r.status === "DUPLICATE").length,
  };
  return { rows, summary };
}

export const EXAM_SCHEDULE_IMPORT_TEMPLATE_HEADERS = [
  "Class",
  "Subject Name",
  "Exam Date",
  "Starting Time",
  "Ending Time",
  "Total Marks",
  "Passing Marks",
];
