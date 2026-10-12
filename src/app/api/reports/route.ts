import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSessionClassesServer,
  getStudentCountsByClassServer,
  getTeachersServer,
  getFeeTotalsByClassServer,
  getExamGradeCountsServer,
  getAttendanceTotalsByClassServer,
  analyticsAttendanceWindowStart,
  ANALYTICS_ATTENDANCE_WINDOW_DAYS,
  emptyAttendanceCounts,
} from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

const GRADES = ["A+", "A", "B+", "B", "C", "D", "F"] as const;

export async function GET(req: NextRequest) {
  try {
    // School-wide analytics: fee collection by class, full student/teacher counts, grade
    // distribution. Only /admin/reports calls this route.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const schoolId = authUser.schoolId;

    // Every figure comes from aggregates (count()/sum() per class, per-grade counts, the
    // attendanceDailyTotals summaries for the 30-day window) instead of reading every student,
    // challan, exam result and attendance record (~16,000 reads per load before).
    const attendanceWindowStart = analyticsAttendanceWindowStart();
    const today = new Date().toISOString().split("T")[0];

    const [classes, studentCounts, teachers, feeTotals, grades, attendanceTotals] = await Promise.all([
      getSessionClassesServer(schoolId),
      getStudentCountsByClassServer(schoolId, { withGender: true }),
      getTeachersServer(schoolId),
      getFeeTotalsByClassServer(schoolId),
      getExamGradeCountsServer(schoolId, [...GRADES]),
      getAttendanceTotalsByClassServer(schoolId, attendanceWindowStart, today),
    ]);

    // 1. Real Attendance Report by Class (daily register, last ANALYTICS_ATTENDANCE_WINDOW_DAYS)
    const attendanceByClass = classes.map((cls) => {
      const counts = attendanceTotals.get(cls.id) || emptyAttendanceCounts();
      const totalDays = counts.PRESENT + counts.LATE + counts.LEAVE + counts.ABSENT;
      const attendanceRate =
        totalDays > 0 ? Number((((counts.PRESENT + counts.LATE) / totalDays) * 100).toFixed(1)) : 0;

      return {
        classId: cls.id,
        className: `${cls.name}-${cls.section}`,
        studentCount: studentCounts.get(cls.id)?.total || 0,
        attendanceRate,
        present: counts.PRESENT,
        late: counts.LATE,
        leave: counts.LEAVE,
        absent: counts.ABSENT,
      };
    });

    // 2. Fee collection by class
    const feeByClass = classes.map((cls) => {
      const t = feeTotals.get(cls.id) || { count: 0, expected: 0, collected: 0 };
      const outstanding = Math.max(0, t.expected - t.collected);
      const collectionRate = t.expected > 0 ? ((t.collected / t.expected) * 100).toFixed(1) : "0.0";

      return {
        classId: cls.id,
        className: `${cls.name}-${cls.section}`,
        studentCount: studentCounts.get(cls.id)?.total || 0,
        expected: t.expected,
        collected: t.collected,
        outstanding,
        collectionRate: Number(collectionRate),
      };
    });

    // 3. Grade distribution (exams of the active session)
    const gradeDistribution = Object.fromEntries(GRADES.map((g) => [g, grades.byGrade[g] || 0])) as Record<
      (typeof GRADES)[number],
      number
    >;
    const totalResults = grades.total;
    const passedResults = totalResults - (grades.byGrade.F || 0);
    const passPercentage = totalResults > 0 ? ((passedResults / totalResults) * 100).toFixed(1) : "0.0";

    let totalStudents = 0;
    let femaleStudents = 0;
    let maleStudents = 0;
    for (const cls of classes) {
      const c = studentCounts.get(cls.id);
      if (!c) continue;
      totalStudents += c.total;
      femaleStudents += c.female;
      maleStudents += c.male;
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalStudents,
        totalTeachers: teachers.length,
        totalClasses: classes.length,
        femaleStudents,
        maleStudents,
        passPercentage: Number(passPercentage),
      },
      attendanceWindowDays: ANALYTICS_ATTENDANCE_WINDOW_DAYS,
      attendanceByClass,
      feeByClass,
      gradeDistribution,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/reports");
    if (busy) return busy;
    console.error("Reports error:", error);
    return NextResponse.json(
      { error: "Failed to generate report analytics." },
      { status: 500 }
    );
  }
}
