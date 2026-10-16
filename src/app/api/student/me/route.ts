import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentByIdServer,
  getStudentByUserIdServer,
  getSessionProfileServer,
  getUserByEmailServer,
  getStudentAttendanceTotalsServer,
  getStudentRecentAttendanceServer,
  getStudentFeeChallansServer,
  RECENT_ATTENDANCE_DAYS,
  getExamResultsServer,
  getExamsServer,
  getStudentObservationsServer,
  getClassesServer,
  getSubjectsServer,
  getSchoolServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { schoolPrintIdentity } from "@/lib/school-display";
import { AttendanceDoc, ExamResultDoc, FeeChallanDoc, StudentObservationDoc, SubjectDoc } from "@/lib/firebase/types";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import {
  resolveGradingScale,
  resultSubjectName,
  sortObservationsNewestFirst,
  summarizeResults,
  toObservationView,
} from "@/lib/exam-results";

/**
 * `?view=` selects what a student page needs, so each page reads only its own data:
 *  - dashboard: attendance/fee/academic stats, results, observations
 *  - attendance: attendance stats + the last RECENT_ATTENDANCE_DAYS days of records
 *  - fees: challans
 *  - results: exam results
 *  - profile: identity only
 * No view (older clients) = everything. Attendance stats come from the per-student totals
 * summary (1 read) instead of the student's whole attendance history.
 */
