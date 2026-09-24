import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getTeachersServer,
  getClassesServer,
  getFeeChallansServer,
  getPaymentsServer,
  getAuditLogsServer,
  getSchoolSettingsServer,
  getAttendanceServer,
  analyticsAttendanceWindowStart,
  ANALYTICS_ATTENDANCE_WINDOW_DAYS
} from "@/lib/firebase/server-db";
import { getDefaultAcademicYear } from "@/lib/school-display";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const schoolId = authUser.schoolId;

    const attendanceWindowStart = analyticsAttendanceWindowStart();

    const [
      studentsRes,
      teachersRes,
      classesRes,
      challansRes,
      paymentsRes,
      auditLogsRes,
      settingsRes,
      attendanceRes
    ] = await Promise.allSettled([
      getStudentsServer(schoolId),
      getTeachersServer(schoolId),
      getClassesServer(schoolId),
      getFeeChallansServer(schoolId),
      getPaymentsServer(schoolId, undefined, 50),
      getAuditLogsServer(schoolId, 8),
      getSchoolSettingsServer(schoolId),
      getAttendanceServer(schoolId, undefined, undefined, undefined, attendanceWindowStart)
    ]);

    const students = studentsRes.status === "fulfilled" ? studentsRes.value : [];
    const teachers = teachersRes.status === "fulfilled" ? teachersRes.value : [];
    const classes = classesRes.status === "fulfilled" ? classesRes.value : [];
    const challans = challansRes.status === "fulfilled" ? challansRes.value : [];
    const payments = paymentsRes.status === "fulfilled" ? paymentsRes.value : [];
    const auditLogs = auditLogsRes.status === "fulfilled" ? auditLogsRes.value : [];
    const settings = settingsRes.status === "fulfilled" ? settingsRes.value : null;
    const attendanceRecords = attendanceRes.status === "fulfilled" ? attendanceRes.value : [];

    const activeStudents = students.filter((s) => !s.status || s.status.toUpperCase() === "ACTIVE");
    const activeTeachers = teachers.filter((t) => !t.status || t.status.toUpperCase() === "ACTIVE");

    // Real Attendance calculations
    const totalAttRecords = attendanceRecords.length;
    const presentAttRecords = attendanceRecords.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
    const attendancePercentage = totalAttRecords > 0
      ? Number(((presentAttRecords / totalAttRecords) * 100).toFixed(1))
      : 0;

    // Fee calculations
    const totalExpected = challans.reduce((sum, c) => sum + (c.totalExpected || 0), 0);
    const totalCollected = challans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
    const totalOutstanding = challans.reduce((sum, c) => sum + Math.max(0, (c.totalExpected || 0) - (c.paidAmount || 0)), 0);
    const collectionRate = totalExpected > 0 ? Number(((totalCollected / totalExpected) * 100).toFixed(1)) : 0;

    // Class snapshots
    const classWiseSnapshots = classes.map((cls) => {
      const clsStudents = students.filter((s) => s.classId === cls.id);
      const clsStudentIds = new Set(clsStudents.map((s) => s.id));
      const clsChallans = challans.filter((c) => c.classId === cls.id || (c.studentId && clsStudentIds.has(c.studentId)));
      const clsExpected = clsChallans.reduce((sum, c) => sum + (c.totalExpected || 0), 0);
      const clsCollected = clsChallans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
      const clsOutstanding = Math.max(0, clsExpected - clsCollected);
      const clsPct = clsExpected > 0 ? Math.round((clsCollected / clsExpected) * 100) : 0;

      return {
        id: cls.id,
        className: cls.name.includes(cls.section) ? cls.name : `${cls.name}-${cls.section}`,
        roomNumber: cls.roomNo || "-",
        studentCount: clsStudents.length,
        classTeacherName: cls.classTeacherName || "Unassigned",
        expected: clsExpected,
        collected: clsCollected,
        outstanding: clsOutstanding,
        collectionPercentage: clsPct,
      };
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalStudents: activeStudents.length || students.length,
        totalTeachers: activeTeachers.length || teachers.length,
        totalClasses: classes.length,
        attendancePercentage,
        attendanceWindowDays: ANALYTICS_ATTENDANCE_WINDOW_DAYS,
        totalExpectedFee: totalExpected,
        totalCollectedFee: totalCollected,
        totalOutstandingFee: totalOutstanding,
        collectionRate,
      },
      classWiseSnapshots,
      recentAuditLogs: auditLogs,
      recentPayments: payments.slice(0, 6),
      settings: settings || {
        schoolName: "Allied School",
        campusName: "Main Campus",
        academicYear: getDefaultAcademicYear()
      },
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve dashboard analytics." },
      { status: 500 }
    );
  }
}
