import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import {
  deleteTeacherServer,
  deleteUserProfileServer,
  getClassesServer,
  getSubjectsServer,
  getTeacherByIdServer,
  getTeachersServer,
  getTimetableServer,
  getUserByEmailServer,
  getUserByIdServer,
  saveClassServer,
  saveSubjectServer,
  saveTimetableEntryServer,
} from "@/lib/firebase/server-db";
import { TeacherDoc, UserProfile } from "@/lib/firebase/types";

async function deleteAuthAccount(uid: string): Promise<void> {
  if (!hasAdminCredentials) return;
  try {
    await adminAuth.deleteUser(uid);
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw err;
  }
}

/** A login profile that belongs to a teacher of this school. */
function isTeacherProfileOf(profile: UserProfile | null, schoolId: string): profile is UserProfile {
  return Boolean(profile && profile.role === "TEACHER" && profile.schoolId === schoolId);
}

export interface TeacherReferenceCleanup {
  classesCleared: number;
  subjectsCleared: number;
  timetableSlotsCleared: number;
}

/**
 * Clears every pointer to the teacher across all academic sessions: class-incharge on classes,
 * subject teacher, and timetable slots (the slot itself is kept — it belongs to the class — and
 * shows as unassigned). Historical records that only carry the teacher's name (payroll,
 * observations, audit logs) are deliberately left untouched.
 */
export async function clearTeacherReferences(schoolId: string, teacherId: string): Promise<TeacherReferenceCleanup> {
  const all = { allSessions: true };
  const [classes, subjects, slots] = await Promise.all([
    getClassesServer(schoolId, all),
    getSubjectsServer(schoolId, undefined, all),
    getTimetableServer(schoolId, teacherId, undefined, undefined, all),
  ]);

  const managed = classes.filter((c) => c.classTeacherId === teacherId);
  const taught = subjects.filter((s) => s.teacherId === teacherId);
  const ownSlots = slots.filter((t) => t.teacherId === teacherId);

  for (const c of managed) {
    await saveClassServer({ ...c, classTeacherId: null, classTeacherName: "Unassigned" });
  }
  for (const s of taught) {
    await saveSubjectServer({ ...s, teacherId: null, teacherName: "Unassigned" });
  }
  for (const t of ownSlots) {
    await saveTimetableEntryServer({ ...t, teacherId: "", teacherName: "Unassigned" });
  }

  return { classesCleared: managed.length, subjectsCleared: taught.length, timetableSlotsCleared: ownSlots.length };
}

/**
 * Full teacher deletion. Previously only the `teachers` document was removed, while the
 * teacher's `users` login profile and Firebase Auth account stayed behind — so the email stayed
 * "taken" and re-creating the same teacher failed with 409, and the deleted teacher could still
 * sign in. Now the login identity is removed together with the record and all references.
 */
export async function deleteTeacherCompletely(
  schoolId: string,
  teacher: TeacherDoc
): Promise<TeacherReferenceCleanup & { loginRemoved: boolean }> {
  const cleanup = await clearTeacherReferences(schoolId, teacher.id);

  let profile = teacher.userId ? await getUserByIdServer(teacher.userId) : null;
  if (!profile && teacher.email) profile = await getUserByEmailServer(teacher.email);

  let loginRemoved = false;
  // Only remove a login that really is this teacher's (same school, TEACHER role, and not linked
  // to a different teacher record).
  if (isTeacherProfileOf(profile, schoolId) && (!profile.teacherId || profile.teacherId === teacher.id)) {
    await deleteAuthAccount(profile.uid);
    await deleteUserProfileServer(profile.uid);
    loginRemoved = true;
  } else if (!profile && teacher.userId) {
    await deleteAuthAccount(teacher.userId);
  }

  await deleteTeacherServer(schoolId, teacher.id);
  return { ...cleanup, loginRemoved };
}

export type IdentityCheck = { ok: true; releasedStaleLogin: boolean } | { ok: false; error: string };

/**
 * Decides whether an email can be used for a new teacher in this school. An email held by a
 * live account (any school, any role, or an existing teacher) stays blocked. An email held only
 * by an orphaned TEACHER login of this school — left behind by a deletion made before
 * deleteTeacherCompletely existed — is released so the teacher can be re-created.
 */
export async function ensureTeacherEmailAvailable(schoolId: string, email: string): Promise<IdentityCheck> {
  const normalized = email.trim().toLowerCase();

  const teachers = await getTeachersServer(schoolId);
  if (teachers.some((t) => (t.email || "").trim().toLowerCase() === normalized)) {
    return { ok: false, error: "A teacher with this email already exists in this school." };
  }

  const profile = await getUserByEmailServer(normalized);
  if (!profile) return { ok: true, releasedStaleLogin: false };

  const orphaned =
    isTeacherProfileOf(profile, schoolId) &&
    (!profile.teacherId || !(await getTeacherByIdServer(schoolId, profile.teacherId)));
  if (!orphaned) {
    return { ok: false, error: "A user with this email already exists." };
  }

  await deleteAuthAccount(profile.uid);
  await deleteUserProfileServer(profile.uid);
  return { ok: true, releasedStaleLogin: true };
}

/**
 * Firebase Auth can still hold the email after the Firestore profile is gone (same historical
 * deletion bug). Such an account is released only when its own custom claims say it was a
 * TEACHER of this school whose teacher record no longer exists.
 */
export async function releaseOrphanedTeacherAuthAccount(schoolId: string, email: string): Promise<boolean> {
  if (!hasAdminCredentials) return false;
  let record;
  try {
    record = await adminAuth.getUserByEmail(email);
  } catch (err: any) {
    if (err?.code === "auth/user-not-found") return false;
    throw err;
  }
  const claims = record.customClaims || {};
  if (claims.role !== "TEACHER" || claims.schoolId !== schoolId) return false;
  if (await getUserByIdServer(record.uid)) return false;
  if (typeof claims.teacherId === "string" && (await getTeacherByIdServer(schoolId, claims.teacherId))) return false;
  await deleteAuthAccount(record.uid);
  return true;
}

/** Next free TCH-<n> employee id: one above the highest issued, never a reused number. */
export function nextEmployeeId(existing: Pick<TeacherDoc, "employeeId">[]): string {
  const highest = existing.reduce((max, t) => {
    const m = /^TCH-(\d+)$/.exec(t.employeeId || "");
    const n = m ? parseInt(m[1], 10) : 0;
    return n > max ? n : max;
  }, 100);
  return `TCH-${highest + 1}`;
}
