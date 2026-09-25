import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  getClassByIdServer,
  saveClassServer,
  deleteClassServer,
  getStudentsServer,
  getSubjectsServer,
  getAttendanceServer,
  getExamResultsServer,
  getTimetableServer,
  getFeeChallansServer,
  createAuditLogServer,
  getTeacherByIdServer,
  getTeachersServer,
  saveTeacherServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { ClassDoc, TeacherDoc } from "@/lib/firebase/types";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";

export async function GET(req: NextRequest) {
  try {
    // Only the admin console and the teacher portal ever read the class list. It was
    // previously open to any authenticated role, which let a STUDENT or PARENT session
    // enumerate every class in the school together with its roster size and class-teacher
    // name. Restricted to the roles that actually use it.
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const [classes, students, subjects, teachers] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getStudentsServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
      getTeachersServer(authUser.schoolId),
    ]);

    // A TEACHER's class list (used to populate class selectors/dropdowns on the teacher
    // portal) is restricted to their own assignedClassIds — the UI must not be the only
    // thing hiding other classes from a teacher. ADMIN (and a teacher with no
    // assignedClassIds configured yet) continue to see the full school list unchanged.
    const teacher = await resolveAuthenticatedTeacher(authUser);
    const teacherAssignedClasses = teacher?.assignedClassIds?.length ? new Set(teacher.assignedClassIds) : null;
    const visibleClasses = teacherAssignedClasses
      ? classes.filter((c) => teacherAssignedClasses.has(c.id))
      : classes;

    const formatted = visibleClasses.map((c) => {
      const clsStudents = students.filter((s) => s.classId === c.id);
      const clsSubjects = subjects.filter((s) => s.classId === c.id);
      const classTeacher = c.classTeacherId ? teachers.find((t) => t.id === c.classTeacherId) : null;
      const classTeacherName = classTeacher
        ? classTeacher.fullName
        : (c.classTeacherName && c.classTeacherName !== "Unassigned" ? c.classTeacherName : "Unassigned");

      return {
        id: c.id,
        name: c.name,
        section: c.section,
        displayName: `${c.name}-${c.section}`,
        roomNumber: c.roomNo || "Room",
        capacity: c.capacity,
        studentCount: clsStudents.length,
        activeStudentCount: clsStudents.filter((s) => s.status === "ACTIVE").length,
        classTeacherId: c.classTeacherId || null,
        classTeacherName,
        subjects: clsSubjects.map((s) => {
          const subTeacher = s.teacherId ? teachers.find((t) => t.id === s.teacherId) : null;
          return {
            id: s.id,
            name: s.name,
            code: s.code,
            classId: s.classId,
            teacherId: s.teacherId || null,
            teacherName: subTeacher
              ? subTeacher.fullName
              : (s.teacherName && s.teacherName !== "Unassigned" ? s.teacherName : "Unassigned"),
          };
        }),
      };
    });

    return NextResponse.json({ success: true, classes: formatted });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Classes GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve classes." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { name, section, roomNumber, capacity, classTeacherId } = body;

    if (!name || !section) {
      return NextResponse.json({ error: "Class name and section are required." }, { status: 400 });
    }

    let classTeacherName = "Unassigned";
    let assignedTeacher: TeacherDoc | null = null;
    if (classTeacherId) {
      assignedTeacher = await getTeacherByIdServer(authUser.schoolId, classTeacherId);
      if (assignedTeacher) classTeacherName = assignedTeacher.fullName;
    }

    const existingClasses = await getClassesServer(authUser.schoolId);
    const count = existingClasses.length + 1;

    const slug = (value: string) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
    // The generated document id MUST include the schoolId. `classes` is a single flat,
    // multi-tenant collection and saveClassServer writes with { merge: true }, so the previous
    // school-agnostic id (`cls-<name>-<section>`) meant two different schools that both created
    // e.g. class "10" section "A" resolved to the SAME Firestore document — the second school's
    // write silently overwrote the first school's class (flipping its schoolId), and every
    // student in the first school still pointing at that classId was re-parented into another
    // tenant's class. Scoping the id by schoolId makes cross-tenant collision impossible.
    const classId = `cls-${slug(authUser.schoolId)}-${slug(name)}-${slug(section)}`;

    // A class is naturally keyed by name+section within a school. Without a duplicate check,
    // creating the same name+section twice would silently overwrite the existing class
    // document (and its roster) rather than reporting a conflict. Both the generated id and
    // the name+section pair are checked: the latter also catches classes created before the
    // id scheme above was scoped by schoolId, so an existing school can't end up with two
    // separate documents for the same real-world class.
    const duplicate = existingClasses.some(
      (c) =>
        c.id === classId ||
        (slug(c.name) === slug(name) && slug(c.section || "") === slug(section))
    );
    if (duplicate) {
      return NextResponse.json(
        { error: `Class ${name}-${section} already exists.` },
        { status: 409 }
      );
    }

    const schoolSettings = await getSchoolSettingsServer(authUser.schoolId);

    const newClass: ClassDoc = {
      id: classId,
      schoolId: authUser.schoolId,
      name,
      section,
      numericLevel: parseInt(name.replace(/[^0-9]/g, "")) || count,
      capacity: Number(capacity) || 35,
      roomNo: roomNumber || `Room ${name}`,
      classTeacherId: classTeacherId || null,
      classTeacherName,
      academicYear: schoolSettings?.academicYear || new Date().getFullYear().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveClassServer(newClass);

    // Two-way sync: add class to assigned teacher
    if (assignedTeacher) {
      const classIds = new Set(assignedTeacher.assignedClassIds || []);
      classIds.add(classId);
      await saveTeacherServer({
        ...assignedTeacher,
        assignedClassIds: Array.from(classIds),
      });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_CLASS",
      "CLASS",
      classId,
      `Created class ${name}-${section}.`
    );

    return NextResponse.json({ success: true, class: newClass }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Class POST error:", error);
    return NextResponse.json(
      { error: "Failed to create class." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { id, name, section, roomNumber, capacity, classTeacherId } = body;

    if (!id || !name || !section) {
      return NextResponse.json(
        { error: "Class ID, name, and section are required." },
        { status: 400 }
      );
    }

    const existingClasses = await getClassesServer(authUser.schoolId);
    const existing = existingClasses.find((c) => c.id === id);
    if (!existing) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const slug = (value: string) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
    const duplicate = existingClasses.some(
      (c) =>
        c.id !== id &&
        slug(c.name) === slug(name) &&
        slug(c.section || "") === slug(section)
    );
    if (duplicate) {
      return NextResponse.json(
        { error: `Another class ${name}-${section} already exists.` },
        { status: 409 }
      );
    }

    const oldClassTeacherId = existing.classTeacherId || null;
    let classTeacherName = existing.classTeacherName || "Unassigned";
    let newlyAssignedTeacher: TeacherDoc | null = null;

    if (classTeacherId !== undefined) {
      if (classTeacherId) {
        newlyAssignedTeacher = await getTeacherByIdServer(authUser.schoolId, classTeacherId);
        classTeacherName = newlyAssignedTeacher ? newlyAssignedTeacher.fullName : "Unassigned";
      } else {
        classTeacherName = "Unassigned";
      }
    }

    const updated: ClassDoc = {
      ...existing,
      name: name.trim(),
      section: section.trim(),
      capacity: capacity !== undefined ? Number(capacity) || existing.capacity : existing.capacity,
      roomNo: roomNumber !== undefined ? roomNumber.trim() : existing.roomNo,
      classTeacherId: classTeacherId !== undefined ? (classTeacherId || null) : (existing.classTeacherId || null),
      classTeacherName,
      updatedAt: new Date().toISOString(),
    };

    await saveClassServer(updated);

    // Two-way sync: update teacher assignedClassIds
    if (classTeacherId !== undefined) {
      const targetTeacherId = classTeacherId || null;
      // 1. Add class to newly assigned teacher
      if (newlyAssignedTeacher) {
        const classIds = new Set(newlyAssignedTeacher.assignedClassIds || []);
        classIds.add(id);
        await saveTeacherServer({
          ...newlyAssignedTeacher,
          assignedClassIds: Array.from(classIds),
        });
      }

      // 2. If old teacher was replaced or unassigned, remove class unless they teach a subject in this class
      if (oldClassTeacherId && oldClassTeacherId !== targetTeacherId) {
        const oldTeacher = await getTeacherByIdServer(authUser.schoolId, oldClassTeacherId);
        if (oldTeacher) {
          const subjects = await getSubjectsServer(authUser.schoolId, id);
          const stillTeachesSubject = subjects.some((s) => s.teacherId === oldClassTeacherId);
          if (!stillTeachesSubject) {
            const classIds = (oldTeacher.assignedClassIds || []).filter((cId) => cId !== id);
            await saveTeacherServer({
              ...oldTeacher,
              assignedClassIds: classIds,
            });
          }
        }
      }
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_CLASS",
      "CLASS",
      id,
      `Updated class ${updated.name}-${updated.section}.`
    );

    return NextResponse.json({ success: true, class: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Class PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update class." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    let classId = searchParams.get("id");

    if (!classId) {
      try {
        const body = await req.json();
        classId = body.id;
      } catch {
        // no body
      }
    }

    if (!classId || typeof classId !== "string") {
      return NextResponse.json({ error: "Class ID is required." }, { status: 400 });
    }

    const targetClass = await getClassByIdServer(authUser.schoolId, classId);
    if (!targetClass) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    // Server-side dependency validations to protect data integrity:
    // 1. Enrolled students
    const enrolledStudents = await getStudentsServer(authUser.schoolId, classId);
    if (enrolledStudents.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete class "${targetClass.name}-${targetClass.section}". It has ${enrolledStudents.length} enrolled student(s). Please reassign or remove all students before deleting this class.`,
        },
        { status: 409 }
      );
    }

    // 2. Active subjects
    const subjects = await getSubjectsServer(authUser.schoolId, classId);
    if (subjects.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete class "${targetClass.name}-${targetClass.section}". It has ${subjects.length} curriculum subject(s) assigned. Please remove or reassign all subjects first.`,
        },
        { status: 409 }
      );
    }

    // 3. Historical attendance records
    const attendanceRecords = await getAttendanceServer(authUser.schoolId, undefined, classId);
    if (attendanceRecords.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete class "${targetClass.name}-${targetClass.section}". It has ${attendanceRecords.length} historical attendance record(s). Classes with attendance records cannot be deleted.`,
        },
        { status: 409 }
      );
    }

    // 4. Historical exam results
    const examResults = await getExamResultsServer(authUser.schoolId, undefined, classId);
    if (examResults.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete class "${targetClass.name}-${targetClass.section}". It has ${examResults.length} historical exam result(s). Classes with examination history cannot be deleted.`,
        },
        { status: 409 }
      );
    }

    // 5. Timetable schedule slots
    const timetableEntries = await getTimetableServer(authUser.schoolId, undefined, classId);
    if (timetableEntries.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete class "${targetClass.name}-${targetClass.section}". It has ${timetableEntries.length} timetable slot(s). Please remove all timetable schedule slots first.`,
        },
        { status: 409 }
      );
    }

    // 6. Fee challans
    const feeChallans = await getFeeChallansServer(authUser.schoolId);
    const classChallans = feeChallans.filter((c) => c.classId === classId);
    if (classChallans.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete class "${targetClass.name}-${targetClass.section}". It has ${classChallans.length} financial fee challan(s). Classes with financial records cannot be deleted.`,
        },
        { status: 409 }
      );
    }

    // Clean up assignedClassIds from teachers
    const teachers = await getTeachersServer(authUser.schoolId);
    for (const teacher of teachers) {
      if (teacher.assignedClassIds && teacher.assignedClassIds.includes(classId)) {
        const updatedAssigned = teacher.assignedClassIds.filter((cId) => cId !== classId);
        await saveTeacherServer({
          ...teacher,
          assignedClassIds: updatedAssigned,
        });
      }
    }

    await deleteClassServer(authUser.schoolId, classId);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_CLASS",
      "CLASS",
      classId,
      `Deleted class ${targetClass.name}-${targetClass.section}.`
    );

    return NextResponse.json({
      success: true,
      message: `Class "${targetClass.name}-${targetClass.section}" deleted successfully.`,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Class DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete class." },
      { status: 500 }
    );
  }
}

