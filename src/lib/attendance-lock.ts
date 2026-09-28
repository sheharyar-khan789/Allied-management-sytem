import type { AttendanceDoc, UserRole } from "@/lib/firebase/types";

/**
 * Attendance locking.
 *
 * A TEACHER may create or change an attendance record only within 24 hours of that record being
 * first marked (its `createdAt`). After that the record is permanently locked for teachers and
 * only an ADMIN can change it. Enforced server-side in /api/attendance; the pages only mirror it.
 *
 * Creating a record that doesn't exist yet is allowed for a teacher only while the attendance
 * date itself is inside the same 24-hour window, so the lock can't be sidestepped by backfilling
 * an old date that was never marked.
 */
export const ATTENDANCE_TEACHER_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Roles allowed to edit attendance after the teacher window has closed. */
export function canOverrideAttendanceLock(role: UserRole): boolean {
  return role === "ADMIN";
}

/** ISO timestamp at which the record locks for teachers, or null if it has no usable timestamp. */
export function attendanceLockTime(record: Pick<AttendanceDoc, "createdAt" | "updatedAt">): string | null {
  const markedAt = Date.parse(record.createdAt || record.updatedAt || "");
  if (Number.isNaN(markedAt)) return null;
  return new Date(markedAt + ATTENDANCE_TEACHER_EDIT_WINDOW_MS).toISOString();
}

/** A record with no readable timestamp is treated as locked (fail closed). */
export function isAttendanceLockedForTeacher(
  record: Pick<AttendanceDoc, "createdAt" | "updatedAt">,
  now: number = Date.now()
): boolean {
  const lockTime = attendanceLockTime(record);
  if (!lockTime) return true;
  return now >= Date.parse(lockTime);
}

/**
 * Whether a teacher may create a new record for this YYYY-MM-DD date: the date must not be
 * earlier than the (UTC) calendar date 24 hours ago. Dates are compared as UTC calendar days,
 * matching how the attendance pages and API default "today".
 */
export function isAttendanceDateOpenForTeacher(date: string, now: number = Date.now()): boolean {
  const earliest = new Date(now - ATTENDANCE_TEACHER_EDIT_WINDOW_MS).toISOString().split("T")[0];
  return date >= earliest;
}
