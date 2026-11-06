import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import { findForbiddenFields, forbiddenFieldsResponse, isSafeStoredUrl, teacherDocumentsArray } from "@/lib/input-validation";
import {
  getTeacherByIdServer,
  saveTeacherServer,
  createAuditLogServer,
  getClassesServer,
  getSubjectsServer
} from "@/lib/firebase/server-db";
import { validateDateString, isDateBefore } from "@/lib/date-utils";
import {
  deleteTeacherCompletely,
  updateTeacherAccountEmail,
  syncTeacherAccountStatus,
  TeacherEmailUpdateResult
} from "@/lib/teacher-lifecycle";
import { assignTeacherUsername } from "@/lib/teacher-username";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { deleteFileFromStorage, storagePathFromDownloadUrl } from "@/lib/storage";

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
      username: teacher.username || "",
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
      documents: teacher.documents || [],
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
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]");
    if (busy) return busy;
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    const forbiddenFields = findForbiddenFields(body, ["teacherId", "assignedSubjectIds"]);
    if (forbiddenFields.length > 0) return forbiddenFieldsResponse(forbiddenFields);
    if (body.photoUrl !== undefined && body.photoUrl !== null && !isSafeStoredUrl(body.photoUrl)) {
      return NextResponse.json({ error: "photoUrl must be an https:// URL." }, { status: 400 });
    }
    let parsedDocuments: ReturnType<typeof teacherDocumentsArray.parse> | undefined;
    if (body.documents !== undefined) {
      const docsParsed = teacherDocumentsArray.safeParse(body.documents);
      if (!docsParsed.success) {
        return NextResponse.json({ error: "Invalid documents: " + docsParsed.error.issues[0]?.message }, { status: 400 });
      }
      parsedDocuments = docsParsed.data;
    }
    for (const [key, max] of Object.entries({ firstName: 80, lastName: 80, designation: 120, qualification: 200, specialization: 120, phone: 30, email: 254 })) {
      if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== "string" || body[key].length > max)) {
        return NextResponse.json({ error: `${key} must be text of at most ${max} characters.` }, { status: 400 });
      }
    }
    if (body.status !== undefined && !["ACTIVE", "INACTIVE"].includes(body.status)) {
      return NextResponse.json({ error: "status must be ACTIVE or INACTIVE." }, { status: 400 });
    }
    if (body.baseSalary !== undefined || body.salary !== undefined) {
      requireRecentAuth(authUser, "change a teacher's salary", req);
    }

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

    // If the email address is changing, safely update the authentication account,
    // login profile, and teacher record with full two-phase rollback protection.
    let emailChangeResult: TeacherEmailUpdateResult | null = null;
    if (body.email !== undefined && body.email !== null && String(body.email).trim() !== "") {
      const targetEmail = String(body.email).trim().toLowerCase();
      const currentEmail = (existing.email || "").trim().toLowerCase();
      if (targetEmail !== currentEmail) {
        const emailUpdate = await updateTeacherAccountEmail(authUser.schoolId, id, targetEmail, {
          performedByUid: authUser.uid,
          performedByEmail: authUser.email,
          performedByRole: authUser.role,
        });
        if (!emailUpdate.ok) {
          return NextResponse.json({ error: emailUpdate.error }, { status: emailUpdate.status });
        }
        emailChangeResult = emailUpdate;
      }
    }

    const baseRecord = emailChangeResult?.teacher || existing;
    const updated: typeof existing = {
      ...baseRecord,
      assignedClassIds,
      fullName: body.firstName ? `${body.firstName} ${body.lastName || ""}`.trim() : baseRecord.fullName,
      designation: body.designation || baseRecord.designation,
      qualification: body.qualification || baseRecord.qualification,
      department: body.specialization || baseRecord.department,
      phone: body.phone || baseRecord.phone,
      email: emailChangeResult?.email || baseRecord.email,
      status: inferredStatus,
      photoUrl: body.photoUrl !== undefined ? body.photoUrl : baseRecord.photoUrl,
      documents: parsedDocuments !== undefined ? parsedDocuments : (baseRecord.documents || []),
      baseSalary: updatedSalary,
      salary: updatedSalary,
      joiningDate: updatedJoiningDate,
      endingDate: updatedEndingDate,
      updatedAt: new Date().toISOString()
    };

    await saveTeacherServer(updated);

    // If teacher status changed (ACTIVE <-> INACTIVE), sync login account status
    if (inferredStatus !== existing.status) {
      await syncTeacherAccountStatus(authUser.schoolId, updated, inferredStatus, {
        performedByUid: authUser.uid,
        performedByEmail: authUser.email,
        performedByRole: authUser.role,
      });
    }

    // A document removed from the array (the admin deleted it) has its underlying file cleaned
    // up too — see the identical rationale in PUT /api/students/[id]. Best-effort; never blocks
    // the profile save that already succeeded.
    if (parsedDocuments !== undefined) {
      const keptIds = new Set(parsedDocuments.map((d) => d.id));
      const removedDocs = (existing.documents || []).filter((d) => !keptIds.has(d.id));
      for (const doc of removedDocs) {
        const path = storagePathFromDownloadUrl(doc.url, authUser.schoolId);
        if (path) await deleteFileFromStorage(path, authUser.schoolId).catch(() => false);
      }
    }

    // Username (re)assignment: validated, atomically claimed, and applied without touching the
    // teacher's Firebase account, e-mail or password. Done after the rest of the profile saved so
    // a rejected username (taken/invalid) reports clearly without losing the other edits.
    let usernameChange: { username: string; changed: boolean } | null = null;
    if (body.username !== undefined && body.username !== null && String(body.username).trim() !== "") {
      const result = await assignTeacherUsername(authUser.schoolId, updated, body.username);
      if (!result.ok) {
        return NextResponse.json({ error: result.error, profileSaved: true }, { status: result.status });
      }
      updated.username = result.username;
      usernameChange = { username: result.username, changed: result.changed };
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      usernameChange?.changed ? "SET_TEACHER_USERNAME" : "UPDATE_TEACHER",
      "TEACHER",
      id,
      body.assignedClassIds !== undefined
        ? `Updated faculty member ${updated.fullName} (${updated.employeeId}); class access set to ${
            assignedClassIds.length > 0
              ? assignedClassIds.join(", ")
              : "none (unrestricted — see assertTeacherOwnsClass)"
          }.`
        : usernameChange?.changed
        ? `Set login username "${usernameChange.username}" for faculty member ${updated.fullName} (${updated.employeeId}).`
        : parsedDocuments !== undefined
        ? `Updated documents for faculty member ${updated.fullName} (${updated.employeeId}); now ${parsedDocuments.length} document(s) on file.`
        : `Updated profile for faculty member ${updated.fullName} (${updated.employeeId}).`
    );

    return NextResponse.json({ success: true, teacher: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]");
    if (busy) return busy;
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

    requireRecentAuth(authUser, "delete a teacher", req);
    const result = await deleteTeacherCompletely(authUser.schoolId, existing);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_TEACHER",
      "TEACHER",
      id,
      `Deleted faculty member ${existing.fullName} (${existing.employeeId}); ` +
        `login ${result.loginRemoved ? "removed" : "not found"}, ` +
        `cleared from ${result.classesCleared} class(es), ${result.subjectsCleared} subject(s), ` +
        `${result.timetableSlotsCleared} timetable slot(s).`
    );

    return NextResponse.json({ success: true, message: "Faculty member deleted successfully.", ...result });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]");
    if (busy) return busy;
    console.error("Teacher delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete teacher record." },
      { status: 500 }
    );
  }
}

