import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTeacherByIdServer,
  saveTeacherServer,
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

    const teacher = await getTeacherByIdServer(authUser.schoolId, id);
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }

    const [classes, subjects] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId)
    ]);

    const managed = classes.filter((c) => c.classTeacherId === teacher.id);
    const taught = subjects.filter((s) => s.teacherId === teacher.id);

    const formattedTeacher = {
      id: teacher.id,
      employeeId: teacher.employeeId,
      firstName: teacher.fullName.split(" ")[0] || teacher.fullName,
      lastName: teacher.fullName.split(" ").slice(1).join(" ") || "",
      fullName: teacher.fullName,
      gender: "Female",
      designation: teacher.designation,
      qualification: teacher.qualification,
      specialization: teacher.department,
      phone: teacher.phone,
      email: teacher.email,
      status: teacher.status,
      joiningDate: teacher.joiningDate || teacher.createdAt,
      managedClasses: managed.map((c) => ({
        id: c.id,
        name: c.name,
        section: c.section,
        roomNumber: c.roomNo || "Room",
        students: []
      })),
      taughtSubjects: taught.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        class: { name: s.className?.split("-")[0] || "Class", section: s.className?.split("-")[1] || "A" }
      })),
      observations: []
    };

    return NextResponse.json({ success: true, teacher: formattedTeacher });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teacher detail error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve teacher details." },
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

    const existing = await getTeacherByIdServer(authUser.schoolId, id);
    if (!existing) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }

    const updated: typeof existing = {
      ...existing,
      fullName: body.firstName ? `${body.firstName} ${body.lastName || ""}`.trim() : existing.fullName,
      designation: body.designation || existing.designation,
      qualification: body.qualification || existing.qualification,
      department: body.specialization || existing.department,
      phone: body.phone || existing.phone,
      email: body.email || existing.email,
      status: body.status || existing.status,
      updatedAt: new Date().toISOString()
    };

    await saveTeacherServer(updated);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_TEACHER",
      "TEACHER",
      id,
      `Updated profile for faculty member ${updated.fullName} (${updated.employeeId}).`
    );

    return NextResponse.json({ success: true, teacher: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teacher update error:", error);
    return NextResponse.json(
      { error: "Failed to update teacher profile." },
      { status: 500 }
    );
  }
}
