import * as XLSX from "xlsx";
import { StudentDoc } from "@/lib/firebase/types";
import { StudentPaymentState, allocateAndApply, buildInitialStudentState, computeDedupKey, AllocationResult } from "@/lib/payment-allocation";
import { getFeeChallansServer, getPaymentsServer, getAdvanceBalanceServer } from "@/lib/firebase/server-db";

const HEADER_ALIASES: Record<string, string> = {
  paymentdate: "paymentDate",
  date: "paymentDate",
  admissionno: "admissionNo",
  admissionnumber: "admissionNo",
  studentname: "studentName",
  name: "studentName",
  class: "className",
  paymentcategory: "category",
  category: "category",
  transactiondetails: "details",
  details: "details",
  notes: "details",
  amount: "amount",
  paymentmethod: "paymentMethod",
  paymentmode: "paymentMethod",
  referencenumber: "referenceNumber",
  reference: "referenceNumber",
  receiptnumber: "referenceNumber",
};

function normalizeHeader(h: string): string {
  return String(h || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function toIsoDate(value: any): string | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split("T")[0];
  }
  const parsed = new Date(String(value));
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return null;
}

const VALID_PAYMENT_MODES = ["CASH", "BANK_TRANSFER", "ONLINE", "CHEQUE"];

function normalizePaymentMode(value: any): "CASH" | "BANK_TRANSFER" | "ONLINE" | "CHEQUE" {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  return (VALID_PAYMENT_MODES.includes(normalized) ? normalized : "CASH") as any;
}

export interface ParsedTransactionRow {
  rowNumber: number;
  paymentDate: string | null;
  admissionNo: string;
  studentName: string;
  className: string;
  category: string;
  details: string;
  amount: number | null;
  paymentMethod: "CASH" | "BANK_TRANSFER" | "ONLINE" | "CHEQUE";
  referenceNumber: string;
}

export function parseTransactionWorkbook(buffer: Buffer): ParsedTransactionRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
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

  const rows: ParsedTransactionRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    if (!line || line.every((cell) => String(cell ?? "").trim() === "")) continue;

    const record: Record<string, any> = {};
    line.forEach((cell, idx) => {
      const field = headerMap[idx];
      if (field) record[field] = cell;
    });

    const amountRaw = record.amount;
    const amount = amountRaw === undefined || amountRaw === null || String(amountRaw).trim() === "" ? null : Number(amountRaw);

    rows.push({
      rowNumber: r + 1,
      paymentDate: toIsoDate(record.paymentDate),
      admissionNo: String(record.admissionNo ?? "").trim(),
      studentName: String(record.studentName ?? "").trim(),
      className: String(record.className ?? "").trim(),
      category: String(record.category ?? "").trim(),
      details: String(record.details ?? "").trim(),
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
      paymentMethod: normalizePaymentMode(record.paymentMethod),
      referenceNumber: String(record.referenceNumber ?? "").trim(),
    });
  }
  return rows;
}

export function buildTransactionTemplate(): Buffer {
  const headers = [
    "PaymentDate",
    "AdmissionNumber",
    "StudentName",
    "Class",
    "Amount",
    "PaymentCategory",
    "TransactionDetails",
    "PaymentMethod",
    "ReferenceNumber",
  ];
  const sample = ["2025-11-05", "STD-2024-001", "Ali Raza", "Grade 5", 6000, "Tuition Fee", "November fee counter payment", "CASH", ""];
  const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "DailyTransactions");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export type TransactionRowAction = "ALLOCATED" | "DUPLICATE_IN_FILE" | "DUPLICATE_EXISTS" | "ERROR";

export interface ClassifiedTransactionRow {
  rowNumber: number;
  admissionNo: string;
  studentId?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  amount?: number;
  paymentDate?: string;
  paymentMethod?: "CASH" | "BANK_TRANSFER" | "ONLINE" | "CHEQUE";
  category?: string;
  details?: string;
  referenceNumber?: string;
  dedupKey?: string;
  action: TransactionRowAction;
  errorReason?: string;
  nameMismatch?: boolean;
  allocation?: AllocationResult;
}

/**
 * Classifies every row, running the allocation simulation in file order so that two rows
 * for the same student in one file correctly see each other's effect (see payment-allocation.ts).
 * `studentStates` is mutated — callers reuse the same map across preview and commit so both
 * stages compute identical allocations from identical starting data.
 */
