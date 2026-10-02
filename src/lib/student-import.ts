import { validateDateString, validateStudentDates } from "./date-utils";
import type { ClassDoc, StudentDoc } from "./firebase/types";

/**
 * Bulk student import: header mapping, row normalization and validation. Pure functions only —
 * the API route supplies the school's real classes/students/users and performs the writes.
 *
 * Every row is mapped onto the EXISTING StudentDoc fields; nothing outside that schema is stored.
 */

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Canonical import fields (a subset of StudentDoc plus class/section lookups). */
export type ImportField =
  | "fullName"
  | "firstName"
  | "lastName"
  | "fatherName"
  | "gender"
  | "dob"
  | "admissionDate"
  | "className"
  | "section"
  | "rollNo"
  | "admissionNo"
  | "phone"
  | "guardianName"
  | "guardianRelation"
  | "guardianPhone"
  | "guardianEmail"
  | "email"
  | "address"
  | "bloodGroup"
  | "bForm"
  | "monthlyFee";

function normHeader(h: string): string {
  return h.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const HEADER_ALIASES: Record<ImportField, string[]> = {
  fullName: ["name", "student name", "full name", "student full name", "students name", "student"],
  firstName: ["first name", "firstname", "given name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  fatherName: ["father name", "fathers name", "father", "father full name"],
  gender: ["gender", "sex"],
  dob: ["dob", "date of birth", "birth date", "birthdate", "d o b"],
  admissionDate: ["admission date", "enrollment date", "enrolment date", "date of admission", "joining date"],
  className: ["class", "grade", "class name", "standard"],
  section: ["section", "sec"],
  rollNo: ["roll no", "roll number", "roll", "roll num"],
  admissionNo: ["admission no", "admission number", "student id", "reg no", "registration no", "registration number", "gr no", "admission"],
  phone: ["phone", "contact", "contact number", "mobile", "student phone", "phone number", "cell"],
  guardianName: ["guardian name", "guardian", "parent name"],
  guardianRelation: ["guardian relation", "relation", "relationship"],
  guardianPhone: ["guardian phone", "parent phone", "father phone", "guardian contact", "parent contact", "guardian mobile", "father mobile"],
  guardianEmail: ["guardian email", "parent email", "father email"],
  email: ["email", "student email", "e mail"],
  address: ["address", "home address", "residential address"],
  bloodGroup: ["blood group", "blood"],
  bForm: ["b form", "bform", "b form no", "cnic", "cnic b form", "b form number"],
  monthlyFee: ["monthly fee", "fee", "tuition fee"],
};

const ALIAS_LOOKUP: Map<string, ImportField> = (() => {
  const m = new Map<string, ImportField>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
    for (const a of aliases) m.set(normHeader(a), field);
  }
  return m;
})();

export interface HeaderMapping {
  /** column index -> field */
  columns: Map<number, ImportField>;
  /** header labels that don't map to any student field (reported, never stored) */
  ignored: string[];
}

export function mapHeaders(header: string[]): HeaderMapping {
  const columns = new Map<number, ImportField>();
  const used = new Set<ImportField>();
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

export type ImportRowInput = Partial<Record<ImportField, string>>;

export function rowsToInputs(rows: string[][]): { inputs: ImportRowInput[]; mapping: HeaderMapping } {
  if (rows.length === 0) return { inputs: [], mapping: { columns: new Map(), ignored: [] } };
  const mapping = mapHeaders(rows[0]);
  const inputs = rows.slice(1).map((r) => {
    const input: ImportRowInput = {};
    for (const [i, field] of mapping.columns) {
      const v = (r[i] ?? "").toString().trim();
      if (v) input[field] = v;
    }
    return input;
  });
  return { inputs, mapping };
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (day first, the convention used in
 * Pakistan), "12 Apr 2009" / "12-Apr-2009", and Excel date serial numbers. Returns
 * YYYY-MM-DD, or null when the value isn't an unambiguous real calendar date.
 */
export function parseImportDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (iso) return validateDateString(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`);

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (dmy) return validateDateString(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);

  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(v);
  if (named) {
    const month = MONTHS[named[2].toLowerCase().slice(0, 3)];
    if (!month) return null;
    return validateDateString(`${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`);
  }

  // Excel stores dates as days since 1899-12-30 (whole numbers for date-only cells).
  if (/^\d{4,5}(\.0+)?$/.test(v)) {
    const serial = parseInt(v, 10);
    if (serial >= 1 && serial <= 73050) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return d.toISOString().split("T")[0];
    }
  }
  return null;
}

export function normalizeGender(value: string | undefined): "MALE" | "FEMALE" | null {
  const v = (value || "").trim().toLowerCase();
  if (["m", "male", "boy", "man"].includes(v)) return "MALE";
  if (["f", "female", "girl", "woman"].includes(v)) return "FEMALE";
  return null;
}

/**
 * Keeps a leading "+" and digits. Excel often drops the leading 0 of local mobile numbers
 * (03001234567 -> 3001234567), so 10-digit numbers starting with 3 get it back.
 */
export function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/[^\d\s+()\-.]/.test(v)) return null;
  const plus = v.startsWith("+");
  let digits = v.replace(/\D/g, "");
  if (!plus && digits.length === 10 && digits.startsWith("3")) digits = `0${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strips "class"/"grade" prefixes so "Class 10", "Grade 10" and "10" match the same class. */
function classKey(v: string): string {
  return slug(v.replace(/^\s*(class|grade|std\.?|standard)\s*/i, ""));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export type ImportRowStatus = "VALID" | "WARNING" | "INVALID" | "DUPLICATE";

export interface NormalizedImportStudent {
  fullName: string;
  fatherName: string;
  gender: "MALE" | "FEMALE";
  dob: string | null;
  admissionDate: string | null;
  classId: string;
  className: string;
  section: string;
  academicYear: string;
  rollNo: string | null;
  admissionNo: string | null;
  phone: string | null;
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
  guardianEmail: string | null;
  email: string | null;
  address: string | null;
  bloodGroup: string | null;
  bForm: string | null;
  monthlyFee: number;
}

export interface ImportRowResult {
  /** 1-based row number as seen in the spreadsheet (header is row 1). */
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  input: ImportRowInput;
  student: NormalizedImportStudent | null;
}

export interface ImportContext {
  /** Classes of the importing school's active session — the only valid targets. */
  classes: ClassDoc[];
  /** All of the school's students (all sessions), for duplicate detection. */
  existingStudents: Pick<StudentDoc, "admissionNo" | "fullName" | "fatherName" | "classId" | "dob">[];
  /** Login emails already in use anywhere (normalized). */
  takenEmails: Set<string>;
  now?: number;
}

export interface ImportSummary {
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
}

function resolveClass(
  classes: ClassDoc[],
  rawClass: string | undefined,
  rawSection: string | undefined
): { cls: ClassDoc | null; error?: string } {
  if (!rawClass) return { cls: null, error: "Class is required." };
  let classPart = rawClass;
  let sectionPart = rawSection;
  // "10-A" / "Class 10 A" in the class column when no separate section is given.
  if (!sectionPart) {
    const m = /^(.*?)[\s\-/]+([A-Za-z])$/.exec(rawClass.trim());
    if (m && classes.some((c) => classKey(c.name) === classKey(m[1]))) {
      classPart = m[1];
      sectionPart = m[2];
    }
  }
  const byName = classes.filter((c) => classKey(c.name) === classKey(classPart));
  if (byName.length === 0) {
    return { cls: null, error: `Class "${rawClass}" does not exist in the active academic session.` };
  }
  if (!sectionPart) {
    if (byName.length === 1) return { cls: byName[0] };
    return {
      cls: null,
      error: `Section is required: class "${rawClass}" has sections ${byName.map((c) => c.section).join(", ")}.`,
    };
  }
  const match = byName.find((c) => slug(c.section || "") === slug(sectionPart!));
  if (!match) {
    return {
      cls: null,
      error: `Section "${sectionPart}" does not exist for class "${classPart}" (available: ${byName.map((c) => c.section).join(", ")}).`,
    };
  }
  return { cls: match };
}

function identityKey(name: string, father: string, classId: string): string {
  return `${slug(name)}|${slug(father)}|${classId}`;
}

export function validateImportRows(
  inputs: ImportRowInput[],
  ctx: ImportContext,
  firstDataRowNumber = 2
): { rows: ImportRowResult[]; summary: ImportSummary } {
  const existingAdmission = new Set(ctx.existingStudents.map((s) => slug(s.admissionNo || "")).filter(Boolean));
  const existingIdentity = new Map<string, string | undefined>();
  for (const s of ctx.existingStudents) {
    existingIdentity.set(identityKey(s.fullName || "", s.fatherName || "", s.classId), s.dob);
  }
  const seenAdmission = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const seenIdentity = new Map<string, number>();

  const rows: ImportRowResult[] = inputs.map((input, idx) => {
    const rowNumber = idx + firstDataRowNumber;
    const errors: string[] = [];
    const warnings: string[] = [];
    const duplicates: string[] = [];

    const fullName = (input.fullName || [input.firstName, input.lastName].filter(Boolean).join(" ")).replace(/\s+/g, " ").trim();
    if (!fullName) errors.push("Student name is required.");
    else if (fullName.length > 120) errors.push("Student name is too long.");

    const fatherName = (input.fatherName || "").trim();
    const guardianName = (input.guardianName || fatherName).trim();
    if (!fatherName && !input.guardianName) errors.push("Father's / guardian name is required.");

    const gender = normalizeGender(input.gender);
    if (!input.gender) errors.push("Gender is required (Male/Female).");
    else if (!gender) errors.push(`Gender "${input.gender}" is not recognised (use Male or Female).`);

    let dob: string | null = null;
    if (input.dob) {
      dob = parseImportDate(input.dob);
      if (!dob) errors.push(`Date of birth "${input.dob}" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).`);
    } else {
      warnings.push("Date of birth is missing.");
    }
    let admissionDate: string | null = null;
    if (input.admissionDate) {
      admissionDate = parseImportDate(input.admissionDate);
      if (!admissionDate) errors.push(`Admission date "${input.admissionDate}" is not a valid date.`);
    }
    if (dob !== null || admissionDate !== null) {
      const dates = validateStudentDates({ dob, admissionDate }, ctx.now);
      if (!dates.ok) errors.push(dates.error);
    }

    const { cls, error: classError } = resolveClass(ctx.classes, input.className, input.section);
    if (classError) errors.push(classError);

    let phone: string | null = null;
    if (input.phone) {
      phone = normalizePhone(input.phone);
      if (!phone) errors.push(`Phone "${input.phone}" is not a valid phone number.`);
    }
    let guardianPhone: string | null = null;
    if (input.guardianPhone) {
      guardianPhone = normalizePhone(input.guardianPhone);
      if (!guardianPhone) errors.push(`Guardian phone "${input.guardianPhone}" is not a valid phone number.`);
    } else if (phone) {
      guardianPhone = phone;
      warnings.push("Guardian phone not given; the student phone is used as the guardian contact.");
    } else if (!input.phone) {
      errors.push("Guardian phone is required.");
    }

    const email = input.email ? input.email.trim().toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) errors.push(`Email "${input.email}" is not a valid email address.`);
    const guardianEmail = input.guardianEmail ? input.guardianEmail.trim().toLowerCase() : null;
    if (guardianEmail && !EMAIL_RE.test(guardianEmail)) {
      errors.push(`Guardian email "${input.guardianEmail}" is not a valid email address.`);
    }

    let monthlyFee = 0;
    if (input.monthlyFee) {
      const n = Number(input.monthlyFee.replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) errors.push(`Monthly fee "${input.monthlyFee}" is not a valid amount.`);
      else monthlyFee = n;
    }

    const admissionNo = input.admissionNo ? input.admissionNo.trim() : null;
    if (admissionNo) {
      const key = slug(admissionNo);
      if (existingAdmission.has(key)) duplicates.push(`Admission number "${admissionNo}" already belongs to an existing student.`);
      else if (seenAdmission.has(key)) duplicates.push(`Admission number "${admissionNo}" repeats row ${seenAdmission.get(key)}.`);
      else seenAdmission.set(key, rowNumber);
    }
    if (email && EMAIL_RE.test(email)) {
      if (ctx.takenEmails.has(email)) duplicates.push(`Email "${email}" is already used by another account.`);
      else if (seenEmail.has(email)) duplicates.push(`Email "${email}" repeats row ${seenEmail.get(email)}.`);
      else seenEmail.set(email, rowNumber);
    }
    if (fullName && (fatherName || guardianName) && cls) {
      const key = identityKey(fullName, fatherName || guardianName, cls.id);
      if (existingIdentity.has(key)) {
        const existingDob = existingIdentity.get(key);
        if (!dob || !existingDob || existingDob === dob) {
          duplicates.push(`A student named "${fullName}" with the same father's name is already enrolled in ${cls.name}-${cls.section}.`);
        } else {
          warnings.push(`A student with the same name and father's name exists in ${cls.name}-${cls.section} (different date of birth).`);
        }
      } else if (seenIdentity.has(key)) {
        duplicates.push(`Same student as row ${seenIdentity.get(key)}.`);
      } else {
        seenIdentity.set(key, rowNumber);
      }
    }

    const status: ImportRowStatus =
      errors.length > 0 ? "INVALID" : duplicates.length > 0 ? "DUPLICATE" : warnings.length > 0 ? "WARNING" : "VALID";

    const student: NormalizedImportStudent | null =
      status === "VALID" || status === "WARNING"
        ? {
            fullName,
            fatherName: fatherName || guardianName,
            gender: gender!,
            dob,
            admissionDate,
            classId: cls!.id,
            className: `${cls!.name}-${cls!.section}`,
            section: cls!.section,
            academicYear: cls!.academicYear,
            rollNo: input.rollNo ? input.rollNo.trim() : null,
            admissionNo,
            phone,
            guardianName: guardianName || fatherName,
            guardianRelation: (input.guardianRelation || "Father").trim(),
            guardianPhone: guardianPhone!,
            guardianEmail,
            email,
            address: input.address ? input.address.trim() : null,
            bloodGroup: input.bloodGroup ? input.bloodGroup.trim().toUpperCase() : null,
            bForm: input.bForm ? input.bForm.trim() : null,
            monthlyFee,
          }
        : null;

    return { rowNumber, status, errors: [...errors, ...duplicates], warnings, input, student };
  });

  const summary: ImportSummary = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "VALID").length,
    warnings: rows.filter((r) => r.status === "WARNING").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    duplicates: rows.filter((r) => r.status === "DUPLICATE").length,
  };
  return { rows, summary };
}

/** Required-column check before row validation, so a wrong file fails with one clear message. */
export function missingRequiredColumns(mapping: HeaderMapping): string[] {
  const fields = new Set(mapping.columns.values());
  const missing: string[] = [];
  if (!fields.has("fullName") && !fields.has("firstName")) missing.push("Student Name");
  if (!fields.has("fatherName") && !fields.has("guardianName")) missing.push("Father Name");
  if (!fields.has("gender")) missing.push("Gender");
  if (!fields.has("className")) missing.push("Class");
  if (!fields.has("guardianPhone") && !fields.has("phone")) missing.push("Guardian Phone");
  return missing;
}

export const IMPORT_TEMPLATE_HEADERS = [
  "Student Name",
  "Father Name",
  "Gender",
  "Date of Birth",
  "Admission Date",
  "Class",
  "Section",
  "Roll No",
  "Admission No",
  "Phone",
  "Guardian Phone",
  "Guardian Email",
  "Email",
  "Address",
  "Blood Group",
  "B-Form",
  "Monthly Fee",
];
