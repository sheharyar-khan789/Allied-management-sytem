import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSubjectsServer,
  getSubjectByIdServer,
  saveSubjectServer,
  deleteSubjectServer,
  getClassesServer,
  getTeacherByIdServer,
  getTeachersServer,
  saveTeacherServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { SubjectDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId") || undefined;
    const teacherId = searchParams.get("teacherId") || undefined;

    const [subjects, classes, teachers] = await Promise.all([
      getSubjectsServer(authUser.schoolId, classId),
      getClassesServer(authUser.schoolId),
      getTeachersServer(authUser.schoolId),
    ]);

    let filtered = subjects;
    if (teacherId) {
      filtered = filtered.filter((s) => s.teacherId === teacherId);
    }

    const formatted = filtered.map((s) => {
      const cls = classes.find((c) => c.id === s.classId);
      const teacher = s.teacherId ? teachers.find((t) => t.id === s.teacherId) : null;
      return {
        id: s.id,
        schoolId: s.schoolId,
        name: s.name,
        code: s.code,
        classId: s.classId,
        className: cls ? `${cls.name}-${cls.section}` : s.className || "Class",
        teacherId: s.teacherId || null,
        teacherName: teacher ? teacher.fullName : s.teacherName || "Unassigned",
        credits: s.credits ?? 3,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });

    return NextResponse.json({ success: true, subjects: formatted });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Subjects GET error:", error);
    return NextResponse.json({ error: "Failed to retrieve subjects." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { name, code, classId, teacherId, credits } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Subject name is required." }, { status: 400 });
    }

    if (!classId || typeof classId !== "string" || !classId.trim()) {
      return NextResponse.json({ error: "Class selection is required." }, { status: 400 });
    }

    const classes = await getClassesServer(authUser.schoolId);
    const targetClass = classes.find((c) => c.id === classId.trim());
    if (!targetClass) {
      return NextResponse.json({ error: "Selected class does not exist in this school." }, { status: 404 });
    }

    let assignedTeacher = null;
    let teacherName = "Unassigned";
    if (teacherId && typeof teacherId === "string" && teacherId.trim()) {
      assignedTeacher = await getTeacherByIdServer(authUser.schoolId, teacherId.trim());
      if (!assignedTeacher) {
        return NextResponse.json({ error: "Selected teacher does not exist in this school." }, { status: 404 });
      }
      teacherName = assignedTeacher.fullName;
    }

    const slug = (val: string) => String(val).toLowerCase().replace(/[^a-z0-9]/g, "");
    const generatedId = `sb-${slug(authUser.schoolId)}-${slug(targetClass.id)}-${slug(name.trim())}`;

    const existingSubjects = await getSubjectsServer(authUser.schoolId, targetClass.id);
    const duplicate = existingSubjects.some(
      (s) => s.id === generatedId || slug(s.name) === slug(name.trim())
    );
    if (duplicate) {
      return NextResponse.json(
        { error: `Subject '${name.trim()}' already exists for ${targetClass.name}-${targetClass.section}.` },
        { status: 409 }
      );
    }

    const subjectCode = (code && typeof code === "string" && code.trim())
      ? code.trim().toUpperCase()
      : `${name.trim().slice(0, 3).toUpperCase()}-${targetClass.name.replace(/[^0-9]/g, "") || "01"}`;

    const newSubject: SubjectDoc = {
      id: generatedId,
      schoolId: authUser.schoolId,
      classId: targetClass.id,
      className: `${targetClass.name}-${targetClass.section}`,
      name: name.trim(),
      code: subjectCode,
      teacherId: assignedTeacher ? assignedTeacher.id : null,
      teacherName,
      credits: Number(credits) || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveSubjectServer(newSubject);

    // Two-way sync: Add to teacher's assigned subjects and class access
    if (assignedTeacher) {
      const subjectIds = new Set(assignedTeacher.assignedSubjectIds || []);
      subjectIds.add(newSubject.id);
      const classIds = new Set(assignedTeacher.assignedClassIds || []);
      classIds.add(targetClass.id);

      await saveTeacherServer({
        ...assignedTeacher,
        assignedSubjectIds: Array.from(subjectIds),
        assignedClassIds: Array.from(classIds),
      });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_SUBJECT",
      "SUBJECT",
      newSubject.id,
      `Created subject ${newSubject.name} (${newSubject.code}) for class ${targetClass.name}-${targetClass.section}.`
    );

    return NextResponse.json({ success: true, subject: newSubject }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Subject POST error:", error);
    return NextResponse.json({ error: "Failed to create subject." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { id, name, code, classId, teacherId, credits } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Subject ID is required." }, { status: 400 });
    }

    const existing = await getSubjectByIdServer(authUser.schoolId, id);
    if (!existing) {
      return NextResponse.json({ error: "Subject not found." }, { status: 404 });
    }

    let targetClass = null;
    const targetClassId = classId || existing.classId;
    if (targetClassId) {
      const classes = await getClassesServer(authUser.schoolId);
      targetClass = classes.find((c) => c.id === targetClassId);
      if (!targetClass) {
        return NextResponse.json({ error: "Selected class does not exist in this school." }, { status: 404 });
      }
    }

    const oldTeacherId = existing.teacherId || null;
    let newlyAssignedTeacher = null;
    let updatedTeacherName = existing.teacherName || "Unassigned";

    if (teacherId !== undefined) {
      if (teacherId && typeof teacherId === "string" && teacherId.trim()) {
        newlyAssignedTeacher = await getTeacherByIdServer(authUser.schoolId, teacherId.trim());
        if (!newlyAssignedTeacher) {
          return NextResponse.json({ error: "Selected teacher does not exist in this school." }, { status: 404 });
        }
        updatedTeacherName = newlyAssignedTeacher.fullName;
      } else {
        updatedTeacherName = "Unassigned";
      }
    }

    const updated: SubjectDoc = {
      ...existing,
      name: name ? name.trim() : existing.name,
      code: code ? code.trim().toUpperCase() : existing.code,
      classId: targetClass ? targetClass.id : existing.classId,
      className: targetClass ? `${targetClass.name}-${targetClass.section}` : existing.className,
      teacherId: teacherId !== undefined ? (teacherId ? teacherId.trim() : null) : (existing.teacherId || null),
      teacherName: updatedTeacherName,
      credits: credits !== undefined ? Number(credits) || existing.credits : existing.credits,
      updatedAt: new Date().toISOString(),
    };

    await saveSubjectServer(updated);

    // Two-way sync: Update teacher assignments
    if (teacherId !== undefined) {
      const targetTeacherId = teacherId ? teacherId.trim() : null;

      // 1. Add subject and class to new teacher
      if (newlyAssignedTeacher) {
        const subjectIds = new Set(newlyAssignedTeacher.assignedSubjectIds || []);
        subjectIds.add(id);
        const classIds = new Set(newlyAssignedTeacher.assignedClassIds || []);
        if (updated.classId) classIds.add(updated.classId);

        await saveTeacherServer({
          ...newlyAssignedTeacher,
          assignedSubjectIds: Array.from(subjectIds),
          assignedClassIds: Array.from(classIds),
        });
      }

      // 2. If old teacher was replaced or unassigned, remove subject from old teacher
      if (oldTeacherId && oldTeacherId !== targetTeacherId) {
        const oldTeacher = await getTeacherByIdServer(authUser.schoolId, oldTeacherId);
        if (oldTeacher) {
          const subjectIds = (oldTeacher.assignedSubjectIds || []).filter((sId) => sId !== id);

          // Check if old teacher still has any other subject or is class incharge for this class
          const schoolSubjects = await getSubjectsServer(authUser.schoolId, existing.classId);
          const stillTeachesOtherInClass = schoolSubjects.some((s) => s.id !== id && s.teacherId === oldTeacherId);
          const isClassTeacher = targetClass ? targetClass.classTeacherId === oldTeacherId : false;

          let classIds = oldTeacher.assignedClassIds || [];
          if (!stillTeachesOtherInClass && !isClassTeacher) {
            classIds = classIds.filter((cId) => cId !== existing.classId);
          }

          await saveTeacherServer({
            ...oldTeacher,
            assignedSubjectIds: subjectIds,
            assignedClassIds: classIds,
          });
        }
      }
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_SUBJECT",
      "SUBJECT",
      id,
      `Updated subject ${updated.name} (${updated.code}).`
    );

    return NextResponse.json({ success: true, subject: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Subject PUT error:", error);
    return NextResponse.json({ error: "Failed to update subject." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    let subjectId = searchParams.get("id");

    if (!subjectId) {
      try {
        const body = await req.json();
        subjectId = body.id;
      } catch {
        // no body
      }
    }

    if (!subjectId) {
      return NextResponse.json({ error: "Subject ID is required." }, { status: 400 });
    }

    const existing = await getSubjectByIdServer(authUser.schoolId, subjectId);
    if (!existing) {
      return NextResponse.json({ error: "Subject not found." }, { status: 404 });
    }

    // Clean up teacher assignment if assigned
    if (existing.teacherId) {
      const teacher = await getTeacherByIdServer(authUser.schoolId, existing.teacherId);
      if (teacher) {
        const subjectIds = (teacher.assignedSubjectIds || []).filter((sId) => sId !== subjectId);
        await saveTeacherServer({
          ...teacher,
          assignedSubjectIds: subjectIds,
        });
      }
    }

    await deleteSubjectServer(authUser.schoolId, subjectId);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_SUBJECT",
      "SUBJECT",
      subjectId,
      `Deleted subject ${existing.name} (${existing.code}).`
    );

    return NextResponse.json({ success: true, message: "Subject deleted successfully." });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Subject DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete subject." }, { status: 500 });
  }
}
