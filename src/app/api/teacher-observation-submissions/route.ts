import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSubmissionsBySubmitterServer,
  saveTeacherObservationSubmissionServer,
  getTeacherByIdServer,
  getTeachersServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { TeacherObservationSubmissionDoc } from "@/lib/firebase/types";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { TEACHER_OBSERVATION_CATEGORIES, TEACHER_OBSERVATION_RATINGS } from "@/lib/teacher-observations";

/**
 * Coordinator-facing: a TEACHER with `TeacherDoc.canSubmitObservations === true` may draft an
 * observation about ANOTHER teacher here. It is never published directly — it is saved with
 * `status: "PENDING"` and only becomes a real /api/teacher-observations record if an ADMIN
 * approves it (see src/app/api/teacher-observation-submissions/[id]/approve). This route never
 * accepts or trusts a client-supplied `status` or `submittedByTeacherId` — both are always
 * server-resolved, so there is no way for a coordinator to self-publish or impersonate another
 * coordinator's submission.
 */

const createSchema = z.object({
  teacherId: idString, // the SUBJECT teacher this note is about
  observationDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Observation date must be YYYY-MM-DD."),
  category: z.enum(TEACHER_OBSERVATION_CATEGORIES),
  rating: z.enum(TEACHER_OBSERVATION_RATINGS),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().min(1, "Observation text is required.").max(4000),
  subjectId: z.union([idString, z.literal(""), z.null()]).optional(),
  classId: z.union([idString, z.literal(""), z.null()]).optional(),
});

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["TEACHER"]);
    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher) return jsonError("Your account is not linked to a teacher profile.", 403);

    // Ignores any client-supplied id — always the caller's own submissions, mirroring
    // GET /api/teacher-observations' identical TEACHER-branch pattern.
    const submissions = await getSubmissionsBySubmitterServer(authUser.schoolId, teacher.id);
    const isCoordinator = teacher.canSubmitObservations === true;

    // The subject-teacher picker, id+name only (never phone/salary/email) — only ever returned
    // to a confirmed coordinator; this GET's own 403 above already blocks anyone else from this
    // route in the first place, this is belt-and-suspenders for the response shape too.
    const teachers = isCoordinator
      ? (await getTeachersServer(authUser.schoolId)).map((t) => ({ id: t.id, fullName: t.fullName }))
      : [];

    return NextResponse.json({
      success: true,
      coordinator: isCoordinator,
      submissions,
      teachers,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observation-submissions");
    if (busy) return busy;
    console.error("Teacher observation submission GET error:", error);
    return jsonError("Failed to load your submissions.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["TEACHER"]);
    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher) return jsonError("Your account is not linked to a teacher profile.", 403);
    if (teacher.canSubmitObservations !== true) {
      return jsonError("You are not authorized to submit observations. Ask an administrator to grant this permission.", 403);
    }

    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const subject = await getTeacherByIdServer(authUser.schoolId, body.teacherId);
    if (!subject) return jsonError("Teacher not found for this school.", 404);

    const nowIso = new Date().toISOString();
    const sub: TeacherObservationSubmissionDoc = {
      id: `tobsub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      schoolId: authUser.schoolId,
      teacherId: subject.id,
      teacherName: subject.fullName,
      submittedByTeacherId: teacher.id,
      submittedByName: teacher.fullName,
      submittedAt: nowIso,
      observationDate: body.observationDate,
      category: body.category,
      rating: body.rating,
      ...(body.title ? { title: body.title } : {}),
      note: body.note,
      ...(body.subjectId ? { subjectId: body.subjectId } : {}),
      ...(body.classId ? { classId: body.classId } : {}),
      status: "PENDING",
      createdAt: nowIso,
    };

    await saveTeacherObservationSubmissionServer(sub);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "SUBMIT_TEACHER_OBSERVATION",
      "TEACHER_OBSERVATION_SUBMISSION",
      sub.id,
      `Submitted an observation about ${subject.fullName} for admin review: "${body.title || body.note.slice(0, 80)}".`
    );

    return NextResponse.json({ success: true, submission: sub }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observation-submissions");
    if (busy) return busy;
    console.error("Teacher observation submission POST error:", error);
    return jsonError("Failed to submit the observation.", 500);
  }
}
