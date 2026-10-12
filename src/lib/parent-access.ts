import { AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  getSessionProfileServer,
  getStudentByIdServer,
  getStudentsByGuardianEmailServer,
  getStudentsByParentUserIdServer,
} from "@/lib/firebase/server-db";
import { StudentDoc } from "@/lib/firebase/types";

function parentLinkedToStudent(
  parentUid: string,
  parentEmail: string | undefined,
  student: StudentDoc
): boolean {
  if (student.parentUserIds?.includes(parentUid)) return true;
  const email = (parentEmail || "").trim().toLowerCase();
  const guardianEmail = (student.guardianEmail || "").trim().toLowerCase();
  return Boolean(email && guardianEmail && email === guardianEmail);
}

export async function getLinkedChildrenForParent(
  schoolId: string,
  parentUid: string
): Promise<StudentDoc[]> {
  // The same (≤30s cached) profile the session check uses.
  const profile = await getSessionProfileServer(schoolId, parentUid);
  if (profile && profile.schoolId !== schoolId) {
    return [];
  }

  const fromRelation = await getStudentsByParentUserIdServer(schoolId, parentUid);
  const byId = new Map<string, StudentDoc>();

  for (const student of fromRelation) {
    if (student.schoolId === schoolId && parentLinkedToStudent(parentUid, profile?.email, student)) {
      byId.set(student.id, student);
    }
  }

  const claimedIds = Array.isArray(profile?.studentIds) ? profile.studentIds : [];
  for (const studentId of claimedIds) {
    if (!studentId || byId.has(studentId)) continue;
    const student = await getStudentByIdServer(schoolId, studentId);
    if (!student || student.schoolId !== schoolId) continue;
    if (parentLinkedToStudent(parentUid, profile?.email, student)) {
      byId.set(student.id, student);
    }
  }

  if (profile?.email) {
    // Parent↔child links are identity, not session data (the relation lookup above spans all
    // sessions too); each child's attendance/fees/results are session-filtered when read.
    // One equality query on the (lowercase) guardian email instead of reading every student of
    // the school on every parent request.
    const byGuardianEmail = await getStudentsByGuardianEmailServer(schoolId, profile.email);
    for (const student of byGuardianEmail) {
      if (student.schoolId !== schoolId) continue;
      if (parentLinkedToStudent(parentUid, profile.email, student)) {
        byId.set(student.id, student);
      }
    }
  }

  return Array.from(byId.values());
}

export async function assertParentOwnsStudent(
  authUser: AuthenticatedUser,
  studentId: string
): Promise<StudentDoc> {
  if (!studentId) {
    throw new Response(JSON.stringify({ error: "studentId is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (authUser.role !== "PARENT") {
    throw new Response(JSON.stringify({ error: "Forbidden: parent relationship required." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const children = await getLinkedChildrenForParent(authUser.schoolId, authUser.uid);
  const child = children.find((c) => c.id === studentId);
  if (!child || child.schoolId !== authUser.schoolId) {
    throw new Response(
      JSON.stringify({ error: "Forbidden: this student is not linked to your parent account." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return child;
}

export async function parentOwnsStudentId(
  schoolId: string,
  parentUid: string,
  studentId: string
): Promise<boolean> {
  const children = await getLinkedChildrenForParent(schoolId, parentUid);
  return children.some((c) => c.id === studentId && c.schoolId === schoolId);
}
