import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getExamsServer,
  saveExamServer,
  getExamSchedulesServer,
  saveExamScheduleServer,
  getExamResultsServer,
  saveExamResultsBulkServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer,
  getStudentsServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { ExamDoc, ExamResultDoc, ExamScheduleDoc, SchoolSettingsDoc } from "@/lib/firebase/types";
import { assertTeacherOwnsClass, resolveAuthenticatedTeacher } from "@/lib/academic-access";

// Grade/GPA are derived from the school's own configured grading scale (Settings), falling
// back to a sane default scale for schools that have not customized one yet. This replaces a
// previous hardcoded binary A/B split that ignored the school's real configuration entirely.
const DEFAULT_GRADING_SCALE: SchoolSettingsDoc["gradingScale"] = [
  { minPercentage: 90, grade: "A+", gpa: 4.0 },
  { minPercentage: 80, grade: "A", gpa: 3.7 },
  { minPercentage: 70, grade: "B+", gpa: 3.3 },
  { minPercentage: 60, grade: "B", gpa: 3.0 },
  { minPercentage: 50, grade: "C", gpa: 2.5 },
  { minPercentage: 40, grade: "D", gpa: 2.0 },
  { minPercentage: 0, grade: "F", gpa: 0.0 },
];

function gradeFor(percentage: number, scale: SchoolSettingsDoc["gradingScale"]) {
  const sorted = [...scale].sort((a, b) => b.minPercentage - a.minPercentage);
  const match = sorted.find((s) => percentage >= s.minPercentage) || sorted[sorted.length - 1];
  return match ? { grade: match.grade, gpa: match.gpa } : { grade: "F", gpa: 0 };
}

