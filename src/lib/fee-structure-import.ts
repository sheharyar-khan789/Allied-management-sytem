import * as XLSX from "xlsx";
import { StudentDoc, YearlyFeeStructureDoc, ImportBatchRowResult } from "@/lib/firebase/types";

// Column header aliases -> canonical field. Matched case-insensitively after trimming/stripping spaces.
const HEADER_ALIASES: Record<string, string> = {
  admissionno: "admissionNo",
  admissionnumber: "admissionNo",
  admission_no: "admissionNo",
  studentname: "studentName",
  name: "studentName",
  class: "className",
  section: "section",
  monthlytuitionfee: "monthlyTuitionFee",
  monthlyfee: "monthlyTuitionFee",
  tuitionfee: "monthlyTuitionFee",
  annualfee: "annualFee",
  admissionfee: "admissionFee",
  othercharges: "otherCharges",
  othercharge: "otherCharges",
  recurringcharges: "otherCharges",
  discount: "discount",
  concession: "discount",
  notes: "notes",
  remarks: "notes",
};

function normalizeHeader(h: string): string {
  return String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export interface ParsedFeeStructureRow {
  rowNumber: number; // 1-based, matches spreadsheet row (header = row 1)
  admissionNo: string;
  studentName: string;
  className: string;
  section: string;
  monthlyTuitionFee: number | null;
  annualFee: number;
  admissionFee: number;
  otherCharges: number;
  discount: number;
  notes: string;
  raw: Record<string, any>;
}

export function parseFeeStructureWorkbook(buffer: Buffer, filename: string): ParsedFeeStructureRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  if (grid.length === 0) return [];

  const headerRow = grid[0];
  const headerMap: Record<number, string> = {};
  headerRow.forEach((h, idx) => {
    const canonical = HEADER_ALIASES[normalizeHeader(String(h))];
    if (canonical) headerMap[idx] = canonical;
  });

  const rows: ParsedFeeStructureRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    if (!line || line.every((cell) => String(cell ?? "").trim() === "")) continue; // skip blank rows

    const record: Record<string, any> = {};
    line.forEach((cell, idx) => {
      const field = headerMap[idx];
      if (field) record[field] = cell;
    });

    const toNumberOrNull = (v: any): number | null => {
      if (v === undefined || v === null || String(v).trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const toNumber = (v: any, fallback = 0): number => {
      const n = toNumberOrNull(v);
      return n === null ? fallback : n;
    };

    rows.push({
      rowNumber: r + 1,
      admissionNo: String(record.admissionNo ?? "").trim(),
      studentName: String(record.studentName ?? "").trim(),
      className: String(record.className ?? "").trim(),
      section: String(record.section ?? "").trim(),
      monthlyTuitionFee: toNumberOrNull(record.monthlyTuitionFee),
      annualFee: toNumber(record.annualFee, 0),
      admissionFee: toNumber(record.admissionFee, 0),
      otherCharges: toNumber(record.otherCharges, 0),
      discount: toNumber(record.discount, 0),
      notes: String(record.notes ?? "").trim(),
      raw: record,
    });
  }
  return rows;
}

export function buildFeeStructureTemplate(): Buffer {
  const headers = [
    "AdmissionNumber",
    "StudentName",
    "Class",
    "Section",
    "MonthlyTuitionFee",
    "AnnualFee",
    "AdmissionFee",
    "OtherCharges",
    "Discount",
    "Notes",
  ];
  const sample = ["STD-2024-001", "Ali Raza", "Grade 5", "A", 6000, 12000, 5000, 500, 0, ""];
  const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "YearlyFeeStructure");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export type ClassifiedRowAction = "CREATED" | "UPDATED" | "UNCHANGED" | "ERROR";

export interface ClassifiedFeeStructureRow {
  rowNumber: number;
  admissionNo: string;
  studentId?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  section?: string;
  action: ClassifiedRowAction;
  errorReason?: string;
  nameMismatch?: boolean;
  structure?: {
    monthlyTuitionFee: number;
    annualFee: number;
    admissionFee: number;
    otherCharges: number;
    discount: number;
    notes?: string;
  };
  previousValues?: Record<string, number>;
}

const STRUCTURE_FIELDS = ["monthlyTuitionFee", "annualFee", "admissionFee", "otherCharges", "discount"] as const;

export function classifyFeeStructureRows(
  rows: ParsedFeeStructureRow[],
  students: StudentDoc[],
  existingStructures: Map<string, YearlyFeeStructureDoc>
): ClassifiedFeeStructureRow[] {
  const studentsByAdmissionNo = new Map<string, StudentDoc>();
  students.forEach((s) => studentsByAdmissionNo.set(s.admissionNo.trim().toUpperCase(), s));

  const admissionNoCounts = new Map<string, number>();
  rows.forEach((r) => {
    const key = r.admissionNo.toUpperCase();
    if (!key) return;
    admissionNoCounts.set(key, (admissionNoCounts.get(key) || 0) + 1);
  });

  return rows.map((row): ClassifiedFeeStructureRow => {
    const admissionKey = row.admissionNo.toUpperCase();

    if (!row.admissionNo) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, action: "ERROR", errorReason: "Admission Number is required." };
    }
    if (admissionNoCounts.get(admissionKey)! > 1) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, action: "ERROR", errorReason: "Duplicate Admission Number within this file." };
    }
    const student = studentsByAdmissionNo.get(admissionKey);
    if (!student) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, action: "ERROR", errorReason: "No matching student found for this Admission Number in this school." };
    }
    if (row.monthlyTuitionFee === null) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, studentId: student.id, studentName: student.fullName, action: "ERROR", errorReason: "Monthly Tuition Fee is required and must be a number." };
    }
    if (
      row.monthlyTuitionFee < 0 ||
      row.annualFee < 0 ||
      row.admissionFee < 0 ||
      row.otherCharges < 0 ||
      row.discount < 0
    ) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, studentId: student.id, studentName: student.fullName, action: "ERROR", errorReason: "Fee amounts cannot be negative." };
    }

    const nameMismatch =
      row.studentName.length > 0 &&
      row.studentName.trim().toLowerCase() !== student.fullName.trim().toLowerCase();

    const structure = {
      monthlyTuitionFee: row.monthlyTuitionFee,
      annualFee: row.annualFee,
      admissionFee: row.admissionFee,
      otherCharges: row.otherCharges,
      discount: row.discount,
      notes: row.notes || undefined,
    };

    const existing = existingStructures.get(admissionKey);
    if (!existing) {
      return {
        rowNumber: row.rowNumber,
        admissionNo: row.admissionNo,
        studentId: student.id,
        studentName: student.fullName,
        classId: student.classId,
        className: student.className,
        section: student.section,
        action: "CREATED",
        nameMismatch,
        structure,
      };
    }

    const changed = STRUCTURE_FIELDS.some((f) => Number(existing[f] || 0) !== Number((structure as any)[f] || 0));
    if (!changed) {
      return {
        rowNumber: row.rowNumber,
        admissionNo: row.admissionNo,
        studentId: student.id,
        studentName: student.fullName,
        classId: student.classId,
        className: student.className,
        section: student.section,
        action: "UNCHANGED",
        nameMismatch,
        structure,
      };
    }

    const previousValues: Record<string, number> = {};
    STRUCTURE_FIELDS.forEach((f) => (previousValues[f] = Number(existing[f] || 0)));

    return {
      rowNumber: row.rowNumber,
      admissionNo: row.admissionNo,
      studentId: student.id,
      studentName: student.fullName,
      classId: student.classId,
      className: student.className,
      section: student.section,
      action: "UPDATED",
      nameMismatch,
      structure,
      previousValues,
    };
  });
}

export function summarizeClassifiedRows(rows: ClassifiedFeeStructureRow[]) {
  return {
    totalRows: rows.length,
    createdCount: rows.filter((r) => r.action === "CREATED").length,
    updatedCount: rows.filter((r) => r.action === "UPDATED").length,
    unchangedCount: rows.filter((r) => r.action === "UNCHANGED").length,
    errorCount: rows.filter((r) => r.action === "ERROR").length,
  };
}

export function toImportBatchRowResults(rows: ClassifiedFeeStructureRow[]): ImportBatchRowResult[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    admissionNo: r.admissionNo,
    studentName: r.studentName,
    action: r.action,
    errorReason: r.errorReason,
    previousValues: r.previousValues,
    newValues: r.structure
      ? {
          monthlyTuitionFee: r.structure.monthlyTuitionFee,
          annualFee: r.structure.annualFee,
          admissionFee: r.structure.admissionFee,
          otherCharges: r.structure.otherCharges,
          discount: r.structure.discount,
        }
      : undefined,
  }));
}
