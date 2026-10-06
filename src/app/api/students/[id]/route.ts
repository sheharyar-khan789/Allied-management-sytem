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
  getExamsServer
} from "@/lib/firebase/server-db";
import { assertCanViewStudent } from "@/lib/academic-access";
import { linkGuardianEmailToStudent } from "@/lib/link-parent";
import { requireRecentAuth } from "@/lib/firebase/server-auth";
import { syncLoginActive } from "@/lib/account-status";
import { z } from "zod";
import { documentsArray, idString, parseJsonBody, safeUrl } from "@/lib/input-validation";

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
  cnicBForm: optText(30),
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

    const [attendances, challans, examResults, observations, classes, subjects, exams] = await Promise.all([
      getStudentAttendanceServer(authUser.schoolId, id),
      getStudentFeeChallansServer(authUser.schoolId, id),
      getExamResultsServer(authUser.schoolId, undefined, undefined, id),
      getStudentObservationsServer(authUser.schoolId, id),
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId, student.classId),
      getExamsServer(authUser.schoolId)
    ]);

    const targetClass = classes.find((c) => c.id === student.classId);
    const examNameById = new Map(exams.map((e) => [e.id, e.name]));

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
    const totalMaxMarks = examResults.reduce((s, r) => s + (r.totalMarks || 100), 0);
    const totalObtainedMarks = examResults.reduce((s, r) => s + (r.obtainedMarks || 0), 0);
    const examPct = totalMaxMarks > 0 ? ((totalObtainedMarks / totalMaxMarks) * 100).toFixed(1) : "0";
    const avgGpa = examResults.length > 0
      ? (examResults.reduce((s, r) => s + (r.gpa || 0), 0) / examResults.length).toFixed(2)
      : "0.00";

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
      cnicBForm: student.cnic || student.bForm || "-",
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
      examResults: examResults.map((r) => ({
        id: r.id,
        marksObtained: r.obtainedMarks,
        maxMarks: r.totalMarks,
        percentage: r.percentage,
        grade: r.grade,
        gpa: r.gpa,
        remarks: r.remarks || "",
        examSchedule: {
          examDate: r.createdAt.split("T")[0],
          exam: { name: examNameById.get(r.examId) || "" },
          subject: { name: r.subjectName || "", code: "" }
        }
      })),
      observations: observations.map((o) => ({
        id: o.id,
        category: o.category,
        sentiment: o.sentiment,
        note: o.note,
        date: o.createdAt,
        teacher: { firstName: o.teacherName || "Faculty", lastName: "" }
      }))
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
        fees: {
          expected: totalExpectedFee,
          paid: totalPaidFee,
          outstanding: totalOutstandingFee,
        },
        academics: {
          totalMarks: totalMaxMarks,
          obtainedMarks: totalObtainedMarks,
          percentage: Number(examPct),
          gpa: Number(avgGpa),
          totalExamsAppeared: examResults.length,
        },
      },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
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
      phone: body.contactNumber || body.phone || existing.phone,
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
      `Updated profile for student ${updated.fullName} (${updated.admissionNo}).`
    );

    return NextResponse.json({ success: true, student: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
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
    console.error("Student archive error:", error);
    return NextResponse.json(
      { error: "Failed to archive student record." },
      { status: 500 }
    );
  }
}
