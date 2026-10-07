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
import { assertParentOwnsStudent } from "@/lib/parent-access";

export const dynamic = "force-dynamic";

const DAYS: TimetableDoc["dayOfWeek"][] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

/** "HH:MM" (24h) → minutes since midnight; also accepts legacy "hh:mm AM/PM". */
function toMinutes(value: string | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i.exec(value || "");
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

function sortEntries(items: TimetableDoc[]): TimetableDoc[] {
  return [...items].sort(
    (a, b) =>
      DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) ||
      (toMinutes(a.startTime) ?? 0) - (toMinutes(b.startTime) ?? 0)
  );
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Read-only fields a student or parent sees for a period of their (child's) class. */
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
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId") || undefined;
    const dayOfWeek = searchParams.get("dayOfWeek") || undefined;

    // STUDENT and PARENT: the class is always derived server-side — the student's own record
    // (student → classId), or a child linked to the parent (parent → student → classId). Any
    // ?classId= / ?teacherId= they send is ignored, so no other class's timetable is reachable.
    if (authUser.role === "STUDENT" || authUser.role === "PARENT") {
      const student =
        authUser.role === "STUDENT"
          ? await resolveSessionStudent(authUser)
          : await assertParentOwnsStudent(authUser, (searchParams.get("studentId") || "").trim());
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
    console.error("Timetable GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve timetable records." },
      { status: 500 }
    );
  }
}

type SlotResult = { ok: true; slot: Omit<TimetableDoc, "id" | "createdAt" | "updatedAt"> } | { ok: false; error: string; status: number };

/**
 * Validates an admin-submitted slot against this school's own records. Names are always taken
 * from the referenced documents, never from the request, and the slot may not clash with
 * another slot of the same teacher, class or room on that day.
 */
async function buildSlot(authUser: AuthenticatedUser, body: any, editingId?: string): Promise<SlotResult> {
  const classId = String(body?.classId || "").trim();
  const subjectId = String(body?.subjectId || "").trim();
  const dayOfWeek = String(body?.dayOfWeek || "").trim() as TimetableDoc["dayOfWeek"];
  const periodName = String(body?.periodName || "").trim();
  const startTime = String(body?.startTime || "").trim();
  const endTime = String(body?.endTime || "").trim();
  const roomNo = String(body?.roomNo || "").trim();
  const topic = String(body?.topic || "").trim();
  const requestedTeacherId = String(body?.teacherId || "").trim();

  if (!classId || !subjectId || !dayOfWeek || !periodName || !startTime || !endTime) {
    return { ok: false, status: 400, error: "Class, Subject, Day, Period, Start Time, and End Time are required." };
  }
  if ([classId, subjectId, requestedTeacherId].some((v) => v.length > 128) || periodName.length > 60 || roomNo.length > 40 || topic.length > 200) {
    return { ok: false, status: 400, error: "One or more fields are too long (period max 60, room max 40, topic max 200 characters)." };
  }
  if (!DAYS.includes(dayOfWeek)) return { ok: false, status: 400, error: "Day must be a weekday name (Monday–Sunday)." };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return { ok: false, status: 400, error: "Start and end time must be valid times (HH:MM)." };
  if (end <= start) return { ok: false, status: 400, error: "End time must be after start time." };

  const [classes, subjects, teachers] = await Promise.all([
    getClassesServer(authUser.schoolId),
    getSubjectsServer(authUser.schoolId),
    getTeachersServer(authUser.schoolId),
  ]);
  const cls = classes.find((c) => c.id === classId);
  if (!cls) return { ok: false, status: 404, error: "Class not found for this school." };
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject || subject.classId !== classId) {
    return { ok: false, status: 404, error: "Subject not found for this class." };
  }

  // Defaults to the subject's allocated teacher; an explicit teacher must belong to this school.
  const teacherId = requestedTeacherId || subject.teacherId || "";
  const teacher = teacherId ? teachers.find((t) => t.id === teacherId) : null;
  if (teacherId && !teacher) return { ok: false, status: 404, error: "Teacher not found for this school." };

  const sameDay = (await getTimetableServer(authUser.schoolId, undefined, undefined, dayOfWeek)).filter(
    (t) => t.id !== editingId
  );
  const overlaps = (t: TimetableDoc) => {
    const s = toMinutes(t.startTime);
    const e = toMinutes(t.endTime);
    return s !== null && e !== null && s < end && start < e;
  };
  const clash =
    (teacher && sameDay.find((t) => t.teacherId === teacher.id && overlaps(t))) ||
    sameDay.find((t) => t.classId === classId && overlaps(t)) ||
    (roomNo && roomNo !== "-" && sameDay.find((t) => t.roomNo === roomNo && overlaps(t)));
  if (clash) {
    const who =
      teacher && clash.teacherId === teacher.id ? `${teacher.fullName} is` :
      clash.classId === classId ? "This class is" : `Room ${roomNo} is`;
    return {
      ok: false,
      status: 409,
      error: `${who} already scheduled on ${dayOfWeek} ${clash.startTime}–${clash.endTime} (${clash.subjectName}, ${clash.className}).`,
    };
  }

  return {
    ok: true,
    slot: {
      schoolId: authUser.schoolId,
      teacherId: teacher ? teacher.id : "",
      teacherName: teacher ? teacher.fullName : "Unassigned",
      classId: cls.id,
      className: `${cls.name}-${cls.section}`,
      subjectId: subject.id,
      subjectName: subject.name,
      dayOfWeek,
      periodName,
      startTime,
      endTime,
      roomNo: roomNo || cls.roomNo || "",
      topic,
    },
  };
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
    console.error("Timetable DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete timetable slot." }, { status: 500 });
  }
}
