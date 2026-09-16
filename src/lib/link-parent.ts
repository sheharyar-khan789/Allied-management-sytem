import crypto from "crypto";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import {
  createUserServer,
  getUserByEmailServer,
  saveStudentServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { StudentDoc, UserProfile } from "@/lib/firebase/types";

// Cryptographically secure, high-entropy password — replaces a previous
// timestamp-derived password (`Parent@${last 4 digits of Date.now()}#`) that was
// both low-entropy (10,000 possible values) and identical for any two parent
// accounts created within the same 10-second window.
function generateSecureParentPassword(): string {
  const randomSegment = crypto.randomBytes(12).toString("base64url"); // 16 chars, URL-safe alphanumerics
  return `Parent@${randomSegment}!1`;
}

export async function linkGuardianEmailToStudent(params: {
  schoolId: string;
  student: StudentDoc;
  guardianEmail?: string;
  guardianName?: string;
}): Promise<{ parentUid?: string; parentEmail?: string; created: boolean; parentTemporaryPassword?: string }> {
  const email = (params.guardianEmail || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { created: false };
  }

  const existing = await getUserByEmailServer(email);
  let parent: UserProfile | null = existing;
  let created = false;
  let parentTemporaryPassword: string | undefined;

  if (parent) {
    if (parent.schoolId !== params.schoolId) {
      return { created: false };
    }
    if (parent.role !== "PARENT") {
      return { created: false };
    }
  } else {
    const now = new Date().toISOString();
    let uid = `usr-parent-${Date.now()}`;
    if (hasAdminCredentials) {
      try {
        const generatedPassword = generateSecureParentPassword();
        const createdAuth = await adminAuth.createUser({
          email,
          emailVerified: false,
          password: generatedPassword,
          displayName: params.guardianName || email,
          disabled: false,
        });
        uid = createdAuth.uid;
        // Surfaced once to the caller (the same secure, one-time-return pattern used
        // for student/teacher account creation elsewhere) — never logged, never
        // persisted to Firestore.
        parentTemporaryPassword = generatedPassword;
        await adminAuth.setCustomUserClaims(uid, {
          role: "PARENT",
          schoolId: params.schoolId,
        });
      } catch (err: any) {
        if (err?.code === "auth/email-already-exists") {
          const rec = await adminAuth.getUserByEmail(email);
          uid = rec.uid;
          const again = await getUserByEmailServer(email);
          if (again) parent = again;
        } else {
          console.error("Parent auth provision failed:", err);
          return { created: false };
        }
      }
    }

    if (!parent) {
      parent = {
        uid,
        name: params.guardianName || email.split("@")[0],
        email,
        role: "PARENT",
        schoolId: params.schoolId,
        studentIds: [params.student.id],
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      await createUserServer(parent);
      created = true;
    }
  }

  const studentIds = Array.from(new Set([...(parent.studentIds || []), params.student.id]));
  if (!parent.studentIds || parent.studentIds.join(",") !== studentIds.join(",")) {
    await updateUserServer({ ...parent, studentIds, updatedAt: new Date().toISOString() });
  }

  const parentUserIds = Array.from(new Set([...(params.student.parentUserIds || []), parent.uid]));
  if (
    params.student.guardianEmail !== email ||
    (params.student.parentUserIds || []).join(",") !== parentUserIds.join(",")
  ) {
    await saveStudentServer({
      ...params.student,
      guardianEmail: email,
      parentUserIds,
      updatedAt: new Date().toISOString(),
    });
  }

  return { parentUid: parent.uid, parentEmail: email, created, parentTemporaryPassword };
}
