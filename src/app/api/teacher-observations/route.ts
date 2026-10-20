import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getTeacherByIdServer,
  getTeacherObservationByIdServer,
  getTeacherObservationsServer,
  saveTeacherObservationServer,
} from "@/lib/firebase/server-db";
import { TeacherObservationDoc } from "@/lib/firebase/types";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { idString, parseJsonBody } from "@/lib/input-validation";
import { TEACHER_OBSERVATION_CATEGORIES, toTeacherObservationView } from "@/lib/teacher-observations";

/**
 * Observations about teachers (`teacherObservations/{id}`), written by admins.
 *
 *  - ADMIN: create, edit, soft-delete and read every observation of their own school.
 *  - TEACHER: read-only, and only observations whose teacherId is the teacherId in their own
 *    signed session. A teacher can't widen that by passing another teacherId or an observation
 *    id: a foreign teacherId is refused (403), and a foreign observation id is reported as not
 *    found (404) so its existence isn't revealed.
 *  - Everyone else (STUDENT, PARENT, signed-out): refused by requireAuth.
 *
 * Every write is audit-logged; edits keep the previous text in editHistory and deletes are soft.
 */

const writable = {
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1, "Observation text is required.").max(8000),
  category: z.enum(TEACHER_OBSERVATION_CATEGORIES).optional(),
};
const createSchema = z.object({ teacherId: idString, ...writable });
const updateSchema = z.object({ id: idString, ...writable, content: writable.content.optional() });

const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });

function handleError(error: unknown, label: string, fallback: string) {
  if (error instanceof Response) return error;
  const busy = serviceBusyResponseFor(error, "/api/teacher-observations");
  if (busy) return busy;
  console.error(`Teacher observation ${label} error:`, error);
  return jsonError(fallback, 500);
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const params = new URL(req.url).searchParams;
    const id = params.get("id") || "";
    const requestedTeacherId = params.get("teacherId") || "";

    if (authUser.role === "TEACHER") {
      if (!authUser.teacherId) return jsonError("Your account is not linked to a teacher profile.", 403);
      if (requestedTeacherId && requestedTeacherId !== authUser.teacherId) {
        return jsonError("Forbidden: you can only view observations about yourself.", 403);
      }
    }
    const viewerRole = authUser.role === "ADMIN" ? "ADMIN" : "TEACHER";

    if (id) {
      const obs = await getTeacherObservationByIdServer(authUser.schoolId, id);
      const visible =
        obs && !obs.deletedAt && (authUser.role === "ADMIN" || obs.teacherId === authUser.teacherId);
      if (!visible) return jsonError("Observation not found.", 404);
      return NextResponse.json({ success: true, observation: toTeacherObservationView(obs!, viewerRole) });
    }

    const teacherId = authUser.role === "TEACHER" ? authUser.teacherId! : requestedTeacherId || undefined;
    const list = await getTeacherObservationsServer(authUser.schoolId, teacherId);
    return NextResponse.json({
      success: true,
      observations: list.map((o) => toTeacherObservationView(o, viewerRole)),
    });
  } catch (error) {
    return handleError(error, "GET", "Failed to load teacher observations.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // The teacher must genuinely belong to this school.
    const teacher = await getTeacherByIdServer(authUser.schoolId, body.teacherId);
    if (!teacher) return jsonError("Teacher not found for this school.", 404);

    const now = new Date().toISOString();
    const doc: TeacherObservationDoc = {
      id: `tobs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      schoolId: authUser.schoolId,
      teacherId: teacher.id,
      teacherName: teacher.fullName,
      category: body.category || "GENERAL",
      ...(body.title ? { title: body.title } : {}),
      note: body.content,
      authorUid: authUser.uid,
      authorName: authUser.name || "Administration",
      createdAt: now,
      updatedAt: now,
    };
    await saveTeacherObservationServer(doc);
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ADD_TEACHER_OBSERVATION",
      "TEACHER_OBSERVATION",
      doc.id,
      `Added observation about teacher ${teacher.fullName} (${teacher.id}): "${body.title || body.content.slice(0, 80)}".`
    );
    return NextResponse.json({ success: true, observation: toTeacherObservationView(doc, "ADMIN") }, { status: 201 });
  } catch (error) {
    return handleError(error, "POST", "Failed to add teacher observation.");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, updateSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const existing = await getTeacherObservationByIdServer(authUser.schoolId, body.id);
    if (!existing || existing.deletedAt) return jsonError("Observation not found.", 404);

    const now = new Date().toISOString();
    const titleChanged = body.title !== undefined && body.title !== (existing.title || "");
    const noteChanged = body.content !== undefined && body.content !== existing.note;
    const editHistory =
      titleChanged || noteChanged
        ? [
            ...(existing.editHistory || []),
            { at: now, by: authUser.uid, byName: authUser.name, previousTitle: existing.title, previousNote: existing.note },
          ]
        : existing.editHistory;

    const updated: TeacherObservationDoc = {
      ...existing,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { note: body.content } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(editHistory ? { editHistory } : {}),
      updatedAt: now,
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
      `Edited observation about teacher ${updated.teacherName} (${updated.teacherId}).`
    );
    return NextResponse.json({ success: true, observation: toTeacherObservationView(updated, "ADMIN") });
  } catch (error) {
    return handleError(error, "PUT", "Failed to update teacher observation.");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!id) return jsonError("id is required.", 400);

    const existing = await getTeacherObservationByIdServer(authUser.schoolId, id);
    if (!existing || existing.deletedAt) return jsonError("Observation not found.", 404);

    const now = new Date().toISOString();
    await saveTeacherObservationServer({ ...existing, deletedAt: now, deletedBy: authUser.uid, updatedAt: now, updatedBy: authUser.uid });
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_TEACHER_OBSERVATION",
      "TEACHER_OBSERVATION",
      id,
      `Deleted observation about teacher ${existing.teacherName} (${existing.teacherId}).`
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error, "DELETE", "Failed to delete teacher observation.");
  }
}
