import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import {
  createAuditLogServer,
  deleteTeacherServer,
  deleteUserProfileServer,
  getClassesServer,
  getSubjectsServer,
  getTeacherByIdServer,
  getTeachersServer,
  getTimetableServer,
  getUserByEmailServer,
  getUserByIdServer,
  releaseUsernameServer,
  revokeUserSessionsServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  saveTimetableEntryServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { cacheKeys, invalidateCache, invalidateUserProfileCache } from "@/lib/server-cache";
import { sendPasswordSetupLink } from "@/lib/account-email";
import { resolveAppBaseUrl } from "@/lib/password-reset";
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
    // Free the username (only if this account holds it) so it can be reused.
    if (profile.username) await releaseUsernameServer(profile.username, profile.uid).catch(() => undefined);
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

export interface TeacherEmailUpdateResult {
  ok: boolean;
  status: number;
  error?: string;
  unchanged?: boolean;
  email?: string;
  teacher?: TeacherDoc;
  profile?: UserProfile;
}

/**
 * Updates a teacher's account email securely:
 * 1. Validates the email format and ensures length <= 254.
 * 2. Resolves the teacher and their associated UserProfile.
 * 3. Enforces that the email is not already taken by another teacher in the school,
 *    another UserProfile in the system, or another Firebase Auth account.
 * 4. Updates Firebase Authentication email securely with rollback protection.
 * 5. Updates the Firestore UserProfile and TeacherDoc records.
 * 6. Invalidates all caches and revokes active sessions.
 * 7. Records an audit log entry.
 *
 * Preserves the existing Firebase UID, username, role, schoolId, teacherId,
 * and all curriculum/timetable allocations.
 */
export async function updateTeacherAccountEmail(
  schoolId: string,
  teacherId: string,
  newEmailRaw: string,
  auditContext?: {
    performedByUid?: string;
    performedByEmail?: string;
    performedByRole?: string;
  }
): Promise<TeacherEmailUpdateResult> {
  if (!newEmailRaw || typeof newEmailRaw !== "string") {
    return { ok: false, status: 400, error: "Please provide a valid email address." };
  }
  const newEmail = newEmailRaw.trim().toLowerCase();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) {
    return { ok: false, status: 400, error: "Please provide a valid email address." };
  }

  const teacher = await getTeacherByIdServer(schoolId, teacherId);
  if (!teacher || teacher.schoolId !== schoolId) {
    return { ok: false, status: 404, error: "Teacher not found." };
  }

  let profile = teacher.userId ? await getUserByIdServer(teacher.userId) : null;
  if (!profile && teacher.email) {
    profile = await getUserByEmailServer(teacher.email);
  }
  if (!profile || profile.role !== "TEACHER" || profile.schoolId !== schoolId || (profile.teacherId && profile.teacherId !== teacher.id)) {
    return { ok: false, status: 409, error: "This teacher has no login account to update." };
  }

  const oldEmail = (profile.email || teacher.email || "").toLowerCase().trim();
  if (oldEmail === newEmail) {
    return { ok: true, status: 200, unchanged: true, email: newEmail, teacher, profile };
  }

  // Check for duplicates within this school's teachers
  const teachers = await getTeachersServer(schoolId);
  if (teachers.some((t) => t.id !== teacher.id && (t.email || "").trim().toLowerCase() === newEmail)) {
    return { ok: false, status: 409, error: "A teacher with this email already exists in this school." };
  }

  // Check for duplicates across all user profiles
  const existingUser = await getUserByEmailServer(newEmail);
  if (existingUser && existingUser.uid !== profile.uid) {
    return { ok: false, status: 409, error: "This login email is already in use by another account." };
  }

  // Check for duplicates in Firebase Auth
  if (hasAdminCredentials) {
    try {
      const authRecord = await adminAuth.getUserByEmail(newEmail);
      if (authRecord.uid !== profile.uid) {
        const released = await releaseOrphanedTeacherAuthAccount(schoolId, newEmail);
        if (!released) {
          return { ok: false, status: 409, error: "This login email is already in use by another account." };
        }
      }
    } catch (err: any) {
      if (err?.code !== "auth/user-not-found") throw err;
    }
  }

  // Phase 1: Update Firebase Auth provider
  let authUpdated = false;
  if (hasAdminCredentials) {
    try {
      await adminAuth.updateUser(profile.uid, {
        email: newEmail,
      });
      authUpdated = true;
    } catch (err: any) {
      if (err?.code === "auth/email-already-exists") {
        return { ok: false, status: 409, error: "This login email is already in use by another account." };
      }
      if (err?.code === "auth/invalid-email") {
        return { ok: false, status: 400, error: "This login email is not valid for the sign-in provider." };
      }
      console.error("[teacher-account] Firebase Auth email update failed:", err);
      return { ok: false, status: 500, error: "Failed to update authentication account email." };
    }
  }

  // Phase 2: Update Firestore records with rollback guarantee
  const updatedProfile: UserProfile = {
    ...profile,
    email: newEmail,
    updatedAt: new Date().toISOString(),
  };
  const updatedTeacher: TeacherDoc = {
    ...teacher,
    email: newEmail,
    userId: profile.uid,
    updatedAt: new Date().toISOString(),
  };

  try {
    await updateUserServer(updatedProfile);
    await saveTeacherServer(updatedTeacher);
  } catch (dbErr: any) {
    if (authUpdated && hasAdminCredentials) {
      try {
        await adminAuth.updateUser(profile.uid, { email: oldEmail });
      } catch (rbErr) {
        console.error("[teacher-account] Rollback of Firebase Auth email failed:", rbErr);
      }
    }
    try {
      await updateUserServer({ ...profile, email: oldEmail });
    } catch {}
    try {
      await saveTeacherServer({ ...teacher, email: oldEmail });
    } catch {}
    console.error("[teacher-account] Database update failed:", dbErr);
    return { ok: false, status: 500, error: "Failed to update teacher profile in database." };
  }

  // Cache invalidation & session revocation
  invalidateUserProfileCache(profile.uid);
  invalidateCache(cacheKeys.userByEmail(oldEmail));
  invalidateCache(cacheKeys.userByEmail(newEmail));
  await revokeUserSessionsServer(profile.uid);
  if (hasAdminCredentials) {
    await adminAuth.revokeRefreshTokens(profile.uid).catch(() => undefined);
  }

  // Audit log
  if (auditContext?.performedByUid) {
    await createAuditLogServer(
      schoolId,
      auditContext.performedByUid,
      auditContext.performedByEmail || "",
      auditContext.performedByRole || "ADMIN",
      "UPDATE_TEACHER_EMAIL",
      "TEACHER",
      teacher.id,
      `Changed teacher account email from ${oldEmail} to ${newEmail} for faculty member ${teacher.fullName} (${teacher.employeeId}).`
    );
  }

  return {
    ok: true,
    status: 200,
    email: newEmail,
    teacher: updatedTeacher,
    profile: updatedProfile,
  };
}