const VIEWS = ["dashboard", "attendance", "fees", "results", "profile", "all"] as const;
type View = (typeof VIEWS)[number];

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["STUDENT"]);
    const viewParam = new URL(req.url).searchParams.get("view") || "all";
    const view: View = (VIEWS as readonly string[]).includes(viewParam) ? (viewParam as View) : "all";
    const wants = {
      attendanceStats: view === "dashboard" || view === "attendance" || view === "all",
      attendanceRecords: view === "attendance" || view === "all",
      fees: view === "dashboard" || view === "fees" || view === "all",
      results: view === "dashboard" || view === "results" || view === "all",
      observations: view === "dashboard" || view === "all",
      // No student page renders the class's subject list; only the full (view-less) payload has it.
      subjects: view === "all",
    };

    // 1. Resolve studentId from session claims or user record
    let studentId = authUser.studentId;

    if (!studentId && authUser.uid) {
      const userProfile = await getSessionProfileServer(authUser.schoolId, authUser.uid);
      if (userProfile?.studentId) {
        studentId = userProfile.studentId;
      }
    }

    if (!studentId && authUser.email) {
      const userProfile = await getUserByEmailServer(authUser.email);
      if (userProfile?.studentId) {
        studentId = userProfile.studentId;
      }
    }

    // 2. If studentId still not found, search by userId mapping
    let student = null;
    if (studentId) {
      student = await getStudentByIdServer(authUser.schoolId, studentId);
    } else if (authUser.uid) {
      student = await getStudentByUserIdServer(authUser.schoolId, authUser.uid);
    }

    if (!student || student.schoolId !== authUser.schoolId) {
      return NextResponse.json(
        { error: "Student profile not found." },
        { status: 404 }
      );
    }

    const resolvedStudentId = student.id;

    // 3. Fetch related academic and financial datasets strictly for this student
    const [attendanceTotals, attendances, challans, examResultsRaw, exams, observations, classes, subjects, school, settings] = await Promise.all([
      wants.attendanceStats ? getStudentAttendanceTotalsServer(authUser.schoolId, resolvedStudentId) : Promise.resolve(null),
      wants.attendanceRecords ? getStudentRecentAttendanceServer(authUser.schoolId, resolvedStudentId) : Promise.resolve([] as AttendanceDoc[]),
      wants.fees ? getStudentFeeChallansServer(authUser.schoolId, resolvedStudentId) : Promise.resolve([] as FeeChallanDoc[]),
      wants.results ? getExamResultsServer(authUser.schoolId, undefined, undefined, resolvedStudentId) : Promise.resolve([] as ExamResultDoc[]),
      getExamsServer(authUser.schoolId),
      wants.observations ? getStudentObservationsServer(authUser.schoolId, resolvedStudentId) : Promise.resolve([] as StudentObservationDoc[]),
      getClassesServer(authUser.schoolId),
      // All subjects when results are shown: older results carry only subjectId, never a name.
      wants.subjects || wants.results ? getSubjectsServer(authUser.schoolId) : Promise.resolve([] as SubjectDoc[]),
      getSchoolServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId)
    ]);
    const publishedExamIds = new Set(exams.filter((e) => e.status === "PUBLISHED").map((e) => e.id));
    const examResults = examResultsRaw.filter((r) => publishedExamIds.has(r.examId));
    const examNameById = new Map(exams.map((e) => [e.id, e.name]));
    const subjectsById = new Map(subjects.map((s) => [s.id, s]));
    const classSubjects = subjects.filter((s) => s.classId === student.classId);
    const gradingScale = resolveGradingScale(settings);

    const targetClass = classes.find((c) => c.id === student.classId);

    // Attendance statistics (whole active session, daily register)
    const presentAtt = attendanceTotals?.PRESENT || 0;
    const lateAtt = attendanceTotals?.LATE || 0;
    const leaveAtt = attendanceTotals?.LEAVE || 0;
    const absentAtt = attendanceTotals?.ABSENT || 0;
    const totalAtt = presentAtt + lateAtt + leaveAtt + absentAtt;
    const attPct = totalAtt > 0 ? parseFloat(((presentAtt / totalAtt) * 100).toFixed(1)) : 0.0;

    // Fee statistics
    const totalExpectedFee = challans.reduce((s, c) => s + (c.totalExpected || 0), 0);
    const totalPaidFee = challans.reduce((s, c) => s + (c.paidAmount || 0), 0);
    const totalOutstandingFee = Math.max(0, totalExpectedFee - totalPaidFee);

    // Academic statistics
    // Same arithmetic as the report card (src/lib/exam-results.ts).
    const academics = summarizeResults(examResults, gradingScale);

    const formattedStudent = {
      id: student.id,
      admissionNumber: student.admissionNo,
      rollNumber: student.rollNo,
      firstName: student.fullName.split(" ")[0] || student.fullName,
      lastName: student.fullName.split(" ").slice(1).join(" ") || "",
      fullName: student.fullName,
      gender: student.gender === "MALE" ? "Male" : "Female",
      dob: student.dob || "",
      bloodGroup: student.bloodGroup || "Not Specified",
      cnicBForm: student.cnic || student.bForm || "",
      contactNumber: student.phone || "",
      email: authUser.email,
      address: student.address || "Not Provided",
      guardianName: student.guardianName || "Not Specified",
      guardianRelation: student.guardianRelation || "Guardian",
      guardianPhone: student.guardianPhone || "Not Provided",
      guardianEmail: "",
      classId: student.classId,
      status: student.status,
      admissionDate: student.createdAt,
      classTeacherName: targetClass?.classTeacherName || "",
      class: {
        id: student.classId,
        name: targetClass?.name || "",
        section: targetClass?.section || "",
        classTeacher: targetClass?.classTeacherName ? { firstName: targetClass.classTeacherName, lastName: "" } : null,
        subjects: classSubjects.map((sub) => ({
          id: sub.id,
          name: sub.name,
          code: sub.code,
          credits: sub.credits,
          teacher: { firstName: sub.teacherName || "Faculty", lastName: "" }
        }))
      },
      attendances: attendances.map((a) => ({
        id: a.id,
        date: a.date,
        status: a.status,
        remarks: a.remarks || ""
      })),
      feeChallans: challans.map((c) => ({
        id: c.id,
        challanNumber: c.challanNo,
        month: c.month,
        year: c.year,
        dueDate: c.dueDate,
        totalExpected: c.totalExpected,
        paidAmount: c.paidAmount,
        status: c.status === "PAID" ? "PAID" : c.paidAmount > 0 ? "PARTIAL" : "UNPAID",
        payments: []
      })),
      examResults: examResults.map((r) => {
        const subject = resultSubjectName(r, subjectsById);
        return {
          id: r.id,
          examId: r.examId,
          marksObtained: r.obtainedMarks,
          maxMarks: r.totalMarks,
          percentage: r.percentage,
          grade: r.grade,
          gpa: r.gpa,
          status: r.status,
          remarks: r.remarks || "",
          examSchedule: {
            exam: { name: examNameById.get(r.examId) || "" },
            subject: { name: subject.name, code: subject.code }
          }
        };
      }),
      // Observations tied to an exam that isn't published yet are withheld with its results.
      observations: sortObservationsNewestFirst(
        observations
          .filter((o) => !o.examId || publishedExamIds.has(o.examId))
          .map((o) => toObservationView(o, examNameById))
      )
    };

    return NextResponse.json({
      success: true,
      student: formattedStudent,
      stats: {
        attendance: {
          percentage: attPct,
          present: presentAtt,
          absent: absentAtt,
          late: lateAtt,
          leave: leaveAtt,
          total: totalAtt
        },
        fees: {
          expected: totalExpectedFee,
          paid: totalPaidFee,
          outstanding: totalOutstandingFee
        },
        academics: {
          percentage: academics.percentage,
          gpa: academics.gpa,
          grade: academics.grade,
          totalMarks: academics.totalMarks,
          obtainedMarks: academics.obtainedMarks
        }
      },
      school: schoolPrintIdentity(school, settings),
      view,
      // The on-screen list covers this many recent days; the stats cover the whole session.
      attendanceRecordsDays: RECENT_ATTENDANCE_DAYS
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/student/me");
    if (busy) return busy;
    console.error("Student /me route error:", error);
    return NextResponse.json(
      { error: "Failed to load student identity." },
      { status: 500 }
    );
  }
}
