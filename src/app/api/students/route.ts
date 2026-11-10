import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  saveStudentServer,
  createUserServer,
  getUserByEmailServer,
  saveFeeChallanServer,
  createAuditLogServer,
  getClassesServer
} from "@/lib/firebase/server-db";
import { StudentDoc, FeeChallanDoc } from "@/lib/firebase/types";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { linkGuardianEmailToStudent } from "@/lib/link-parent";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const classId = searchParams.get("classId") || undefined;
    const status = searchParams.get("status") || undefined;

    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;

    const students = await getStudentsServer(authUser.schoolId, classId, search, parsedLimit, status);

    const mapped = students.map((st) => ({
      id: st.id,
      userId: st.userId,
      admissionNumber: st.admissionNo,
      rollNumber: st.rollNo,
      firstName: st.fullName.split(" ")[0] || st.fullName,
      lastName: st.fullName.split(" ").slice(1).join(" ") || "",
      fullName: st.fullName,
      gender: st.gender,
      dob: st.dob,
      bloodGroup: st.bloodGroup || "Not Specified",
      cnicBForm: st.cnic || st.bForm || "-",
      contactNumber: st.phone,
      email: `${st.id}@alliedschool.edu`,
      guardianName: st.guardianName,
      guardianRelation: st.guardianRelation,
      guardianPhone: st.guardianPhone,
      guardianEmail: st.guardianEmail || "",
      guardianOccupation: "Not Specified",
      status: st.status,
      classId: st.classId,
      className: st.className || "",
      attendanceRate: 0,
      feeStatus: "CLEAR",
      admissionDate: st.createdAt,
    }));

    return NextResponse.json({ success: true, students: mapped });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Students GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve students list." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();

    const {
      firstName,
      lastName,
      rollNumber,
      gender,
      dob,
      bloodGroup,
      contactNumber,
      guardianName,
      guardianRelation,
      guardianPhone,
      classId,
    } = body;

    if (!firstName || !lastName || !classId || !guardianName || !guardianPhone) {
      return NextResponse.json(
        { error: "First Name, Last Name, Class, and Guardian details are required." },
        { status: 400 }
      );
    }

    const existingStudents = await getStudentsServer(authUser.schoolId);
    const count = existingStudents.length + 1;
    const admissionNo = `STD-2024-${count.toString().padStart(3, "0")}`;
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const studentId = `std-${count}`;
    const studentEmail = body.email?.trim().toLowerCase() || `student.${count}@alliedschool.edu`;
    let userUid = `user_std_${count}`;
    let createdAuthUid: string | null = null;

    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
      return NextResponse.json({ error: "Please enter a valid student email address." }, { status: 400 });
    }

    const existingUser = await getUserByEmailServer(studentEmail);
    if (existingUser) {
      return NextResponse.json({ error: "A user with this student email already exists." }, { status: 409 });
    }

    if (hasAdminCredentials) {
      try {
        const studentAuthUser = await adminAuth.createUser({
          email: studentEmail,
          emailVerified: true,
          password: `Student@${Date.now().toString().slice(-4)}#2024`,
          displayName: fullName,
          disabled: false,
        });
        userUid = studentAuthUser.uid;
        createdAuthUid = studentAuthUser.uid;

        await adminAuth.setCustomUserClaims(studentAuthUser.uid, {
          role: "STUDENT",
          schoolId: authUser.schoolId,
          studentId: studentId,
        });
      } catch (authErr: any) {
        console.error("Firebase Auth creation error for student:", authErr);
        const duplicateEmail = authErr?.code === "auth/email-already-exists";
        return NextResponse.json(
          {
            error: duplicateEmail
              ? "A user with this student email already exists."
              : "Failed to provision authentication account for student.",
          },
          { status: duplicateEmail ? 409 : 400 }
        );
      }
    }

    // Look up class name
    const classes = await getClassesServer(authUser.schoolId);
    const targetClass = classes.find((c) => c.id === classId);
    const className = targetClass ? `${targetClass.name}-${targetClass.section}` : "Class Cohort";

    const studentDoc: StudentDoc = {
      id: studentId,
      schoolId: authUser.schoolId,
      userId: userUid,
      admissionNo,
      fullName,
      fatherName: guardianName,
      gender: gender === "Male" ? "MALE" : "FEMALE",
      dob: dob || "2010-01-01",
      phone: contactNumber || guardianPhone,
      address: "Campus District",
      classId,
      className,
      section: targetClass?.section || "A",
      rollNo: rollNumber || count.toString(),
      status: "ACTIVE",
      guardianName,
      guardianPhone,
      guardianRelation: guardianRelation || "Father",
      guardianEmail: body.guardianEmail || "",
      parentUserIds: [],
      bloodGroup: bloodGroup || "B+",
      monthlyFee: 6000,
      discount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveStudentServer(studentDoc);

      // Create User record in Firestore
      await createUserServer({
        uid: userUid,
        name: fullName,
        email: studentEmail,
        role: "STUDENT",
        schoolId: authUser.schoolId,
        studentId: studentId,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (dbErr: any) {
      // Rollback auth user if created
      if (createdAuthUid && hasAdminCredentials) {
        try {
          await adminAuth.deleteUser(createdAuthUid);
        } catch (delErr) {
          console.error("Rollback student user failed:", delErr);
        }
      }
      throw dbErr;
    }

    // Create Initial Fee Challan
    const challanDoc: FeeChallanDoc = {
      id: `ch-adm-${count}`,
      schoolId: authUser.schoolId,
      studentId: studentId,
      studentName: fullName,
      admissionNo,
      classId,
      className,
      challanNo: `CHL-2024-ADM-${count.toString().padStart(4, "0")}`,
      month: "September",
      year: 2024,
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: "2024-09-30",
      tuitionFee: 5000,
      admissionFee: 2000,
      examFee: 0,
      otherFee: 500,
      discount: 0,
      totalExpected: 7500,
      paidAmount: 0,
      balanceAmount: 7500,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveFeeChallanServer(challanDoc);

    if (body.guardianEmail) {
      await linkGuardianEmailToStudent({
        schoolId: authUser.schoolId,
        student: studentDoc,
        guardianEmail: body.guardianEmail,
        guardianName,
      });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ENROLL_STUDENT",
      "STUDENT",
      studentId,
      `Enrolled student ${fullName} (${admissionNo}) into ${className}.`
    );

    return NextResponse.json({ success: true, student: studentDoc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student enrollment error:", error);
    return NextResponse.json(
      { error: "Failed to enroll student." },
      { status: 500 }
    );
  }
}
