import { AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getFeeChallanByIdServer,
  getStudentByIdServer,
  getTeacherByIdServer,
  getUserByIdServer,
} from "@/lib/firebase/server-db";
import { FeeChallanDoc, StudentDoc } from "@/lib/firebase/types";
import { assertParentOwnsStudent } from "@/lib/parent-access";

function forbidden(message: string): never {
  throw new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
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
    const profile = await getUserByIdServer(authUser.uid);
    const teacherId = authUser.teacherId || profile?.teacherId;
    if (teacherId) {
      const teacher = await getTeacherByIdServer(authUser.schoolId, teacherId);
      const assigned = teacher?.assignedClassIds || [];
      if (assigned.length > 0 && !assigned.includes(student.classId)) {
        forbidden("Forbidden: this student is not in your assigned classes.");
      }
    }
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
