import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getTimetableServer,
  getTimetableEntryByIdServer,
  saveTimetableEntryServer,
  deleteTimetableEntryServer,
  getClassesServer,
  getSubjectsServer,
  getTeachersServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { TimetableDoc } from "@/lib/firebase/types";
import { requireTeacherAllocation, resolveSessionStudent } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { SlotResult, TIMETABLE_DAYS, toMinutes, validateTimetableSlot } from "@/lib/timetable-import";

export const dynamic = "force-dynamic";

function sortEntries(items: TimetableDoc[]): TimetableDoc[] {
  return [...items].sort(
    (a, b) =>
      TIMETABLE_DAYS.indexOf(a.dayOfWeek) - TIMETABLE_DAYS.indexOf(b.dayOfWeek) ||
      (toMinutes(a.startTime) ?? 0) - (toMinutes(b.startTime) ?? 0)
  );
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Read-only fields a student sees for a period of their own class. */
function toClassView(t: TimetableDoc) {
  return {
    id: t.id,
    dayOfWeek: t.dayOfWeek,
    periodName: t.periodName,
    startTime: t.startTime,
    endTime: t.endTime,
    classId: t.classId,
    className: t.className,
    subjectName: t.subjectName,
    teacherName: t.teacherId ? t.teacherName || "" : "",
    roomNo: t.roomNo || "",
  };
}

export async function GET(req: NextRequest) {
  try {
    // PARENT is deliberately not allowed: the timetable is not part of the parent portal (403).
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId") || undefined;
    const dayOfWeek = searchParams.get("dayOfWeek") || undefined;

    // STUDENT: the class is always derived server-side from the student's own record
    // (student → classId). Any ?classId= / ?teacherId= sent is ignored, so no other class's
    // timetable is reachable.
    if (authUser.role === "STUDENT") {
      const student = await resolveSessionStudent(authUser);
      if (!student) return jsonError("Student profile not found.", 404);
      const items = student.classId ? await getTimetableServer(authUser.schoolId, undefined, student.classId) : [];
      return NextResponse.json({
        success: true,
        student: { id: student.id, fullName: student.fullName, classId: student.classId, className: student.className || "" },
        timetable: sortEntries(items.filter((t) => t.classId === student.classId)).map(toClassView),
      });
    }

    let teacherId: string | undefined;
    if (authUser.role === "TEACHER") {
      // A TEACHER only ever sees their own slots. The teacher id comes from their own teacher
      // record (resolved from the session, falling back to their profile) — never from
      // ?teacherId=. If no teacher record resolves this is a 403, not an unfiltered read of
      // the whole school (the previous code passed `undefined` straight through as "no filter").
      const allocation = await requireTeacherAllocation(authUser);
      teacherId = allocation.teacher.id;
      if (classId && !allocation.classIds.has(classId)) {
        return jsonError("Forbidden: this class is not in your assigned classes.", 403);
      }
    } else {
      teacherId = searchParams.get("teacherId") || undefined;
    }

    const items = await getTimetableServer(authUser.schoolId, teacherId, classId, dayOfWeek);

    return NextResponse.json({
      success: true,
      timetable: sortEntries(items),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable");
    if (busy) return busy;
    console.error("Timetable GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve timetable records." },
      { status: 500 }
    );
  }
}

/**
 * Validates an admin-submitted slot against this school's own records (shared with the timetable
 * import, see src/lib/timetable-import.ts). Names are always taken from the referenced
 * documents, never from the request, and the slot may not clash with another slot of the same
 * teacher, class or room on that day.
 */
async function buildSlot(authUser: AuthenticatedUser, body: any, editingId?: string): Promise<SlotResult> {
  const dayOfWeek = String(body?.dayOfWeek || "").trim();
  const [classes, subjects, teachers] = await Promise.all([
    getClassesServer(authUser.schoolId),
    getSubjectsServer(authUser.schoolId),
    getTeachersServer(authUser.schoolId),
  ]);
  const sameDay = TIMETABLE_DAYS.includes(dayOfWeek as TimetableDoc["dayOfWeek"])
    ? (await getTimetableServer(authUser.schoolId, undefined, undefined, dayOfWeek)).filter((t) => t.id !== editingId)
    : [];
  return validateTimetableSlot(authUser.schoolId, body, { classes, subjects, teachers }, sameDay);
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json().catch(() => null);

    const built = await buildSlot(authUser, body);
    if (!built.ok) return jsonError(built.error, built.status);

    const now = new Date().toISOString();
    const doc: TimetableDoc = {
      ...built.slot,
      id: `tt-${authUser.schoolId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      updatedAt: now,
    };
    const id = await saveTimetableEntryServer(doc);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "CREATE_TIMETABLE_SLOT", "TIMETABLE", id,
      `Scheduled ${doc.subjectName} for ${doc.className} on ${doc.dayOfWeek} ${doc.startTime}–${doc.endTime} (${doc.teacherName}).`
    );

    return NextResponse.json({ success: true, id, timetable: { ...doc, id } }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable");
    if (busy) return busy;
    console.error("Timetable POST error:", error);
    return NextResponse.json(
      { error: "Failed to create timetable slot." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json().catch(() => null);
    const id = String(body?.id || "").trim();
    if (!id) return jsonError("Timetable slot id is required.", 400);

    // Resolved within the caller's school: another school's slot id is simply "not found".
    const existing = await getTimetableEntryByIdServer(authUser.schoolId, id);
    if (!existing) return jsonError("Timetable slot not found.", 404);

    const built = await buildSlot(authUser, body, id);
    if (!built.ok) return jsonError(built.error, built.status);

    const updated: TimetableDoc = {
      ...existing,
      ...built.slot,
      id,
      // A changed class may belong to another session; let the save re-derive it.
      academicYear: built.slot.classId === existing.classId ? existing.academicYear : undefined,
    };
    await saveTimetableEntryServer(updated);

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "UPDATE_TIMETABLE_SLOT", "TIMETABLE", id,
      `Updated slot to ${updated.subjectName} for ${updated.className} on ${updated.dayOfWeek} ${updated.startTime}–${updated.endTime} (${updated.teacherName}).`
    );

    return NextResponse.json({ success: true, timetable: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable");
    if (busy) return busy;
    console.error("Timetable PUT error:", error);
    return NextResponse.json({ error: "Failed to update timetable slot." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const id = (new URL(req.url).searchParams.get("id") || "").trim();
    if (!id) return jsonError("Timetable slot id is required.", 400);

    const existing = await getTimetableEntryByIdServer(authUser.schoolId, id);
    if (!existing || !(await deleteTimetableEntryServer(authUser.schoolId, id))) {
      return jsonError("Timetable slot not found.", 404);
    }

    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "DELETE_TIMETABLE_SLOT", "TIMETABLE", id,
      `Removed ${existing.subjectName} for ${existing.className} on ${existing.dayOfWeek} ${existing.startTime}–${existing.endTime}.`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable");
    if (busy) return busy;
    console.error("Timetable DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete timetable slot." }, { status: 500 });
  }
}
