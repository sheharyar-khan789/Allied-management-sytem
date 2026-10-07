import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { attendanceBodySchema, parseJsonBody } from "@/lib/input-validation";
import {
  getStudentsServer,
  getAttendanceServer,
  saveAttendanceBulkServer,
  createAuditLogServer,
  getClassesServer
} from "@/lib/firebase/server-db";
import { AttendanceDoc } from "@/lib/firebase/types";
import { assertTeacherCanAccessAttendance } from "@/lib/academic-access";
import {
  attendanceLockTime,
  canOverrideAttendanceLock,
  isAttendanceDateOpenForTeacher,
  isAttendanceLockedForTeacher,
} from "@/lib/attendance-lock";
import { validateDateString } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    // Absent/empty = the class's daily register; otherwise that subject's register.
    const subjectId = searchParams.get("subjectId") || null;
    const rawDate = searchParams.get("date");
    const dateStr = rawDate ? validateDateString(rawDate) : new Date().toISOString().split("T")[0];

    if (!classId) {
      return NextResponse.json({ error: "classId is required" }, { status: 400 });
    }
    if (!dateStr) {
      return NextResponse.json({ error: "date must be a valid YYYY-MM-DD calendar date." }, { status: 400 });
    }

    // A TEACHER may only open a subject register for a subject allocated to them in this class,
    // or the daily register of a class they are incharge of — checked against their own
    // Firestore records before anything is read, so no other register's data is ever returned.
    const { subject } = await assertTeacherCanAccessAttendance(authUser, classId, subjectId);

    const [students, existingRecords] = await Promise.all([
      getStudentsServer(authUser.schoolId, classId),
      getAttendanceServer(authUser.schoolId, dateStr, classId, undefined, undefined, undefined, { subjectId })
    ]);

    const recordMap = new Map(existingRecords.map((r) => [r.studentId, r]));
    const now = Date.now();
    const canOverride = canOverrideAttendanceLock(authUser.role);
    const dateOpenForTeacher = isAttendanceDateOpenForTeacher(dateStr, now);

    const roster = students.map((st) => {
      const existing = recordMap.get(st.id);
      // Mirrors the POST rule: an existing record locks for teachers 24h after it was first
      // marked; an unmarked one can only be created while the date is inside that window.
      const lockedForTeachers = existing
        ? isAttendanceLockedForTeacher(existing, now)
        : !dateOpenForTeacher;
      return {
        studentId: st.id,
        admissionNumber: st.admissionNo,
        rollNumber: st.rollNo,
        name: st.fullName,
        gender: st.gender === "MALE" ? "Male" : "Female",
        status: existing ? existing.status : "PRESENT",
        remarks: existing?.remarks || "",
        recordId: existing?.id || null,
        saved: Boolean(existing),
        lockedForTeachers,
        lockedAt: existing ? attendanceLockTime(existing) : null,
        editable: canOverride || !lockedForTeachers,
      };
    });

    const summary = {
      total: roster.length,
      present: roster.filter((r) => r.status === "PRESENT").length,
      absent: roster.filter((r) => r.status === "ABSENT").length,
      late: roster.filter((r) => r.status === "LATE").length,
      leave: roster.filter((r) => r.status === "LEAVE").length,
    };

    return NextResponse.json({
      success: true,
      date: dateStr,
      classId,
      subjectId,
      subjectName: subject?.name || null,
      roster,
      summary,
      isSaved: existingRecords.length > 0,
      savedCount: roster.filter((r) => r.saved).length,
      // Whole register is read-only for this caller (a teacher after the 24h window).
      locked: roster.length > 0 && roster.every((r) => !r.editable),
      lockedForTeachers: roster.some((r) => r.lockedForTeachers),
      canOverrideLock: canOverride,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Attendance GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve attendance roster." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const parsedBody = await parseJsonBody(req, attendanceBodySchema);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data;
    const { classId, date, records } = body;
    const subjectId: string | null =
      typeof body.subjectId === "string" && body.subjectId.trim() ? body.subjectId.trim() : null;

    if (!classId || !date || !Array.isArray(records)) {
      return NextResponse.json(
        { error: "classId, date, and records array are required." },
        { status: 400 }
      );
    }
    // Strict calendar validation (rejects e.g. 2026-02-31, which `new Date()` silently rolls over).
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || validateDateString(date) !== date) {
      return NextResponse.json({ error: "date is not a valid date." }, { status: 400 });
    }
    const VALID_STATUSES = new Set(["PRESENT", "LATE", "ABSENT", "LEAVE"]);
    const invalidStatus = records.find((r: any) => !VALID_STATUSES.has(r?.status));
    if (invalidStatus) {
      return NextResponse.json(
        { error: "Each record's status must be one of PRESENT, LATE, ABSENT, LEAVE." },
        { status: 400 }
      );
    }

    // Verify the class actually belongs to this school, and that every studentId in the
    // submitted roster genuinely belongs to that class in this school. Without this, a
    // caller could submit an arbitrary classId/studentId pair and have it persisted as if
    // it were this school's own attendance data.
    const [classes, studentsInClass] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getStudentsServer(authUser.schoolId, classId),
    ]);
    const classBelongsToSchool = classes.some((c) => c.id === classId);
    if (!classBelongsToSchool) {
      return NextResponse.json({ error: "Class not found for this school." }, { status: 404 });
    }

    // A TEACHER may only mark their own subject register in this class, or the daily register
    // of a class they are incharge of.
    const { subject } = await assertTeacherCanAccessAttendance(authUser, classId, subjectId);

    const validStudentIds = new Set(studentsInClass.map((s) => s.id));
    const invalidRecord = records.find((r: any) => !validStudentIds.has(r.studentId));
    if (invalidRecord) {
      return NextResponse.json(
        { error: "One or more students in the roster do not belong to this class." },
        { status: 403 }
      );
    }

    // 24-hour teacher lock, enforced here rather than trusted from the page. A record keeps its
    // original createdAt/recordedBy on every later save (they were previously reset on each
    // save, which would have let any re-save restart the lock window).
    const existingRecords = await getAttendanceServer(
      authUser.schoolId, date, classId, undefined, undefined, undefined, { subjectId }
    );
    const existingByStudent = new Map(existingRecords.map((r) => [r.studentId, r]));
    const canOverride = canOverrideAttendanceLock(authUser.role);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const dateOpenForTeacher = isAttendanceDateOpenForTeacher(date, now);

    const attendanceDocs: AttendanceDoc[] = [];
    const lockedStudentIds: string[] = [];
    let overriddenLocked = 0;

    for (const r of records as { studentId: string; status: AttendanceDoc["status"]; remarks?: string }[]) {
      const remarks = r.remarks || "";
      const existing = existingByStudent.get(r.studentId);

      if (existing) {
        const changed = existing.status !== r.status || (existing.remarks || "") !== remarks;
        if (!changed) continue;
        const locked = isAttendanceLockedForTeacher(existing, now);
        if (locked && !canOverride) {
          lockedStudentIds.push(r.studentId);
          continue;
        }
        if (locked) overriddenLocked++;
        attendanceDocs.push({
          ...existing,
          status: r.status,
          remarks,
          updatedBy: authUser.uid,
          updatedAt: nowIso,
        });
        continue;
      }

      if (!canOverride && !dateOpenForTeacher) {
        lockedStudentIds.push(r.studentId);
        continue;
      }
      attendanceDocs.push({
        id: subject
          ? `${authUser.schoolId}_${classId}_${subject.id}_${r.studentId}_${date}`
          : `${authUser.schoolId}_${classId}_${r.studentId}_${date}`,
        schoolId: authUser.schoolId,
        classId,
        ...(subject ? { subjectId: subject.id, subjectName: subject.name } : {}),
        studentId: r.studentId,
        date,
        status: r.status,
        remarks,
        recordedBy: authUser.uid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    if (lockedStudentIds.length > 0) {
      return NextResponse.json(
        {
          error:
            "Attendance is locked: teachers can only mark or change attendance within 24 hours of it being recorded. Please contact an administrator to make this change.",
          locked: true,
          lockedStudentIds,
        },
        { status: 403 }
      );
    }

    if (attendanceDocs.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No attendance changes to save.",
      });
    }

    await saveAttendanceBulkServer(attendanceDocs);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "MARK_ATTENDANCE",
      "ATTENDANCE",
      classId,
      `Recorded ${subject ? `${subject.name} subject` : "daily"} roll call for class on ${date} (${attendanceDocs.length} of ${records.length} records changed` +
        (overriddenLocked > 0 ? `, including ${overriddenLocked} locked record(s) edited by admin override` : "") +
        ")."
    );

    return NextResponse.json({
      success: true,
      saved: attendanceDocs.length,
      message: "Attendance recorded and synced to Firestore successfully.",
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Attendance POST error:", error);
    return NextResponse.json(
      { error: "Failed to save attendance." },
      { status: 500 }
    );
  }
}
