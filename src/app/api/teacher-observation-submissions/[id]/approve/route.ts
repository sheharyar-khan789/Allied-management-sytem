import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import { approveTeacherObservationSubmissionServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { TEACHER_OBSERVATION_CATEGORIES, TEACHER_OBSERVATION_RATINGS } from "@/lib/teacher-observations";

/**
 * Admin-only. Publishes a pending submission as a real TeacherObservationDoc — this is the ONLY
 * code path, anywhere in the app, that turns a coordinator's draft into a published observation.
 * The resulting note's `authorUid`/`authorName` are always the approving admin's, never the
 * coordinator's — see approveTeacherObservationSubmissionServer.
 */
const approveSchema = z.object({
  observationDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.enum(TEACHER_OBSERVATION_CATEGORIES).optional(),
  rating: z.enum(TEACHER_OBSERVATION_RATINGS).optional(),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().min(1).max(4000).optional(),
  subjectId: z.union([idString, z.literal(""), z.null()]).optional(),
  classId: z.union([idString, z.literal(""), z.null()]).optional(),
  reviewNote: z.string().trim().max(500).optional(),
});

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  NOT_FOUND: { message: "Submission not found.", status: 404 },
  ALREADY_REVIEWED: { message: "This submission has already been reviewed.", status: 409 },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, approveSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const result = await approveTeacherObservationSubmissionServer(
      authUser.schoolId,
      id,
      {
        observationDate: body.observationDate,
        category: body.category,
        rating: body.rating,
        title: body.title,
        note: body.note,
        subjectId: body.subjectId || undefined,
        classId: body.classId || undefined,
      },
      { uid: authUser.uid, name: authUser.name },
      body.reviewNote
    );

    if (!result.ok) {
      const err = ERROR_MESSAGES[result.error];
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "APPROVE_TEACHER_OBSERVATION_SUBMISSION",
      "TEACHER_OBSERVATION_SUBMISSION",
      id,
      `Approved and published a coordinator-submitted observation about ${result.submission.teacherName || result.submission.teacherId} (submitted by ${result.submission.submittedByName || result.submission.submittedByTeacherId}).`
    );

    return NextResponse.json({ success: true, observation: result.observation, submission: result.submission });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observation-submissions/[id]/approve");
    if (busy) return busy;
    console.error("Teacher observation submission approve error:", error);
    return NextResponse.json({ error: "Failed to approve the submission." }, { status: 500 });
  }
}
