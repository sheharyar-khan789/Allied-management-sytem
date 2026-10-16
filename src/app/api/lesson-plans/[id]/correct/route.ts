import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import { parseJsonBody } from "@/lib/input-validation";
import { getLessonPlanByIdServer, saveLessonPlanServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { weekdayOf } from "@/lib/lesson-plan-schedule";
import { toLessonPlanView } from "../../route";

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

const dayEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().trim().max(4000).optional().default(""),
  isNonTeachingDay: z.boolean().optional(),
});

const correctSchema = z.object({
  days: z.array(dayEntrySchema).min(1).max(7),
  reason: z.string().trim().min(1, "A reason is required for an admin correction.").max(500),
});

/**
 * POST /api/lesson-plans/[id]/correct — ADMIN-only. Edits an already-submitted/locked plan's
 * `days` while preserving the teacher's original content in `adminCorrections` (never silently
 * overwritten) and keeping `submitted`/`submittedAt`/`submissionDeadline` exactly as the teacher
 * left them, so the record's locked status and the original submission timestamp are unchanged.
 * Gated behind requireRecentAuth like other sensitive admin actions (settings, payroll, deletes).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, correctSchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "correct a submitted lesson plan", req);
    const body = parsed.data;

    const existing = await getLessonPlanByIdServer(authUser.schoolId, id);
    if (!existing || existing.deletedAt) return jsonError("Lesson plan not found.", 404);

    const validDates = new Set(existing.days.map((d) => d.date));
    for (const d of body.days) {
      if (!validDates.has(d.date)) {
        return jsonError(`${d.date} is not one of this plan's dates.`, 400);
      }
    }
    const byDate = new Map(body.days.map((d) => [d.date, d]));
    const correctedDays = existing.days.map((d) => {
      const edit = byDate.get(d.date);
      if (!edit) return d;
      return { date: d.date, dayOfWeek: weekdayOf(d.date), content: edit.content || "", ...(edit.isNonTeachingDay ? { isNonTeachingDay: true } : {}) };
    });

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      days: correctedDays,
      updatedAt: now,
      updatedBy: authUser.uid,
      adminCorrections: [
        ...(existing.adminCorrections || []),
        { at: now, by: authUser.uid, byName: authUser.name, reason: body.reason, previousDays: existing.days },
      ],
    };
    await saveLessonPlanServer(updated);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CORRECT_LESSON_PLAN",
      "LESSON_PLAN",
      id,
      `Corrected the week of ${existing.weekId} lesson plan for ${existing.subjectName || existing.subjectId} / ${existing.className || existing.classId}. Reason: ${body.reason}`
    );

    return NextResponse.json({ success: true, plan: toLessonPlanView(updated) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans/[id]/correct");
    if (busy) return busy;
    console.error("Lesson plan correction error:", error);
    return jsonError("Failed to save the correction.", 500);
  }
}
