import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { assertCanViewStudent, canViewStudentAttendance } from "@/lib/academic-access";
import { buildStudentAcademicPayload } from "@/lib/student-academic-payload";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    const { studentId } = await params;
    const student = await assertCanViewStudent(authUser, studentId);
    const payload = await buildStudentAcademicPayload(authUser.schoolId, student, {
      publishedResultsOnly: authUser.role === "PARENT" || authUser.role === "STUDENT",
    });
    // Attendance belongs to the class incharge: a subject teacher's report card carries none.
    // Fees are never part of a teacher's view.
    const { attendance, fees, ...rest } = payload;
    const showAttendance = await canViewStudentAttendance(authUser, student);
    return NextResponse.json({
      success: true,
      ...rest,
      ...(showAttendance ? { attendance } : {}),
      ...(authUser.role !== "TEACHER" ? { fees } : {}),
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Print report card error:", error);
    return NextResponse.json({ error: "Failed to load report card." }, { status: 500 });
  }
}
