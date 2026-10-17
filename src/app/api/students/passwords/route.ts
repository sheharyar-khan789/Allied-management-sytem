import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { setAuthPasswordServer } from "@/lib/firebase/auth-password";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getStudentByIdServer,
  getUserByIdServer,
  revokeUserSessionsServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { parseJsonBody, idString } from "@/lib/input-validation";
import { BCRYPT_COST, generateInitialPassword } from "@/lib/password-reset";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

/** Students per request: keeps one call inside the serverless time limit; larger sets are re-sent in chunks. */
export const MAX_BULK_PASSWORD_RESETS = 100;
/** The shared temporary password an admin may explicitly choose. Never stored in the database. */
export const TEMPORARY_STUDENT_PASSWORD = "student@1";

const bodySchema = z.object({
  /** Student ids (named `students` because `studentIds` is a reserved server-controlled field). */
  students: z.array(idString).min(1).max(MAX_BULK_PASSWORD_RESETS),
  /**
   * "random": a unique password per student, returned once in the response for the admin to hand
   * out (the default and the safe choice). "temporary": the shared temporary password, only with
   * `confirmTemporary: true`.
   */
  mode: z.enum(["random", "temporary"]).default("random"),
  confirmTemporary: z.boolean().optional(),
});

type Outcome = {
  studentId: string;
  name?: string;
  loginEmail?: string;
  status: "UPDATED" | "FAILED";
  reason?: string;
  /** Whether the Authentication provider's own state was checked after the update (null = not checkable). */
  verified?: boolean | null;
  /** Only present in "random" mode, and only in this response — it is never stored or logged. */
  password?: string;
};

/**
 * Admin: sets a new password for selected students' real authentication accounts. The password is
 * written to Firebase Authentication (the system that actually checks it) and only its bcrypt hash
 * is kept on the login profile; it is never saved in clear text, never logged and never put in a
 * student record. Each account gets its own success/failure line, so a failed account is never
 * reported as updated, and the same call can be repeated for just the failed ids.
 */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "reset student passwords", req);
    const { mode, confirmTemporary } = parsed.data;
    const studentIds = Array.from(new Set(parsed.data.students));

    if (mode === "temporary" && confirmTemporary !== true) {
      return NextResponse.json(
        {
          error:
            "The shared temporary password is weak and identical for every selected student. Confirm explicitly (confirmTemporary: true) or use unique random passwords.",
        },
        { status: 400 }
      );
    }

    const outcomes: Outcome[] = [];
    for (const studentId of studentIds) {
      const outcome: Outcome = { studentId, status: "FAILED" };
      outcomes.push(outcome);
      try {
        const student = await getStudentByIdServer(authUser.schoolId, studentId);
        if (!student || student.schoolId !== authUser.schoolId) {
          outcome.reason = "Student not found in this school.";
          continue;
        }
        outcome.name = student.fullName;
        const profile = student.userId ? await getUserByIdServer(student.userId) : null;
        if (!profile || profile.role !== "STUDENT" || profile.schoolId !== authUser.schoolId) {
          outcome.reason = "This student has no login account.";
          continue;
        }
        outcome.loginEmail = profile.email;

        const password = mode === "temporary" ? TEMPORARY_STUDENT_PASSWORD : generateInitialPassword();
        const startedAt = Date.now();

        // The provider first: a failure here leaves the account exactly as it was.
        await setAuthPasswordServer(profile, password);
        try {
          const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
          await updateUserServer({ ...profile, passwordHash });
          await revokeUserSessionsServer(profile.uid);
        } catch {
          outcome.reason =
            "The sign-in provider was updated but the login profile could not be saved. Repeat the reset for this student.";
          continue;
        }

        // Checkable proof that the provider acted: revokeRefreshTokens (done by setAuthPasswordServer)
        // moves tokensValidAfterTime to "now".
        outcome.verified = null;
        if (hasAdminCredentials) {
          try {
            const record = await adminAuth.getUser(profile.uid);
            const validAfter = record.tokensValidAfterTime ? Date.parse(record.tokensValidAfterTime) : NaN;
            outcome.verified = Number.isFinite(validAfter) && validAfter >= startedAt - 5000;
          } catch {
            outcome.verified = null;
          }
        }

        outcome.status = "UPDATED";
        if (mode === "random") outcome.password = password;
      } catch (err: any) {
        outcome.status = "FAILED";
        outcome.reason =
          err?.code === "auth/too-many-requests" || err?.code === "auth/quota-exceeded"
            ? "The sign-in provider is rate limiting requests. Try this student again shortly."
            : outcome.reason || "The password could not be changed.";
        console.error("[student-password] failed:", err?.code || "error");
      }

      // One audit line per affected account; never the password.
      await createAuditLogServer(
        authUser.schoolId,
        authUser.uid,
        authUser.email,
        authUser.role,
        "RESET_STUDENT_PASSWORD",
        "STUDENT",
        studentId,
        `${outcome.status === "UPDATED" ? "Reset" : "Failed to reset"} password (${mode}) for ${outcome.loginEmail || studentId}${
          outcome.reason ? `: ${outcome.reason}` : ""
        }`
      ).catch(() => undefined);
    }

    const updated = outcomes.filter((o) => o.status === "UPDATED").length;
    const failedStudentIds = outcomes.filter((o) => o.status === "FAILED").map((o) => o.studentId);
    return NextResponse.json({
      success: failedStudentIds.length === 0,
      mode,
      updated,
      failed: failedStudentIds.length,
      failedStudentIds,
      outcomes,
      warnings:
        mode === "temporary"
          ? [
              "Every selected student now shares the same weak password. The system cannot force a change at first login, so ask students to change it immediately from their account, or reset them again with unique passwords.",
            ]
          : [],
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/passwords");
    if (busy) return busy;
    console.error("Student password reset error:", error?.message || "error");
    return NextResponse.json({ error: "Failed to reset student passwords." }, { status: 500 });
  }
}