export function classifyTransactionRows(
  rows: ParsedTransactionRow[],
  students: StudentDoc[],
  studentStates: Map<string, StudentPaymentState>,
  existingDedupKeys: Set<string>,
  schoolId: string
): ClassifiedTransactionRow[] {
  const studentsByAdmissionNo = new Map<string, StudentDoc>();
  students.forEach((s) => studentsByAdmissionNo.set(s.admissionNo.trim().toUpperCase(), s));

  const seenInFile = new Map<string, number[]>(); // dedupKey -> row numbers sharing it

  const results: ClassifiedTransactionRow[] = rows.map((row) => {
    if (!row.admissionNo) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, action: "ERROR", errorReason: "Admission Number is required." };
    }
    const student = studentsByAdmissionNo.get(row.admissionNo.toUpperCase());
    if (!student) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, action: "ERROR", errorReason: "No matching student found for this Admission Number in this school." };
    }
    if (!row.paymentDate) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, studentId: student.id, studentName: student.fullName, action: "ERROR", errorReason: "Payment Date is required and must be a valid date." };
    }
    if (row.amount === null || row.amount <= 0) {
      return { rowNumber: row.rowNumber, admissionNo: row.admissionNo, studentId: student.id, studentName: student.fullName, action: "ERROR", errorReason: "Amount is required and must be a positive number." };
    }

    const dedupKey = computeDedupKey(schoolId, row.admissionNo, row.paymentDate, row.amount, row.category, row.referenceNumber);
    const nameMismatch = row.studentName.length > 0 && row.studentName.trim().toLowerCase() !== student.fullName.trim().toLowerCase();

    const base = {
      rowNumber: row.rowNumber,
      admissionNo: row.admissionNo,
      studentId: student.id,
      studentName: student.fullName,
      classId: student.classId,
      className: student.className,
      amount: row.amount,
      paymentDate: row.paymentDate,
      paymentMethod: row.paymentMethod,
      category: row.category,
      details: row.details,
      referenceNumber: row.referenceNumber || undefined,
      dedupKey,
      nameMismatch,
    };

    if (existingDedupKeys.has(dedupKey)) {
      return { ...base, action: "DUPLICATE_EXISTS", errorReason: "An identical payment has already been imported previously." };
    }

    const priorRows = seenInFile.get(dedupKey);
    if (priorRows) {
      priorRows.push(row.rowNumber);
      return { ...base, action: "DUPLICATE_IN_FILE", errorReason: `Duplicate of row ${priorRows[0]} within this file.` };
    }
    seenInFile.set(dedupKey, [row.rowNumber]);

    let state = studentStates.get(student.id);
    if (!state) {
      state = { challans: [], advanceBalance: 0 };
      studentStates.set(student.id, state);
    }
    const allocation = allocateAndApply(state, row.amount);

    return { ...base, action: "ALLOCATED", allocation };
  });

  return results;
}

/**
 * Fetches real current state only for the students that actually appear in this file
 * (never the whole school) and builds the inputs classifyTransactionRows needs. Called
 * fresh by both the preview and commit routes so commit never trusts a client-held plan.
 */
export async function prepareClassificationContext(
  schoolId: string,
  academicYear: string,
  rows: ParsedTransactionRow[],
  students: StudentDoc[]
): Promise<{ studentStates: Map<string, StudentPaymentState>; existingDedupKeys: Set<string> }> {
  const studentsByAdmissionNo = new Map(students.map((s) => [s.admissionNo.trim().toUpperCase(), s]));
  const matchedStudentIds = new Set<string>();
  rows.forEach((r) => {
    const student = studentsByAdmissionNo.get(r.admissionNo.trim().toUpperCase());
    if (student) matchedStudentIds.add(student.id);
  });

  const studentStates = new Map<string, StudentPaymentState>();
  const existingDedupKeys = new Set<string>();

  await Promise.all(
    Array.from(matchedStudentIds).map(async (studentId) => {
      const [challans, payments, advance] = await Promise.all([
        getFeeChallansServer(schoolId, studentId),
        getPaymentsServer(schoolId, studentId),
        getAdvanceBalanceServer(schoolId, studentId, academicYear),
      ]);
      studentStates.set(studentId, buildInitialStudentState(challans, advance?.balance || 0));
      payments.forEach((p) => {
        if (p.dedupKey) existingDedupKeys.add(p.dedupKey);
      });
    })
  );

  return { studentStates, existingDedupKeys };
}

export function summarizeTransactionRows(rows: ClassifiedTransactionRow[]) {
  return {
    totalRows: rows.length,
    allocatedCount: rows.filter((r) => r.action === "ALLOCATED").length,
    duplicateCount: rows.filter((r) => r.action === "DUPLICATE_IN_FILE" || r.action === "DUPLICATE_EXISTS").length,
    errorCount: rows.filter((r) => r.action === "ERROR").length,
    totalAmount: rows.filter((r) => r.action === "ALLOCATED").reduce((sum, r) => sum + (r.amount || 0), 0),
  };
}
