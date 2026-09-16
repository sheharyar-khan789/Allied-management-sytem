import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  saveStudentObservationServer,
  createAuditLogServer,
  getStudentByIdServer
} from "@/lib/firebase/server-db";
import { StudentObservationDoc } from "@/lib/firebase/types";
import { assertTeacherOwnsClass } from "@/lib/academic-access";

const ALLOWED_SENTIMENTS: StudentObservationDoc["sentiment"][] = ["POSITIVE", "NEUTRAL", "NEEDS_IMPROVEMENT"];

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const body = await req.json();
    const { studentId, teacherId, title, category, content, sentiment } = body;

    if (!studentId || !content) {
      return NextResponse.json(
        { error: "Student ID and observation content are required." },
        { status: 400 }
      );
    }

    // The student must genuinely belong to this school. Previously a missing/foreign student
    // was allowed through silently (falling back to a generic "Student" label) instead of
    // being rejected, which would attach an observation to a non-existent or cross-tenant
    // studentId.
    const student = await getStudentByIdServer(authUser.schoolId, studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found for this school." }, { status: 404 });
    }

    // A TEACHER may only write an observation for a student in one of their own
    // assignedClassIds — verified against the student's real classId server-side, never
    // trusting any client-supplied ownership claim.
    await assertTeacherOwnsClass(authUser, student.classId);

    // Never fabricate a teacher identity. A teacher's own account id is used automatically;
    // an admin's own staff id is used when they log the note themselves. Previously a
    // hardcoded "tch-101" was silently attributed to every note whose author had no
    // teacherId, which mis-attributed admin-authored notes to an arbitrary fake teacher.
    let resolvedTeacherId: string;
    if (authUser.role === "TEACHER") {
      if (!authUser.teacherId) {
        return NextResponse.json(
          { error: "Your account is not linked to a teacher profile." },
          { status: 403 }
        );
      }
      resolvedTeacherId = authUser.teacherId;
    } else {
      resolvedTeacherId = teacherId || `staff-${authUser.uid}`;
    }

    const resolvedSentiment: StudentObservationDoc["sentiment"] = ALLOWED_SENTIMENTS.includes(sentiment)
      ? sentiment
      : "NEUTRAL";

    const obsDoc: StudentObservationDoc = {
      id: `obs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      schoolId: authUser.schoolId,
      studentId,
      studentName: student.fullName,
      teacherId: resolvedTeacherId,
      teacherName: authUser.name || "Educator",
      category: category || "ACADEMIC",
      note: title ? `${title}: ${content}` : content,
      sentiment: resolvedSentiment,
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
