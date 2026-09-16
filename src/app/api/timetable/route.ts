import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTimetableServer,
  saveTimetableEntryServer,
  getClassesServer,
  getSubjectsServer,
  getTeachersServer
} from "@/lib/firebase/server-db";
import { TimetableDoc } from "@/lib/firebase/types";
import { assertTeacherOwnsClass } from "@/lib/academic-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // STUDENT was previously allowed but had no scoping at all — a student session could
    // pass any ?classId= or ?teacherId= and read the whole school's timetable. No student
    // page calls this route (the student portal is served by /api/student/me), so the role
    // is removed rather than a scoping rule invented for an unused code path.
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);

    // A TEACHER can only ever see their own timetable — their teacherId is taken from the
    // authenticated session and a client-supplied ?teacherId= is ignored outright (not just
    // defaulted-to), so a teacher can no longer view another teacher's schedule by passing a
    // different id in the query string.
    const teacherId = authUser.role === "TEACHER"
      ? authUser.teacherId
      : (searchParams.get("teacherId") || undefined);
    const classId = searchParams.get("classId") || undefined;
    const dayOfWeek = searchParams.get("dayOfWeek") || undefined;

    // A TEACHER filtering by classId may only do so for a class in their own
    // assignedClassIds — resolved server-side, matching the same convention used for
    // attendance/exams/observations.
    if (authUser.role === "TEACHER" && classId) {
      await assertTeacherOwnsClass(authUser, classId);
    }

    const items = await getTimetableServer(authUser.schoolId, teacherId, classId, dayOfWeek);

    return NextResponse.json({
      success: true,
      timetable: items,
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

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();

    const {
      teacherId,
      teacherName,
      classId,
      className,
      subjectId,
      subjectName,
      dayOfWeek,
      periodName,
      startTime,
      endTime,
      roomNo,
      topic,
    } = body;

    if (!classId || !className || !subjectName || !dayOfWeek || !periodName || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Class, Subject, Day, Period, Start Time, and End Time are required." },
        { status: 400 }
      );
    }

    // Verify the class (and, if supplied, the teacher/subject) actually belong to this school
    // before persisting a timetable slot that references them.
    const classes = await getClassesServer(authUser.schoolId);
    if (!classes.some((c) => c.id === classId)) {
      return NextResponse.json({ error: "Class not found for this school." }, { status: 404 });
    }
    if (subjectId) {
      const subjects = await getSubjectsServer(authUser.schoolId);
      if (!subjects.some((s) => s.id === subjectId)) {
        return NextResponse.json({ error: "Subject not found for this school." }, { status: 404 });
      }
    }
    if (teacherId) {
      const teachers = await getTeachersServer(authUser.schoolId);
      if (!teachers.some((t) => t.id === teacherId)) {
        return NextResponse.json({ error: "Teacher not found for this school." }, { status: 404 });
      }
    }

    const doc: TimetableDoc = {
      id: `tt-${authUser.schoolId}-${Date.now()}`,
      schoolId: authUser.schoolId,
      teacherId: teacherId || "unassigned",
      teacherName: teacherName || "Unassigned Faculty",
      classId,
      className,
      subjectId,
      subjectName,
      dayOfWeek,
      periodName,
      startTime,
      endTime,
      roomNo: roomNo || "-",
      topic: topic || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const id = await saveTimetableEntryServer(doc);

    return NextResponse.json({ success: true, id, timetable: doc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Timetable POST error:", error);
    return NextResponse.json(
      { error: "Failed to create timetable slot." },
      { status: 500 }
    );
  }
}
