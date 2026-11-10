import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { assertCanViewStudent } from "@/lib/academic-access";
import { buildStudentAcademicPayload } from "@/lib/student-academic-payload";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    const { studentId } = await params;
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const student = await assertCanViewStudent(authUser, studentId);
    const payload = await buildStudentAcademicPayload(authUser.schoolId, student);

    let records = payload.attendance.records;
    if (from) records = records.filter((r) => r.date >= from);
    if (to) records = records.filter((r) => r.date <= to);

    const present = records.filter((r) => r.status === "PRESENT").length;
    const absent = records.filter((r) => r.status === "ABSENT").length;
    const leave = records.filter((r) => r.status === "LEAVE").length;
    const late = records.filter((r) => r.status === "LATE").length;
    const total = records.length;
    const percentage = total > 0 ? parseFloat(((present / total) * 100).toFixed(1)) : 0;

    return NextResponse.json({
      success: true,
      school: payload.school,
      student: payload.student,
      range: { from: from || null, to: to || null },
      attendance: {
        records,
        stats: { present, absent, leave, late, total, percentage },
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Print attendance error:", error);
    return NextResponse.json({ error: "Failed to load attendance report." }, { status: 500 });
  }
}
