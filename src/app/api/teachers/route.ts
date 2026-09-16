import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTeachersServer,
  saveTeacherServer,
  createUserServer,
  getUserByEmailServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer
} from "@/lib/firebase/server-db";
import { TeacherDoc } from "@/lib/firebase/types";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  try {
    // The faculty directory (staff phone numbers, personal email addresses, employee ids,
    // joining dates) is only ever read by the admin console — verified against every caller
    // in src/. A TEACHER has no legitimate need for their colleagues' contact records here.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.toLowerCase() || "";
    const limitParam = searchParams.get("limit");
    // Default to a bounded read (capped further to 250 inside getTeachersServer) instead of an
    // unconditionally unbounded full-collection fetch when the caller doesn't specify a limit —
    // same convention already applied to /api/students.
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : 250;

    const [teachers, classes, subjects] = await Promise.all([
      getTeachersServer(authUser.schoolId, parsedLimit),
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId)
    ]);

    let filtered = teachers;
    if (search) {
      filtered = filtered.filter((t) =>
        t.fullName.toLowerCase().includes(search) ||
        t.employeeId.toLowerCase().includes(search) ||
        t.department.toLowerCase().includes(search) ||
        t.designation.toLowerCase().includes(search)
      );
    }

    const teacherRecords = filtered.map((t) => {
      const managed = classes.filter((c) => c.classTeacherId === t.id).map((c) => `${c.name}-${c.section}`);
      const taught = subjects.filter((s) => s.teacherId === t.id).map((s) => `${s.name} (${s.code})`);

      return {
        id: t.id,
        userId: t.userId,
        employeeId: t.employeeId,
        firstName: t.fullName.split(" ")[0] || t.fullName,
        lastName: t.fullName.split(" ").slice(1).join(" ") || "",
        fullName: t.fullName,
        // TeacherDoc does not currently store gender; no real value exists to report here.
        gender: "Not Specified",
        designation: t.designation,
        qualification: t.qualification,
        specialization: t.department,
        phone: t.phone,
        email: t.email,
        status: t.status,
        joiningDate: t.joiningDate || t.createdAt,
        managedClasses: managed,
        taughtSubjectsCount: taught.length,
        taughtSubjects: taught,
      };
    });

    return NextResponse.json({ success: true, teachers: teacherRecords });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teachers GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve teachers list." },
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
      designation,
      qualification,
      specialization,
      phone,
      email,
    } = body;

    if (!firstName || !lastName || !email || !phone) {
      return NextResponse.json(
        { error: "First Name, Last Name, Email, and Phone are required." },
        { status: 400 }
      );
    }

    const existingTeachers = await getTeachersServer(authUser.schoolId);
    const count = existingTeachers.length + 101;
    const employeeId = `TCH-${count}`;
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    // Use a timestamp+random suffix (not a sequential count) for the internal ID so two
    // concurrent teacher registrations can never collide and silently overwrite one another.
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const teacherId = `tch-${uniqueSuffix}`;
    const teacherEmail = email.trim().toLowerCase();
    let userUid = `user_tch_${uniqueSuffix}`;
    let createdAuthUid: string | null = null;
    let temporaryPassword: string | null = null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail)) {
      return NextResponse.json({ error: "Please enter a valid teacher email address." }, { status: 400 });
    }

    const existingUser = await getUserByEmailServer(teacherEmail);
    if (existingUser) {
      return NextResponse.json({ error: "A user with this teacher email already exists." }, { status: 409 });
    }

    if (hasAdminCredentials) {
      try {
        // Cryptographically secure, high-entropy temporary password — see the identical fix
        // and rationale in src/app/api/students/route.ts and src/lib/link-parent.ts.
        const generatedPassword = `Teacher@${crypto.randomBytes(12).toString("base64url")}!1`;
        const teacherAuthUser = await adminAuth.createUser({
          email: teacherEmail,
          emailVerified: true,
          password: generatedPassword,
          displayName: fullName,
          disabled: false,
        });
        userUid = teacherAuthUser.uid;
        createdAuthUid = teacherAuthUser.uid;
        temporaryPassword = generatedPassword;

        await adminAuth.setCustomUserClaims(teacherAuthUser.uid, {
          role: "TEACHER",
          schoolId: authUser.schoolId,
          teacherId: teacherId,
        });
      } catch (authErr: any) {
        console.error("Firebase Auth creation error for teacher:", authErr);
        const duplicateEmail = authErr?.code === "auth/email-already-exists";
        return NextResponse.json(
          {
            error: duplicateEmail
              ? "A user with this teacher email already exists."
              : "Failed to provision authentication account for teacher.",
          },
          { status: duplicateEmail ? 409 : 400 }
        );
      }
    }

    const teacherDoc: TeacherDoc = {
      id: teacherId,
      schoolId: authUser.schoolId,
      userId: userUid,
      employeeId,
      fullName,
      email: teacherEmail,
      phone,
      designation: designation || "Subject Educator",
      department: specialization || "Academic Faculty",
      qualification: qualification || "M.Sc / B.Ed",
      status: "ACTIVE",
      assignedClassIds: [],
      assignedSubjectIds: [],
      weeklyLoad: 20,
      joiningDate: new Date().toISOString().split("T")[0],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveTeacherServer(teacherDoc);

      // Create User account in Firestore
      await createUserServer({
        uid: userUid,
        name: fullName,
        email: teacherEmail,
        role: "TEACHER",
        schoolId: authUser.schoolId,
        teacherId: teacherId,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (dbErr: any) {
      // Rollback Auth user if created
      if (createdAuthUid && hasAdminCredentials) {
        try {
          await adminAuth.deleteUser(createdAuthUid);
        } catch (delErr) {
          console.error("Rollback teacher user failed:", delErr);
        }
      }
      throw dbErr;
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_TEACHER",
      "TEACHER",
      teacherId,
      `Registered faculty member ${fullName} (${employeeId}).`
    );

    return NextResponse.json(
      {
        success: true,
        teacher: teacherDoc,
        // Only present when a real Firebase Auth account was provisioned. Surfaced once so
        // the admin can hand it to the teacher; it is never stored or logged.
        temporaryPassword: temporaryPassword || undefined,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teacher POST error:", error);
    return NextResponse.json(
      { error: "Failed to create teacher record." },
      { status: 500 }
    );
  }
}