/**
 * Synchronizes teacher account activation/deactivation status across Firestore and Firebase Auth.
 * When deactivated:
 *  - UserProfile.status becomes "INACTIVE"
 *  - Firebase Auth disabled flag is set to true
 *  - Active sessions and refresh tokens are revoked
 * When reactivated:
 *  - UserProfile.status becomes "ACTIVE"
 *  - Firebase Auth disabled flag is set to false
 */
export async function syncTeacherAccountStatus(
  schoolId: string,
  teacher: TeacherDoc,
  status: "ACTIVE" | "INACTIVE",
  auditContext?: {
    performedByUid?: string;
    performedByEmail?: string;
    performedByRole?: string;
  }
): Promise<{ ok: boolean; status: "ACTIVE" | "INACTIVE" }> {
  let profile = teacher.userId ? await getUserByIdServer(teacher.userId) : null;
  if (!profile && teacher.email) {
    profile = await getUserByEmailServer(teacher.email);
  }

  if (profile && isTeacherProfileOf(profile, schoolId) && (!profile.teacherId || profile.teacherId === teacher.id)) {
    if (profile.status !== status) {
      await updateUserServer({ ...profile, status });
      invalidateUserProfileCache(profile.uid);
      if (status === "INACTIVE") {
        await revokeUserSessionsServer(profile.uid);
        if (hasAdminCredentials) {
          await adminAuth.revokeRefreshTokens(profile.uid).catch(() => undefined);
        }
      }
    }
  }

  const targetUid = profile?.uid || teacher.userId;
  if (hasAdminCredentials && targetUid) {
    try {
      await adminAuth.updateUser(targetUid, { disabled: status === "INACTIVE" });
    } catch (err: any) {
      if (err?.code !== "auth/user-not-found") {
        console.error("[teacher-status] Failed to update disabled in Auth:", err);
      }
    }
  }

  if (auditContext?.performedByUid && (!profile || profile.status !== status)) {
    await createAuditLogServer(
      schoolId,
      auditContext.performedByUid,
      auditContext.performedByEmail || "",
      auditContext.performedByRole || "ADMIN",
      status === "ACTIVE" ? "ACTIVATE_TEACHER_ACCOUNT" : "DEACTIVATE_TEACHER_ACCOUNT",
      "TEACHER",
      teacher.id,
      `Set faculty member ${teacher.fullName} (${teacher.employeeId}) account status to ${status}.`
    );
  }

  return { ok: true, status };
}


export interface TeacherPasswordResetResult {
  ok: boolean;
  status: number;
  error?: string;
  email?: string;
  channel?: string;
  sent?: boolean;
  resetLink?: string;
}

/**
 * Authoritative Teacher Password Reset:
 * 1. Admin requests password reset for teacherId in schoolId.
 * 2. Backend resolves the teacher's current account by UID first.
 * 3. Retrieves current authoritative email from Firebase Auth / UserProfile.
 * 4. Ensures any desync between Auth and Firestore is repaired immediately.
 * 5. Generates the Firebase password reset link and dispatches the reset email to the NEW email.
 * 6. Drops stale caches so old emails can never be targeted.
 * 7. Records an audit log event.
 */
