import { AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  getFeeChallanByIdServer,
  getStudentByIdServer,
  getSubjectByIdServer,
  getSubjectsServer,
  getTeacherByIdServer,
  getStudentByUserIdServer,
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
 * Attendance is a class-incharge responsibility. A TEACHER may access a class's attendance only
 * when `ClassDoc.classTeacherId` (the canonical class-incharge link, resolved here from the
 * caller's own teacher record) names them. Teaching a subject in the class, or an admin-granted
 * `assignedClassIds` entry, never grants attendance access.
 */
export async function assertTeacherIsClassIncharge(
  authUser: AuthenticatedUser,
  classId: string
): Promise<TeacherAllocation> {
  const allocation = await requireTeacherAllocation(authUser);
  if (!allocation.inchargeClassIds.has(classId)) {
    forbidden("Forbidden: only the class incharge can access this class's attendance.");
  }
  return allocation;
}

/**
 * Authorization gate for one attendance register. `subjectId` selects a subject register; null
 * selects the class's daily register. ADMIN passes for any register of their school. A TEACHER
 * passes only for a class they are incharge of (any register of that class).
 */
export async function assertTeacherCanAccessAttendance(
  authUser: AuthenticatedUser,
  classId: string,
  subjectId: string | null
): Promise<{ subject: SubjectDoc | null }> {
  if (authUser.role === "TEACHER") {
    await assertTeacherIsClassIncharge(authUser, classId);
  }
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

/**
 * Whether `authUser` may see `student`'s attendance history. Callers must already have passed
 * assertCanViewStudent (school isolation, student/parent ownership). For a TEACHER this
 * additionally requires being the incharge of the student's class.
 */
export async function canViewStudentAttendance(
  authUser: AuthenticatedUser,
  student: StudentDoc
): Promise<boolean> {
  if (authUser.role !== "TEACHER") return true;
  const allocation = await requireTeacherAllocation(authUser);
  return allocation.inchargeClassIds.has(student.classId);
}

/** assertCanViewStudent plus the class-incharge rule for a teacher reading attendance. */
export async function assertCanViewStudentAttendance(
  authUser: AuthenticatedUser,
  studentId: string
): Promise<StudentDoc> {
  const student = await assertCanViewStudent(authUser, studentId);
  if (!(await canViewStudentAttendance(authUser, student))) {
    forbidden("Forbidden: only the class incharge can access this student's attendance.");
  }
  return student;
}

/**
 * The student record of a STUDENT session: the session's studentId, else the login profile's,
 * else the student whose userId is this login. Always within the caller's own school.
 */
export async function resolveSessionStudent(authUser: AuthenticatedUser): Promise<StudentDoc | null> {
  if (authUser.role !== "STUDENT") return null;
  let studentId = authUser.studentId;
  if (!studentId) studentId = (await getUserByIdServer(authUser.uid))?.studentId;
  const student = studentId
    ? await getStudentByIdServer(authUser.schoolId, studentId)
    : await getStudentByUserIdServer(authUser.schoolId, authUser.uid);
  return student && student.schoolId === authUser.schoolId ? student : null;
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
