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
  getSubjectsServer,
  getExamSchedulesServer,
  getStudentObservationsServer,
} from "@/lib/firebase/server-db";
import { ExamScheduleDoc, StudentDoc, StudentObservationDoc, SubjectDoc } from "@/lib/firebase/types";
import { schoolPrintIdentity } from "@/lib/school-display";
import {
  resolveGradingScale,
  resultSubjectName,
  sortObservationsNewestFirst,
  summarizeResults,
  toObservationView,
} from "@/lib/exam-results";

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
    /**
     * Report card extras: results grouped per exam (with the subjects scheduled for the student's
     * class that have no recorded mark yet) and the written observations.
     */
    reportCard?: boolean;
    /** Limit results/observations to one exam (the report card of that exam). */
    examId?: string | null;
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
  const visibleExams = exams.filter((e) => !options?.publishedResultsOnly || publishedExamIds.has(e.id));
  const selectedExamId =
    options?.examId && visibleExams.some((e) => e.id === options.examId) ? options.examId : null;
  const examResults = examResultsRaw.filter(
    (r) =>
      (!options?.publishedResultsOnly || publishedExamIds.has(r.examId)) &&
      (!selectedExamId || r.examId === selectedExamId)
  );

  const targetClass = classes.find((c) => c.id === student.classId);
  const examNameById = new Map(exams.map((e) => [e.id, e.name]));
  const gradingScale = resolveGradingScale(settings);

  // Results saved before the marks route stored subjectName carry only subjectId: their names
  // (and codes) are resolved from the subject records. Read only when needed.
  const needSubjects = Boolean(options?.reportCard) || examResults.some((r) => !r.subjectName);
  const reportExams = options?.reportCard
    ? visibleExams.filter((e) => !selectedExamId || e.id === selectedExamId)
    : [];
  const [subjects, schedulesPerExam, observationsRaw] = await Promise.all([
    needSubjects ? getSubjectsServer(schoolId) : Promise.resolve([] as SubjectDoc[]),
    Promise.all(reportExams.map((e) => getExamSchedulesServer(schoolId, e.id))),
    options?.reportCard
      ? getStudentObservationsServer(schoolId, student.id)
      : Promise.resolve([] as StudentObservationDoc[]),
  ]);
  const subjectsById = new Map(subjects.map((sub) => [sub.id, sub]));
  const scheduleById = new Map<string, ExamScheduleDoc>();
  const classSchedulesByExam = new Map<string, ExamScheduleDoc[]>();
  reportExams.forEach((e, i) => {
    classSchedulesByExam.set(e.id, schedulesPerExam[i].filter((sch) => sch.classId === student.classId));
    for (const sch of schedulesPerExam[i]) scheduleById.set(sch.id, sch);
  });
  const scheduleFor = (r: { scheduleId?: string; examId: string; subjectId: string }) =>
    (r.scheduleId && scheduleById.get(r.scheduleId)) ||
    (classSchedulesByExam.get(r.examId) || []).find((sch) => sch.subjectId === r.subjectId);

  const formattedResults = examResults
    .map((r) => {
      const subject = resultSubjectName(r, subjectsById);
      const schedule = scheduleFor(r);
      return {
        id: r.id,
        examId: r.examId,
        examName: examNameById.get(r.examId) || "",
        subjectId: r.subjectId,
        subjectName: subject.name,
        subjectCode: subject.code,
        examDate: schedule?.examDate || "",
        obtainedMarks: r.obtainedMarks,
        totalMarks: r.totalMarks,
        passingMarks: typeof schedule?.passingMarks === "number" ? schedule.passingMarks : null,
        percentage: r.percentage,
        grade: r.grade,
        gpa: typeof r.gpa === "number" ? r.gpa : null,
        status: r.status,
        remarks: r.remarks || "",
      };
    })
    .sort(
      (a, b) =>
        a.examName.localeCompare(b.examName) ||
        (a.examDate || "").localeCompare(b.examDate || "") ||
        a.subjectName.localeCompare(b.subjectName)
    );

  // Observations tied to an exam the viewer may not see yet are withheld along with its results.
  const visibleExamIds = new Set(visibleExams.map((e) => e.id));
  const observations = sortObservationsNewestFirst(
    observationsRaw
      .filter((o) => !o.examId || visibleExamIds.has(o.examId))
      .filter((o) => !selectedExamId || !o.examId || o.examId === selectedExamId)
      .map((o) => toObservationView(o, examNameById))
  );

  const examSections = reportExams
    .map((e) => {
      const rows = formattedResults.filter((r) => r.examId === e.id);
      const recordedSubjectIds = new Set(rows.map((r) => r.subjectId));
      const notRecorded = (classSchedulesByExam.get(e.id) || [])
        .filter((sch) => !recordedSubjectIds.has(sch.subjectId))
        .map((sch) => ({
          subjectId: sch.subjectId,
          subjectName: subjectsById.get(sch.subjectId)?.name || sch.subjectName || "",
          totalMarks: sch.totalMarks,
          examDate: sch.examDate,
        }));
      return {
        examId: e.id,
        examName: e.name,
        term: e.term,
        session: e.session,
        startDate: e.startDate,
        endDate: e.endDate,
        status: e.status,
        results: rows,
        notRecorded,
        summary: summarizeResults(rows, gradingScale),
        observations: observations.filter((o) => o.examId === e.id),
      };
    })
    .filter((sec) => sec.results.length > 0 || sec.notRecorded.length > 0 || selectedExamId === sec.examId);

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

  // Same arithmetic as the dossier and the student portal (src/lib/exam-results.ts).
  const overall = summarizeResults(examResults, gradingScale);

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
    results: formattedResults,
    academics: {
      percentage: overall.percentage,
      gpa: overall.gpa,
      totalMarks: overall.totalMarks,
      obtainedMarks: overall.obtainedMarks,
      grade: overall.grade,
      passed: overall.passed,
      failed: overall.failed,
      subjects: overall.subjects,
    },
    ...(options?.reportCard
      ? {
          exams: examSections,
          observations,
          selectedExamId,
          examOptions: visibleExams.map((e) => ({ id: e.id, name: e.name, term: e.term, status: e.status })),
          gradingScale,
          classTeacherName: targetClass?.classTeacherName || "",
        }
      : {}),
    school: schoolPrintIdentity(school, settings),
  };
}
