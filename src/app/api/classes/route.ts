import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  saveClassServer,
  getStudentsServer,
  getSubjectsServer,
  createAuditLogServer,
  getTeacherByIdServer
} from "@/lib/firebase/server-db";
import { ClassDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req);
    const [classes, students, subjects] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getStudentsServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId)
    ]);

    const formatted = classes.map((c) => {
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
    const classId = `cls-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${section.toLowerCase()}`;

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
      academicYear: "2024-2025",
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
