import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import { rejectTeacherObservationSubmissionServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { parseJsonBody } from "@/lib/input-validation";

/**
 * Admin-only. Rejects a pending submission with a required reason — never writes to
 * teacherObservations, and the subject teacher never learns this submission existed.
 */
const rejectSchema = z.object({
  reviewNote: z.string().trim().min(1, "A rejection reason is required.").max(500),
});

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  NOT_FOUND: { message: "Submission not found.", status: 404 },
  ALREADY_REVIEWED: { message: "This submission has already been reviewed.", status: 409 },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, rejectSchema);
    if (!parsed.ok) return parsed.response;

    const result = await rejectTeacherObservationSubmissionServer(
      authUser.schoolId,
      id,
      { uid: authUser.uid, name: authUser.name },
      parsed.data.reviewNote
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
      "REJECT_TEACHER_OBSERVATION_SUBMISSION",
      "TEACHER_OBSERVATION_SUBMISSION",
      id,
      `Rejected a coordinator-submitted observation about ${result.submission.teacherName || result.submission.teacherId} (submitted by ${result.submission.submittedByName || result.submission.submittedByTeacherId}). Reason: ${parsed.data.reviewNote}`
    );

    return NextResponse.json({ success: true, submission: result.submission });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observation-submissions/[id]/reject");
    if (busy) return busy;
    console.error("Teacher observation submission reject error:", error);
    return NextResponse.json({ error: "Failed to reject the submission." }, { status: 500 });
  }
}
