import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentByIdServer,
  saveStudentServer,
  getStudentAttendanceServer,
  getStudentFeeChallansServer,
  getExamResultsServer,
  getStudentObservationsServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer
} from "@/lib/firebase/server-db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req);
    const { id } = await params;

    // Student privacy guard
    if (authUser.role === "STUDENT") {
      if (!authUser.studentId || authUser.studentId !== id) {
        return NextResponse.json(
          { error: "Forbidden: You cannot view another student's dossier." },
          { status: 403 }
        );
      }
    }

    const student = await getStudentByIdServer(authUser.schoolId, id);
    if (!student) {
      return NextResponse.json({ error: "Student record not found." }, { status: 404 });
    }

    const [attendances, challans, examResults, observations, classes, subjects] = await Promise.all([
      getStudentAttendanceServer(authUser.schoolId, id),
      getStudentFeeChallansServer(authUser.schoolId, id),
      getExamResultsServer(authUser.schoolId, undefined, undefined, id),
      getStudentObservationsServer(authUser.schoolId, id),
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId, student.classId)
    ]);

    const targetClass = classes.find((c) => c.id === student.classId);

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
      email: `${student.id}@alliedschool.edu`,
      address: student.address || "Not Provided",
      guardianName: student.guardianName,
      guardianRelation: student.guardianRelation,
      guardianPhone: student.guardianPhone,
      guardianEmail: "",
      guardianOccupation: "Not Specified",
      classId: student.classId,
      status: student.status,
      admissionDate: student.createdAt,
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
          exam: { name: "Mid-Term Examination 2024-25" },
          subject: { name: r.subjectName || "Subject", code: "SUB" }
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
    const body = await req.json();

    const existing = await getStudentByIdServer(authUser.schoolId, id);
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    const updated: typeof existing = {
      ...existing,
      fullName: body.firstName ? `${body.firstName} ${body.lastName || ""}`.trim() : existing.fullName,
      rollNo: body.rollNumber || existing.rollNo,
      gender: body.gender === "Male" ? "MALE" : body.gender === "Female" ? "FEMALE" : existing.gender,
      dob: body.dob || existing.dob,
      bloodGroup: body.bloodGroup || existing.bloodGroup,
      phone: body.contactNumber || existing.phone,
      guardianName: body.guardianName || existing.guardianName,
      guardianRelation: body.guardianRelation || existing.guardianRelation,
      guardianPhone: body.guardianPhone || existing.guardianPhone,
      classId: body.classId || existing.classId,
      status: body.status || existing.status,
      updatedAt: new Date().toISOString()
    };

    await saveStudentServer(updated);

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
