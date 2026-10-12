import {
  getStudentAttendanceServer,
  getStudentAttendanceTotalsServer,
  getStudentRecentAttendanceServer,
  getStudentFeeChallansServer,
  getExamResultsServer,
  getExamsServer,
  getPaymentsByStudentServer,
  getClassesServer,
  getSchoolServer,
  getSchoolSettingsServer,
} from "@/lib/firebase/server-db";
import { StudentDoc } from "@/lib/firebase/types";
import { schoolPrintIdentity } from "@/lib/school-display";

export async function buildStudentAcademicPayload(
  schoolId: string,
  student: StudentDoc,
  options?: {
    publishedResultsOnly?: boolean;
    /**
     * "full" (default, printable reports): the whole session's attendance records.
     * "recent" (parent portal): the last RECENT_ATTENDANCE_DAYS days on screen, with the session
     * stats taken from the per-student totals summary instead of reading every record.
     */
    attendanceRecords?: "full" | "recent";
  }
) {
  const recentOnly = options?.attendanceRecords === "recent";
  const [attendances, attendanceTotals, challans, examResultsRaw, exams, payments, classes, school, settings] = await Promise.all([
    recentOnly ? getStudentRecentAttendanceServer(schoolId, student.id) : getStudentAttendanceServer(schoolId, student.id),
    recentOnly ? getStudentAttendanceTotalsServer(schoolId, student.id) : Promise.resolve(null),
    getStudentFeeChallansServer(schoolId, student.id),
    getExamResultsServer(schoolId, undefined, undefined, student.id),
    getExamsServer(schoolId),
    getPaymentsByStudentServer(schoolId, student.id),
    getClassesServer(schoolId),
    getSchoolServer(schoolId),
    getSchoolSettingsServer(schoolId),
  ]);

  const publishedExamIds = new Set(exams.filter((e) => e.status === "PUBLISHED").map((e) => e.id));
  const examResults = options?.publishedResultsOnly
    ? examResultsRaw.filter((r) => publishedExamIds.has(r.examId))
    : examResultsRaw;

  const targetClass = classes.find((c) => c.id === student.classId);
  const examNameById = new Map(exams.map((e) => [e.id, e.name]));

  const countOf = (status: "PRESENT" | "LATE" | "LEAVE" | "ABSENT") =>
    attendanceTotals ? attendanceTotals[status] : attendances.filter((a) => a.status === status).length;
  const presentAtt = countOf("PRESENT");
  const lateAtt = countOf("LATE");
  const leaveAtt = countOf("LEAVE");
  const absentAtt = countOf("ABSENT");
  const totalAtt = presentAtt + lateAtt + leaveAtt + absentAtt;
  const attPct = totalAtt > 0 ? parseFloat(((presentAtt / totalAtt) * 100).toFixed(1)) : 0;

  const totalExpectedFee = challans.reduce((s, c) => s + (c.totalExpected || 0), 0);
  const totalPaidFee = challans.reduce((s, c) => s + (c.paidAmount || 0), 0);
  const totalOutstandingFee = Math.max(0, totalExpectedFee - totalPaidFee);

  const totalMaxMarks = examResults.reduce((s, r) => s + (r.totalMarks || 0), 0);
  const totalObtainedMarks = examResults.reduce((s, r) => s + (r.obtainedMarks || 0), 0);
  const examPct = totalMaxMarks > 0 ? parseFloat(((totalObtainedMarks / totalMaxMarks) * 100).toFixed(1)) : 0;
  const gpaValues = examResults.filter((r) => typeof r.gpa === "number");
  const avgGpa =
    gpaValues.length > 0
      ? parseFloat((gpaValues.reduce((s, r) => s + (r.gpa || 0), 0) / gpaValues.length).toFixed(2))
      : null;

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      admissionNo: student.admissionNo,
      rollNo: student.rollNo,
      classId: student.classId,
      className: targetClass?.name || student.className || "",
      section: targetClass?.section || student.section || "",
      status: student.status,
      guardianName: student.guardianName,
    },
    attendance: {
      records: attendances
        .slice()
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .map((a) => ({
          id: a.id,
          date: a.date,
          status: a.status,
          remarks: a.remarks || "",
        })),
      stats: {
        percentage: attPct,
        present: presentAtt,
        absent: absentAtt,
        late: lateAtt,
        leave: leaveAtt,
        total: totalAtt,
      },
    },
    fees: {
      challans: challans
        .slice()
        .sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""))
        .map((c) => ({
          id: c.id,
          challanNo: c.challanNo,
          month: c.month,
          year: c.year,
          issueDate: c.issueDate,
          dueDate: c.dueDate,
          tuitionFee: c.tuitionFee,
          admissionFee: c.admissionFee,
          examFee: c.examFee,
          otherFee: c.otherFee,
          discount: c.discount,
          totalExpected: c.totalExpected,
          paidAmount: c.paidAmount,
          outstanding: Math.max(0, (c.totalExpected || 0) - (c.paidAmount || 0)),
          status: c.status,
        })),
      payments: payments
        .slice()
        .sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""))
        .map((p) => ({
          id: p.id,
          challanId: p.challanId,
          receiptNo: p.receiptNo,
          amount: p.amount,
          paymentDate: p.paymentDate,
          paymentMode: p.paymentMode,
          notes: p.notes || "",
        })),
      stats: {
        expected: totalExpectedFee,
        paid: totalPaidFee,
        outstanding: totalOutstandingFee,
      },
    },
    results: examResults.map((r) => ({
      id: r.id,
      examId: r.examId,
      examName: examNameById.get(r.examId) || "",
      subjectName: r.subjectName || "",
      obtainedMarks: r.obtainedMarks,
      totalMarks: r.totalMarks,
      percentage: r.percentage,
      grade: r.grade,
      gpa: typeof r.gpa === "number" ? r.gpa : null,
      status: r.status,
      remarks: r.remarks || "",
    })),
    academics: {
      percentage: examPct,
      gpa: avgGpa,
      totalMarks: totalMaxMarks,
      obtainedMarks: totalObtainedMarks,
    },
    school: schoolPrintIdentity(school, settings),
  };
}
