import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSubjectByIdServer,
  deleteSubjectServer,
  getExamsServer,
  getExamSchedulesServer,
  getExamScheduleByIdServer,
  saveExamScheduleServer,
  deleteExamScheduleServer,
  getExamResultsServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Links (merges) an exam-import-created unregistered subject into an existing real subject of
 * the same class: every exam schedule that referenced the unregistered subject is re-created
 * under the target subject's id and the old one removed, then the now-empty unregistered
 * subject is deleted. Refused outright — never a partial/best-effort merge — if the source
 * subject already has any recorded marks (same "never silently overwrite results" rule as
 * deleting a subject) or if the target already has its own schedule for an exam the source is
 * also scheduled in (two schedules can't be merged into one without picking a winner, which
 * this never does automatically).
 */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json().catch(() => ({}));
    const subjectId = typeof body?.subjectId === "string" ? body.subjectId.trim() : "";
    const targetSubjectId = typeof body?.targetSubjectId === "string" ? body.targetSubjectId.trim() : "";

    if (!subjectId || !targetSubjectId) {
      return jsonError("subjectId and targetSubjectId are required.", 400);
    }
    if (subjectId === targetSubjectId) {
      return jsonError("A subject cannot be linked to itself.", 400);
    }

    const [source, target] = await Promise.all([
      getSubjectByIdServer(authUser.schoolId, subjectId),
      getSubjectByIdServer(authUser.schoolId, targetSubjectId),
    ]);
    if (!source || !target) {
      return jsonError("Subject not found for this school.", 404);
    }
    if (!source.unregisteredFromImport) {
      return jsonError("Only an unregistered exam-import subject can be linked into another subject.", 400);
    }
    if (source.classId !== target.classId) {
      return jsonError("Both subjects must belong to the same class.", 400);
    }

    const existingResults = await getExamResultsServer(authUser.schoolId, undefined, undefined, undefined, { allSessions: true });
    const sourceResults = existingResults.filter((r) => r.subjectId === subjectId);
    if (sourceResults.length > 0) {
      return jsonError(
        `"${source.name}" already has ${sourceResults.length} recorded mark(s). Correct or clear them before linking it to another subject.`,
        409
      );
    }

    const exams = await getExamsServer(authUser.schoolId, { allSessions: true });
    const migrated: string[] = [];
    for (const exam of exams) {
      const schedules = await getExamSchedulesServer(authUser.schoolId, exam.id);
      const sourceSchedule = schedules.find((s) => s.subjectId === subjectId);
      if (!sourceSchedule) continue;

      const targetScheduleId = `sch-${exam.id}-${sourceSchedule.classId}-${targetSubjectId}`;
      const conflicting = await getExamScheduleByIdServer(authUser.schoolId, targetScheduleId);
      if (conflicting) {
        return jsonError(
          `Cannot link: exam "${exam.name}" already has a separate schedule for "${target.name}". Remove one of the two schedules first.`,
          409
        );
      }

      await saveExamScheduleServer({
        ...sourceSchedule,
        id: targetScheduleId,
        subjectId: targetSubjectId,
        subjectName: target.name,
      });
      await deleteExamScheduleServer(authUser.schoolId, sourceSchedule.id);
      migrated.push(exam.name);
    }

    await deleteSubjectServer(authUser.schoolId, subjectId);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "LINK_SUBJECT",
      "SUBJECT",
      targetSubjectId,
      `Linked unregistered exam subject "${source.name}" into "${target.name}"${migrated.length ? ` (${migrated.length} schedule(s) migrated: ${migrated.join(", ")})` : ""}.`
    );

    return NextResponse.json({ success: true, mergedSchedules: migrated.length, subject: target });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Subject link error:", error);
    return NextResponse.json({ error: "Failed to link subject." }, { status: 500 });
  }
}
