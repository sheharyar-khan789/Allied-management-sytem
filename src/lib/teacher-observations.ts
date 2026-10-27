import { TeacherObservationDoc } from "@/lib/firebase/types";

/**
 * Admin evaluation notes about a TEACHER. Kept entirely separate from the student-observation
 * system (`src/lib/exam-results.ts` / `studentObservations` collection) — different collection,
 * different schema, different authorization rules — so the two can never be merged by accident.
 */
export const TEACHER_OBSERVATION_CATEGORIES = [
  "TEACHING_QUALITY",
  "CLASSROOM_MANAGEMENT",
  "PUNCTUALITY",
  "COLLABORATION",
  "PROFESSIONAL_CONDUCT",
  "OTHER",
] as const;

export const TEACHER_OBSERVATION_CATEGORY_LABELS: Record<string, string> = {
  TEACHING_QUALITY: "Teaching quality",
  CLASSROOM_MANAGEMENT: "Classroom management",
  PUNCTUALITY: "Punctuality",
  COLLABORATION: "Collaboration",
  PROFESSIONAL_CONDUCT: "Professional conduct",
  OTHER: "Other",
};

export const TEACHER_OBSERVATION_RATINGS = ["EXCELLENT", "SATISFACTORY", "NEEDS_IMPROVEMENT"] as const;

export const TEACHER_OBSERVATION_RATING_LABELS: Record<string, string> = {
  EXCELLENT: "Excellent",
  SATISFACTORY: "Satisfactory",
  NEEDS_IMPROVEMENT: "Needs improvement",
};

export interface TeacherObservationView {
  id: string;
  teacherId: string;
  teacherName: string;
  authorUid: string;
  authorName: string;
  observationDate: string;
  subjectId: string | null;
  classId: string | null;
  category: string;
  categoryLabel: string;
  rating: string;
  ratingLabel: string;
  title: string;
  note: string;
  academicYear: string;
  createdAt: string;
  updatedAt: string;
  editHistory: { at: string; by: string; byName?: string; previousTitle?: string; previousNote: string }[];
}

export function toTeacherObservationView(o: TeacherObservationDoc): TeacherObservationView {
  return {
    id: o.id,
    teacherId: o.teacherId,
    teacherName: o.teacherName || "",
    authorUid: o.authorUid,
    authorName: o.authorName || "Administration",
    observationDate: o.observationDate,
    subjectId: o.subjectId || null,
    classId: o.classId || null,
    category: o.category,
    categoryLabel: TEACHER_OBSERVATION_CATEGORY_LABELS[o.category] || o.category,
    rating: o.rating,
    ratingLabel: TEACHER_OBSERVATION_RATING_LABELS[o.rating] || o.rating,
    title: o.title || "",
    note: o.note || "",
    academicYear: o.academicYear || "",
    createdAt: o.createdAt,
    updatedAt: o.updatedAt || o.createdAt,
    editHistory: o.editHistory || [],
  };
}

export function sortTeacherObservationsNewestFirst<T extends { observationDate: string; createdAt: string }>(
  list: T[]
): T[] {
  return list
    .slice()
    .sort((a, b) => (b.observationDate || b.createdAt).localeCompare(a.observationDate || a.createdAt));
}
