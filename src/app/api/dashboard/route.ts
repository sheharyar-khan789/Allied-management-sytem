import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getTeachersServer,
  getClassesServer,
  getFeeChallansServer,
  getPaymentsServer,
  getAuditLogsServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const schoolId = authUser.schoolId;

    const [
      students,
      teachers,
      classes,
      challans,
      payments,
      auditLogs,
      settings
    ] = await Promise.all([
      getStudentsServer(schoolId),
      getTeachersServer(schoolId),
      getClassesServer(schoolId),
      getFeeChallansServer(schoolId),
      getPaymentsServer(schoolId),
      getAuditLogsServer(schoolId, 8),
      getSchoolSettingsServer(schoolId)
    ]);

    const activeStudents = students.filter((s) => s.status === "ACTIVE");
    const activeTeachers = teachers.filter((t) => t.status === "ACTIVE");

    // Fee calculations
    const totalExpected = challans.reduce((sum, c) => sum + (c.totalExpected || 0), 0);
    const totalCollected = challans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
    const totalOutstanding = challans.reduce((sum, c) => sum + Math.max(0, (c.totalExpected || 0) - (c.paidAmount || 0)), 0);
    const collectionRate = totalExpected > 0 ? ((totalCollected / totalExpected) * 100).toFixed(1) : "0";

    // Class snapshots
    const classWiseSnapshots = classes.map((cls) => {
      const clsStudents = students.filter((s) => s.classId === cls.id);
      const clsChallans = challans.filter((c) => c.classId === cls.id);
      const clsExpected = clsChallans.reduce((sum, c) => sum + (c.totalExpected || 0), 0);
      const clsCollected = clsChallans.reduce((sum, c) => sum + (c.paidAmount || 0), 0);
      const clsOutstanding = Math.max(0, clsExpected - clsCollected);
      const clsPct = clsExpected > 0 ? Math.round((clsCollected / clsExpected) * 100) : 100;

      return {
        id: cls.id,
        className: `${cls.name}-${cls.section}`,
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
        totalStudents: activeStudents.length,
        totalTeachers: activeTeachers.length,
        totalClasses: classes.length,
        attendancePercentage: 92.5,
        totalExpectedFee: totalExpected,
        totalCollectedFee: totalCollected,
        totalOutstandingFee: totalOutstanding,
        collectionRate: Number(collectionRate),
      },
      classWiseSnapshots,
      recentAuditLogs: auditLogs,
      recentPayments: payments.slice(0, 6),
      settings: settings || {
        schoolName: "Allied School",
        campusName: "Main Campus",
        academicYear: "2024-2025"
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
