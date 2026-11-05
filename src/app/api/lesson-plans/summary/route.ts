import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getClassesServer, getSubjectsServer, getLessonPlansServer, getLessonPlanWeeksServer } from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { lessonPlanStatus } from "@/lib/lesson-plan-schedule";
import { resolveWeek } from "@/lib/lesson-plan-weeks";

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * GET /api/lesson-plans/summary?weekId=YYYY-MM-DD — ADMIN only. For every subject that has a
 * teacher allocated (the school's real "who must submit this week" set, from the Subjects
 * collection — never a hardcoded list), reports whether that week's plan is missing, a draft,
 * submitted, late (drafted but never finalized before the window closed) or locked. This is what
 * powers "identify teachers who have not submitted their weekly plans."
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const weekId = searchParams.get("weekId") || "";
    // Same schedule the submission form uses: a standard Monday week or an admin-defined week.
    const resolved = resolveWeek(weekId, await getLessonPlanWeeksServer(authUser.schoolId));
    // A historical week that predates a covering custom week is still readable (read-only view).
    if (!resolved.ok && !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return jsonError(resolved.error, 400);
    const classId = searchParams.get("classId") || undefined;
    const subjectId = searchParams.get("subjectId") || undefined;
    const teacherId = searchParams.get("teacherId") || undefined;

    const [classes, subjects, plans] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
      getLessonPlansServer(authUser.schoolId, { weekId }),
    ]);
    const classNameById = new Map(classes.map((c) => [c.id, `${c.name} ${c.section}`.trim()]));
    const planByKey = new Map(plans.map((p) => [`${p.classId}:${p.subjectId}`, p]));

    const now = new Date();
    const rows = subjects
      .filter((s) => Boolean(s.teacherId))
      .filter((s) => !classId || s.classId === classId)
      .filter((s) => !subjectId || s.id === subjectId)
      .filter((s) => !teacherId || s.teacherId === teacherId)
      .map((s) => {
        const plan = planByKey.get(`${s.classId}:${s.id}`);
        return {
          classId: s.classId,
          className: classNameById.get(s.classId) || "",
          subjectId: s.id,
          subjectName: s.name,
          teacherId: s.teacherId,
          teacherName: s.teacherName || "",
          planId: plan?.id || null,
          status: plan ? lessonPlanStatus(plan, now) : ("MISSING" as const),
          submittedAt: plan?.submittedAt || null,
        };
      })
      .sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));

    const counts = rows.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return NextResponse.json({ success: true, weekId, rows, counts, total: rows.length });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans/summary");
    if (busy) return busy;
    console.error("Lesson plan summary error:", error);
    return jsonError("Failed to load the lesson plan summary.", 500);
  }
}
