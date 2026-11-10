import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTimetableServer,
  saveTimetableEntryServer,
  getClassesServer,
  getSubjectsServer
} from "@/lib/firebase/server-db";
import { TimetableDoc } from "@/lib/firebase/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT"]);
    const { searchParams } = new URL(req.url);

    const teacherId = searchParams.get("teacherId") || (authUser.role === "TEACHER" ? authUser.teacherId : undefined);
    const classId = searchParams.get("classId") || undefined;
    const dayOfWeek = searchParams.get("dayOfWeek") || undefined;

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
