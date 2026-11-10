import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import {
  createUserServer,
  getUserByEmailServer,
  saveStudentServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { StudentDoc, UserProfile } from "@/lib/firebase/types";

export async function linkGuardianEmailToStudent(params: {
  schoolId: string;
  student: StudentDoc;
  guardianEmail?: string;
  guardianName?: string;
}): Promise<{ parentUid?: string; parentEmail?: string; created: boolean }> {
  const email = (params.guardianEmail || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { created: false };
  }

  const existing = await getUserByEmailServer(email);
  let parent: UserProfile | null = existing;
  let created = false;

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
        const createdAuth = await adminAuth.createUser({
          email,
          emailVerified: false,
          password: `Parent@${Date.now().toString().slice(-4)}#`,
          displayName: params.guardianName || email,
          disabled: false,
        });
        uid = createdAuth.uid;
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

  return { parentUid: parent.uid, parentEmail: email, created };
}
