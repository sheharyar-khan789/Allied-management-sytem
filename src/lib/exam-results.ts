/**
 * Grading and result arithmetic shared by every exam/result view: the marks-entry grid (admin
 * and teacher), the result writes in /api/exams, the student dossier, the student portal and the
 * printed report card. Pure functions only (no server imports) so client pages can use the same
 * code for their live preview — previously the grids graded with a hardcoded client-side scale
 * that disagreed with the school's configured one, and each view summed totals its own way.
 */
import type { ExamCategory, ExamResultDoc, SchoolSettingsDoc, StudentObservationDoc } from "@/lib/firebase/types";

export type GradingScale = SchoolSettingsDoc["gradingScale"];

// Used only for a school whose settings carry no scale yet; the same default that
// /api/auth/register and /api/settings write for a new school.
export const DEFAULT_GRADING_SCALE: GradingScale = [
  { minPercentage: 90, grade: "A+", gpa: 4.0 },
  { minPercentage: 80, grade: "A", gpa: 3.7 },
  { minPercentage: 70, grade: "B+", gpa: 3.3 },
  { minPercentage: 60, grade: "B", gpa: 3.0 },
  { minPercentage: 50, grade: "C", gpa: 2.5 },
  { minPercentage: 40, grade: "D", gpa: 2.0 },
  { minPercentage: 0, grade: "F", gpa: 0.0 },
];

export function resolveGradingScale(settings?: Pick<SchoolSettingsDoc, "gradingScale"> | null): GradingScale {
  return settings?.gradingScale?.length ? settings.gradingScale : DEFAULT_GRADING_SCALE;
}

export function gradeFor(percentage: number, scale: GradingScale): { grade: string; gpa: number } {
  const sorted = [...scale].sort((a, b) => b.minPercentage - a.minPercentage);
  const match = sorted.find((s) => percentage >= s.minPercentage) || sorted[sorted.length - 1];
  return match ? { grade: match.grade, gpa: match.gpa } : { grade: "F", gpa: 0 };
}

export interface ComputedSubjectResult {
  percentage: number;
  grade: string;
  gpa: number;
  status: "PASS" | "FAIL";
}

/**
 * Derived fields of one subject result. The percentage is rounded for display/grading as
 * before; pass/fail compares the actual marks with the schedule's passing marks, so 32.6/100
 * with passing 33 is a FAIL (comparing the rounded 33% used to make it a PASS).
 */
export function computeSubjectResult(
  obtainedMarks: number,
  totalMarks: number,
  passingMarks: number,
  scale: GradingScale
): ComputedSubjectResult {
  const total = totalMarks > 0 ? totalMarks : 0;
  const percentage = total > 0 ? Math.round((obtainedMarks / total) * 100) : 0;
  const { grade, gpa } = gradeFor(percentage, scale);
  return { percentage, grade, gpa, status: obtainedMarks >= passingMarks ? "PASS" : "FAIL" };
}

/** Validation of one entered mark against the schedule's maximum. null = valid. */
export function validateObtainedMarks(value: unknown, totalMarks: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Marks must be a number.";
  if (value < 0) return "Marks cannot be negative.";
  if (value > totalMarks) return `Marks cannot exceed the maximum of ${totalMarks}.`;
  return null;
}

export interface ResultsSummary {
  subjects: number;
  totalMarks: number;
  obtainedMarks: number;
  /** One decimal; 0 when nothing is recorded. */
  percentage: number;
  /** Grade of the overall percentage on the school's scale; null when nothing is recorded. */
  grade: string | null;
  /** Mean of the subject GPAs; null when no result carries one. */
  gpa: number | null;
  passed: number;
  failed: number;
}

/** Totals over recorded results only — a subject with no recorded mark is never counted as 0. */
export function summarizeResults(
  results: { obtainedMarks: number; totalMarks: number; gpa?: number | null; status?: string }[],
  scale: GradingScale
): ResultsSummary {
  const totalMarks = results.reduce((s, r) => s + (Number(r.totalMarks) || 0), 0);
  const obtainedMarks = results.reduce((s, r) => s + (Number(r.obtainedMarks) || 0), 0);
  const percentage = totalMarks > 0 ? parseFloat(((obtainedMarks / totalMarks) * 100).toFixed(1)) : 0;
  const gpaValues = results.filter((r) => typeof r.gpa === "number");
  const gpa =
    gpaValues.length > 0
      ? parseFloat((gpaValues.reduce((s, r) => s + (r.gpa || 0), 0) / gpaValues.length).toFixed(2))
      : null;
  return {
    subjects: results.length,
    totalMarks,
    obtainedMarks: parseFloat(obtainedMarks.toFixed(2)),
    percentage,
    grade: results.length > 0 && totalMarks > 0 ? gradeFor(percentage, scale).grade : null,
    gpa,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
  };
}

// ---------------------------------------------------------------------------
// Exam categories & teacher mark-entry permission
// ---------------------------------------------------------------------------

export const EXAM_CATEGORIES: ExamCategory[] = [
  "MONTHLY_TEST",
  "WEEKLY_TEST",
  "FIRST_TERM",
  "SECOND_TERM",
  "MIDTERM",
  "FINAL_TERM",
];

