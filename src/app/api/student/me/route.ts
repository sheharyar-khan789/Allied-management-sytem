import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentByIdServer,
  getStudentByUserIdServer,
  getUserByIdServer,
  getUserByEmailServer,
  getStudentAttendanceServer,
  getStudentFeeChallansServer,
  getExamResultsServer,
  getExamsServer,
  getStudentObservationsServer,
  getClassesServer,
  getSubjectsServer,
  getSchoolServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { schoolPrintIdentity } from "@/lib/school-display";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["STUDENT"]);

    // 1. Resolve studentId from session claims or user record
    let studentId = authUser.studentId;

    if (!studentId && authUser.uid) {
      const userProfile = await getUserByIdServer(authUser.uid);
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
    const [attendances, challans, examResultsRaw, exams, observations, classes, subjects, school, settings] = await Promise.all([
      getStudentAttendanceServer(authUser.schoolId, resolvedStudentId),
      getStudentFeeChallansServer(authUser.schoolId, resolvedStudentId),
      getExamResultsServer(authUser.schoolId, undefined, undefined, resolvedStudentId),
      getExamsServer(authUser.schoolId),
      getStudentObservationsServer(authUser.schoolId, resolvedStudentId),
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId, student.classId),
      getSchoolServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId)
    ]);
    const publishedExamIds = new Set(exams.filter((e) => e.status === "PUBLISHED").map((e) => e.id));
    const examResults = examResultsRaw.filter((r) => publishedExamIds.has(r.examId));
    const examNameById = new Map(exams.map((e) => [e.id, e.name]));

    const targetClass = classes.find((c) => c.id === student.classId);

    // Attendance statistics
    const totalAtt = attendances.length;
    const presentAtt = attendances.filter((a) => a.status === "PRESENT").length;
    const lateAtt = attendances.filter((a) => a.status === "LATE").length;
    const leaveAtt = attendances.filter((a) => a.status === "LEAVE").length;
    const absentAtt = attendances.filter((a) => a.status === "ABSENT").length;
    const attPct = totalAtt > 0 ? parseFloat(((presentAtt / totalAtt) * 100).toFixed(1)) : 0.0;

    // Fee statistics
    const totalExpectedFee = challans.reduce((s, c) => s + (c.totalExpected || 0), 0);
    const totalPaidFee = challans.reduce((s, c) => s + (c.paidAmount || 0), 0);
    const totalOutstandingFee = Math.max(0, totalExpectedFee - totalPaidFee);

    // Academic statistics
    const totalMaxMarks = examResults.reduce((s, r) => s + (r.totalMarks || 100), 0);
    const totalObtainedMarks = examResults.reduce((s, r) => s + (r.obtainedMarks || 0), 0);
    const examPct = totalMaxMarks > 0 ? parseFloat(((totalObtainedMarks / totalMaxMarks) * 100).toFixed(1)) : 0.0;
    const gpaValues = examResults.filter((r) => typeof r.gpa === "number");
    const avgGpa =
      gpaValues.length > 0
        ? parseFloat((gpaValues.reduce((s, r) => s + (r.gpa || 0), 0) / gpaValues.length).toFixed(2))
        : null;

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
      cnicBForm: student.cnic || student.bForm || "-",
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
          examDate: r.createdAt ? r.createdAt.split("T")[0] : "",
          exam: { name: examNameById.get(r.examId) || "" },
          subject: { name: r.subjectName || "", code: "" }
        }
      })),
      observations: observations.map((o) => ({
        id: o.id,
        title: (o as any).title || o.category,
        content: (o as any).content || o.note,
        notes: (o as any).content || o.note,
        severity: (o as any).type || o.sentiment,
        date: o.createdAt,
        teacher: { name: o.teacherName || "Faculty" }
      }))
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
          percentage: examPct,
          gpa: avgGpa,
          totalMarks: totalMaxMarks,
          obtainedMarks: totalObtainedMarks
        }
      },
      school: schoolPrintIdentity(school, settings)
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student /me route error:", error);
    return NextResponse.json(
      { error: "Failed to load student identity." },
      { status: 500 }
    );
  }
}
