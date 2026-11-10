import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  getTeachersServer,
  getClassesServer,
  getFeeChallansServer,
  getExamResultsServer,
  getAttendanceServer
} from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const schoolId = authUser.schoolId;

    const [classes, students, teachers, challans, examResults, attendanceRecords] = await Promise.all([
      getClassesServer(schoolId),
      getStudentsServer(schoolId),
      getTeachersServer(schoolId),
      getFeeChallansServer(schoolId),
      getExamResultsServer(schoolId),
      getAttendanceServer(schoolId)
    ]);

    // 1. Real Attendance Report by Class
    const attendanceByClass = classes.map((cls) => {
      const clsStudents = students.filter((s) => s.classId === cls.id);
      const clsAtt = attendanceRecords.filter((a) => a.classId === cls.id);
      const totalDays = clsAtt.length;
      const present = clsAtt.filter((a) => a.status === "PRESENT").length;
      const late = clsAtt.filter((a) => a.status === "LATE").length;
      const leave = clsAtt.filter((a) => a.status === "LEAVE").length;
      const absent = clsAtt.filter((a) => a.status === "ABSENT").length;
      const attendanceRate = totalDays > 0 ? Number((((present + late) / totalDays) * 100).toFixed(1)) : 0;

      return {
        classId: cls.id,
        className: `${cls.name}-${cls.section}`,
        studentCount: clsStudents.length,
        attendanceRate,
        present,
        late,
        leave,
        absent,
      };
    });

    // 2. Fee Collection Report by Class
    const feeByClass = classes.map((cls) => {
      const clsChallans = challans.filter((c) => c.classId === cls.id);
      const expected = clsChallans.reduce((s, f) => s + (f.totalExpected || 0), 0);
      const collected = clsChallans.reduce((s, f) => s + (f.paidAmount || 0), 0);
      const outstanding = Math.max(0, expected - collected);
      const collectionRate = expected > 0 ? ((collected / expected) * 100).toFixed(1) : "0.0";

      return {
        classId: cls.id,
        className: `${cls.name}-${cls.section}`,
        studentCount: students.filter((s) => s.classId === cls.id).length,
        expected,
        collected,
        outstanding,
        collectionRate: Number(collectionRate),
      };
    });

    // 3. Academic Grade Distribution
    const gradeDistribution = {
      "A+": examResults.filter((r) => r.grade === "A+").length,
      A: examResults.filter((r) => r.grade === "A").length,
      "B+": examResults.filter((r) => r.grade === "B+").length,
      B: examResults.filter((r) => r.grade === "B").length,
      C: examResults.filter((r) => r.grade === "C").length,
      D: examResults.filter((r) => r.grade === "D").length,
      F: examResults.filter((r) => r.grade === "F").length,
    };

    const totalResults = examResults.length;
    const passedResults = examResults.filter((r) => r.grade !== "F").length;
    const passPercentage = totalResults > 0 ? ((passedResults / totalResults) * 100).toFixed(1) : "0.0";

    const femaleStudents = students.filter((s) => s.gender === "FEMALE").length;
    const maleStudents = students.filter((s) => s.gender === "MALE").length;

    return NextResponse.json({
      success: true,
      summary: {
        totalStudents: students.length,
        totalTeachers: teachers.length,
        totalClasses: classes.length,
        femaleStudents,
        maleStudents,
        passPercentage: Number(passPercentage),
      },
      attendanceByClass,
      feeByClass,
      gradeDistribution,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Reports error:", error);
    return NextResponse.json(
      { error: "Failed to generate report analytics." },
      { status: 500 }
    );
  }
}
