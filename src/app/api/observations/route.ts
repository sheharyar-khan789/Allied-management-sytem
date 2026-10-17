import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  saveStudentObservationServer,
  createAuditLogServer,
  getStudentByIdServer,
  getStudentObservationsServer,
  getStudentObservationByIdServer,
  getAllObservationsServer,
  getExamsServer,
  getClassesServer,
  getTeachersServer,
} from "@/lib/firebase/server-db";
import { StudentObservationDoc } from "@/lib/firebase/types";
import { assertCanViewStudent, assertTeacherOwnsClass } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { idString, parseJsonBody } from "@/lib/input-validation";
import {
  CONDUCT_RATINGS,
  OBSERVATION_CATEGORIES,
  sortObservationsNewestFirst,
  toObservationView,
} from "@/lib/exam-results";

/**
 * Student observations live in the `studentObservations` collection, one document per note
 * (`studentObservations/{obsId}`), keyed to the student by `studentId` and to the tenant by
 * `schoolId`. The heading is stored in `title`, the written text in `note`, the conduct rating
 * in `sentiment`; `examId` (optional) ties a note to one exam's report card.
 *
 * Earlier versions merged the title into `note` ("Title: text") and the screens rendered
 * `obs.title`/`obs.content`, fields the API never returned — so only the category badge
 * ("CONDUCT") was ever visible. Every response now uses the shape of `toObservationView`.
 */

const writableFields = {
  title: z.string().trim().max(200).optional(),
  // `content` is the name the existing forms send; it is stored as `note`.
  content: z.string().trim().min(1, "Observation text is required.").max(4000),
  category: z.enum(OBSERVATION_CATEGORIES).optional(),
  sentiment: z.enum(CONDUCT_RATINGS).optional(),
  examId: z.union([idString, z.literal(""), z.null()]).optional(),
};

const createSchema = z.object({ studentId: idString, ...writableFields });
const updateSchema = z.object({
  id: idString,
  ...writableFields,
  content: writableFields.content.optional(),
});

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

async function resolveExamId(schoolId: string, examId: string | null | undefined): Promise<string | undefined | Response> {
  if (!examId) return undefined;
  const exams = await getExamsServer(schoolId);
  if (!exams.some((e) => e.id === examId)) return jsonError("Selected exam not found in the active session.", 404);
  return examId;
}

/**
 * Admin-only, school-wide observation search (Admin Observations screen): no single studentId,
 * filterable by class/teacher/category/date range. A TEACHER always goes through the per-student
 * path below — class/allocation scoping for a free cross-student search isn't meaningfully
 * different from just giving them the whole school's notes, which assertCanViewStudent exists to
 * prevent.
 */
