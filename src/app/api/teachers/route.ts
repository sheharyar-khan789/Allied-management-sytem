import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTeachersServer,
  saveTeacherServer,
  createUserServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer
} from "@/lib/firebase/server-db";
import { TeacherDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.toLowerCase() || "";

    const [teachers, classes, subjects] = await Promise.all([
      getTeachersServer(authUser.schoolId),
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
        gender: "Female",
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
    const teacherId = `tch-${count}`;
    const userUid = `user_tch_${count}`;

    const teacherDoc: TeacherDoc = {
      id: teacherId,
      schoolId: authUser.schoolId,
      userId: userUid,
      employeeId,
      fullName,
      email,
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

    await saveTeacherServer(teacherDoc);

    // Create User account in Firestore
    await createUserServer({
      uid: userUid,
      name: fullName,
      email,
      role: "TEACHER",
      schoolId: authUser.schoolId,
      teacherId: teacherId,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

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

    return NextResponse.json({ success: true, teacher: teacherDoc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teacher POST error:", error);
    return NextResponse.json(
      { error: "Failed to create teacher record." },
      { status: 500 }
    );
  }
}
