import type { StudentDoc } from "./firebase/types";

/**
 * Bulk student document import (Part 13): each uploaded file's name must start with the
 * student's own Student ID (admissionNo) - "STD-2026-001.pdf" or "STD-2026-001_certificate.pdf"
 * - optionally followed by "_" and any description. Matching is by that exact id only, never by
 * name. A file whose id doesn't resolve to exactly one active student in this school is rejected
 * and reported; nothing is ever assigned to a guessed or "closest" student.
 */

export const DOC_IMPORT_MAX_FILES = 200;

function slug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The candidate Student ID encoded in a filename: everything before "_", or the whole
 *  (extension-stripped) name if there is no "_". */
export function studentIdFromFilename(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, "");
  const idx = base.indexOf("_");
  return (idx > 0 ? base.slice(0, idx) : base).trim();
}

export type DocImportRowStatus = "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "DUPLICATE" | "INVALID";

export interface DocImportRow {
  fileName: string;
  studentId: string;
  status: DocImportRowStatus;
  error?: string;
  student?: { id: string; fullName: string; admissionNo: string };
}

export function resolveDocImportRows(
  fileNames: string[],
  students: Pick<StudentDoc, "id" | "admissionNo" | "fullName" | "status">[]
): DocImportRow[] {
  const byAdmission = new Map<string, Pick<StudentDoc, "id" | "admissionNo" | "fullName" | "status">[]>();
  for (const s of students) {
    const key = slug(s.admissionNo || "");
    if (!key) continue;
    const list = byAdmission.get(key) || [];
    list.push(s);
    byAdmission.set(key, list);
  }

  const seenThisBatch = new Set<string>();
  return fileNames.map((fileName) => {
    const studentId = studentIdFromFilename(fileName);
    if (!studentId) {
      return { fileName, studentId: "", status: "INVALID", error: "Could not read a Student ID from this file name." };
    }
    const key = slug(studentId);
    const matches = byAdmission.get(key) || [];
    if (matches.length === 0) {
      return { fileName, studentId, status: "UNMATCHED", error: `No student found with Student ID "${studentId}".` };
    }
    if (matches.length > 1) {
      return { fileName, studentId, status: "AMBIGUOUS", error: `Student ID "${studentId}" matches more than one student record.` };
    }
    const student = matches[0];
    if (student.status !== "ACTIVE") {
      return { fileName, studentId, status: "UNMATCHED", error: `Student "${studentId}" is not an active student.` };
    }
    const batchKey = `${student.id}|${fileName}`;
    if (seenThisBatch.has(batchKey)) {
      return { fileName, studentId, status: "DUPLICATE", error: "The same file name for the same student appears more than once in this upload." };
    }
    seenThisBatch.add(batchKey);
    return { fileName, studentId, status: "MATCHED", student: { id: student.id, fullName: student.fullName, admissionNo: student.admissionNo } };
  });
}
