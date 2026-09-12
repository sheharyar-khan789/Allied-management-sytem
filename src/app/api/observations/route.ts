import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  saveStudentObservationServer,
  createAuditLogServer,
  getStudentByIdServer
} from "@/lib/firebase/server-db";
import { StudentObservationDoc } from "@/lib/firebase/types";

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const body = await req.json();
    const { studentId, teacherId, title, category, content } = body;

    if (!studentId || !content) {
      return NextResponse.json(
        { error: "Student ID and observation content are required." },
        { status: 400 }
      );
    }

    const student = await getStudentByIdServer(authUser.schoolId, studentId);

    const obsDoc: StudentObservationDoc = {
      id: `obs-${Date.now().toString().slice(-4)}`,
      schoolId: authUser.schoolId,
      studentId,
      studentName: student?.fullName || "Student",
      teacherId: teacherId || authUser.teacherId || "tch-101",
      teacherName: authUser.name || "Educator",
      category: category || "ACADEMIC",
      note: title ? `${title}: ${content}` : content,
      sentiment: "POSITIVE",
      createdAt: new Date().toISOString(),
    };

    await saveStudentObservationServer(obsDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ADD_OBSERVATION",
      "STUDENT_OBSERVATION",
      obsDoc.id,
      `Added observation note for ${obsDoc.studentName}: "${title || content}".`
    );

    return NextResponse.json({ success: true, observation: obsDoc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Observation POST error:", error);
    return NextResponse.json({ error: "Failed to add observation note." }, { status: 500 });
  }
}