export async function resetTeacherPassword(
  schoolId: string,
  teacherId: string,
  requestContext: { origin?: string | null; host?: string | null },
  auditContext?: {
    performedByUid?: string;
    performedByEmail?: string;
    performedByRole?: string;
  }
): Promise<TeacherPasswordResetResult> {
  const teacher = await getTeacherByIdServer(schoolId, teacherId);
  if (!teacher || teacher.schoolId !== schoolId) {
    return { ok: false, status: 404, error: "Teacher not found." };
  }

  if (teacher.status !== "ACTIVE") {
    return { ok: false, status: 409, error: "This teacher's account is inactive." };
  }

  // Resolve profile using UID first
  let profile = teacher.userId ? await getUserByIdServer(teacher.userId) : null;
  if (!profile && teacher.email) {
    profile = await getUserByEmailServer(teacher.email);
  }
  if (!profile && hasAdminCredentials && teacher.email) {
    try {
      const fb = await adminAuth.getUserByEmail(teacher.email);
      if (fb.uid) {
        profile = await getUserByIdServer(fb.uid);
      }
    } catch {}
  }

  if (
    !profile ||
    profile.role !== "TEACHER" ||
    profile.schoolId !== schoolId ||
    (profile.teacherId && profile.teacherId !== teacher.id)
  ) {
    return { ok: false, status: 404, error: "This teacher has no login account to reset." };
  }

  if (profile.status !== "ACTIVE") {
    return { ok: false, status: 409, error: "This teacher's account is inactive." };
  }

  // Authoritative email resolution from Firebase Auth if live
  let authoritativeEmail = (profile.email || teacher.email || "").toLowerCase().trim();
  if (hasAdminCredentials && profile.uid) {
    try {
      const authRecord = await adminAuth.getUser(profile.uid);
      if (authRecord.email) {
        const authEmail = authRecord.email.toLowerCase().trim();
        if (authEmail !== authoritativeEmail) {
          authoritativeEmail = authEmail;
          profile.email = authoritativeEmail;
          await updateUserServer(profile);
          if (teacher.email !== authoritativeEmail) {
            await saveTeacherServer({ ...teacher, email: authoritativeEmail });
          }
        }
      }
    } catch (err: any) {
      if (err?.code === "auth/user-not-found") {
        return { ok: false, status: 404, error: "Authentication account not found for this teacher." };
      }
      console.error("[teacher-reset] Firebase Auth check failed:", err);
    }
  }

  // Guarantee teacherDoc has userId and authoritative email linked
  if (teacher.userId !== profile.uid || teacher.email !== authoritativeEmail) {
    await saveTeacherServer({
      ...teacher,
      userId: profile.uid,
      email: authoritativeEmail,
      updatedAt: new Date().toISOString(),
    });
  }

  // Invalidate any stale caches
  invalidateUserProfileCache(profile.uid, authoritativeEmail, teacher.email);
  invalidateCache(cacheKeys.userByEmail(authoritativeEmail));
  if (teacher.email && teacher.email.toLowerCase().trim() !== authoritativeEmail) {
    invalidateCache(cacheKeys.userByEmail(teacher.email.toLowerCase().trim()));
  }
  invalidateCache(cacheKeys.teacher(schoolId, teacher.id));
  invalidateCache(cacheKeys.teachers(schoolId));

  // Generate password reset link / send email
  const delivery = await sendPasswordSetupLink(
    {
      uid: profile.uid,
      email: authoritativeEmail,
      name: profile.name || teacher.fullName,
      schoolId: profile.schoolId,
    },
    "RESET",
    requestContext
  );

  let resetLink: string | undefined = undefined;
  if (hasAdminCredentials) {
    try {
      const base = resolveAppBaseUrl(requestContext, process.env);
      const continueUrl = base.ok ? `${base.baseUrl}/login` : undefined;
      resetLink = await adminAuth.generatePasswordResetLink(authoritativeEmail, continueUrl ? { url: continueUrl } : undefined);
    } catch (e) {
      // Best-effort for link generation
    }
  }

  if (auditContext?.performedByUid) {
    await createAuditLogServer(
      schoolId,
      auditContext.performedByUid,
      auditContext.performedByEmail || "",
      auditContext.performedByRole || "ADMIN",
      delivery.delivered ? "ADMIN_RESET_TEACHER_PASSWORD" : "TEACHER_PASSWORD_RESET_FAILED",
      "TEACHER",
      teacher.id,
      delivery.delivered
        ? `Password reset link for ${authoritativeEmail} (${teacher.fullName}) dispatched via ${delivery.mode}.`
        : `Password reset link for ${authoritativeEmail} (${teacher.fullName}) failed via ${delivery.mode}: ${delivery.message}`
    );
  }

  return {
    ok: delivery.delivered || delivery.mode === "dev-console",
    status: delivery.delivered || delivery.mode === "dev-console" ? 200 : 502,
    email: authoritativeEmail,
    channel: delivery.mode,
    sent: delivery.delivered,
    resetLink,
    error: delivery.delivered || delivery.mode === "dev-console" ? undefined : delivery.message,
  };
}
