import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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
import { assertTeacherOwnsClass, resolveAuthenticatedTeacher } from "@/lib/academic-access";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const classId = searchParams.get("classId") || undefined;
    const status = searchParams.get("status") || undefined;

    // A TEACHER requesting a specific class's roster may only do so for one of their own
    // assignedClassIds — verified server-side against the authenticated teacher's own
    // Firestore record, never trusting the classId at face value.
    if (authUser.role === "TEACHER" && classId) {
      await assertTeacherOwnsClass(authUser, classId);
    }

    const limitParam = searchParams.get("limit");
    // Default to a bounded read (capped further to 250 inside getStudentsServer) instead of an
    // unconditionally unbounded full-collection fetch when the caller doesn't specify a limit.
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 250;

    let students = await getStudentsServer(authUser.schoolId, classId, search, parsedLimit, status);

    // Without a specific classId filter, a TEACHER must still only see students in their own
    // assigned classes (containing full guardian/contact PII) rather than the whole school's
    // roster — matches the same assignedClassIds convention used for attendance/exams.
    if (authUser.role === "TEACHER" && !classId) {
      const teacher = await resolveAuthenticatedTeacher(authUser);
      const assigned = teacher?.assignedClassIds?.length ? new Set(teacher.assignedClassIds) : null;
      if (assigned) {
        students = students.filter((s) => assigned.has(s.classId));
      }
    }

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
      email: st.email || "Not Available",
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
    const currentYear = new Date().getFullYear();
    // Derive the next admission number from the highest sequence already issued rather than
    // from the roster size. `existingStudents.length + 1` silently reissues a number that is
    // already in use as soon as the roster count stops matching the highest sequence — which it
    // does the moment a record is filtered out of this read, or an admission number is entered
    // manually. Scanning the real issued numbers makes a collision with existing data
    // impossible. (Two *simultaneous* enrollments can still race for the same sequence; the
    // student's actual document id is independently collision-resistant, so that race affects
    // only this display number. Eliminating it entirely needs a Firestore counter transaction.)
    const highestSequence = existingStudents.reduce((max, st) => {
      const match = /^STD-\d{4}-(\d+)$/.exec(st.admissionNo || "");
      const value = match ? parseInt(match[1], 10) : 0;
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
    const count = highestSequence + 1;
    const admissionNo = `STD-${currentYear}-${count.toString().padStart(3, "0")}`;
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    // Use a timestamp+random suffix (not a sequential count) for the internal ID so two
    // concurrent enrollments can never collide and silently overwrite one another.
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const studentId = `std-${uniqueSuffix}`;
    const studentEmail = body.email?.trim().toLowerCase() || `student.${uniqueSuffix}@alliedschool.edu`;
    let userUid = `user_std_${uniqueSuffix}`;
    let createdAuthUid: string | null = null;
    let temporaryPassword: string | null = null;

    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
      return NextResponse.json({ error: "Please enter a valid student email address." }, { status: 400 });
    }

    const existingUser = await getUserByEmailServer(studentEmail);
    if (existingUser) {
      return NextResponse.json({ error: "A user with this student email already exists." }, { status: 409 });
    }

    if (hasAdminCredentials) {
      try {
        // Cryptographically secure, high-entropy temporary password — Math.random() is a
        // non-cryptographic PRNG (predictable given enough samples, and Date.now()'s last 4
        // digits repeat every 10 seconds), which is unsuitable for a real account credential
        // even though it's shown once and meant to be changed. Same fix and rationale already
        // applied to parent account provisioning in src/lib/link-parent.ts.
        const generatedPassword = `Student@${crypto.randomBytes(12).toString("base64url")}!1`;
        const studentAuthUser = await adminAuth.createUser({
          email: studentEmail,
          emailVerified: true,
          password: generatedPassword,
          displayName: fullName,
          disabled: false,
        });
        userUid = studentAuthUser.uid;
        createdAuthUid = studentAuthUser.uid;
        temporaryPassword = generatedPassword;

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
      dob: dob || undefined,
      phone: contactNumber || guardianPhone,
      address: body.address?.trim() || "Not Provided",
      email: studentEmail,
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
      bloodGroup: bloodGroup || "Not Specified",
      monthlyFee: Number(body.monthlyFee) > 0 ? Number(body.monthlyFee) : 0,
      discount: Number(body.discount) || 0,
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

    // Create an initial fee challan ONLY when the admin actually supplied real fee figures
    // and a due date. Previously this always fabricated a challan with invented amounts
    // (Rs. 5000 tuition, Rs. 2000 admission fee, a hardcoded "September 2024" period, etc.)
    // regardless of the school's real fee structure. Admins can generate the real first
    // challan for this student at any time from the Fees module, which already uses actual
    // admin-entered figures.
    const suppliedTuitionFee = Number(body.tuitionFee);
    if (suppliedTuitionFee > 0 && body.dueDate) {
      const admissionFee = Number(body.admissionFee) || 0;
      const examFee = Number(body.examFee) || 0;
      const otherFee = Number(body.otherFee) || 0;
      const discount = Number(body.discount) || 0;
      const totalExpected = suppliedTuitionFee + admissionFee + examFee + otherFee - discount;
      const challanDoc: FeeChallanDoc = {
        id: `ch-adm-${uniqueSuffix}`,
        schoolId: authUser.schoolId,
        studentId: studentId,
        studentName: fullName,
        admissionNo,
        classId,
        className,
        challanNo: `CHL-${currentYear}-ADM-${count.toString().padStart(4, "0")}`,
        month: body.month || new Date().toLocaleString("en-US", { month: "long" }),
        year: Number(body.year) || currentYear,
        issueDate: new Date().toISOString().split("T")[0],
        dueDate: body.dueDate,
        tuitionFee: suppliedTuitionFee,
        admissionFee,
        examFee,
        otherFee,
        discount,
        totalExpected,
        paidAmount: 0,
        balanceAmount: totalExpected,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveFeeChallanServer(challanDoc);
    }

    let parentTemporaryPassword: string | undefined;
    if (body.guardianEmail) {
      const parentLinkResult = await linkGuardianEmailToStudent({
        schoolId: authUser.schoolId,
        student: studentDoc,
        guardianEmail: body.guardianEmail,
        guardianName,
      });
      parentTemporaryPassword = parentLinkResult.parentTemporaryPassword;
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

    return NextResponse.json(
      {
        success: true,
        student: studentDoc,
        // Only present when a real Firebase Auth account was provisioned. Surfaced once so
        // the admin can hand it to the student/guardian; it is never stored or logged.
        temporaryPassword: temporaryPassword || undefined,
        // Only present when a real parent Firebase Auth account was auto-created via the
        // guardian email on this enrollment.
        parentTemporaryPassword: parentTemporaryPassword || undefined,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student enrollment error:", error);
    return NextResponse.json(
      { error: "Failed to enroll student." },
      { status: 500 }
    );
  }
}
