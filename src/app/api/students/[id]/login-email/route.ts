import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getStudentByIdServer,
  getUserByIdServer,
  revokeUserSessionsServer,
  saveStudentServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { parseJsonBody } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { isLoginEmailTaken } from "@/lib/student-login-id";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().max(254).email() });

/**
 * Admin: changes a student's sign-in address. The student keeps the same internal id, uid and
 * every linked record (attendance, fees, marks, observations, enrolment history) — only the
 * login email on the Firebase Auth account, the login profile and the student record changes.
 * The new address must not be held by any other profile or Auth account.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "change a student's login email", req);
    const { id } = await params;
    const newEmail = parsed.data.email;

    const student = await getStudentByIdServer(authUser.schoolId, id);
    if (!student || student.schoolId !== authUser.schoolId) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }
    const profile = student.userId ? await getUserByIdServer(student.userId) : null;
    if (
      !profile ||
      profile.role !== "STUDENT" ||
      profile.schoolId !== authUser.schoolId ||
      (profile.studentId && profile.studentId !== student.id)
    ) {
      return NextResponse.json({ error: "This student has no login account to update." }, { status: 409 });
    }

    const oldEmail = profile.email;
    if (oldEmail === newEmail) {
      return NextResponse.json({ success: true, unchanged: true, email: newEmail });
    }
    if (await isLoginEmailTaken(newEmail, profile.uid)) {
      return NextResponse.json({ error: "This login email is already in use by another account." }, { status: 409 });
    }

    // 1. Authentication provider first: if it refuses, nothing else has changed.
    if (hasAdminCredentials) {
      try {
        await adminAuth.updateUser(profile.uid, { email: newEmail, emailVerified: true });
      } catch (err: any) {
        if (err?.code === "auth/email-already-exists") {
          return NextResponse.json({ error: "This login email is already in use by another account." }, { status: 409 });
        }
        if (err?.code === "auth/invalid-email") {
          return NextResponse.json({ error: "This login email is not valid for the sign-in provider." }, { status: 400 });
        }
        throw err;
      }
    }

    // 2. Application records. A failure here puts the provider back, so the two never disagree.
    try {
      await updateUserServer({ ...profile, email: newEmail });
      await saveStudentServer({ ...student, email: newEmail });
    } catch (dbErr) {
      if (hasAdminCredentials) {
        try {
          await adminAuth.updateUser(profile.uid, { email: oldEmail });
        } catch (rollbackErr: any) {
          console.error("[login-email] rollback of the Auth email failed:", rollbackErr?.code || "error");
        }
      }
      try {
        await updateUserServer({ ...profile, email: oldEmail });
      } catch {
        // best effort; the original error below is what the admin needs to see
      }
      throw dbErr;
    }

    // Sessions carry the old address; they must sign in again with the new one.
    await revokeUserSessionsServer(profile.uid);
    if (hasAdminCredentials) await adminAuth.revokeRefreshTokens(profile.uid);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CHANGE_STUDENT_LOGIN_EMAIL",
      "STUDENT",
      student.id,
      `Changed student login email from ${oldEmail} to ${newEmail}.`
    );

    return NextResponse.json({ success: true, email: newEmail, studentId: student.id });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/[id]/login-email");
    if (busy) return busy;
    console.error("Student login email error:", error?.message || "error");
    return NextResponse.json({ error: "Failed to update the login email." }, { status: 500 });
  }
}