export const EXAM_CATEGORY_LABELS: Record<ExamCategory, string> = {
  MONTHLY_TEST: "Monthly Test",
  WEEKLY_TEST: "Weekly Test",
  FIRST_TERM: "First Term",
  SECOND_TERM: "Second Term",
  MIDTERM: "Midterm",
  FINAL_TERM: "Final Term",
};

export type TeacherMarksPermission = "ALLOWED" | "READ_ONLY";

/**
 * Initial policy (a school can change every one of these in Settings): Monthly and Weekly tests
 * are low-stakes and routinely teacher-entered; First/Second Term and Midterm start allowed but
 * are the ones Admin is expected to actually review per-school; Final Term is read-only for
 * teachers by default since it is usually the one Admin finalizes and controls most tightly.
 */
export const EXAM_CATEGORY_PERMISSION_DEFAULTS: Record<ExamCategory, TeacherMarksPermission> = {
  MONTHLY_TEST: "ALLOWED",
  WEEKLY_TEST: "ALLOWED",
  FIRST_TERM: "ALLOWED",
  SECOND_TERM: "ALLOWED",
  MIDTERM: "ALLOWED",
  FINAL_TERM: "READ_ONLY",
};

/**
 * Whether an allocated TEACHER may currently enter/edit marks for an exam of `category`. An
 * exam with no category (created before this field existed, or deliberately uncategorized) is
 * never category-gated — only the existing allocation/publish checks apply. ADMIN is never
 * subject to this; it only restricts TEACHER writes, enforced in /api/exams PUT, not just hidden
 * in the UI.
 */
export function resolveTeacherMarksPermission(
  category: ExamCategory | undefined,
  settings?: Pick<SchoolSettingsDoc, "examCategoryPermissions"> | null
): TeacherMarksPermission {
  if (!category) return "ALLOWED";
  return settings?.examCategoryPermissions?.[category] || EXAM_CATEGORY_PERMISSION_DEFAULTS[category];
}

/**
 * Subject name of a result. Results written before this fix carry no subjectName (the marks
 * route never stored it), so it is resolved from the subject records at read time.
 */
export function resultSubjectName(
  result: Pick<ExamResultDoc, "subjectId" | "subjectName">,
  subjectsById: Map<string, { name: string; code?: string }>
): { name: string; code: string } {
  const subject = subjectsById.get(result.subjectId);
  return { name: result.subjectName || subject?.name || "", code: subject?.code || "" };
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export const OBSERVATION_CATEGORIES = [
  "ACADEMIC",
  "CONDUCT",
  "BEHAVIORAL",
  "LEADERSHIP",
  "PARTICIPATION",
  "ATTENDANCE",
  "SPORTS",
] as const;

export const OBSERVATION_CATEGORY_LABELS: Record<string, string> = {
  ACADEMIC: "Academic",
  CONDUCT: "Behavior & Conduct",
  BEHAVIORAL: "Behavior",
  LEADERSHIP: "Leadership & Citizenship",
  PARTICIPATION: "Classroom Participation",
  ATTENDANCE: "Attendance",
  SPORTS: "Sports",
};

export const CONDUCT_RATINGS = ["POSITIVE", "NEUTRAL", "NEEDS_IMPROVEMENT"] as const;

export const CONDUCT_RATING_LABELS: Record<string, string> = {
  POSITIVE: "Positive",
  NEUTRAL: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};

export interface ObservationView {
  id: string;
  studentId: string;
  /**
   * The student's name as snapshotted when the note was written. Empty for a handful of
   * records saved before this field was stored — callers resolve those from the current
   * student record (see `resolveObservationStudentNames` in server-db) rather than ever
   * showing a blank or, worse, another student's name.
   */
  studentName: string;
  /** Short heading; empty for records saved before titles were stored separately. */
  title: string;
  /** The written observation text exactly as saved. */
  note: string;
  category: string;
  categoryLabel: string;
  /** Conduct rating (stored as `sentiment`). */
  sentiment: string;
  conductLabel: string;
  examId: string | null;
  examName: string;
  teacherId: string;
  teacherName: string;
  academicYear: string;
  date: string;
  updatedAt: string;
  /** Prior (title, note) pairs, oldest first; empty when the note has never been edited. */
  editHistory: { at: string; by: string; byName?: string; previousTitle?: string; previousNote: string }[];
}

/**
 * The one shape every screen renders. Older records stored the title and text merged into
 * `note` ("Title: text") with no separate `title`; those are shown with their full saved text
 * rather than guessing where the title ended.
 */
export function toObservationView(
  o: StudentObservationDoc,
  examNameById?: Map<string, string>
): ObservationView {
  return {
    id: o.id,
    studentId: o.studentId,
    studentName: o.studentName || "",
    title: o.title || "",
    note: o.note || "",
    category: o.category,
    categoryLabel: OBSERVATION_CATEGORY_LABELS[o.category] || o.category,
    sentiment: o.sentiment,
    conductLabel: CONDUCT_RATING_LABELS[o.sentiment] || o.sentiment || "",
    examId: o.examId || null,
    examName: (o.examId && examNameById?.get(o.examId)) || "",
    teacherId: o.teacherId,
    teacherName: o.teacherName || "Faculty",
    academicYear: o.academicYear || "",
    date: o.createdAt,
    updatedAt: o.updatedAt || o.createdAt,
    editHistory: o.editHistory || [],
  };
}

export function sortObservationsNewestFirst<T extends { date: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
