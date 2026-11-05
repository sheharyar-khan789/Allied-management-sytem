import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTeacherAttendanceServer,
  getTeacherAttendanceByIdServer,
  getTeachersServer,
  getTeacherByIdServer,
  saveTeacherAttendanceServer,
  getSchoolSettingsServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";
import {
  classifyTeacherDays,
  monthRange,
  summarizeTeacherDays,
  teacherAttendanceIdFor,
} from "@/lib/teacher-attendance";
import { DEFAULT_SCHOOL_TIMEZONE } from "@/lib/lesson-plan-schedule";
import { TeacherAttendanceDoc, TeacherAttendanceStatus } from "@/lib/firebase/types";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

/**
 * Teacher Attendance (Phase 11) — a dedicated module, entirely separate from student attendance
 * (/api/attendance, a different Firestore collection, different rules). See
 * src/lib/teacher-attendance.ts for the actual present/leave/absent computation (deterministic,
 * timezone-aware, weekly-leave-capped) and src/lib/biometric-attendance.ts for the (currently
 * unwired — no device model supplied) biometric compatibility layer.
 */

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

function parseYearMonth(searchParams: URLSearchParams): { year: number; month: number } | null {
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const ym = parseYearMonth(searchParams);
    if (!ym) return jsonError("Valid year and month query parameters are required.", 400);

    const settings = await getSchoolSettingsServer(authUser.schoolId);
    const timezone = settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
    const holidays = settings?.holidays || [];
    const { start, end } = monthRange(ym.year, ym.month);

    // A TEACHER may only ever see their own history — any ?teacherId= is ignored for this role,
    // resolved server-side from the session exactly like /api/teacher-observations.
    if (authUser.role === "TEACHER") {
      const teacher = await resolveAuthenticatedTeacher(authUser);
      if (!teacher) return jsonError("Your account is not linked to a teacher profile.", 403);
      const records = await getTeacherAttendanceServer(authUser.schoolId, teacher.id, start, end);
      const days = classifyTeacherDays(start, end, records, holidays);
      return NextResponse.json({
        success: true,
        teacher: { id: teacher.id, fullName: teacher.fullName },
        year: ym.year,
        month: ym.month,
        timezone,
        days,
        summary: summarizeTeacherDays(days),
      });
    }

    const teacherId = searchParams.get("teacherId") || undefined;
    if (teacherId) {
      const teacher = await getTeacherByIdServer(authUser.schoolId, teacherId);
      if (!teacher) return jsonError("Teacher not found for this school.", 404);
      const records = await getTeacherAttendanceServer(authUser.schoolId, teacher.id, start, end);
      const days = classifyTeacherDays(start, end, records, holidays);
      return NextResponse.json({
        success: true,
        teacher: { id: teacher.id, fullName: teacher.fullName },
        year: ym.year,
        month: ym.month,
        timezone,
        days,
        summary: summarizeTeacherDays(days),
      });
    }

    // No teacherId: a school-wide roster view, one summary per active teacher.
    const [teachers, allRecords] = await Promise.all([
      getTeachersServer(authUser.schoolId),
      getTeacherAttendanceServer(authUser.schoolId, undefined, start, end),
    ]);
    const recordsByTeacher = new Map<string, TeacherAttendanceDoc[]>();
    for (const r of allRecords) {
      const list = recordsByTeacher.get(r.teacherId) || [];
      list.push(r);
      recordsByTeacher.set(r.teacherId, list);
    }
    const roster = teachers
      .filter((t) => t.status === "ACTIVE")
      .map((t) => {
        const days = classifyTeacherDays(start, end, recordsByTeacher.get(t.id) || [], holidays);
        return { id: t.id, fullName: t.fullName, employeeId: t.employeeId, summary: summarizeTeacherDays(days) };
      });

    return NextResponse.json({ success: true, year: ym.year, month: ym.month, timezone, teachers: roster });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-attendance");
    if (busy) return busy;
    console.error("Teacher attendance GET error:", error);
    return jsonError("Failed to load teacher attendance.", 500);
  }
}

const correctionSchema = z.object({
  teacherId: idString,
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD."),
  status: z.enum(["PRESENT", "ABSENT", "LEAVE"]),
  reason: z.string().trim().max(500).optional(),
});

/** Admin-only correction of one teacher's one day. Always audited; always source=ADMIN_CORRECTION
 *  going forward, so a later biometric event for the same date never silently overwrites it
 *  (see resolveBiometricEvent in biometric-attendance.ts). */
export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, correctionSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const teacher = await getTeacherByIdServer(authUser.schoolId, body.teacherId);
    if (!teacher) return jsonError("Teacher not found for this school.", 404);

    const id = teacherAttendanceIdFor(authUser.schoolId, teacher.id, body.date);
    const existing = await getTeacherAttendanceByIdServer(authUser.schoolId, id);
    const now = new Date().toISOString();
    const newStatus = body.status as TeacherAttendanceStatus;

    const updated: TeacherAttendanceDoc = {
      id,
      schoolId: authUser.schoolId,
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      date: body.date,
      status: newStatus,
      source: "ADMIN_CORRECTION",
      checkInTime: existing?.checkInTime,
      remarks: body.reason || existing?.remarks,
      recordedBy: authUser.uid,
      updatedBy: authUser.uid,
      correctionHistory: [
        ...(existing?.correctionHistory || []),
        {
          at: now,
          by: authUser.uid,
          byName: authUser.name,
          previousStatus: existing?.status,
          newStatus,
          reason: body.reason,
        },
      ],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await saveTeacherAttendanceServer(updated);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CORRECT_TEACHER_ATTENDANCE",
      "TEACHER_ATTENDANCE",
      id,
      `Set ${teacher.fullName}'s attendance for ${body.date} to ${newStatus}` +
        (existing ? ` (was ${existing.status}/${existing.source})` : " (no prior record)") +
        (body.reason ? `. Reason: ${body.reason}` : ".")
    );

    return NextResponse.json({ success: true, record: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-attendance");
    if (busy) return busy;
    console.error("Teacher attendance PUT error:", error);
    return jsonError("Failed to correct teacher attendance.", 500);
  }
}
