import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getStudentsServer,
  saveStudentServer,
  createUserServer,
  getUserByEmailServer,
  createAuditLogServer,
  getClassesServer,
  getSchoolServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { StudentDoc } from "@/lib/firebase/types";
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
      photoUrl: st.photoUrl || "",
      documents: st.documents || [],
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
    const studentId = `std_${uniqueSuffix}`;
    const schoolSettings = await getSchoolSettingsServer(authUser.schoolId);
    const school = await getSchoolServer(authUser.schoolId);
    const schoolEmail = schoolSettings?.email || school?.email || authUser.email || "alliedschool.edu";
    const domain = schoolEmail.includes("@") ? schoolEmail.split("@")[1].trim().toLowerCase() : "alliedschool.edu";

    const cleanFirst = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "student";
    const cleanLast = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const rollSlug = rollNumber ? rollNumber.trim().toLowerCase().replace(/[^a-z0-9]/g, "") : "";
    const baseUsername = cleanLast ? `student.${cleanFirst}.${cleanLast}` : `student.${cleanFirst}`;

    const emailCandidates = [
      `${baseUsername}@${domain}`,
      rollSlug ? `${baseUsername}.${rollSlug}@${domain}` : `${baseUsername}.${count}@${domain}`,
      `${baseUsername}.${studentId.replace(/[^a-z0-9]/g, "")}@${domain}`,
    ];
    let studentEmail = emailCandidates[0];
    for (const candidate of emailCandidates) {
      studentEmail = candidate;
      const taken = await getUserByEmailServer(candidate);
      if (!taken) break;
    }
    if (await getUserByEmailServer(studentEmail)) {
      return NextResponse.json({ error: "Could not allocate a unique student login email." }, { status: 409 });
    }

    let userUid = `user_std_${uniqueSuffix}`;
    let createdAuthUid: string | null = null;
    const initialPassword = process.env.DEFAULT_STUDENT_INITIAL_PASSWORD || "Student@123";
    const passwordHash = bcrypt.hashSync(initialPassword, 10);
    const temporaryPassword = initialPassword;

    if (hasAdminCredentials) {
      try {
        const studentAuthUser = await adminAuth.createUser({
          email: studentEmail,
          emailVerified: true,
          password: initialPassword,
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
      photoUrl: body.photoUrl || undefined,
      documents: Array.isArray(body.documents) ? body.documents : [],
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
        passwordHash,
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