function splitName(fullName: string) {
  const parts = (fullName || "").trim().split(/\s+/);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

export async function GET(req: NextRequest) {
  try {
    // Only ADMIN/TEACHER ever call this route from the UI (admin/exams, teacher/gradebook).
    // It previously accepted any authenticated role and returned every class's full roster
    // and marks with no filtering — a STUDENT or PARENT session could call it directly and
    // read other students' grades. Restricted to the roles that actually use it.
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const examId = searchParams.get("examId");

    // A TEACHER only ever sees schedules/results for their own assignedClassIds — resolved
    // from the authenticated session, never from a client-supplied value.
    const teacher = await resolveAuthenticatedTeacher(authUser);
    const teacherAssignedClasses = teacher?.assignedClassIds?.length ? new Set(teacher.assignedClassIds) : null;

    const [exams, settings] = await Promise.all([
      getExamsServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);
    const gradingScale = settings?.gradingScale?.length ? settings.gradingScale : DEFAULT_GRADING_SCALE;

    const activeExam = examId ? exams.find((e) => e.id === examId) : exams[0];

    const realSchedules = activeExam
      ? await getExamSchedulesServer(authUser.schoolId, activeExam.id)
      : [];

    // Restrict to the teacher's own assigned classes (no-op for ADMIN or for a teacher with
    // no assignedClassIds configured yet — see assertTeacherOwnsClass for the same convention).
    const visibleSchedules = teacherAssignedClasses
      ? realSchedules.filter((s) => teacherAssignedClasses.has(s.classId))
      : realSchedules;

    const [classes, subjects] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
    ]);

    // Build the real roster + existing marks for each schedule, matching the exact shape the
    // admin and teacher gradebook pages expect (student.firstName/lastName/rollNumber/
    // admissionNumber, maxMarks, grade, gpa).
    const schedulesFormatted = await Promise.all(
      visibleSchedules.map(async (sched) => {
        const [classStudents, existingResults] = await Promise.all([
          getStudentsServer(authUser.schoolId, sched.classId, undefined, undefined, "ACTIVE"),
          getExamResultsServer(authUser.schoolId, activeExam!.id, sched.classId),
        ]);
        const resultsByStudent = new Map(
          existingResults.filter((r) => r.scheduleId === sched.id).map((r) => [r.studentId, r])
        );
        const cls = classes.find((c) => c.id === sched.classId);
        const subject = subjects.find((s) => s.id === sched.subjectId);

        const results = classStudents.map((st) => {
          const existing = resultsByStudent.get(st.id);
          const { firstName, lastName } = splitName(st.fullName);
          return {
            studentId: st.id,
            student: {
              firstName,
              lastName,
              rollNumber: st.rollNo,
              admissionNumber: st.admissionNo,
            },
            marksObtained: existing?.obtainedMarks ?? 0,
            maxMarks: sched.totalMarks,
            grade: existing?.grade ?? gradeFor(0, gradingScale).grade,
            gpa: existing?.gpa ?? gradeFor(0, gradingScale).gpa,
            remarks: existing?.remarks ?? "",
            cardUrl: existing?.cardUrl || undefined,
          };
        });

        return {
          id: sched.id,
          examDate: sched.examDate,
          startTime: sched.startTime,
          endTime: sched.endTime,
          maxMarks: sched.totalMarks,
          passingMarks: sched.passingMarks,
          classId: sched.classId,
          subjectId: sched.subjectId,
          class: cls ? { id: cls.id, name: cls.name, section: cls.section } : null,
          subject: subject ? { id: subject.id, name: subject.name, code: subject.code } : null,
          results,
        };
      })
    );

    const mappedExams = exams.map((e) => ({
      id: e.id,
      title: e.name,
      term: e.term,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      resultSheetUrl: e.resultSheetUrl || undefined,
      schedulesCount: e.id === activeExam?.id ? schedulesFormatted.length : undefined,
    }));

    const activeExamFormatted = activeExam ? {
      id: activeExam.id,
      title: activeExam.name,
      term: activeExam.term,
      startDate: activeExam.startDate,
      endDate: activeExam.endDate,
      status: activeExam.status,
      resultSheetUrl: activeExam.resultSheetUrl || undefined,
      schedules: schedulesFormatted,
    } : null;

    return NextResponse.json({
      success: true,
      exams: mappedExams,
      activeExam: activeExamFormatted,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Exams GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve examination records." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { title, term, startDate, endDate, schedules, resultSheetUrl } = body;

    if (!title || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Title, start date, and end date are required." },
        { status: 400 }
      );
    }
    if (isNaN(new Date(startDate).getTime()) || isNaN(new Date(endDate).getTime())) {
      return NextResponse.json({ error: "startDate/endDate must be valid dates." }, { status: 400 });
    }
    if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
      return NextResponse.json({ error: "endDate cannot be before startDate." }, { status: 400 });
    }

    const settings = await getSchoolSettingsServer(authUser.schoolId);
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const examId = `exam-${uniqueSuffix}`;
    const examDoc: ExamDoc = {
      id: examId,
      schoolId: authUser.schoolId,
      name: title,
      term: term || "Mid-Term",
      session: settings?.academicYear || new Date().getFullYear().toString(),
      startDate,
      endDate,
      status: "UPCOMING",
      resultSheetUrl: resultSheetUrl ? String(resultSheetUrl) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveExamServer(examDoc);

    // Optionally create real exam schedules (subject/class/date/time/marks) at the same time,
    // rather than the previous approach of fabricating a schedule grid on every read.
    let createdSchedules = 0;
    if (Array.isArray(schedules) && schedules.length > 0) {
      const [classes, subjects] = await Promise.all([
        getClassesServer(authUser.schoolId),
        getSubjectsServer(authUser.schoolId),
      ]);
      for (const s of schedules) {
        if (!s?.classId || !s?.subjectId || !s?.examDate || !s?.startTime || !s?.endTime) continue;
        const classOk = classes.some((c) => c.id === s.classId);
        const subjectOk = subjects.some((sub) => sub.id === s.subjectId && sub.classId === s.classId);
        if (!classOk || !subjectOk) continue; // never trust client-supplied class/subject ownership blindly
        const scheduleDoc: ExamScheduleDoc = {
          id: `sch-${examId}-${s.classId}-${s.subjectId}`,
          schoolId: authUser.schoolId,
          examId,
          classId: s.classId,
          subjectId: s.subjectId,
          examDate: s.examDate,
          startTime: s.startTime,
          endTime: s.endTime,
          totalMarks: Number(s.totalMarks) > 0 ? Number(s.totalMarks) : 100,
          passingMarks: Number(s.passingMarks) >= 0 ? Number(s.passingMarks) : 33,
          roomNo: s.roomNo || undefined,
          createdAt: new Date().toISOString(),
        };
        await saveExamScheduleServer(scheduleDoc);
        createdSchedules += 1;
      }
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_EXAM",
      "EXAM",
      examId,
      `Created examination cycle "${title}" with ${createdSchedules} subject schedule(s).`
    );

    return NextResponse.json({ success: true, exam: examDoc, schedulesCreated: createdSchedules }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Exam POST error:", error);
    return NextResponse.json({ error: "Failed to create exam cycle." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { examId, classId, subjectId, examDate, startTime, endTime, totalMarks, passingMarks, roomNo } = body;

    if (!examId || !classId || !subjectId || !examDate || !startTime || !endTime) {
      return NextResponse.json(
        { error: "examId, classId, subjectId, examDate, startTime, and endTime are required." },
        { status: 400 }
      );
    }
    if (isNaN(new Date(examDate).getTime())) {
      return NextResponse.json({ error: "examDate is not a valid date." }, { status: 400 });
    }
    if (endTime <= startTime) {
      return NextResponse.json({ error: "endTime must be after startTime." }, { status: 400 });
    }
    const resolvedTotalMarks = Number(totalMarks) > 0 ? Number(totalMarks) : 100;
    const resolvedPassingMarks = Number(passingMarks) >= 0 ? Number(passingMarks) : 33;
    if (resolvedPassingMarks > resolvedTotalMarks) {
      return NextResponse.json(
        { error: "passingMarks cannot be greater than totalMarks." },
        { status: 400 }
      );
    }

    const [exams, classes, subjects] = await Promise.all([
      getExamsServer(authUser.schoolId),
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
    ]);
    const examOk = exams.some((e) => e.id === examId);
    if (!examOk) {
      return NextResponse.json({ error: "Exam not found for this school." }, { status: 404 });
    }
    const classOk = classes.some((c) => c.id === classId);
    const subjectOk = subjects.some((s) => s.id === subjectId && s.classId === classId);
    if (!classOk || !subjectOk) {
      return NextResponse.json({ error: "Class or subject not found for this school." }, { status: 404 });
    }

    const scheduleDoc: ExamScheduleDoc = {
      id: `sch-${examId}-${classId}-${subjectId}`,
      schoolId: authUser.schoolId,
      examId,
      classId,
      subjectId,
      examDate,
      startTime,
      endTime,
      totalMarks: resolvedTotalMarks,
      passingMarks: resolvedPassingMarks,
      roomNo: roomNo || undefined,
      createdAt: new Date().toISOString(),
    };
    await saveExamScheduleServer(scheduleDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_EXAM_SCHEDULE",
      "EXAM_SCHEDULE",
      scheduleDoc.id,
      `Added subject schedule to exam ${examId} for class ${classId}.`
    );

    return NextResponse.json({ success: true, schedule: scheduleDoc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Exam schedule PATCH error:", error);
    return NextResponse.json({ error: "Failed to add exam schedule." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const body = await req.json();

    // Support updating exam metadata (such as result sheet URL or status) by ADMIN
    if (body.examId && !body.examScheduleId) {
      if (authUser.role !== "ADMIN") {
        return NextResponse.json({ error: "Only administrators can update exam cycle details." }, { status: 403 });
      }
      const exams = await getExamsServer(authUser.schoolId);
      const targetExam = exams.find((e) => e.id === body.examId);
      if (!targetExam) {
        return NextResponse.json({ error: "Exam not found." }, { status: 404 });
      }
      if (body.resultSheetUrl !== undefined) {
        targetExam.resultSheetUrl = body.resultSheetUrl ? String(body.resultSheetUrl) : undefined;
      }
      if (body.title) targetExam.name = String(body.title);
      if (body.status) targetExam.status = body.status;
      await saveExamServer(targetExam);
      return NextResponse.json({ success: true, exam: targetExam });
    }

    const { examScheduleId, studentMarks } = body;

    if (!examScheduleId || !Array.isArray(studentMarks)) {
      return NextResponse.json(
        { error: "examScheduleId and studentMarks array are required." },
        { status: 400 }
      );
    }

    // The schedule (and therefore its real examId/classId/subjectId/totalMarks) is looked up
    // server-side and verified to belong to this school. Previously these were hardcoded
    // literals ("exam-midterm-2024", "cls-10a", "sub-101", totalMarks 100), which silently
    // corrupted every recorded result regardless of which exam/class/subject was actually
    // being graded.
    const exams = await getExamsServer(authUser.schoolId);
    let schedule: ExamScheduleDoc | undefined;
    for (const exam of exams) {
      const scheds = await getExamSchedulesServer(authUser.schoolId, exam.id);
      const found = scheds.find((s) => s.id === examScheduleId);
      if (found) {
        schedule = found;
        break;
      }
    }
    if (!schedule) {
      return NextResponse.json({ error: "Exam schedule not found for this school." }, { status: 404 });
    }

    // A TEACHER may only submit marks for a schedule whose class is in their own
    // assignedClassIds — resolved server-side, never trusting a client-supplied class/teacher.
    await assertTeacherOwnsClass(authUser, schedule.classId);

    // Verify every graded student actually belongs to this school and to the schedule's class.
    const classStudents = await getStudentsServer(authUser.schoolId, schedule.classId);
    const validStudentIds = new Set(classStudents.map((s) => s.id));
    const invalid = studentMarks.find((sm: any) => !validStudentIds.has(sm.studentId));
    if (invalid) {
      return NextResponse.json(
        { error: "One or more students do not belong to this exam schedule's class." },
        { status: 403 }
      );
    }

    const settings = await getSchoolSettingsServer(authUser.schoolId);
    const gradingScale = settings?.gradingScale?.length ? settings.gradingScale : DEFAULT_GRADING_SCALE;
    const totalMarks = schedule.totalMarks || 100;
    const studentsById = new Map(classStudents.map((s) => [s.id, s]));

    const examResults: ExamResultDoc[] = studentMarks.map((sm: any) => {
      const obtained = Math.max(0, Math.min(totalMarks, Number(sm.marksObtained) || 0));
      const percentage = Math.round((obtained / totalMarks) * 100);
      const { grade, gpa } = gradeFor(percentage, gradingScale);
      const student = studentsById.get(sm.studentId);
      return {
        id: `${authUser.schoolId}_${schedule!.examId}_${sm.studentId}_${schedule!.subjectId}`,
        schoolId: authUser.schoolId,
        examId: schedule!.examId,
        studentId: sm.studentId,
        studentName: student?.fullName,
        rollNo: student?.rollNo,
        classId: schedule!.classId,
        subjectId: schedule!.subjectId,
        scheduleId: examScheduleId,
        obtainedMarks: obtained,
        totalMarks,
        percentage,
        grade,
        gpa,
        status: percentage >= (schedule!.passingMarks / totalMarks) * 100 ? "PASS" : "FAIL",
        remarks: sm.remarks || "",
        cardUrl: sm.cardUrl ? String(sm.cardUrl) : undefined,
        evaluatedBy: authUser.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    await saveExamResultsBulkServer(examResults);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ENTER_EXAM_MARKS",
      "EXAM_RESULT",
      examScheduleId,
      `Recorded marks for schedule ${examScheduleId} (${studentMarks.length} students).`
    );

    return NextResponse.json({
      success: true,
      message: "Grades saved and calculated successfully in Firestore.",
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Marks entry error:", error);
    return NextResponse.json({ error: "Failed to record exam marks." }, { status: 500 });
  }
}
