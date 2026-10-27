import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  saveTeacherObservationServer,
  createAuditLogServer,
  getTeacherByIdServer,
  getTeachersServer,
  getTeacherObservationsServer,
  getTeacherObservationByIdServer,
  getAllTeacherObservationsServer,
} from "@/lib/firebase/server-db";
import { TeacherObservationDoc } from "@/lib/firebase/types";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { idString, parseJsonBody } from "@/lib/input-validation";
import {
  TEACHER_OBSERVATION_CATEGORIES,
  TEACHER_OBSERVATION_RATINGS,
  sortTeacherObservationsNewestFirst,
  toTeacherObservationView,
} from "@/lib/teacher-observations";

/**
 * Admin evaluation notes written ABOUT a teacher — not to be confused with `/api/observations`,
 * where a teacher writes a note about a student. Stored in its own `teacherObservations`
 * collection (see `src/lib/firebase/types.ts`).
 *
 * Authorization, deliberately asymmetric from the student-observation route:
 *  - Only ADMIN ever writes, edits, or deletes a note (the "author" is always the admin).
 *  - A TEACHER may only ever read — and only their OWN notes. Their own `teacherId` is resolved
 *    server-side from the session; any `teacherId` the client sends is ignored for a TEACHER
 *    caller, so there is no query-parameter, document-id, or body field that widens a teacher's
 *    read to another teacher's record.
 */

const writableFields = {
  observationDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Observation date must be YYYY-MM-DD."),
  category: z.enum(TEACHER_OBSERVATION_CATEGORIES),
  rating: z.enum(TEACHER_OBSERVATION_RATINGS),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().min(1, "Observation text is required.").max(4000),
  subjectId: z.union([idString, z.literal(""), z.null()]).optional(),
  classId: z.union([idString, z.literal(""), z.null()]).optional(),
};

const createSchema = z.object({ teacherId: idString, ...writableFields });
const updateSchema = z.object({
  id: idString,
  ...writableFields,
  observationDate: writableFields.observationDate.optional(),
  category: writableFields.category.optional(),
  rating: writableFields.rating.optional(),
  note: writableFields.note.optional(),
});

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Admin-only, school-wide search across every teacher's notes. */
/**
 * Admin-only review: school-wide by default, or narrowed to one teacher via `teacherId` — the
 * same endpoint applies category/date/text filters either way, so picking a teacher in the UI
 * never silently drops the other filters.
 */
