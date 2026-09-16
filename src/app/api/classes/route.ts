import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  saveClassServer,
  getStudentsServer,
  getSubjectsServer,
  createAuditLogServer,
  getTeacherByIdServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";
import { ClassDoc } from "@/lib/firebase/types";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";

export async function GET(req: NextRequest) {
  try {
    // Only the admin console and the teacher portal ever read the class list. It was
    // previously open to any authenticated role, which let a STUDENT or PARENT session
    // enumerate every class in the school together with its roster size and class-teacher
    // name. Restricted to the roles that actually use it.
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const [classes, students, subjects] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getStudentsServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId)
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

      return {
        id: c.id,
        name: c.name,
        section: c.section,
        displayName: `${c.name}-${c.section}`,
        roomNumber: c.roomNo || "Room",
        capacity: c.capacity,
        studentCount: clsStudents.length,
        activeStudentCount: clsStudents.filter((s) => s.status === "ACTIVE").length,
        classTeacherId: c.classTeacherId,
        classTeacherName: c.classTeacherName || "Unassigned",
        subjects: clsSubjects.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          teacherName: s.teacherName || "Faculty",
        })),
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
    if (classTeacherId) {
      const teacher = await getTeacherByIdServer(authUser.schoolId, classTeacherId);
      if (teacher) classTeacherName = teacher.fullName;
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
      classTeacherId: classTeacherId || undefined,
      classTeacherName,
      academicYear: schoolSettings?.academicYear || new Date().getFullYear().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveClassServer(newClass);

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
