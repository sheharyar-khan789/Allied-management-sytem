import { NextRequest, NextResponse } from "next/server";
import { validateStudentDates } from "@/lib/date-utils";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentByIdServer,
  saveStudentServer,
  deleteStudentServer,
  getStudentAttendanceServer,
  getStudentFeeChallansServer,
  getExamResultsServer,
  getStudentObservationsServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer,
  getExamsServer,
  getExamSchedulesForExamsServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import {
  resolveGradingScale,
  resultSubjectName,
  sortObservationsNewestFirst,
  summarizeResults,
  toObservationView,
} from "@/lib/exam-results";
import { assertCanViewStudent, canViewStudentAttendance } from "@/lib/academic-access";
import { linkGuardianEmailToStudent } from "@/lib/link-parent";
import { requireRecentAuth } from "@/lib/firebase/server-auth";
import { syncLoginActive } from "@/lib/account-status";
import { z } from "zod";
import { cnicNumber, documentsArray, idString, money, parseJsonBody, safeUrl } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optEmail = z.string().trim().max(254).email().optional().or(z.literal(""));

// Unknown keys are dropped; server-controlled keys (schoolId, userId, parentUserIds, admissionNo,
// fee balances, audit fields, ...) are rejected by parseJsonBody before this runs.
const studentFieldsSchema = {
  firstName: optText(80),
  lastName: optText(80),
  fullName: optText(160),
  rollNumber: optText(30),
  rollNo: optText(30),
  gender: z.enum(["Male", "Female", "MALE", "FEMALE"]).optional(),
  dob: optText(20),
  admissionDate: optText(20),
  bloodGroup: optText(20),
  cnicBForm: cnicNumber.optional(),
  contactNumber: optText(30),
  phone: optText(30),
  email: optEmail,
  address: optText(300),
  classId: idString.optional(),
  guardianName: optText(120),
  fatherName: optText(120),
  guardianRelation: optText(40),
  guardianPhone: optText(30),
  guardianEmail: optEmail,
  guardianOccupation: optText(80),
  photoUrl: safeUrl.optional(),
  documents: documentsArray.optional(),
};

