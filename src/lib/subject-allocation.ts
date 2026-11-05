import type { StudentDoc, SubjectDoc } from "./firebase/types";

/**
 * Subject-wise student allocation (Part 12): an elective subject (SubjectDoc.isOptional) is
 * compulsory-equivalent for no one automatically — only the students an Admin has explicitly
 * listed in their own StudentDoc.optionalSubjectIds are eligible for it. A compulsory subject (or
 * one that can't be resolved at all) keeps the existing behavior: every active student of the
 * class is eligible. Used identically by the roster the exams GET route builds and by the marks
 * PUT route's own validation, so a teacher/admin can never save a mark for an ineligible student
 * just because the display happened to be stale.
 */

export function isStudentEligibleForSubject(
  student: Pick<StudentDoc, "optionalSubjectIds">,
  subject: Pick<SubjectDoc, "id" | "isOptional"> | undefined | null
): boolean {
  if (!subject || !subject.isOptional) return true;
  return Boolean(student.optionalSubjectIds?.includes(subject.id));
}

export function eligibleStudentsForSubject<S extends Pick<StudentDoc, "optionalSubjectIds">>(
  students: S[],
  subject: Pick<SubjectDoc, "id" | "isOptional"> | undefined | null
): S[] {
  return students.filter((s) => isStudentEligibleForSubject(s, subject));
}
