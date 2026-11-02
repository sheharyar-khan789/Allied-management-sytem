import {
  claimUsernameServer,
  getUsernameRecordServer,
  getUserByIdServer,
  releaseUsernameServer,
  saveTeacherServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { TeacherDoc } from "@/lib/firebase/types";
import { normalizeUsername, validateUsername } from "@/lib/username";

export type UsernameAssignResult =
  | { ok: true; username: string; changed: boolean }
  | { ok: false; status: number; error: string };

export const USERNAME_TAKEN_MESSAGE = "This username is already taken. Please choose another.";

/**
 * Assigns or changes an existing teacher's login username, safely:
 *  - validated and normalized with src/lib/username.ts;
 *  - claimed with an atomic create-if-absent write, so two admins (or two requests) can never
 *    both get it — globally, across schools;
 *  - the teacher's Firebase Auth account, uid, e-mail, password and sessions are NOT touched; only
 *    the profile's `username` and the teacher record's display copy change;
 *  - if anything after the claim fails, the claim is released again (no stuck usernames);
 *  - the old username is freed only once the new one is fully in place.
 */
export async function assignTeacherUsername(
  schoolId: string,
  teacher: TeacherDoc,
  requested: unknown
): Promise<UsernameAssignResult> {
  const problem = validateUsername(requested);
  if (problem) return { ok: false, status: 400, error: problem };
  const username = normalizeUsername(requested);

  if (!teacher.userId) {
    return { ok: false, status: 409, error: "This teacher has no login account yet, so a username cannot be assigned." };
  }
  const profile = await getUserByIdServer(teacher.userId);
  if (!profile || profile.schoolId !== schoolId || profile.role !== "TEACHER") {
    return { ok: false, status: 409, error: "This teacher's login account could not be found in this school." };
  }
  if (profile.username === username && teacher.username === username) {
    return { ok: true, username, changed: false };
  }

  const holder = await getUsernameRecordServer(username);
  if (holder && holder.uid !== profile.uid) return { ok: false, status: 409, error: USERNAME_TAKEN_MESSAGE };

  let claimedNow = false;
  if (!holder) {
    const claim = await claimUsernameServer({ username, uid: profile.uid, schoolId, teacherId: teacher.id });
    if (claim === "TAKEN") return { ok: false, status: 409, error: USERNAME_TAKEN_MESSAGE };
    claimedNow = true;
  }

  const previous = profile.username;
  try {
    await updateUserServer({ ...profile, username });
    await saveTeacherServer({ ...teacher, username });
  } catch (e) {
    if (claimedNow) await releaseUsernameServer(username, profile.uid).catch(() => undefined);
    throw e;
  }
  if (previous && previous !== username) await releaseUsernameServer(previous, profile.uid).catch(() => undefined);
  return { ok: true, username, changed: true };
}
