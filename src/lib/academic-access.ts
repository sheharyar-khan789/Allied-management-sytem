import { AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  getFeeChallanByIdServer,
  getStudentByIdServer,
  getSubjectByIdServer,
  getSubjectsServer,
  getTeacherByIdServer,
  getUserByIdServer,
} from "@/lib/firebase/server-db";
import { FeeChallanDoc, StudentDoc, SubjectDoc, TeacherDoc } from "@/lib/firebase/types";
import { assertParentOwnsStudent } from "@/lib/parent-access";

function forbidden(message: string): never {
  throw new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Resolves the authenticated caller's TeacherDoc (schoolId-scoped), falling back to the
 * user profile's teacherId if the session token itself doesn't carry one. Returns null for
 * non-TEACHER callers or a TEACHER session with no resolvable teacher record.
 */
export async function resolveAuthenticatedTeacher(
  authUser: AuthenticatedUser
): Promise<TeacherDoc | null> {
  if (authUser.role !== "TEACHER") return null;
  const profile = authUser.teacherId ? null : await getUserByIdServer(authUser.uid);
  const teacherId = authUser.teacherId || profile?.teacherId;
  if (!teacherId) return null;
  return getTeacherByIdServer(authUser.schoolId, teacherId);
}

/**
 * Everything a teacher has actually been allocated by an admin, resolved server-side from the
 * caller's own records in their own school (active academic session):
 *  - `subjects`: subjects whose `teacherId` is this teacher. `SubjectDoc.teacherId` is the
 *    canonical subject→teacher link (the subjects API mirrors it into
 *    `TeacherDoc.assignedSubjectIds`, which is not trusted on its own).
 *  - `inchargeClassIds`: classes whose `classTeacherId` is this teacher (the daily register).
 *  - `classIds`: every class the teacher may open — subject classes, incharge classes, and the
 *    classes an admin granted explicitly on the teacher's page (`assignedClassIds`).
 */
export interface TeacherAllocation {
  teacher: TeacherDoc;
  subjects: SubjectDoc[];
  subjectIds: Set<string>;
  inchargeClassIds: Set<string>;
  classIds: Set<string>;
}

export async function resolveTeacherAllocation(authUser: AuthenticatedUser): Promise<TeacherAllocation | null> {
  const teacher = await resolveAuthenticatedTeacher(authUser);
  if (!teacher) return null;
  const [subjects, classes] = await Promise.all([
    getSubjectsServer(authUser.schoolId),
    getClassesServer(authUser.schoolId),
  ]);
  const schoolClassIds = new Set(classes.map((c) => c.id));
  const own = subjects.filter((s) => s.teacherId === teacher.id && s.schoolId === authUser.schoolId);
  const inchargeClassIds = new Set(classes.filter((c) => c.classTeacherId === teacher.id).map((c) => c.id));
  const classIds = new Set<string>([
    ...own.map((s) => s.classId),
    ...inchargeClassIds,
    ...(teacher.assignedClassIds || []).filter((id) => schoolClassIds.has(id)),
  ]);
  return { teacher, subjects: own, subjectIds: new Set(own.map((s) => s.id)), inchargeClassIds, classIds };
}

/**
 * The allocation of a TEACHER caller, or a 403 if their session can't be tied to a teacher
 * record of their school. Fails closed: a teacher with nothing allocated gets an empty
 * allocation (and sees nothing), never the whole school.
 */
export async function requireTeacherAllocation(authUser: AuthenticatedUser): Promise<TeacherAllocation> {
  const allocation = await resolveTeacherAllocation(authUser);
  if (!allocation) forbidden("Forbidden: your account is not linked to a teacher profile in this school.");
  return allocation;
}

/**
 * Authorization gate for class-level teacher actions (student roster, observations, exam
 * marks). ADMIN callers pass through. A TEACHER may only act on a class in their allocation
 * (see resolveTeacherAllocation). This previously let a teacher with no class assignments — or
 * with no resolvable teacher record — through for every class in the school.
 */
export async function assertTeacherOwnsClass(
  authUser: AuthenticatedUser,
  classId: string
): Promise<TeacherDoc | null> {
  if (authUser.role !== "TEACHER") return null;

  const allocation = await requireTeacherAllocation(authUser);
  if (!allocation.classIds.has(classId)) {
    forbidden("Forbidden: this class is not in your assigned classes.");
  }
  return allocation.teacher;
}

/**
 * Authorization gate for one attendance register. `subjectId` selects a subject register; null
 * selects the class's daily register. ADMIN passes for any register of their school. A TEACHER
 * may open a subject register only for a subject allocated to them in that same class, and the
 * daily register only for a class they are incharge of.
 */
export async function assertTeacherCanAccessAttendance(
  authUser: AuthenticatedUser,
  classId: string,
  subjectId: string | null
): Promise<{ subject: SubjectDoc | null }> {
  if (authUser.role !== "TEACHER") {
    if (!subjectId) return { subject: null };
    const subject = await getSubjectByIdServer(authUser.schoolId, subjectId);
    if (!subject || subject.classId !== classId) {
      throw new Response(JSON.stringify({ error: "Subject not found for this class." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return { subject };
  }

  const allocation = await requireTeacherAllocation(authUser);
  if (!subjectId) {
    if (!allocation.inchargeClassIds.has(classId)) {
      forbidden("Forbidden: only the class incharge can open this class's daily register.");
    }
    return { subject: null };
  }
  const subject = allocation.subjects.find((s) => s.id === subjectId);
  if (!subject || subject.classId !== classId) {
    forbidden("Forbidden: this subject is not allocated to you for this class.");
  }
  return { subject };
}

export async function assertCanViewStudent(
  authUser: AuthenticatedUser,
  studentId: string
): Promise<StudentDoc> {
  if (!studentId) {
    throw new Response(JSON.stringify({ error: "studentId is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (authUser.role === "PARENT") {
    return assertParentOwnsStudent(authUser, studentId);
  }

  if (authUser.role === "STUDENT") {
    if (!authUser.studentId || authUser.studentId !== studentId) {
      forbidden("Forbidden: you can only view your own student record.");
    }
  }

  const student = await getStudentByIdServer(authUser.schoolId, studentId);
  if (!student || student.schoolId !== authUser.schoolId) {
    throw new Response(JSON.stringify({ error: "Student record not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (authUser.role === "TEACHER") {
    await assertTeacherOwnsClass(authUser, student.classId);
  }

  return student;
}

export async function assertCanViewChallan(
  authUser: AuthenticatedUser,
  challanId: string
): Promise<{ challan: FeeChallanDoc; student: StudentDoc }> {
  if (!challanId) {
    throw new Response(JSON.stringify({ error: "challanId is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const challan = await getFeeChallanByIdServer(authUser.schoolId, challanId);
  if (!challan || challan.schoolId !== authUser.schoolId) {
    throw new Response(JSON.stringify({ error: "Challan not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const student = await assertCanViewStudent(authUser, challan.studentId);
  return { challan, student };
}
