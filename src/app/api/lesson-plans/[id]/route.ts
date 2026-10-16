import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getLessonPlanByIdServer, softDeleteLessonPlanServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { isLessonPlanLockedForTeacher } from "@/lib/lesson-plan-schedule";
import { toLessonPlanView } from "../route";

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

async function loadOwned(req: NextRequest, id: string) {
  const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
  const plan = await getLessonPlanByIdServer(authUser.schoolId, id);
  if (!plan || plan.deletedAt) return { authUser, plan: null };
  if (authUser.role === "TEACHER") {
    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher || plan.teacherId !== teacher.id) {
      throw new Response(JSON.stringify({ error: "Forbidden: this is not your lesson plan." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  return { authUser, plan };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { plan } = await loadOwned(req, id);
    if (!plan) return jsonError("Lesson plan not found.", 404);
    return NextResponse.json({ success: true, plan: toLessonPlanView(plan) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans/[id]");
    if (busy) return busy;
    console.error("Lesson plan GET error:", error);
    return jsonError("Failed to load the lesson plan.", 500);
  }
}

/**
 * Soft delete. TEACHER: only their own record, and only while the Saturday window is still open
 * (same lock as editing). ADMIN: may delete any record of their school at any time (e.g. to
 * remove a record created in error) — always soft, always audited.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { authUser, plan } = await loadOwned(req, id);
    if (!plan) return jsonError("Lesson plan not found.", 404);

    if (authUser.role === "TEACHER" && isLessonPlanLockedForTeacher(plan)) {
      return jsonError(
        "This week's lesson plan is locked and can no longer be deleted. Contact an administrator.",
        403
      );
    }

    const ok = await softDeleteLessonPlanServer(authUser.schoolId, id, authUser.uid);
    if (!ok) return jsonError("Lesson plan not found.", 404);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_LESSON_PLAN",
      "LESSON_PLAN",
      id,
      `Deleted the week of ${plan.weekId} lesson plan for ${plan.subjectName || plan.subjectId} / ${plan.className || plan.classId}.`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans/[id]");
    if (busy) return busy;
    console.error("Lesson plan DELETE error:", error);
    return jsonError("Failed to delete the lesson plan.", 500);
  }
}
