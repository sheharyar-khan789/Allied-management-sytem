import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  getStudentByIdServer,
  getSubjectsServer,
  getTeachersServer,
} from "@/lib/firebase/server-db";
import { teachersWithAccessToClass } from "@/lib/student-teacher-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

/** Admin view: which teachers' accounts can open this student, and why. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const student = await getStudentByIdServer(authUser.schoolId, id);
    if (!student || student.schoolId !== authUser.schoolId) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }
    const [teachers, subjects, classes] = await Promise.all([
      getTeachersServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId, student.classId),
      getClassesServer(authUser.schoolId),
    ]);
    return NextResponse.json({
      success: true,
      studentId: student.id,
      classId: student.classId,
      className: student.className,
      teachers: teachersWithAccessToClass(student.classId, teachers, subjects, classes),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/[id]/teacher-access");
    if (busy) return busy;
    console.error("Teacher access GET error:", error?.message || "error");
    return NextResponse.json({ error: "Failed to resolve teacher access." }, { status: 500 });
  }
}
