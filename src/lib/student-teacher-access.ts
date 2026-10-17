import { ClassDoc, SubjectDoc, TeacherDoc } from "@/lib/firebase/types";

export type TeacherAccessReason =
  | { kind: "INCHARGE" }
  | { kind: "SUBJECT"; subjectId: string; subjectName: string }
  | { kind: "ASSIGNED_CLASS" };

export interface TeacherAccessEntry {
  teacherId: string;
  teacherName: string;
  employeeId?: string;
  reasons: TeacherAccessReason[];
}

/**
 * Which teachers can open a student of `classId`, using exactly the rules a teacher session is
 * checked against in academic-access.ts (resolveTeacherAllocation): the class's incharge
 * (`ClassDoc.classTeacherId`), teachers of a subject of the class (`SubjectDoc.teacherId`), and
 * teachers an admin explicitly granted the class (`TeacherDoc.assignedClassIds`). Pure, so the
 * admin view cannot drift from what the teacher-facing queries enforce.
 */
export function teachersWithAccessToClass(
  classId: string,
  teachers: TeacherDoc[],
  subjects: SubjectDoc[],
  classes: ClassDoc[]
): TeacherAccessEntry[] {
  const cls = classes.find((c) => c.id === classId);
  const out = new Map<string, TeacherAccessEntry>();
  const entry = (t: TeacherDoc) => {
    let e = out.get(t.id);
    if (!e) out.set(t.id, (e = { teacherId: t.id, teacherName: t.fullName, employeeId: t.employeeId, reasons: [] }));
    return e;
  };
  const byId = new Map(teachers.map((t) => [t.id, t]));

  const incharge = cls?.classTeacherId ? byId.get(cls.classTeacherId) : undefined;
  if (incharge) entry(incharge).reasons.push({ kind: "INCHARGE" });

  for (const s of subjects) {
    if (s.classId !== classId || !s.teacherId) continue;
    const t = byId.get(s.teacherId);
    if (t) entry(t).reasons.push({ kind: "SUBJECT", subjectId: s.id, subjectName: s.name });
  }

  for (const t of teachers) {
    if ((t.assignedClassIds || []).includes(classId) && cls) entry(t).reasons.push({ kind: "ASSIGNED_CLASS" });
  }

  return Array.from(out.values()).sort((a, b) => a.teacherName.localeCompare(b.teacherName));
}
