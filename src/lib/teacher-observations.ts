import { TeacherObservationDoc } from "@/lib/firebase/types";

/**
 * Admin-written observations about a teacher (see TeacherObservationDoc). Pure helpers shared by
 * /api/teacher-observations and the admin/teacher screens.
 */

export const TEACHER_OBSERVATION_CATEGORIES = [
  "CLASSROOM_PRACTICE",
  "LESSON_PLANNING",
  "STUDENT_ENGAGEMENT",
  "PROFESSIONAL_CONDUCT",
  "PUNCTUALITY",
  "COMMUNICATION",
  "GENERAL",
] as const;

export type TeacherObservationCategory = (typeof TEACHER_OBSERVATION_CATEGORIES)[number];

export const TEACHER_OBSERVATION_CATEGORY_LABELS: Record<string, string> = {
  CLASSROOM_PRACTICE: "Classroom Practice",
  LESSON_PLANNING: "Lesson Planning",
  STUDENT_ENGAGEMENT: "Student Engagement",
  PROFESSIONAL_CONDUCT: "Professional Conduct",
  PUNCTUALITY: "Punctuality & Attendance",
  COMMUNICATION: "Communication",
  GENERAL: "General",
};

export interface TeacherObservationView {
  id: string;
  teacherId: string;
  teacherName: string;
  category: string;
  categoryLabel: string;
  title: string;
  note: string;
  authorName: string;
  date: string;
  updatedAt: string;
  /** Prior versions, oldest first — admins only. The observed teacher sees the current text, not
   * earlier drafts of a note about them (the history is an administrative audit trail). */
  editHistory: { at: string; by?: string; byName?: string; previousTitle?: string; previousNote: string }[];
}

export function toTeacherObservationView(
  o: TeacherObservationDoc,
  viewerRole: "ADMIN" | "TEACHER"
): TeacherObservationView {
  return {
    id: o.id,
    teacherId: o.teacherId,
    teacherName: o.teacherName || "",
    category: o.category,
    categoryLabel: TEACHER_OBSERVATION_CATEGORY_LABELS[o.category] || o.category,
    title: o.title || "",
    note: o.note || "",
    authorName: o.authorName || "Administration",
    date: o.createdAt,
    updatedAt: o.updatedAt || o.createdAt,
    editHistory: viewerRole === "ADMIN" ? o.editHistory || [] : [],
  };
}