const studentUpdateSchema = z.object({
  ...studentFieldsSchema,
  status: z.enum(["ACTIVE", "INACTIVE", "ALUMNI", "EXPELLED"]).optional(),
  monthlyFee: money.optional(),
  annualFee: money.optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    const { id } = await params;

    // Single shared authorization gate for every role, replacing a hand-rolled check that
    // covered STUDENT and PARENT but silently let any TEACHER read ANY student in the school —
    // the full dossier, including guardian contact details, fee balances and private
    // observation notes. assertCanViewStudent applies the same assignedClassIds rule already
    // enforced on attendance, exams, observations, timetable and every /api/print/* route, so
    // teacher scoping is now consistent across the whole application rather than correct
    // everywhere except here. It also performs the school-isolation and 404 checks.
    const student = await assertCanViewStudent(authUser, id);
    // Attendance is only for the class incharge: a subject teacher's dossier carries none.
    const showAttendance = await canViewStudentAttendance(authUser, student);
    // Fees are school finances: a TEACHER's dossier carries no challans or balances at all.
    const showFees = authUser.role !== "TEACHER";

    // Each section degrades to an empty/default value on its own failure (e.g. one collection
    // momentarily out of Firestore quota) instead of taking the whole dossier down with it: an
    // admin viewing a student should still see attendance and grades even if, say, observations
    // could not be read right now. Previously a single Promise.all meant any one of these nine
    // reads being out of quota turned the entire page into "Service is Temporarily Busy".
    async function settle<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
      try {
        return await promise;
      } catch (error) {
        if (error instanceof Response) throw error;
        console.error(`Student detail: ${label} read failed, showing without it`, error);
        return fallback;
      }
    }

    const [attendanceRecords, challans, examResults, observations, classes, allSubjects, exams, settings] = await Promise.all([
      settle("attendance", getStudentAttendanceServer(authUser.schoolId, id), []),
      settle("fees", showFees ? getStudentFeeChallansServer(authUser.schoolId, id) : Promise.resolve([]), []),
      settle("exam results", getExamResultsServer(authUser.schoolId, undefined, undefined, id), []),
      settle("observations", getStudentObservationsServer(authUser.schoolId, id), []),
      settle("classes", getClassesServer(authUser.schoolId), []),
      // One read of the whole-school subject list, reused below for both the student's class
      // subjects and result subject names, instead of two separate Firestore queries for the
      // same collection (the class-scoped one also used to race the whole-school one for the
      // shared cache, so it rarely hit the cache and issued its own query anyway).
      settle("subjects", getSubjectsServer(authUser.schoolId), []),
      settle("exams", getExamsServer(authUser.schoolId), []),
      settle("settings", getSchoolSettingsServer(authUser.schoolId), null),
    ]);

    const attendances = showAttendance ? attendanceRecords : [];
    const targetClass = classes.find((c) => c.id === student.classId);
    const subjects = allSubjects.filter((s) => s.classId === student.classId);
    const examNameById = new Map(exams.map((e) => [e.id, e.name]));
    const examById = new Map(exams.map((e) => [e.id, e]));
    const subjectsById = new Map(allSubjects.map((s) => [s.id, s]));
    const gradingScale = resolveGradingScale(settings);
    // The real exam date of each result comes from its schedule (the result's createdAt used to be
    // shown as the exam date). Only the exams this student has results in are read, in one
    // batched query instead of one Firestore round trip per distinct exam.
    const resultExamIds = Array.from(new Set(examResults.map((r) => r.examId)));
    const schedules = await settle(
      "exam schedules",
      getExamSchedulesForExamsServer(authUser.schoolId, resultExamIds),
      []
    );
    const scheduleById = new Map(schedules.map((s) => [s.id, s]));
    const scheduleOf = (r: (typeof examResults)[number]) =>
      (r.scheduleId && scheduleById.get(r.scheduleId)) ||
      schedules.find((s) => s.examId === r.examId && s.classId === r.classId && s.subjectId === r.subjectId);

    // Attendance stats
    const totalAtt = attendances.length;
    const presentAtt = attendances.filter((a) => a.status === "PRESENT").length;
    const lateAtt = attendances.filter((a) => a.status === "LATE").length;
    const leaveAtt = attendances.filter((a) => a.status === "LEAVE").length;
    const absentAtt = attendances.filter((a) => a.status === "ABSENT").length;
    const attPct = totalAtt > 0 ? ((presentAtt / totalAtt) * 100).toFixed(1) : "0.0";

    // Fee stats
    const totalExpectedFee = challans.reduce((s, c) => s + (c.totalExpected || 0), 0);
    const totalPaidFee = challans.reduce((s, c) => s + (c.paidAmount || 0), 0);
    const totalOutstandingFee = Math.max(0, totalExpectedFee - totalPaidFee);

    // Academics stats
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
      dob: student.dob,
      bloodGroup: student.bloodGroup || "Not Specified",
      cnicBForm: student.cnic || student.bForm || "",
      ...(authUser.role === "ADMIN"
        ? { monthlyFee: Number(student.monthlyFee) || 0, annualFee: Number(student.annualFee) || 0 }
        : {}),
      contactNumber: student.phone,
      email: student.email || "Not Available",
      address: student.address || "Not Provided",
      guardianName: student.guardianName,
      guardianRelation: student.guardianRelation,
      guardianPhone: student.guardianPhone,
      guardianEmail: student.guardianEmail || "",
      guardianOccupation: "Not Specified",
      classId: student.classId,
      status: student.status,
      admissionDate: student.admissionDate || student.createdAt,
      photoUrl: student.photoUrl || "",
      documents: student.documents || [],
      class: {
        id: student.classId,
        name: targetClass?.name || "",
        section: targetClass?.section || "",
        classTeacher: targetClass?.classTeacherName ? { firstName: targetClass.classTeacherName, lastName: "" } : null,
        subjects: subjects.map((sub) => ({
          id: sub.id,
          name: sub.name,
          code: sub.code,
          credits: sub.credits,
          teacher: { firstName: sub.teacherName || "Faculty", lastName: "" }
        }))
      },
      attendanceRestricted: !showAttendance,
      attendances: attendances.map((a) => ({
        id: a.id,
        date: a.date,
        status: a.status,
        remarks: a.remarks || ""
      })),
      leaveRequests: [],
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
      examResults: examResults
        .map((r) => {
          const subject = resultSubjectName(r, subjectsById);
          const schedule = scheduleOf(r);
          const exam = examById.get(r.examId);
          return {
            id: r.id,
            examId: r.examId,
            examStatus: exam?.status || "",
            marksObtained: r.obtainedMarks,
            maxMarks: r.totalMarks,
            passingMarks: typeof schedule?.passingMarks === "number" ? schedule.passingMarks : null,
            percentage: r.percentage,
            grade: r.grade,
            gpa: r.gpa,
            status: r.status,
            remarks: r.remarks || "",
            examSchedule: {
              examDate: schedule?.examDate || "",
              exam: { name: examNameById.get(r.examId) || "" },
              subject: { name: subject.name, code: subject.code }
            }
          };
        })
        .sort((a, b) =>
          a.examSchedule.exam.name.localeCompare(b.examSchedule.exam.name) ||
          a.examSchedule.subject.name.localeCompare(b.examSchedule.subject.name)
        ),
      observations: sortObservationsNewestFirst(
        observations.map((o) => ({
          ...toObservationView(o, examNameById),
          teacher: { firstName: o.teacherName || "Faculty", lastName: "" }
        }))
      ),
      examOptions: exams.map((e) => ({ id: e.id, name: e.name, term: e.term }))
    };

    return NextResponse.json({
      success: true,
      student: formattedStudent,
      stats: {
        attendance: {
          total: totalAtt,
          present: presentAtt,
          late: lateAtt,
          leave: leaveAtt,
          absent: absentAtt,
          percentage: Number(attPct),
        },
        ...(showFees
          ? {
              fees: {
                expected: totalExpectedFee,
                paid: totalPaidFee,
                outstanding: totalOutstandingFee,
              },
            }
          : {}),
        academics: {
          totalMarks: academics.totalMarks,
          obtainedMarks: academics.obtainedMarks,
          percentage: academics.percentage,
          gpa: academics.gpa,
          grade: academics.grade,
          passed: academics.passed,
          failed: academics.failed,
          totalExamsAppeared: examResults.length,
        },
      },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/[id]");
    if (busy) return busy;
    console.error("Student detail error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve student details." },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const parsed = await parseJsonBody(req, studentUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as z.infer<typeof studentUpdateSchema> & Record<string, any>;

    const existing = await getStudentByIdServer(authUser.schoolId, id);
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    // Only validate fields actually sent; an omitted date keeps the stored value.
    const dates = validateStudentDates({
      dob: body.dob !== undefined ? body.dob : existing.dob,
      admissionDate: body.admissionDate !== undefined ? body.admissionDate : existing.admissionDate,
    });
    if (!dates.ok) {
      return NextResponse.json({ error: dates.error }, { status: 400 });
    }

    const updated: typeof existing = {
      ...existing,
      fullName: body.fullName ? body.fullName.trim() : body.firstName ? `${body.firstName} ${body.lastName || ""}`.trim() : existing.fullName,
      rollNo: body.rollNumber || body.rollNo || existing.rollNo,
      gender: body.gender === "Male" || body.gender === "MALE" ? "MALE" : body.gender === "Female" || body.gender === "FEMALE" ? "FEMALE" : existing.gender,
      dob: dates.dob || existing.dob,
      admissionDate: dates.admissionDate || existing.admissionDate,
      bloodGroup: body.bloodGroup || existing.bloodGroup,
      phone:
        body.contactNumber !== undefined
          ? String(body.contactNumber).trim() || undefined
          : body.phone !== undefined
            ? String(body.phone).trim() || undefined
            : existing.phone,
      address: body.address !== undefined ? body.address : existing.address,
      fatherName: body.fatherName || body.guardianName || existing.fatherName,
      guardianName: body.guardianName || existing.guardianName,
      guardianRelation: body.guardianRelation || existing.guardianRelation,
      guardianPhone: body.guardianPhone || existing.guardianPhone,
      guardianEmail: body.guardianEmail !== undefined ? String(body.guardianEmail).trim().toLowerCase() : existing.guardianEmail,
      classId: body.classId || existing.classId,
      status: body.status || existing.status,
      photoUrl: body.photoUrl !== undefined ? body.photoUrl : existing.photoUrl,
      documents: body.documents !== undefined ? body.documents : (existing.documents || []),
      // CNIC was accepted by this schema but never written, so edits never persisted. The form
      // has one "CNIC / B-Form" field: writing it replaces any legacy imported bForm value too,
      // so a cleared or changed number can't fall back to a stale one on display.
      ...(body.cnicBForm !== undefined ? { cnic: body.cnicBForm, bForm: "" } : {}),
      monthlyFee: body.monthlyFee !== undefined ? Number(body.monthlyFee) : (Number(existing.monthlyFee) || 0),
      annualFee: body.annualFee !== undefined ? Number(body.annualFee) : (Number(existing.annualFee) || 0),
      updatedAt: new Date().toISOString()
    };

    if (body.classId && body.classId !== existing.classId) {
      const classes = await getClassesServer(authUser.schoolId);
      const targetClass = classes.find((c) => c.id === body.classId);
      // Only classes of the student's own session are valid targets; moving a record into
      // another session's class would mix the two sessions' rosters.
      if (!targetClass || targetClass.academicYear !== (existing.academicYear || targetClass.academicYear)) {
        return NextResponse.json(
          { error: "Selected class was not found in this student's academic session." },
          { status: 400 }
        );
      }
      updated.className = `${targetClass.name}-${targetClass.section}`;
      updated.section = targetClass.section;
    }

    await saveStudentServer(updated);
    if (updated.status !== existing.status) {
      await syncLoginActive(existing.userId, authUser.schoolId, updated.status === "ACTIVE");
    }

    if (updated.guardianEmail) {
      await linkGuardianEmailToStudent({
        schoolId: authUser.schoolId,
        student: updated,
        guardianEmail: updated.guardianEmail,
        guardianName: updated.guardianName,
      });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_STUDENT",
      "STUDENT",
      id,
      `Updated profile for student ${updated.fullName} (${updated.admissionNo}).` +
        (updated.monthlyFee !== (Number(existing.monthlyFee) || 0) ? ` Monthly fee: Rs. ${Number(existing.monthlyFee) || 0} → Rs. ${updated.monthlyFee}.` : "") +
        (updated.annualFee !== (Number(existing.annualFee) || 0) ? ` Annual fee: Rs. ${Number(existing.annualFee) || 0} → Rs. ${updated.annualFee}.` : "")
    );

    return NextResponse.json({ success: true, student: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/[id]");
    if (busy) return busy;
    console.error("Student update error:", error);
    return NextResponse.json(
      { error: "Failed to update student profile." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;

    const existing = await getStudentByIdServer(authUser.schoolId, id);
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    const isPermanent = req.nextUrl.searchParams.get("permanent") === "true";
    requireRecentAuth(authUser, isPermanent ? "delete a student record" : "archive a student", req);
    // Either way the student's own login stops working immediately.
    await syncLoginActive(existing.userId, authUser.schoolId, false);

    if (isPermanent) {
      await deleteStudentServer(authUser.schoolId, id);
      await createAuditLogServer(
        authUser.schoolId,
        authUser.uid,
        authUser.email,
        authUser.role,
        "DELETE_STUDENT",
        "STUDENT",
        id,
        `Deleted student ${existing.fullName} (${existing.admissionNo}).`
      );
      return NextResponse.json({ success: true, message: "Student deleted successfully." });
    }

    await saveStudentServer({
      ...existing,
      status: "INACTIVE",
      updatedAt: new Date().toISOString()
    });

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ARCHIVE_STUDENT",
      "STUDENT",
      id,
      `Archived student ${existing.fullName} (${existing.admissionNo}).`
    );

    return NextResponse.json({ success: true, message: "Student archived successfully." });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/[id]");
    if (busy) return busy;
    console.error("Student archive error:", error);
    return NextResponse.json(
      { error: "Failed to archive student record." },
      { status: 500 }
    );
  }
}
