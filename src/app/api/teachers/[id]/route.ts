import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTeacherByIdServer,
  saveTeacherServer,
  deleteTeacherServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer
} from "@/lib/firebase/server-db";
import { validateDateString, isDateBefore } from "@/lib/date-utils";

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
      photoUrl: teacher.photoUrl || "",
      joiningDate: teacher.joiningDate || (teacher.createdAt ? teacher.createdAt.split("T")[0] : ""),
      endingDate: teacher.endingDate || null,
      managedClasses: managed.map((c) => ({
        id: c.id,
        name: c.name,
        section: c.section,
        displayName: `${c.name}-${c.section}`,
        roomNumber: c.roomNo || "Room",
        students: []
      })),
      assignedClasses: classes
        .filter((c) => (teacher.assignedClassIds || []).includes(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          section: c.section,
          displayName: `${c.name}-${c.section}`,
          isClassIncharge: c.classTeacherId === teacher.id,
        })),
      taughtSubjects: taught.map((s) => {
        const cls = classes.find((c) => c.id === s.classId);
        return {
          id: s.id,
          name: s.name,
          code: s.code,
          classId: s.classId,
          class: {
            name: cls ? cls.name : (s.className?.split("-")[0] || "Class"),
            section: cls ? cls.section : (s.className?.split("-")[1] || "A"),
            displayName: cls ? `${cls.name}-${cls.section}` : (s.className || "Class"),
          },
        };
      }),
      // The authoritative teacher-authorization field. Surfaced so the admin faculty profile
      // can actually manage it — until now nothing in the entire application could write this
      // field, so every teacher permanently had an empty array.
      assignedClassIds: Array.isArray(teacher.assignedClassIds) ? teacher.assignedClassIds : [],
      baseSalary: teacher.baseSalary ?? teacher.salary ?? 0,
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

    let updatedSalary = existing.baseSalary ?? existing.salary;
    if (body.baseSalary !== undefined && body.baseSalary !== "") {
      const parsed = Number(body.baseSalary);
      if (!isNaN(parsed) && parsed >= 0) updatedSalary = parsed;
    } else if (body.salary !== undefined && body.salary !== "") {
      const parsed = Number(body.salary);
      if (!isNaN(parsed) && parsed >= 0) updatedSalary = parsed;
    }

    // Validate and process employment dates
    let updatedJoiningDate = existing.joiningDate;
    if (body.joiningDate !== undefined) {
      if (!body.joiningDate || typeof body.joiningDate !== "string" || !body.joiningDate.trim()) {
        return NextResponse.json(
          { error: "Joining Date cannot be empty." },
          { status: 400 }
        );
      }
      const parsed = validateDateString(body.joiningDate);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid Joining Date format. Please provide a valid date (YYYY-MM-DD)." },
          { status: 400 }
        );
      }
      updatedJoiningDate = parsed;
    }

    let updatedEndingDate = existing.endingDate ?? null;
    let inferredStatus = body.status || existing.status;

    if (body.endingDate !== undefined) {
      if (body.endingDate === null || body.endingDate === "") {
        updatedEndingDate = null;
        if (!body.status && existing.status === "INACTIVE" && existing.endingDate) {
          inferredStatus = "ACTIVE";
        }
      } else {
        if (typeof body.endingDate !== "string" || !body.endingDate.trim()) {
          return NextResponse.json(
            { error: "Invalid Ending Date format." },
            { status: 400 }
          );
        }
        const parsedEnding = validateDateString(body.endingDate);
        if (!parsedEnding) {
          return NextResponse.json(
            { error: "Invalid Ending Date format. Please provide a valid date (YYYY-MM-DD)." },
            { status: 400 }
          );
        }
        const effectiveJoining = updatedJoiningDate || (existing.createdAt ? existing.createdAt.split("T")[0] : null);
        if (effectiveJoining && isDateBefore(parsedEnding, effectiveJoining)) {
          return NextResponse.json(
            { error: "Ending Date cannot be earlier than Joining Date." },
            { status: 400 }
          );
        }
        updatedEndingDate = parsedEnding;
        // When ending date is set, infer/mark teacher as INACTIVE
        inferredStatus = "INACTIVE";
      }
    } else if (body.joiningDate !== undefined && existing.endingDate) {
      if (isDateBefore(existing.endingDate, updatedJoiningDate!)) {
        return NextResponse.json(
          { error: "Ending Date cannot be earlier than Joining Date." },
          { status: 400 }
        );
      }
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
      status: inferredStatus,
      photoUrl: body.photoUrl !== undefined ? body.photoUrl : existing.photoUrl,
      baseSalary: updatedSalary,
      salary: updatedSalary,
      joiningDate: updatedJoiningDate,
      endingDate: updatedEndingDate,
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;

    const existing = await getTeacherByIdServer(authUser.schoolId, id);
    if (!existing) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }

    await deleteTeacherServer(authUser.schoolId, id);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_TEACHER",
      "TEACHER",
      id,
      `Deleted faculty member ${existing.fullName} (${existing.employeeId}).`
    );

    return NextResponse.json({ success: true, message: "Faculty member deleted successfully." });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teacher delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete teacher record." },
      { status: 500 }
    );
  }
}