async function searchTeacherObservations(req: NextRequest, schoolId: string) {
  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get("teacherId") || undefined;

  let teacher = null;
  if (teacherId) {
    teacher = await getTeacherByIdServer(schoolId, teacherId);
    if (!teacher) return jsonError("Teacher not found for this school.", 404);
  }

  const [observations, teachers] = await Promise.all([
    getAllTeacherObservationsServer(schoolId, {
      teacherId,
      category: searchParams.get("category") || undefined,
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
    }),
    getTeachersServer(schoolId),
  ]);
  const search = (searchParams.get("q") || "").trim().toLowerCase();
  let list = observations.map((o) => toTeacherObservationView(o));
  if (search) {
    list = list.filter(
      (o) =>
        o.note.toLowerCase().includes(search) ||
        o.title.toLowerCase().includes(search) ||
        o.teacherName.toLowerCase().includes(search)
    );
  }
  return NextResponse.json({
    success: true,
    mode: "search",
    ...(teacher ? { teacher: { id: teacher.id, fullName: teacher.fullName } } : {}),
    observations: sortTeacherObservationsNewestFirst(list),
    teachers: teachers.map((t) => ({ id: t.id, name: t.fullName })),
  });
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);

    if (authUser.role === "TEACHER") {
      // A teacher's own identity is resolved server-side; any `teacherId` query parameter is
      // ignored for this role so URL/parameter tampering cannot reach another teacher's notes.
      const teacher = await resolveAuthenticatedTeacher(authUser);
      if (!teacher) return jsonError("Your account is not linked to a teacher profile.", 403);
      const observations = await getTeacherObservationsServer(authUser.schoolId, teacher.id);
      return NextResponse.json({
        success: true,
        teacher: { id: teacher.id, fullName: teacher.fullName },
        observations: sortTeacherObservationsNewestFirst(observations.map((o) => toTeacherObservationView(o))),
      });
    }

    // ADMIN: school-wide search, optionally narrowed to one teacher — see searchTeacherObservations.
    return await searchTeacherObservations(req, authUser.schoolId);
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observations");
    if (busy) return busy;
    console.error("Teacher observation GET error:", error);
    return jsonError("Failed to load teacher observations.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Admin-only: a teacher can never create an official observation about themself or anyone.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const teacher = await getTeacherByIdServer(authUser.schoolId, body.teacherId);
    if (!teacher) return jsonError("Teacher not found for this school.", 404);

    const obsDoc: TeacherObservationDoc = {
      id: `tobs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      schoolId: authUser.schoolId,
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      authorUid: authUser.uid,
      authorName: authUser.name || "Administration",
      observationDate: body.observationDate,
      category: body.category,
      rating: body.rating,
      ...(body.title ? { title: body.title } : {}),
      note: body.note,
      ...(body.subjectId ? { subjectId: body.subjectId } : {}),
      ...(body.classId ? { classId: body.classId } : {}),
      createdAt: new Date().toISOString(),
    };

    await saveTeacherObservationServer(obsDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ADD_TEACHER_OBSERVATION",
      "TEACHER_OBSERVATION",
      obsDoc.id,
      `Added an observation note for ${teacher.fullName}: "${body.title || body.note.slice(0, 80)}".`
    );

    return NextResponse.json({ success: true, observation: toTeacherObservationView(obsDoc) }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observations");
    if (busy) return busy;
    console.error("Teacher observation POST error:", error);
    return jsonError("Failed to add teacher observation.", 500);
  }
}

/** Admin-only edit. A teacher has no edit path for a note written about them. */
export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, updateSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = await getTeacherObservationByIdServer(authUser.schoolId, body.id);
    if (!existing || existing.deletedAt) return jsonError("Observation not found.", 404);

    const titleChanged = body.title !== undefined && body.title !== (existing.title || "");
    const noteChanged = body.note !== undefined && body.note !== existing.note;
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

    const updated: TeacherObservationDoc = {
      ...existing,
      ...(body.observationDate ? { observationDate: body.observationDate } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.rating ? { rating: body.rating } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.subjectId !== undefined ? { subjectId: body.subjectId || undefined } : {}),
      ...(body.classId !== undefined ? { classId: body.classId || undefined } : {}),
      ...(history ? { editHistory: history } : {}),
      updatedAt: new Date().toISOString(),
      updatedBy: authUser.uid,
    };

    await saveTeacherObservationServer(updated);
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_TEACHER_OBSERVATION",
      "TEACHER_OBSERVATION",
      updated.id,
      `Edited an observation note for ${existing.teacherName || existing.teacherId}.`
    );

    return NextResponse.json({ success: true, observation: toTeacherObservationView(updated) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observations");
    if (busy) return busy;
    console.error("Teacher observation PUT error:", error);
    return jsonError("Failed to update teacher observation.", 500);
  }
}

/** Admin-only soft delete. */
export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return jsonError("id is required.", 400);

    const existing = await getTeacherObservationByIdServer(authUser.schoolId, id);
    if (!existing || existing.deletedAt) return jsonError("Observation not found.", 404);

    await saveTeacherObservationServer({
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
      "DELETE_TEACHER_OBSERVATION",
      "TEACHER_OBSERVATION",
      id,
      `Deleted an observation note for ${existing.teacherName || existing.teacherId}.`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observations");
    if (busy) return busy;
    console.error("Teacher observation DELETE error:", error);
    return jsonError("Failed to delete teacher observation.", 500);
  }
}
