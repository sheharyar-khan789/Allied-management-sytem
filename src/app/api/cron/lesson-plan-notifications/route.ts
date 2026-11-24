import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAllSchoolSettingsServer, getLessonPlanWeeksServer, getTeachersServer } from "@/lib/firebase/server-db";
import { buildWeekSchedule } from "@/lib/lesson-plan-weeks";
import { DEFAULT_SCHOOL_TIMEZONE } from "@/lib/lesson-plan-schedule";
import { notifyTeacherLessonPlanEvent } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** How long before a window's close to send the "deadline soon" notice. */
const DEADLINE_SOON_WINDOW_MS = 6 * 60 * 60 * 1000;

function secretMatches(submitted: string, expected: string): boolean {
  if (!submitted || !expected) return false;
  const a = crypto.createHash("sha256").update(submitted).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b) && submitted.length === expected.length;
}

/**
 * Scheduled check (Vercel Cron, see vercel.json) for lesson-plan submission-window events:
 * window opened, deadline approaching, deadline passed. Fires one notification per active
 * teacher per event, deduped by (weekId, event, teacherId) — see src/lib/notifications.ts — so
 * running this on a schedule (and Vercel's own at-least-once retry behavior) can never double-
 * notify, and a missed tick is simply caught by the next one: no state is kept here at all.
 */
export async function GET(req: NextRequest) {
  const expected = (process.env.CRON_SECRET || "").trim();
  const authHeader = (req.headers.get("authorization") || "").trim();
  const submitted = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!expected || !secretMatches(submitted, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = Date.now();
  const schools = await getAllSchoolSettingsServer();
  let notified = 0;
  let schoolsChecked = 0;

  for (const settings of schools) {
    const schoolId = settings.schoolId;
    if (!schoolId) continue;
    schoolsChecked++;
    const timezone = settings.timezone || DEFAULT_SCHOOL_TIMEZONE;

    try {
      const [customWeeks, teachers] = await Promise.all([
        getLessonPlanWeeksServer(schoolId),
        getTeachersServer(schoolId, 500),
      ]);
      const activeTeachers = teachers.filter((t) => t.status === "ACTIVE");
      if (activeTeachers.length === 0) continue;

      const { weeks } = buildWeekSchedule(customWeeks, timezone, new Date(now));

      for (const week of weeks) {
        const opensAt = Date.parse(week.submissionWindow.opensAt);
        const closesAt = Date.parse(week.submissionWindow.closesAt);

        let event: "LESSON_PLAN_OPEN" | "LESSON_PLAN_DEADLINE_SOON" | "LESSON_PLAN_CLOSED" | null = null;
        let title = "";
        let message = "";
        if (now >= opensAt && now < closesAt - DEADLINE_SOON_WINDOW_MS) {
          event = "LESSON_PLAN_OPEN";
          title = "Lesson plan submission is open";
          message = `Submissions for "${week.label}" (${week.startDate} to ${week.endDate}) are open until ${week.submissionWindow.closesAt}.`;
        } else if (now >= closesAt - DEADLINE_SOON_WINDOW_MS && now < closesAt) {
          event = "LESSON_PLAN_DEADLINE_SOON";
          title = "Lesson plan deadline approaching";
          message = `The submission deadline for "${week.label}" (${week.startDate} to ${week.endDate}) is approaching: ${week.submissionWindow.closesAt}.`;
        } else if (now >= closesAt && now < closesAt + 24 * 60 * 60 * 1000) {
          event = "LESSON_PLAN_CLOSED";
          title = "Lesson plan submission closed";
          message = `The submission window for "${week.label}" (${week.startDate} to ${week.endDate}) has closed.`;
        }
        if (!event) continue;

        for (const teacher of activeTeachers) {
          const { created } = await notifyTeacherLessonPlanEvent({
            schoolId,
            teacherId: teacher.id,
            windowId: week.weekId,
            event,
            title,
            message,
          });
          if (created) notified++;
        }
      }
    } catch (err) {
      console.error(`[cron/lesson-plan-notifications] Failed for school ${schoolId}:`, err);
    }
  }

  return NextResponse.json({ success: true, schoolsChecked, notificationsCreated: notified });
}
