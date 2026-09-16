import { AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getFeeChallanByIdServer,
  getStudentByIdServer,
  getTeacherByIdServer,
  getUserByIdServer,
} from "@/lib/firebase/server-db";
import { FeeChallanDoc, StudentDoc, TeacherDoc } from "@/lib/firebase/types";
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
 * Authorization gate for teacher-scoped academic actions (attendance, exams, observations,
 * timetable). ADMIN callers are always allowed through unchanged. A TEACHER caller is only
 * allowed through for a classId contained in their own assignedClassIds — never a
 * client-supplied teacherId/classId taken at face value. Matches the existing convention in
 * assertCanViewStudent below: a teacher with no assignedClassIds configured yet (empty
 * array) is treated as not-yet-restricted rather than locked out of every class, since an
 * admin may not have finished configuring class assignments. Once assignedClassIds is
 * non-empty, only those classes are permitted.
 */
export async function assertTeacherOwnsClass(
  authUser: AuthenticatedUser,
  classId: string
): Promise<TeacherDoc | null> {
  if (authUser.role !== "TEACHER") return null;

  const teacher = await resolveAuthenticatedTeacher(authUser);
  const assigned = teacher?.assignedClassIds || [];
  if (assigned.length > 0 && !assigned.includes(classId)) {
    forbidden("Forbidden: this class is not in your assigned classes.");
  }
  return teacher;
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