async function searchObservations(req: NextRequest, authUser: Awaited<ReturnType<typeof requireAuth>>) {
  const { searchParams } = new URL(req.url);
  const [observations, exams, classes, teachers] = await Promise.all([
    getAllObservationsServer(authUser.schoolId, {
      classId: searchParams.get("classId") || undefined,
      teacherId: searchParams.get("teacherId") || undefined,
      category: searchParams.get("category") || undefined,
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
    }),
    getExamsServer(authUser.schoolId),
    getClassesServer(authUser.schoolId),
    getTeachersServer(authUser.schoolId),
  ]);
  const examNameById = new Map(exams.map((e) => [e.id, e.name]));
  const classById = new Map(classes.map((c) => [c.id, `${c.name}-${c.section}`]));
  const search = (searchParams.get("q") || "").trim().toLowerCase();
  let list = observations.map((o) => ({
    ...toObservationView(o, examNameById),
    classId: o.classId || "",
    className: (o.classId && classById.get(o.classId)) || "",
  }));
  if (search) {
    list = list.filter(
      (o) =>
        o.note.toLowerCase().includes(search) ||
        o.title.toLowerCase().includes(search) ||
        o.studentId.toLowerCase().includes(search)
    );
  }
  return NextResponse.json({
    success: true,
    mode: "search",
    observations: list,
    classes: classes.map((c) => ({ id: c.id, name: `${c.name}-${c.section}` })),
    teachers: teachers.map((t) => ({ id: t.id, name: t.fullName })),
    exams: exams.map((e) => ({ id: e.id, name: e.name, term: e.term })),
  });
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const studentId = new URL(req.url).searchParams.get("studentId") || "";
    if (!studentId) {
      if (authUser.role !== "ADMIN") return jsonError("studentId is required.", 400);
      return await searchObservations(req, authUser);
    }
    // School isolation + teacher class scoping (404 for another school's student, 403 for a
    // class the teacher is not allocated).
    const student = await assertCanViewStudent(authUser, studentId);
    const [observations, exams] = await Promise.all([
      getStudentObservationsServer(authUser.schoolId, student.id),
      getExamsServer(authUser.schoolId),
    ]);
    const examNameById = new Map(exams.map((e) => [e.id, e.name]));
    return NextResponse.json({
      success: true,
      student: { id: student.id, fullName: student.fullName, classId: student.classId },
      observations: sortObservationsNewestFirst(
        observations.map((o) => ({
          ...toObservationView(o, examNameById),
          // Mirrors the PUT rule: admins edit any note of their school, teachers only their own.
          canEdit: authUser.role === "ADMIN" || o.teacherId === authUser.teacherId,
        }))
      ),
      exams: exams.map((e) => ({ id: e.id, name: e.name, term: e.term })),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/observations");
    if (busy) return busy;
    console.error("Observation GET error:", error);
    return jsonError("Failed to load observations.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // The student must genuinely belong to this school.
    const student = await getStudentByIdServer(authUser.schoolId, body.studentId);
    if (!student) {
      return jsonError("Student not found for this school.", 404);
    }

    // A TEACHER may only write an observation for a student of a class in their allocation —
    // verified against the student's real classId server-side.
    await assertTeacherOwnsClass(authUser, student.classId);

    // Never fabricate a teacher identity: a teacher's own account id, or the admin's staff id.
    let resolvedTeacherId: string;
    if (authUser.role === "TEACHER") {
      if (!authUser.teacherId) {
        return jsonError("Your account is not linked to a teacher profile.", 403);
      }
      resolvedTeacherId = authUser.teacherId;
    } else {
      resolvedTeacherId = `staff-${authUser.uid}`;
    }

    const examId = await resolveExamId(authUser.schoolId, body.examId);
    if (examId instanceof Response) return examId;

    const obsDoc: StudentObservationDoc = {
      id: `obs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      schoolId: authUser.schoolId,
      studentId: student.id,
      studentName: student.fullName,
      classId: student.classId,
      teacherId: resolvedTeacherId,
      teacherName: authUser.name || "Educator",
      category: body.category || "ACADEMIC",
      ...(body.title ? { title: body.title } : {}),
      note: body.content,
      sentiment: body.sentiment || "NEUTRAL",
      ...(examId ? { examId } : {}),
      createdAt: new Date().toISOString(),
    };

    await saveStudentObservationServer(obsDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ADD_OBSERVATION",
      "STUDENT_OBSERVATION",
      obsDoc.id,
      `Added observation note for ${obsDoc.studentName}: "${body.title || body.content.slice(0, 80)}".`
    );

    const exams = await getExamsServer(authUser.schoolId);
    return NextResponse.json(
      { success: true, observation: toObservationView(obsDoc, new Map(exams.map((e) => [e.id, e.name]))) },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/observations");
    if (busy) return busy;
    console.error("Observation POST error:", error);
    return jsonError("Failed to add observation note.", 500);
  }
}

/** Edits an observation: ADMIN for any of their school; a TEACHER only for their own notes. */
export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const parsed = await parseJsonBody(req, updateSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = await getStudentObservationByIdServer(authUser.schoolId, body.id);
    if (!existing) return jsonError("Observation not found.", 404);
    const student = await getStudentByIdServer(authUser.schoolId, existing.studentId);
    if (!student) return jsonError("Student not found for this school.", 404);
    await assertTeacherOwnsClass(authUser, student.classId);
    if (authUser.role === "TEACHER" && existing.teacherId !== authUser.teacherId) {
      return jsonError("Forbidden: you can only edit observations you wrote.", 403);
    }

    const examId = body.examId === undefined ? existing.examId : await resolveExamId(authUser.schoolId, body.examId);
    if (examId instanceof Response) return examId;

    // The text actually changing is what gets preserved in history — switching only the
    // category/sentiment/exam link isn't a correction to what was written.
    const titleChanged = body.title !== undefined && body.title !== (existing.title || "");
    const noteChanged = body.content !== undefined && body.content !== existing.note;
    const history = titleChanged || noteChanged
      ? [
          ...(existing.editHistory || []),
          {
            at: new Date().toISOString(),
            by: authUser.uid,
            byName: authUser.name,
            previousTitle: existing.title,
            previousNote: existing.note,
          },
        ]
      : existing.editHistory;

    const updated: StudentObservationDoc = {
      ...existing,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { note: body.content } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.sentiment ? { sentiment: body.sentiment } : {}),
      ...(history ? { editHistory: history } : {}),
      examId: examId || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: authUser.uid,
    };
    if (!updated.examId) delete updated.examId;

    await saveStudentObservationServer(updated);
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_OBSERVATION",
      "STUDENT_OBSERVATION",
      updated.id,
      `Edited observation note for ${student.fullName}.`
    );

    const exams = await getExamsServer(authUser.schoolId);
    return NextResponse.json({
      success: true,
      observation: toObservationView(updated, new Map(exams.map((e) => [e.id, e.name]))),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/observations");
    if (busy) return busy;
    console.error("Observation PUT error:", error);
    return jsonError("Failed to update observation note.", 500);
  }
}

/**
 * Soft-deletes an observation: ADMIN for any of their school; a TEACHER only for their own
 * notes (same authorization as PUT). The record is kept with deletedAt/deletedBy for the audit
 * trail — it just drops out of every normal read.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return jsonError("id is required.", 400);

    const existing = await getStudentObservationByIdServer(authUser.schoolId, id);
    if (!existing || existing.deletedAt) return jsonError("Observation not found.", 404);
    const student = await getStudentByIdServer(authUser.schoolId, existing.studentId);
    if (!student) return jsonError("Student not found for this school.", 404);
    await assertTeacherOwnsClass(authUser, student.classId);
    if (authUser.role === "TEACHER" && existing.teacherId !== authUser.teacherId) {
      return jsonError("Forbidden: you can only delete observations you wrote.", 403);
    }

    await saveStudentObservationServer({
      ...existing,
      deletedAt: new Date().toISOString(),
      deletedBy: authUser.uid,
      updatedAt: new Date().toISOString(),
      updatedBy: authUser.uid,
    });
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_OBSERVATION",
      "STUDENT_OBSERVATION",
      id,
      `Deleted observation note for ${student.fullName}.`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/observations");
    if (busy) return busy;
    console.error("Observation DELETE error:", error);
    return jsonError("Failed to delete observation note.", 500);
  }
}
