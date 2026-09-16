import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getAttendanceServer,
  saveAttendanceBulkServer,
  createAuditLogServer,
  getClassesServer
} from "@/lib/firebase/server-db";
import { AttendanceDoc } from "@/lib/firebase/types";
import { assertTeacherOwnsClass } from "@/lib/academic-access";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");
    const dateStr = searchParams.get("date") || new Date().toISOString().split("T")[0];

    if (!classId) {
      return NextResponse.json({ error: "classId is required" }, { status: 400 });
    }

    // A TEACHER may only view attendance for a class in their own assignedClassIds. This is
    // never inferred from anything client-supplied beyond the classId itself being checked
    // against the authenticated teacher's own Firestore record.
    await assertTeacherOwnsClass(authUser, classId);

    const [students, existingRecords] = await Promise.all([
      getStudentsServer(authUser.schoolId, classId),
      getAttendanceServer(authUser.schoolId, dateStr, classId)
    ]);

    const recordMap = new Map(existingRecords.map((r) => [r.studentId, r]));

    const roster = students.map((st) => {
      const existing = recordMap.get(st.id);
      return {
        studentId: st.id,
        admissionNumber: st.admissionNo,
        rollNumber: st.rollNo,
        name: st.fullName,
        gender: st.gender === "MALE" ? "Male" : "Female",
        status: existing ? existing.status : "PRESENT",
        remarks: existing?.remarks || "",
        recordId: existing?.id || null,
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
      roster,
      summary,
      isSaved: existingRecords.length > 0,
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
    const body = await req.json();
    const { classId, date, records } = body;

    if (!classId || !date || !Array.isArray(records)) {
      return NextResponse.json(
        { error: "classId, date, and records array are required." },
        { status: 400 }
      );
    }
    if (isNaN(new Date(date).getTime())) {
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

    // A TEACHER may only mark attendance for a class in their own assignedClassIds.
    await assertTeacherOwnsClass(authUser, classId);

    const validStudentIds = new Set(studentsInClass.map((s) => s.id));
    const invalidRecord = records.find((r: any) => !validStudentIds.has(r.studentId));
    if (invalidRecord) {
      return NextResponse.json(
        { error: "One or more students in the roster do not belong to this class." },
        { status: 403 }
      );
    }

    const attendanceDocs: AttendanceDoc[] = records.map((r: any) => ({
      id: `${authUser.schoolId}_${classId}_${r.studentId}_${date}`,
      schoolId: authUser.schoolId,
      classId,
      studentId: r.studentId,
      date,
      status: r.status,
      remarks: r.remarks || "",
      recordedBy: authUser.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    await saveAttendanceBulkServer(attendanceDocs);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "MARK_ATTENDANCE",
      "ATTENDANCE",
      classId,
      `Recorded roll call for class on ${date} (${records.length} students processed).`
    );

    return NextResponse.json({
      success: true,
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
