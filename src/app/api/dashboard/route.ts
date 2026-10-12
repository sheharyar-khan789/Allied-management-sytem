import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSessionClassesServer,
  getStudentCountsByClassServer,
  getTeachersServer,
  getFeeTotalsByClassServer,
  getRecentPaymentsServer,
  getAuditLogsServer,
  getSchoolSettingsServer,
  getAttendanceTotalsByClassServer,
  analyticsAttendanceWindowStart,
  ANALYTICS_ATTENDANCE_WINDOW_DAYS,
  emptyAttendanceCounts,
} from "@/lib/firebase/server-db";
import { getDefaultAcademicYear } from "@/lib/school-display";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin dashboard. Every figure comes from aggregates, not from reading the underlying documents:
 * per-class student counts and fee totals are count()/sum() aggregations (cached 60s), the 30-day
 * attendance rate comes from the attendanceDailyTotals summaries (one read per day). This route
 * used to read every student, challan, payment and attendance record of the school on each load
 * (~15,000 reads for a 300-student school).
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const schoolId = authUser.schoolId;

    const attendanceWindowStart = analyticsAttendanceWindowStart();
    const today = new Date().toISOString().split("T")[0];

    const [
      classesRes,
      studentCountsRes,
      teachersRes,
      feeTotalsRes,
      paymentsRes,
      auditLogsRes,
      settingsRes,
      attendanceRes,
    ] = await Promise.allSettled([
      getSessionClassesServer(schoolId),
      getStudentCountsByClassServer(schoolId),
      getTeachersServer(schoolId),
      getFeeTotalsByClassServer(schoolId),
      getRecentPaymentsServer(schoolId, 6),
      getAuditLogsServer(schoolId, 8),
      getSchoolSettingsServer(schoolId),
      getAttendanceTotalsByClassServer(schoolId, attendanceWindowStart, today),
    ]);

    // Out of quota: tell the client, rather than rendering a dashboard of zeros.
    for (const r of [classesRes, studentCountsRes, teachersRes, feeTotalsRes, paymentsRes, auditLogsRes, settingsRes, attendanceRes]) {
      if (r.status === "rejected") {
        const busy = serviceBusyResponseFor(r.reason, "/api/dashboard");
        if (busy) return busy;
        console.error("Dashboard partial failure:", r.reason);
      }
    }

    const classes = classesRes.status === "fulfilled" ? classesRes.value : [];
    const studentCounts = studentCountsRes.status === "fulfilled" ? studentCountsRes.value : new Map();
    const teachers = teachersRes.status === "fulfilled" ? teachersRes.value : [];
    const feeTotals = feeTotalsRes.status === "fulfilled" ? feeTotalsRes.value : new Map();
    const payments = paymentsRes.status === "fulfilled" ? paymentsRes.value : [];
    const auditLogs = auditLogsRes.status === "fulfilled" ? auditLogsRes.value : [];
    const settings = settingsRes.status === "fulfilled" ? settingsRes.value : null;
    const attendanceByClass = attendanceRes.status === "fulfilled" ? attendanceRes.value : new Map();

    const sessionClassIds = new Set(classes.map((c) => c.id));
    let totalStudentsAll = 0;
    let activeStudents = 0;
    for (const [classId, c] of studentCounts) {
      if (!sessionClassIds.has(classId)) continue;
      totalStudentsAll += c.total;
      activeStudents += c.active;
    }
    const activeTeachers = teachers.filter((t) => !t.status || t.status.toUpperCase() === "ACTIVE");

    // Attendance over the window (daily register, active-session classes).
    const att = emptyAttendanceCounts();
    for (const [classId, counts] of attendanceByClass) {
      if (!sessionClassIds.has(classId)) continue;
      att.PRESENT += counts.PRESENT;
      att.LATE += counts.LATE;
      att.ABSENT += counts.ABSENT;
      att.LEAVE += counts.LEAVE;
    }
    const totalAttRecords = att.PRESENT + att.LATE + att.ABSENT + att.LEAVE;
    const attendancePercentage = totalAttRecords > 0
      ? Number((((att.PRESENT + att.LATE) / totalAttRecords) * 100).toFixed(1))
      : 0;

    // Fee calculations. A payment is capped at the challan balance, so per challan
    // paid <= expected and outstanding = expected - collected.
    let totalExpected = 0;
    let totalCollected = 0;
    for (const [classId, t] of feeTotals) {
      if (!sessionClassIds.has(classId)) continue;
      totalExpected += t.expected;
      totalCollected += t.collected;
    }
    const totalOutstanding = Math.max(0, totalExpected - totalCollected);
    const collectionRate = totalExpected > 0 ? Number(((totalCollected / totalExpected) * 100).toFixed(1)) : 0;

    // Class snapshots
    const classWiseSnapshots = classes.map((cls) => {
      const fee = feeTotals.get(cls.id) || { count: 0, expected: 0, collected: 0 };
      const clsOutstanding = Math.max(0, fee.expected - fee.collected);
      const clsPct = fee.expected > 0 ? Math.round((fee.collected / fee.expected) * 100) : 0;

      return {
        id: cls.id,
        className: cls.name.includes(cls.section) ? cls.name : `${cls.name}-${cls.section}`,
        roomNumber: cls.roomNo || "-",
        studentCount: studentCounts.get(cls.id)?.total || 0,
        classTeacherName: cls.classTeacherName || "Unassigned",
        expected: fee.expected,
        collected: fee.collected,
        outstanding: clsOutstanding,
        collectionPercentage: clsPct,
      };
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalStudents: activeStudents || totalStudentsAll,
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
    const busy = serviceBusyResponseFor(error, "/api/dashboard");
    if (busy) return busy;
    console.error("Dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve dashboard analytics." },
      { status: 500 }
    );
  }
}
