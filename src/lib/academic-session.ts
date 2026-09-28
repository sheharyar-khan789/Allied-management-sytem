/**
 * Academic session isolation.
 *
 * The school's active session is `SchoolSettingsDoc.academicYear` (switched by an admin from the
 * header selector). Every session-dependent record (students, classes, subjects, timetable,
 * attendance, fee challans, payments, exams, exam results, observations) belongs to exactly one
 * session, and all list reads in server-db.ts return only the active session's records unless a
 * caller explicitly asks for another session.
 *
 * New writes are stamped with an explicit `academicYear`. Records written before this field
 * existed are attributed to the session of the class (or exam) they reference — classes and
 * exams have always been stamped with the session that was active when they were created — so
 * existing data stays in the session it was created in, and switching sessions never moves or
 * rewrites it. Only if that reference is missing too (e.g. the class was deleted) does a record
 * fall back to the active session.
 *
 * Pure helpers only — no database access here (see getAcademicSessionContextServer).
 */

export interface AcademicSessionContext {
  /** Active session for the school, or null if the school has no session configured. */
  academicYear: string | null;
  /** classId -> session of that class. */
  classYears: Map<string, string>;
  /** examId -> session of that exam. */
  examSessions: Map<string, string>;
}

export interface SessionScopedRecord {
  academicYear?: string;
  classId?: string;
  examId?: string;
}

export function sessionForClass(ctx: AcademicSessionContext, classId?: string | null): string | null {
  return (classId && ctx.classYears.get(classId)) || ctx.academicYear;
}

/** The session a record belongs to: its own stamp first, then its exam's, then its class's. */
export function resolveRecordSession(
  ctx: AcademicSessionContext,
  record: SessionScopedRecord
): string | null {
  if (record.academicYear) return record.academicYear;
  if (record.examId) {
    const examSession = ctx.examSessions.get(record.examId);
    if (examSession) return examSession;
  }
  return sessionForClass(ctx, record.classId);
}
