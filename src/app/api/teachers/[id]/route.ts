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
    // Previously requireAuth(req) with no role list at all: any authenticated session,
    // including STUDENT and PARENT, could read any faculty member's full record (personal
    // phone, email, employee id, joining date) by id. Only the admin faculty-profile page
    // calls this route.
    const authUser = await requireAuth(req, ["ADMIN"]);
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
      // TeacherDoc does not currently store gender; no real value exists to report here.
      gender: "Not Specified",
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
      // The authoritative teacher-authorization field. Surfaced so the admin faculty profile
      // can actually manage it — until now nothing in the entire application could write this
      // field, so every teacher permanently had an empty array.
      assignedClassIds: Array.isArray(teacher.assignedClassIds) ? teacher.assignedClassIds : [],
    };

    return NextResponse.json({
      success: true,
      teacher: formattedTeacher,
      // Real same-school classes only — the admin UI picks assignments from this list, and the
      // PUT handler independently re-validates against the same source of truth.
      availableClasses: classes.map((c) => ({
        id: c.id,
        name: c.name,
        section: c.section,
        displayName: `${c.name}-${c.section}`,
      })),
    });
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

    // Class assignment is the authoritative teacher-authorization control
    // (TeacherDoc.assignedClassIds, enforced by assertTeacherOwnsClass). Only an ADMIN of this
    // school can set it — a teacher can never modify their own assignment, since this whole
    // handler is ADMIN-only and the teacher record is resolved by schoolId. Every submitted id
    // is validated against the school's real class documents, so a client cannot inject an
    // arbitrary or cross-tenant classId to widen a teacher's access.
    let assignedClassIds = existing.assignedClassIds || [];
    if (body.assignedClassIds !== undefined) {
      if (!Array.isArray(body.assignedClassIds)) {
        return NextResponse.json(
          { error: "assignedClassIds must be an array of class ids." },
          { status: 400 }
        );
      }
      const schoolClasses = await getClassesServer(authUser.schoolId);
      const validClassIds = new Set(schoolClasses.map((c) => c.id));
      const requested = Array.from(
        new Set(body.assignedClassIds.map((c: unknown) => String(c)).filter(Boolean))
      ) as string[];
      const unknown = requested.filter((c) => !validClassIds.has(c));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: "One or more selected classes do not exist in this school." },
          { status: 400 }
        );
      }
      assignedClassIds = requested;
    }

    const updated: typeof existing = {
      ...existing,
      assignedClassIds,
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
      body.assignedClassIds !== undefined
        ? `Updated faculty member ${updated.fullName} (${updated.employeeId}); class access set to ${
            assignedClassIds.length > 0
              ? assignedClassIds.join(", ")
              : "none (unrestricted — see assertTeacherOwnsClass)"
          }.`
        : `Updated profile for faculty member ${updated.fullName} (${updated.employeeId}).`
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
