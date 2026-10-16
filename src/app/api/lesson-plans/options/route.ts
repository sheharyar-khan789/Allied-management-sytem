import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  getSubjectsServer,
  getTeachersServer,
  getSchoolSettingsServer,
} from "@/lib/firebase/server-db";
import { requireTeacherAllocation } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  addDays,
  currentWeekId,
  submissionWindowFor,
} from "@/lib/lesson-plan-schedule";

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * GET /api/lesson-plans/options — the data the teacher/admin UI needs to build the create/filter
 * forms: a TEACHER's actual class+subject allocation (never a hardcoded list), the school
 * timezone, and a run of nearby school weeks with their submission windows.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const settings = await getSchoolSettingsServer(authUser.schoolId);
    const timezone = settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
    // "Next week" relative to today is the default the create form opens on — it's the week
    // whose Saturday submission window is open (or coming up soonest). See lesson-plan-schedule.ts.
    const defaultWeekId = addDays(currentWeekId(timezone), 7);

    const weeks = Array.from({ length: 8 }, (_, i) => {
      const weekId = addDays(defaultWeekId, (i - 5) * 7);
      return { weekId, submissionWindow: submissionWindowFor(weekId, timezone) };
    });

    if (authUser.role === "TEACHER") {
      const allocation = await requireTeacherAllocation(authUser);
      const classes = await getClassesServer(authUser.schoolId);
      const classNameById = new Map(classes.map((c) => [c.id, `${c.name} ${c.section}`.trim()]));
      const classesSubjects = allocation.subjects
        .map((s) => ({
          classId: s.classId,
          className: classNameById.get(s.classId) || s.className || "Class",
          subjectId: s.id,
          subjectName: s.name,
        }))
        .sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));

      return NextResponse.json({
        success: true,
        timezone,
        defaultWeekId,
        weeks,
        classesSubjects,
      });
    }

    const [classes, subjects, teachers] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
      getTeachersServer(authUser.schoolId),
    ]);

    return NextResponse.json({
      success: true,
      timezone,
      defaultWeekId,
      weeks,
      classes: classes.map((c) => ({ id: c.id, name: `${c.name} ${c.section}`.trim() })),
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, classId: s.classId, teacherId: s.teacherId || null })),
      teachers: teachers.filter((t) => t.status === "ACTIVE").map((t) => ({ id: t.id, name: t.fullName })),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/lesson-plans/options");
    if (busy) return busy;
    console.error("Lesson plan options error:", error);
    return jsonError("Failed to load lesson plan options.", 500);
  }
}
