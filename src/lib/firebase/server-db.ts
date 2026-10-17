import { AggregateField, FieldPath, FieldValue } from "firebase-admin/firestore";
import type { DocumentSnapshot, Query } from "firebase-admin/firestore";
import { adminDb, hasAdminCredentials } from "./admin";
import {
  FIRESTORE_INDEX_MISSING,
  isMissingIndexError,
  isServiceUnavailableError,
  logFirestoreOutage,
  withFirestoreRetry,
} from "./firestore-errors";
import {
  CACHE_TTL_MS,
  cacheKeys,
  cached,
  invalidateCache,
  invalidateCachePrefix,
  invalidateUserProfileCache,
  peekCached,
} from "../server-cache";
import { getDefaultAcademicYear } from "../school-display";
import {
  AcademicSessionContext,
  resolveRecordSession,
  SessionScopedRecord,
} from "../academic-session";
import {
  School,
  UserProfile,
  StudentDoc,
  TeacherDoc,
  ClassDoc,
  SubjectDoc,
  AttendanceDoc,
  FeeChallanDoc,
  FeeStatus,
  PaymentDoc,
  ExamDoc,
  ExamScheduleDoc,
  ExamResultDoc,
  StudentObservationDoc,
  LessonPlanDoc,
  LockedRecordDoc,
  AuditLogDoc,
  SchoolSettingsDoc,
  TimetableDoc,
  TimetableImportDoc,
  AnnouncementDoc,
  PayrollRecordDoc,
  PasswordResetTokenDoc,
  StudentFeeLedgerDoc,
  StudentChargeDoc,
  FeeMonth,
  AttendanceStatus,
} from "./types";

// In-memory tenant fallback store for local development / builds without live GCP credentials
const localStore: {
  schools: Map<string, School>;
  settings: Map<string, SchoolSettingsDoc>;
  users: Map<string, UserProfile>;
  students: Map<string, StudentDoc>;
  teachers: Map<string, TeacherDoc>;
  classes: Map<string, ClassDoc>;
  subjects: Map<string, SubjectDoc>;
  attendance: Map<string, AttendanceDoc>;
  feeChallans: Map<string, FeeChallanDoc>;
  payments: Map<string, PaymentDoc>;
  exams: Map<string, ExamDoc>;
  examSchedules: Map<string, ExamScheduleDoc>;
  examResults: Map<string, ExamResultDoc>;
  studentObservations: Map<string, StudentObservationDoc>;
  lessonPlans: Map<string, LessonPlanDoc>;
  lockedRecords: Map<string, LockedRecordDoc>;
  auditLogs: Map<string, AuditLogDoc>;
  timetables: Map<string, TimetableDoc>;
  timetableImports: Map<string, TimetableImportDoc>;
  announcements: Map<string, AnnouncementDoc>;
  payrollRecords: Map<string, PayrollRecordDoc>;
  passwordResetTokens: Map<string, PasswordResetTokenDoc>;
  studentFeeLedgers: Map<string, StudentFeeLedgerDoc>;
  studentCharges: Map<string, StudentChargeDoc>;
} = {
  schools: new Map(),
  settings: new Map(),
  users: new Map(),
  students: new Map(),
  teachers: new Map(),
  classes: new Map(),
  subjects: new Map(),
  attendance: new Map(),
  feeChallans: new Map(),
  payments: new Map(),
  exams: new Map(),
  examSchedules: new Map(),
  examResults: new Map(),
  studentObservations: new Map(),
  lessonPlans: new Map(),
  lockedRecords: new Map(),
  auditLogs: new Map(),
  timetables: new Map(),
  timetableImports: new Map(),
  announcements: new Map(),
  payrollRecords: new Map(),
  passwordResetTokens: new Map(),
  studentFeeLedgers: new Map(),
  studentCharges: new Map(),
};

export function assertProductionDbReady() {
  if (process.env.NODE_ENV === "production" && !hasAdminCredentials) {
    throw new Error(
      "Critical: Cloud Firestore database connection not initialized. Server-side Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) must be properly configured in production environment."
    );
  }
}

export function onFirestoreError(operation: string, error: any): void {
  if (isServiceUnavailableError(error)) {
    // Quota exhausted / backend unreachable: tagged FIRESTORE_QUOTA_EXCEEDED or
    // FIRESTORE_UNAVAILABLE so it stands out in the Vercel logs.
    logFirestoreOutage(operation, error);
  } else {
    console.error(`[Firestore Error] ${operation} failed:`, error);
  }
  if (process.env.NODE_ENV === "production") {
    // Keep the gRPC code (and the original error) so callers can tell "out of quota" (503)
    // apart from a real failure (500).
    const wrapped = new Error(`Database error during ${operation}: ${error?.message || "Operation failed"}`) as Error & {
      code?: unknown;
      cause?: unknown;
    };
    wrapped.code = error?.code;
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * Strips undefined fields from an object so Firestore writes never fail with
 * 'Cannot use "undefined" as a Firestore value' when optional properties are omitted.
 */
/** Firestore allows 500 writes per batch; stay under it. */
export const FIRESTORE_BATCH_LIMIT = 450;

export function cleanUndefined<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

// Populate seed in fallback memory ONLY during non-production development
const DEFAULT_SCHOOL = "allied-school-main";
const now = new Date().toISOString();

if (process.env.NODE_ENV !== "production") {

localStore.schools.set(DEFAULT_SCHOOL, {
  id: DEFAULT_SCHOOL,
  name: "Allied School (Main Campus)",
  code: "ASM-001",
  address: "Sector F-8/4, Islamabad, Pakistan",
  phone: "+92 51 2850000",
  email: "info@alliedschools.edu.pk",
  principalName: "Dr. Asim Farooq",
  academicYear: "2024-2025",
  createdAt: now,
  updatedAt: now,
});

localStore.settings.set(DEFAULT_SCHOOL, {
  id: `set-${DEFAULT_SCHOOL}`,
  schoolId: DEFAULT_SCHOOL,
  schoolName: "Allied School (Main Campus)",
  campusName: "Sector F-8 Campus",
  motto: "Excellence in Education",
  address: "Sector F-8/4, Islamabad, Pakistan",
  phone: "+92 51 2850000",
  email: "info@alliedschools.edu.pk",
  principalName: "Dr. Asim Farooq",
  academicYear: "2024-2025",
  gradingScale: [
    { minPercentage: 80, grade: "A+", gpa: 4.0 },
    { minPercentage: 70, grade: "A", gpa: 3.5 },
    { minPercentage: 60, grade: "B", gpa: 3.0 },
    { minPercentage: 50, grade: "C", gpa: 2.0 },
    { minPercentage: 40, grade: "D", gpa: 1.0 },
    { minPercentage: 0, grade: "F", gpa: 0.0 },
  ],
  updatedAt: now,
});

// Seed users
localStore.users.set("admin@alliedschool.edu", {
  uid: "usr-admin-1",
  email: "admin@alliedschool.edu",
  name: "System Administrator",
  role: "ADMIN",
  schoolId: DEFAULT_SCHOOL,
  status: "ACTIVE",
  createdAt: now,
  updatedAt: now,
});

localStore.users.set("teacher@alliedschool.edu", {
  uid: "usr-teacher-1",
  email: "teacher@alliedschool.edu",
  name: "Prof. Muhammad Ali",
  role: "TEACHER",
  schoolId: DEFAULT_SCHOOL,
  teacherId: "tch-1",
  status: "ACTIVE",
  createdAt: now,
  updatedAt: now,
});

localStore.users.set("student@alliedschool.edu", {
  uid: "usr-student-1",
  email: "student@alliedschool.edu",
  name: "Zainab Khan",
  role: "STUDENT",
  schoolId: DEFAULT_SCHOOL,
  studentId: "std-1",
  status: "ACTIVE",
  createdAt: now,
  updatedAt: now,
});

localStore.users.set("parent@alliedschool.edu", {
  uid: "usr-parent-1",
  email: "parent@alliedschool.edu",
  name: "Muhammad Khan",
  role: "PARENT",
  schoolId: DEFAULT_SCHOOL,
  studentIds: ["std-1"],
  status: "ACTIVE",
  createdAt: now,
  updatedAt: now,
});

// Seed classes
const classesData: ClassDoc[] = [
  { id: "cls-10a", schoolId: DEFAULT_SCHOOL, name: "Class 10-A", section: "A", numericLevel: 10, capacity: 40, roomNo: "R-101", classTeacherId: "tch-1", classTeacherName: "Prof. Muhammad Ali", academicYear: "2024-2025", createdAt: now, updatedAt: now },
  { id: "cls-10b", schoolId: DEFAULT_SCHOOL, name: "Class 10-B", section: "B", numericLevel: 10, capacity: 40, roomNo: "R-102", academicYear: "2024-2025", createdAt: now, updatedAt: now },
  { id: "cls-9a", schoolId: DEFAULT_SCHOOL, name: "Class 9-A", section: "A", numericLevel: 9, capacity: 35, roomNo: "R-201", academicYear: "2024-2025", createdAt: now, updatedAt: now },
  { id: "cls-9b", schoolId: DEFAULT_SCHOOL, name: "Class 9-B", section: "B", numericLevel: 9, capacity: 35, roomNo: "R-202", academicYear: "2024-2025", createdAt: now, updatedAt: now },
];
classesData.forEach((c) => localStore.classes.set(c.id, c));

// Seed subjects
const subjectsData: SubjectDoc[] = [
  { id: "sb-1", schoolId: DEFAULT_SCHOOL, classId: "cls-10a", className: "Class 10-A", name: "Mathematics", code: "MTH-10", teacherId: "tch-1", teacherName: "Prof. Muhammad Ali", credits: 4, createdAt: now, updatedAt: now },
  { id: "sb-2", schoolId: DEFAULT_SCHOOL, classId: "cls-10a", className: "Class 10-A", name: "Physics", code: "PHY-10", credits: 4, createdAt: now, updatedAt: now },
  { id: "sb-3", schoolId: DEFAULT_SCHOOL, classId: "cls-10a", className: "Class 10-A", name: "Chemistry", code: "CHM-10", credits: 4, createdAt: now, updatedAt: now },
  { id: "sb-4", schoolId: DEFAULT_SCHOOL, classId: "cls-10a", className: "Class 10-A", name: "English", code: "ENG-10", credits: 3, createdAt: now, updatedAt: now },
  { id: "sb-5", schoolId: DEFAULT_SCHOOL, classId: "cls-10a", className: "Class 10-A", name: "Urdu", code: "URD-10", credits: 3, createdAt: now, updatedAt: now },
];
subjectsData.forEach((s) => localStore.subjects.set(s.id, s));

// Seed teacher
localStore.teachers.set("tch-1", {
  id: "tch-1",
  schoolId: DEFAULT_SCHOOL,
  employeeId: "EMP-2020-001",
  fullName: "Prof. Muhammad Ali",
  email: "teacher@alliedschool.edu",
  phone: "+92 300 1234567",
  designation: "Senior Mathematics Lecturer",
  department: "Science",
  qualification: "M.Sc. Mathematics, B.Ed",
  joiningDate: "2020-08-15",
  salary: 85000,
  status: "ACTIVE",
  assignedClassIds: ["cls-10a", "cls-9a"],
  assignedSubjectIds: ["sb-1"],
  weeklyLoad: 24,
  createdAt: now,
  updatedAt: now,
});

// Seed student
localStore.students.set("std-1", {
  id: "std-1",
  schoolId: DEFAULT_SCHOOL,
  admissionNo: "STD-2024-001",
  fullName: "Zainab Khan",
  fatherName: "Muhammad Khan",
  gender: "FEMALE",
  dob: "2009-04-12",
  phone: "+92 300 9990001",
  address: "House #12, Sector F-8, Islamabad",
  classId: "cls-10a",
  className: "Class 10-A",
  section: "A",
  rollNo: "01",
  status: "ACTIVE",
  guardianName: "Muhammad Khan",
  guardianPhone: "+92 300 9990001",
  guardianRelation: "Father",
  guardianEmail: "parent@alliedschool.edu",
  parentUserIds: ["usr-parent-1"],
  bloodGroup: "B+",
  monthlyFee: 6000,
  discount: 0,
  createdAt: now,
  updatedAt: now,
});

// Seed fee challan for sample student
localStore.feeChallans.set("ch-1001", {
  id: "ch-1001",
  schoolId: DEFAULT_SCHOOL,
  studentId: "std-1",
  studentName: "Zainab Khan",
  admissionNo: "STD-2024-001",
  classId: "cls-10a",
  className: "Class 10-A",
  challanNo: "CH-2025-1001",
  month: "January",
  year: 2025,
  issueDate: "2025-01-01",
  dueDate: "2025-01-15",
  tuitionFee: 6000,
  admissionFee: 0,
  examFee: 500,
  otherFee: 0,
  discount: 0,
  totalExpected: 6500,
  paidAmount: 6500,
  balanceAmount: 0,
  status: "PAID",
  createdAt: now,
  updatedAt: now,
});

// Seed exam
localStore.exams.set("ex-mid-2025", {
  id: "ex-mid-2025",
  schoolId: DEFAULT_SCHOOL,
  name: "Mid-Term Examination 2025",
  term: "Mid-Term",
  session: "2024-2025",
  startDate: "2025-02-10",
  endDate: "2025-02-20",
  status: "COMPLETED",
  createdAt: now,
  updatedAt: now,
});
}

// ---------------------------------------------------------------------------
// AGGREGATION HELPERS
// ---------------------------------------------------------------------------
/**
 * Runs an aggregation/indexed query; if Firestore says a composite index is missing (not deployed
 * yet), logs FIRESTORE_INDEX_MISSING and runs `fallback` (the older, more expensive but exact
 * path) instead of failing the request.
 */
async function withIndexFallback<T>(label: string, run: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!isMissingIndexError(e)) throw e;
    console.warn(`[${FIRESTORE_INDEX_MISSING}] ${label}: composite index not deployed, using fallback read`);
    return fallback();
  }
}

/** count() aggregation: 1 read per 1000 matching index entries instead of 1 read per document. */
async function countQuery(label: string, query: Query): Promise<number> {
  const snap = await withFirestoreRetry(label, () => query.count().get());
  return snap.data().count;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `field == value` for one value, `field in values` (max 30) for several. */
function whereOneOf(query: Query, field: string, values: string[]): Query {
  return values.length === 1 ? query.where(field, "==", values[0]) : query.where(field, "in", values);
}

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------
export async function createAuditLogServer(
  schoolId: string,
  userId: string,
  userEmail: string,
  role: string,
  action: string,
  entity: string,
  entityId: string,
  details: string
) {
  const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const data: AuditLogDoc = {
    id,
    schoolId,
    userId,
    userEmail,
    role,
    action,
    entity,
    entityId,
    details,
    timestamp: new Date().toISOString()
  };

  localStore.auditLogs.set(id, data);

  if (hasAdminCredentials) {
    try {
      const docRef = adminDb.collection("auditLogs").doc(id);
      await docRef.set(data);
    } catch (e) {
      onFirestoreError(`createAuditLogServer(${id})`, e);
    }
  }
}

export async function getAuditLogsServer(schoolId: string, maxLimit = 50): Promise<AuditLogDoc[]> {
  if (hasAdminCredentials) {
    try {
      let logs: AuditLogDoc[];
      try {
        // Newest first, bounded. Needs the auditLogs (schoolId ASC, timestamp DESC) index from
        // firestore.indexes.json; until it is deployed the unordered bounded read below is used.
        const snap = await adminDb.collection("auditLogs")
          .where("schoolId", "==", schoolId)
          .orderBy("timestamp", "desc")
          .limit(maxLimit)
          .get();
        logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc));
      } catch (e) {
        if (!isMissingIndexError(e)) throw e;
        console.warn(`[${FIRESTORE_INDEX_MISSING}] auditLogs(schoolId, timestamp desc): using unordered read`);
        const snap = await adminDb.collection("auditLogs")
          .where("schoolId", "==", schoolId)
          .limit(maxLimit)
          .get();
        logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc));
      }
      return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch (e) {
      onFirestoreError(`getAuditLogsServer(${schoolId})`, e);
    }
  }

  const logs = Array.from(localStore.auditLogs.values()).filter((l) => l.schoolId === schoolId);
  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, maxLimit);
}

// ---------------------------------------------------------------------------
// SCHOOLS & SETTINGS
// ---------------------------------------------------------------------------
export async function getSchoolServer(schoolId: string): Promise<School | null> {
  if (hasAdminCredentials) {
    try {
      const school = await cached(cacheKeys.school(schoolId), CACHE_TTL_MS.SCHOOL_REFERENCE, async () => {
        const doc = await withFirestoreRetry("getSchoolServer", () => adminDb.collection("schools").doc(schoolId).get());
        return doc.exists ? ({ id: doc.id, ...doc.data() } as School) : null;
      });
      if (school) return school;
    } catch (e) {
      onFirestoreError(`getSchoolServer(${schoolId})`, e);
    }
  }
  return localStore.schools.get(schoolId) || null;
}

export async function saveSchoolServer(school: School): Promise<void> {
  invalidateCache(cacheKeys.school(school.id));
  invalidateAcademicSessionCache(school.id);
  localStore.schools.set(school.id, school);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("schools").doc(school.id).set({
        ...school,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (e) {
      onFirestoreError(`saveSchoolServer(${school.id})`, e);
    }
  }
}

export async function getSchoolSettingsServer(schoolId: string): Promise<SchoolSettingsDoc | null> {
  if (hasAdminCredentials) {
    try {
      const settings = await cached(cacheKeys.settings(schoolId), CACHE_TTL_MS.SCHOOL_REFERENCE, async () => {
        const doc = await withFirestoreRetry("getSchoolSettingsServer", () =>
          adminDb.collection("schoolSettings").doc(schoolId).get()
        );
        return doc.exists ? ({ id: doc.id, ...doc.data() } as SchoolSettingsDoc) : null;
      });
      if (settings) return settings;
    } catch (e) {
      onFirestoreError(`getSchoolSettingsServer(${schoolId})`, e);
    }
  }
  return localStore.settings.get(schoolId) || null;
}

export async function updateSchoolSettingsServer(settings: SchoolSettingsDoc): Promise<void> {
  invalidateCache(cacheKeys.settings(settings.schoolId));
  invalidateAcademicSessionCache(settings.schoolId);
  localStore.settings.set(settings.schoolId, settings);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("schoolSettings").doc(settings.schoolId).set({
        ...settings,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      onFirestoreError(`updateSchoolSettingsServer(${settings.schoolId})`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// ACADEMIC SESSION ISOLATION (see src/lib/academic-session.ts)
// ---------------------------------------------------------------------------
/**
 * Scope for session-dependent list reads. Omitted: the school's active session.
 * `academicYear`: a specific session. `allSessions`: no session filter (e.g. school-wide
 * admission-number sequencing, which must stay unique across sessions).
 */
export interface SessionScope {
  academicYear?: string;
  allSessions?: boolean;
}

// Per-school memo of the session context (settings, school, every class and exam). It used to be
// kept for 5 seconds, so on a quiet serverless instance almost every request re-read all classes
// and exams. It is now cached for SCHOOL_REFERENCE (60s) and invalidated in-process on every write
// that can change it (settings, school, classes, exams); getClassesServer/getExamsServer reuse
// the same lists instead of querying again.
interface CachedSessionContext extends AcademicSessionContext {
  classes: ClassDoc[];
  exams: ExamDoc[];
}

export function invalidateAcademicSessionCache(schoolId: string): void {
  invalidateCache(cacheKeys.sessionContext(schoolId));
  // Per-class aggregates are keyed by the active-session classes, so they go too.
  invalidateCachePrefix(cacheKeys.studentCountsPrefix(schoolId));
  invalidateCachePrefix(cacheKeys.feeAggregatesPrefix(schoolId));
  invalidateCachePrefix(cacheKeys.examGradesPrefix(schoolId));
}

async function loadSessionContext(schoolId: string): Promise<CachedSessionContext> {
  const load = async () => {
    const [settings, school, classes, exams] = await Promise.all([
      getSchoolSettingsServer(schoolId),
      getSchoolServer(schoolId),
      fetchClassesRaw(schoolId),
      fetchExamsRaw(schoolId),
    ]);
    return { academicYear: settings?.academicYear || school?.academicYear || null, classes, exams };
  };
  // The in-memory development store is mutated directly by tests; only Firestore results are cached.
  const raw = hasAdminCredentials
    ? await cached(cacheKeys.sessionContext(schoolId), CACHE_TTL_MS.SCHOOL_REFERENCE, load)
    : await load();
  const classYears = new Map<string, string>();
  for (const c of raw.classes) {
    if (c.academicYear) classYears.set(c.id, c.academicYear);
  }
  const examSessions = new Map<string, string>();
  for (const e of raw.exams) {
    if (e.session) examSessions.set(e.id, e.session);
  }
  return { academicYear: raw.academicYear, classYears, examSessions, classes: raw.classes, exams: raw.exams };
}

export async function getAcademicSessionContextServer(schoolId: string): Promise<AcademicSessionContext> {
  return loadSessionContext(schoolId);
}

/** Classes of the active session (or of `year`), in name order. */
export async function getSessionClassesServer(schoolId: string, year?: string | null): Promise<ClassDoc[]> {
  const ctx = await loadSessionContext(schoolId);
  const target = year === undefined ? ctx.academicYear : year;
  return ctx.classes.filter((c) => !target || (c.academicYear || ctx.academicYear) === target);
}

/** Resolves which session a list read should return; null means "don't filter". */
async function resolveSessionScope(
  schoolId: string,
  scope?: SessionScope
): Promise<{ ctx: AcademicSessionContext; year: string | null }> {
  const ctx = await getAcademicSessionContextServer(schoolId);
  if (scope?.allSessions) return { ctx, year: null };
  return { ctx, year: scope?.academicYear || ctx.academicYear };
}

function filterToSession<T extends SessionScopedRecord>(
  ctx: AcademicSessionContext,
  year: string | null,
  records: T[]
): T[] {
  if (!year) return records;
  return records.filter((r) => resolveRecordSession(ctx, r) === year);
}

/**
 * The session a record being written belongs to. An explicit stamp is kept as is (so editing a
 * historical record never moves it into the active session); otherwise it follows its exam or
 * class, which is how legacy records are attributed on read too.
 */
async function sessionForWrite(schoolId: string, record: SessionScopedRecord): Promise<string | undefined> {
  if (record.academicYear) return record.academicYear;
  const ctx = await getAcademicSessionContextServer(schoolId);
  return resolveRecordSession(ctx, record) || undefined;
}

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------
export async function getUserByEmailServer(email: string): Promise<UserProfile | null> {
  assertProductionDbReady();
  const norm = email.toLowerCase().trim();
  if (hasAdminCredentials) {
    try {
      const snap = await withFirestoreRetry("getUserByEmailServer", () =>
        adminDb.collection("users").where("email", "==", norm).limit(1).get()
      );
      if (!snap.empty) {
        const d = snap.docs[0];
        return { uid: d.id, ...d.data() } as UserProfile;
      }
      if (process.env.NODE_ENV === "production") return null;
    } catch (e) {
      onFirestoreError(`getUserByEmailServer(${email})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  for (const u of localStore.users.values()) {
    if (u.email.toLowerCase().trim() === norm) return u;
  }
  return null;
}

export async function getUserByIdServer(uid: string): Promise<UserProfile | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await withFirestoreRetry("getUserByIdServer", () => adminDb.collection("users").doc(uid).get());
      if (doc.exists) return { uid: doc.id, ...doc.data() } as UserProfile;
      if (process.env.NODE_ENV === "production") return null;
    } catch (e) {
      onFirestoreError(`getUserByIdServer(${uid})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  for (const u of localStore.users.values()) {
    if (u.uid === uid) return u;
  }
  return null;
}

/**
 * The user profile behind a session (revocation check, /api/auth/me, layouts), cached per
 * (schoolId, uid) for CACHE_TTL_MS.SESSION_PROFILE (30s). Every user write in this file
 * (password change/reset, logout, role/status change, delete, import) drops the cached copy in
 * this instance immediately; another serverless instance notices within the TTL. Use
 * getUserByIdServer when the latest stored value is required (e.g. verifying a password).
 */
export async function getSessionProfileServer(schoolId: string, uid: string): Promise<UserProfile | null> {
  if (!hasAdminCredentials) return getUserByIdServer(uid);
  return cached(cacheKeys.sessionProfile(schoolId, uid), CACHE_TTL_MS.SESSION_PROFILE, () => getUserByIdServer(uid));
}

export async function createUserServer(user: UserProfile): Promise<void> {
  invalidateUserProfileCache(user.uid);
  localStore.users.set(user.email.toLowerCase().trim(), user);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(user.uid).set(user);
      invalidateUserProfileCache(user.uid);
    } catch (e) {
      onFirestoreError(`createUserServer(${user.uid})`, e);
    }
  }
}

export async function updateUserServer(user: UserProfile): Promise<void> {
  const merged: UserProfile = {
    ...user,
    email: user.email.toLowerCase().trim(),
    updatedAt: new Date().toISOString(),
  };
  invalidateUserProfileCache(merged.uid);

  for (const [key, existing] of localStore.users.entries()) {
    if (existing.uid === merged.uid) {
      localStore.users.delete(key);
    }
  }
  localStore.users.set(merged.email, merged);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(merged.uid).set(merged, { merge: true });
      invalidateUserProfileCache(merged.uid);
    } catch (e) {
      onFirestoreError(`updateUserServer(${merged.uid})`, e);
    }
  }
}

/**
 * Removes fields from a user profile. updateUserServer writes with { merge: true }, which keeps
 * any field that is merely omitted from the object — so leaving a field out does NOT delete it
 * in Firestore. Fields that must really disappear (e.g. a spent reset token) go through here.
 */
export async function deleteUserFieldsServer(uid: string, fields: (keyof UserProfile)[]): Promise<void> {
  invalidateUserProfileCache(uid);
  for (const [key, existing] of localStore.users.entries()) {
    if (existing.uid === uid) {
      const next = { ...existing } as Record<string, unknown>;
      for (const f of fields) delete next[f as string];
      localStore.users.set(key, next as unknown as UserProfile);
    }
  }
  if (hasAdminCredentials) {
    try {
      const patch: Record<string, unknown> = {};
      for (const f of fields) patch[f as string] = FieldValue.delete();
      await adminDb.collection("users").doc(uid).set(patch, { merge: true });
      invalidateUserProfileCache(uid);
    } catch (e) {
      onFirestoreError(`deleteUserFieldsServer(${uid})`, e);
    }
  }
}

/** Hard-deletes a user profile document. Callers verify ownership/role before calling. */
export async function deleteUserProfileServer(uid: string): Promise<void> {
  invalidateUserProfileCache(uid);
  for (const [key, existing] of localStore.users.entries()) {
    if (existing.uid === uid) localStore.users.delete(key);
  }
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(uid).delete();
      invalidateUserProfileCache(uid);
    } catch (e) {
      onFirestoreError(`deleteUserProfileServer(${uid})`, e);
    }
  }
}

/**
 * Looks up several emails in one pass (Firestore `in` queries of up to 30 values) instead of
 * one query per email. Returns a map keyed by normalized email.
 */
export async function getUsersByEmailsServer(emails: string[]): Promise<Map<string, UserProfile>> {
  assertProductionDbReady();
  const norm = Array.from(new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean)));
  const found = new Map<string, UserProfile>();
  if (norm.length === 0) return found;

  if (hasAdminCredentials) {
    try {
      for (let i = 0; i < norm.length; i += 30) {
        const chunk = norm.slice(i, i + 30);
        const snap = await adminDb.collection("users").where("email", "in", chunk).get();
        for (const d of snap.docs) {
          const u = { uid: d.id, ...d.data() } as UserProfile;
          found.set(u.email.toLowerCase().trim(), u);
        }
      }
      if (process.env.NODE_ENV === "production") return found;
    } catch (e) {
      onFirestoreError("getUsersByEmailsServer", e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const wanted = new Set(norm);
  for (const u of localStore.users.values()) {
    const e = u.email.toLowerCase().trim();
    if (wanted.has(e) && !found.has(e)) found.set(e, u);
  }
  return found;
}

/**
 * Sets the session cutoff on a profile: any session signed in before `atIso` is rejected by
 * requireAuth from then on.
 */
export async function revokeUserSessionsServer(uid: string, atIso: string = new Date().toISOString()): Promise<void> {
  invalidateUserProfileCache(uid);
  syncLocalUser(uid, { sessionsValidAfter: atIso });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(uid).set({ sessionsValidAfter: atIso, updatedAt: atIso }, { merge: true });
      invalidateUserProfileCache(uid);
    } catch (e) {
      onFirestoreError(`revokeUserSessionsServer(${uid})`, e);
      throw e;
    }
  }
}

/**
 * Revokes one session (its `sid` claim) — used by logout so a copied cookie stops working
 * immediately, while the user's other devices stay signed in. Keeps the last 25 ids; older
 * sessions have passed their absolute lifetime anyway.
 */
export async function revokeSessionIdServer(uid: string, sid: string): Promise<void> {
  const MAX_KEPT = 25;
  const merge = (current: string[] | undefined) =>
    Array.from(new Set([...(current || []), sid])).slice(-MAX_KEPT);

  invalidateUserProfileCache(uid);
  for (const existing of localStore.users.values()) {
    if (existing.uid === uid) syncLocalUser(uid, { revokedSessionIds: merge(existing.revokedSessionIds) });
  }
  if (hasAdminCredentials) {
    try {
      const ref = adminDb.collection("users").doc(uid);
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const current = (snap.data()?.revokedSessionIds as string[] | undefined) || [];
        tx.set(ref, { revokedSessionIds: merge(current) }, { merge: true });
      });
      invalidateUserProfileCache(uid);
    } catch (e) {
      onFirestoreError(`revokeSessionIdServer(${uid})`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// MONOTONIC COUNTERS (server-only collection "counters", id = caller supplied key)
// ---------------------------------------------------------------------------
const localCounters = new Map<string, number>();

/**
 * Atomically hands out the next value of a counter and advances it, so two concurrent callers can
 * never receive the same value. A value is never handed out twice, even if the record it was used
 * for is later deleted (the counter only moves forward). The first value is `start`.
 */
export async function allocateCounterValueServer(key: string, start = 1): Promise<number> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const ref = adminDb.collection("counters").doc(key);
      return await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const stored = snap.exists ? Number(snap.data()?.next) : NaN;
        const value = Number.isInteger(stored) && stored >= start ? stored : start;
        tx.set(ref, { next: value + 1, updatedAt: new Date().toISOString() }, { merge: true });
        return value;
      });
    } catch (e) {
      onFirestoreError(`allocateCounterValueServer(${key})`, e);
      throw e;
    }
  }
  // No await between the read and the write: atomic on the single JS thread.
  const stored = localCounters.get(key);
  const value = stored !== undefined && stored >= start ? stored : start;
  localCounters.set(key, value + 1);
  return value;
}

/** Moves a counter forward to at least `next` (never backwards, so issued values stay unique). */
export async function raiseCounterToAtLeastServer(key: string, next: number): Promise<number> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const ref = adminDb.collection("counters").doc(key);
      return await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const stored = snap.exists ? Number(snap.data()?.next) : NaN;
        const value = Number.isInteger(stored) && stored >= next ? stored : next;
        tx.set(ref, { next: value, updatedAt: new Date().toISOString() }, { merge: true });
        return value;
      });
    } catch (e) {
      onFirestoreError(`raiseCounterToAtLeastServer(${key})`, e);
      throw e;
    }
  }
  const stored = localCounters.get(key);
  const value = stored !== undefined && stored >= next ? stored : next;
  localCounters.set(key, value);
  return value;
}

/** The value the next allocation would return (1 if the counter was never used). */
export async function peekCounterServer(key: string, start = 1): Promise<number> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("counters").doc(key).get();
      const stored = snap.exists ? Number(snap.data()?.next) : NaN;
      return Number.isInteger(stored) && stored >= start ? stored : start;
    } catch (e) {
      onFirestoreError(`peekCounterServer(${key})`, e);
      throw e;
    }
  }
  const stored = localCounters.get(key);
  return stored !== undefined && stored >= start ? stored : start;
}

// ---------------------------------------------------------------------------
// ONE-TIME SCHOOL REGISTRATION SECRETS (server-only collection, id = sha256(secret))
// ---------------------------------------------------------------------------
const localConsumedRegistrationSecrets = new Set<string>();

/**
 * Atomically marks a registration secret (by hash) as used. Returns false if it was already used,
 * so one SCHOOL_REGISTRATION_SECRET value can create exactly one institution; registering another
 * school requires the operator to set a new secret.
 */
export async function consumeRegistrationSecretServer(secretHash: string, schoolId: string): Promise<boolean> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const ref = adminDb.collection("registrationSecrets").doc(secretHash);
      return await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return false;
        tx.set(ref, { usedAt: new Date().toISOString(), schoolId });
        return true;
      });
    } catch (e) {
      onFirestoreError("consumeRegistrationSecretServer", e);
      throw e;
    }
  }
  if (localConsumedRegistrationSecrets.has(secretHash)) return false;
  localConsumedRegistrationSecrets.add(secretHash);
  return true;
}

/** Undo a consume when the registration it guarded failed and was rolled back. */
export async function releaseRegistrationSecretServer(secretHash: string): Promise<void> {
  localConsumedRegistrationSecrets.delete(secretHash);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("registrationSecrets").doc(secretHash).delete();
    } catch (e) {
      onFirestoreError("releaseRegistrationSecretServer", e);
    }
  }
}

function syncLocalUser(uid: string, patch: Partial<UserProfile>): void {
  for (const [key, existing] of localStore.users.entries()) {
    if (existing.uid === uid) localStore.users.set(key, { ...existing, ...patch });
  }
}

// ---------------------------------------------------------------------------
// PASSWORD RESET TOKENS (server-only collection, document id = sha256(token))
// ---------------------------------------------------------------------------
/**
 * Stores a new reset token and deletes any earlier tokens for the same user, so only the most
 * recently emailed link can ever be used.
 */
export async function savePasswordResetTokenServer(rec: PasswordResetTokenDoc): Promise<void> {
  assertProductionDbReady();
  for (const [id, t] of localStore.passwordResetTokens.entries()) {
    if (t.uid === rec.uid) localStore.passwordResetTokens.delete(id);
  }
  localStore.passwordResetTokens.set(rec.id, rec);

  if (hasAdminCredentials) {
    try {
      const previous = await adminDb.collection("passwordResetTokens").where("uid", "==", rec.uid).get();
      const batch = adminDb.batch();
      previous.docs.forEach((d) => batch.delete(d.ref));
      batch.set(adminDb.collection("passwordResetTokens").doc(rec.id), cleanUndefined(rec));
      await batch.commit();
    } catch (e) {
      onFirestoreError(`savePasswordResetTokenServer(${rec.uid})`, e);
      throw e;
    }
  }
}

export async function getPasswordResetTokenServer(tokenHash: string): Promise<PasswordResetTokenDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("passwordResetTokens").doc(tokenHash).get();
      if (doc.exists) return { id: doc.id, ...doc.data() } as PasswordResetTokenDoc;
      if (process.env.NODE_ENV === "production") return null;
    } catch (e) {
      onFirestoreError("getPasswordResetTokenServer", e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  return localStore.passwordResetTokens.get(tokenHash) || null;
}

export type ConsumeResetTokenResult = "OK" | "INVALID" | "USED" | "EXPIRED";

export function checkPasswordResetToken(
  token: PasswordResetTokenDoc | null | undefined,
  nowMs: number = Date.now()
): ConsumeResetTokenResult {
  if (!token) return "INVALID";
  if (token.usedAt) return "USED";
  const expires = Date.parse(token.expiresAt);
  if (Number.isNaN(expires) || expires <= nowMs) return "EXPIRED";
  return "OK";
}

/**
 * Atomically marks a reset token as used and writes the new password hash + session cutoff to
 * the user profile. The token check and the "used" mark happen in one Firestore transaction, so
 * the same link can never succeed twice even if submitted concurrently.
 */
export async function consumePasswordResetTokenServer(
  tokenHash: string,
  uid: string,
  passwordHash: string,
  nowIso: string = new Date().toISOString()
): Promise<ConsumeResetTokenResult> {
  assertProductionDbReady();
  const nowMs = Date.parse(nowIso);
  const userPatch = { passwordHash, sessionsValidAfter: nowIso, updatedAt: nowIso };
  invalidateUserProfileCache(uid);

  if (hasAdminCredentials) {
    try {
      const tokenRef = adminDb.collection("passwordResetTokens").doc(tokenHash);
      const userRef = adminDb.collection("users").doc(uid);
      const result = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(tokenRef);
        const token = snap.exists ? ({ id: snap.id, ...snap.data() } as PasswordResetTokenDoc) : null;
        const status = token && token.uid !== uid ? "INVALID" : checkPasswordResetToken(token, nowMs);
        if (status !== "OK") return status;
        tx.set(tokenRef, { usedAt: nowIso }, { merge: true });
        tx.set(
          userRef,
          { ...userPatch, resetTokenHash: FieldValue.delete(), resetTokenExpires: FieldValue.delete() },
          { merge: true }
        );
        return status;
      });
      invalidateUserProfileCache(uid);
      if (result === "OK") {
        const local = localStore.passwordResetTokens.get(tokenHash);
        if (local) local.usedAt = nowIso;
        syncLocalUser(uid, userPatch);
      }
      return result;
    } catch (e) {
      onFirestoreError(`consumePasswordResetTokenServer(${uid})`, e);
      throw e;
    }
  }

  const local = localStore.passwordResetTokens.get(tokenHash);
  const status = local && local.uid !== uid ? "INVALID" : checkPasswordResetToken(local, nowMs);
  if (status !== "OK") return status;
  local!.usedAt = nowIso;
  syncLocalUser(uid, userPatch);
  await deleteUserFieldsServer(uid, ["resetTokenHash", "resetTokenExpires"]);
  return status;
}

// ---------------------------------------------------------------------------
// STUDENTS
// ---------------------------------------------------------------------------
async function fetchStudentsRaw(
  schoolId: string,
  classId?: string,
  search?: string,
  maxLimit?: number,
  status?: string
): Promise<StudentDoc[]> {
  assertProductionDbReady();
  let students: StudentDoc[] = [];
  if (hasAdminCredentials) {
    try {
      students = await queryStudentsFirestore(schoolId, classId, maxLimit, status);
    } catch (e) {
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  if (students.length === 0 && process.env.NODE_ENV !== "production") {
    students = Array.from(localStore.students.values()).filter((s) => s.schoolId === schoolId);
    if (classId && classId !== "ALL") {
      students = students.filter((s) => s.classId === classId);
    }
    if (status && status.toUpperCase() !== "ALL") {
      students = students.filter((s) => s.status === status);
    }
  }

  if (search) {
    const s = search.toLowerCase();
    students = students.filter(
      (st) =>
        st.fullName.toLowerCase().includes(s) ||
        st.admissionNo.toLowerCase().includes(s) ||
        st.rollNo.toLowerCase().includes(s)
    );
  }
  const sorted = students.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return maxLimit && maxLimit > 0 ? sorted.slice(0, Math.min(maxLimit, 250)) : sorted;
}

/**
 * Firestore student list read. Unbounded lists are cached per (school, class, status) for
 * SCHOOL_REFERENCE and dropped on every student write in this instance; a class roster is cut
 * from an already-cached whole-school list instead of being read again.
 */
async function queryStudentsFirestore(
  schoolId: string,
  classId?: string,
  maxLimit?: number,
  status?: string
): Promise<StudentDoc[]> {
  const cls = classId && classId !== "ALL" ? classId : "ALL";
  const st = status && status.toUpperCase() !== "ALL" ? status : "ALL";
  const run = async () => {
    let ref: Query = adminDb.collection("students").where("schoolId", "==", schoolId);
    if (cls !== "ALL") ref = ref.where("classId", "==", cls);
    if (st !== "ALL") ref = ref.where("status", "==", st);
    if (maxLimit && maxLimit > 0) ref = ref.limit(Math.min(maxLimit, 250));
    const snap = await withFirestoreRetry("students", () => ref.get());
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentDoc));
  };
  if (maxLimit && maxLimit > 0) return run();
  if (cls !== "ALL" || st !== "ALL") {
    const whole =
      peekCached<StudentDoc[]>(cacheKeys.students(schoolId, "ALL", st)) ??
      peekCached<StudentDoc[]>(cacheKeys.students(schoolId, "ALL", "ALL"))?.filter((s) => st === "ALL" || s.status === st);
    if (whole) return cls === "ALL" ? whole : whole.filter((s) => s.classId === cls);
  }
  return cached(cacheKeys.students(schoolId, cls, st), CACHE_TTL_MS.SCHOOL_REFERENCE, run);
}

function invalidateStudentCaches(schoolId: string): void {
  invalidateCachePrefix(cacheKeys.studentsPrefix(schoolId));
  invalidateCachePrefix(cacheKeys.studentCountsPrefix(schoolId));
}

export interface ClassStudentCounts {
  total: number;
  active: number;
  male: number;
  female: number;
}

/**
 * Students per class of the active session, via count() aggregations (2 per class, 4 with
 * `withGender`) instead of reading every student document. A student belongs to the session of
 * the class they are in — the same rule session isolation applies to unstamped legacy records.
 * Cached for AGGREGATES; dropped on every student write in this instance.
 */
export async function getStudentCountsByClassServer(
  schoolId: string,
  options: { withGender?: boolean } = {}
): Promise<Map<string, ClassStudentCounts>> {
  const classes = await getSessionClassesServer(schoolId);
  const fromList = async () => {
    const students = await getStudentsServer(schoolId);
    const counts = new Map<string, ClassStudentCounts>();
    for (const c of classes) counts.set(c.id, { total: 0, active: 0, male: 0, female: 0 });
    for (const st of students) {
      const entry = counts.get(st.classId);
      if (!entry) continue;
      entry.total++;
      if (st.status === "ACTIVE") entry.active++;
      if (st.gender === "MALE") entry.male++;
      if (st.gender === "FEMALE") entry.female++;
    }
    return counts;
  };
  if (!hasAdminCredentials) return fromList();

  const key = `${cacheKeys.studentCountsPrefix(schoolId)}${options.withGender ? "g" : "b"}`;
  const rows = await cached(key, CACHE_TTL_MS.AGGREGATES, () =>
    withIndexFallback(
      "students count by class",
      async () =>
        Promise.all(
          classes.map(async (c) => {
            const base = adminDb.collection("students").where("schoolId", "==", schoolId).where("classId", "==", c.id);
            const [total, active, male, female] = await Promise.all([
              countQuery("students.count", base),
              countQuery("students.countActive", base.where("status", "==", "ACTIVE")),
              options.withGender ? countQuery("students.countMale", base.where("gender", "==", "MALE")) : Promise.resolve(0),
              options.withGender ? countQuery("students.countFemale", base.where("gender", "==", "FEMALE")) : Promise.resolve(0),
            ]);
            return [c.id, { total, active, male, female }] as [string, ClassStudentCounts];
          })
        ),
      async () => Array.from((await fromList()).entries())
    )
  );
  return new Map(rows);
}

/**
 * Students whose guardian email is `email` (stored lowercase by linkGuardianEmailToStudent), all
 * sessions. One equality query instead of scanning the whole school.
 */
export async function getStudentsByGuardianEmailServer(schoolId: string, email: string): Promise<StudentDoc[]> {
  const norm = email.trim().toLowerCase();
  if (!norm) return [];
  if (hasAdminCredentials) {
    try {
      const snap = await withFirestoreRetry("getStudentsByGuardianEmailServer", () =>
        adminDb.collection("students").where("schoolId", "==", schoolId).where("guardianEmail", "==", norm).get()
      );
      const found = snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentDoc));
      if (found.length > 0 || process.env.NODE_ENV === "production") return found;
    } catch (e) {
      onFirestoreError(`getStudentsByGuardianEmailServer(${schoolId})`, e);
    }
  }
  return Array.from(localStore.students.values()).filter(
    (st) => st.schoolId === schoolId && (st.guardianEmail || "").trim().toLowerCase() === norm
  );
}

export async function getStudentsServer(
  schoolId: string,
  classId?: string,
  search?: string,
  maxLimit?: number,
  status?: string,
  scope?: SessionScope
): Promise<StudentDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  if (!year) return fetchStudentsRaw(schoolId, classId, search, maxLimit, status);
  // The limit is applied after the session filter; limiting first would drop active-session
  // students whenever older sessions fill the page.
  const scoped = filterToSession(ctx, year, await fetchStudentsRaw(schoolId, classId, search, undefined, status));
  return maxLimit && maxLimit > 0 ? scoped.slice(0, Math.min(maxLimit, 250)) : scoped;
}

export async function getStudentByIdServer(schoolId: string, studentId: string): Promise<StudentDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      // The student layout and the page's API both need the record on every student page view:
      // cached for SESSION_PROFILE (30s), dropped on every student write in this instance.
      const data = await cached(`${cacheKeys.studentsPrefix(schoolId)}id:${studentId}`, CACHE_TTL_MS.SESSION_PROFILE, async () => {
        const doc = await withFirestoreRetry("getStudentByIdServer", () => adminDb.collection("students").doc(studentId).get());
        return doc.exists ? ({ id: doc.id, ...doc.data() } as StudentDoc) : null;
      });
      if (data) {
        if (data.schoolId === schoolId) return data;
      }
      if (process.env.NODE_ENV === "production") return null;
    } catch (e) {
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const local = localStore.students.get(studentId);
  if (local && local.schoolId === schoolId) return local;
  return null;
}

export async function getStudentsByParentUserIdServer(
  schoolId: string,
  parentUid: string
): Promise<StudentDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb
        .collection("students")
        .where("schoolId", "==", schoolId)
        .where("parentUserIds", "array-contains", parentUid)
        .get();
      if (!snap.empty) {
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentDoc));
      }
    } catch (e) {
      onFirestoreError(`getStudentsByParentUserIdServer(${parentUid})`, e);
    }
  }

  return Array.from(localStore.students.values()).filter(
    (st) => st.schoolId === schoolId && Array.isArray(st.parentUserIds) && st.parentUserIds.includes(parentUid)
  );
}

export async function getStudentByUserIdServer(schoolId: string, userId: string): Promise<StudentDoc | null> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("students")
        .where("schoolId", "==", schoolId)
        .where("userId", "==", userId)
        .limit(1)
        .get();
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() } as StudentDoc;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getStudentByUserIdServer(${userId})`, e);
    }
  }

  for (const st of localStore.students.values()) {
    if (st.schoolId === schoolId && st.userId === userId) return st;
  }
  return null;
}

export async function saveStudentServer(student: StudentDoc): Promise<string> {
  const id = student.id || `std-${Date.now()}`;
  const academicYear = await sessionForWrite(student.schoolId, student);
  const data: StudentDoc = {
    ...student,
    ...(academicYear ? { academicYear } : {}),
    id,
    updatedAt: new Date().toISOString(),
    createdAt: student.createdAt || new Date().toISOString()
  };
  localStore.students.set(id, data);
  invalidateStudentCaches(data.schoolId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("students").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveStudentServer(${id})`, e);
    } finally {
      invalidateStudentCaches(data.schoolId);
    }
  }
  return id;
}

/** Max students per import batch: each student is two writes (student + login profile). */
export const STUDENT_IMPORT_BATCH_SIZE = Math.floor(FIRESTORE_BATCH_LIMIT / 2);

/**
 * Writes imported students and their login profiles in one atomic batch (all or nothing).
 * Callers chunk by STUDENT_IMPORT_BATCH_SIZE. Every record must already carry the importing
 * admin's schoolId — this is re-checked here so a mixed batch can never be written.
 */
export async function commitStudentImportBatchServer(
  schoolId: string,
  records: { student: StudentDoc; user: UserProfile }[]
): Promise<void> {
  assertProductionDbReady();
  if (records.length > STUDENT_IMPORT_BATCH_SIZE) {
    throw new Error(`Import batch too large (${records.length} > ${STUDENT_IMPORT_BATCH_SIZE}).`);
  }
  for (const { student, user } of records) {
    if (student.schoolId !== schoolId || user.schoolId !== schoolId) {
      throw new Error("Import batch contains a record for a different school.");
    }
  }

  invalidateStudentCaches(schoolId);
  for (const { user } of records) invalidateUserProfileCache(user.uid);
  if (hasAdminCredentials) {
    const batch = adminDb.batch();
    for (const { student, user } of records) {
      batch.set(adminDb.collection("students").doc(student.id), cleanUndefined(student));
      batch.set(adminDb.collection("users").doc(user.uid), cleanUndefined(user));
    }
    try {
      await batch.commit();
    } catch (e) {
      onFirestoreError(`commitStudentImportBatchServer(${records.length})`, e);
      throw e;
    } finally {
      invalidateStudentCaches(schoolId);
      for (const { user } of records) invalidateUserProfileCache(user.uid);
    }
  }

  for (const { student, user } of records) {
    localStore.students.set(student.id, student);
    localStore.users.set(user.email.toLowerCase().trim(), user);
  }
}

export async function deleteStudentServer(schoolId: string, studentId: string): Promise<boolean> {
  const existing = await getStudentByIdServer(schoolId, studentId);
  if (!existing) return false;

  localStore.students.delete(studentId);
  invalidateStudentCaches(schoolId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("students").doc(studentId).delete();
    } catch (e) {
      onFirestoreError(`deleteStudentServer(${studentId})`, e);
    } finally {
      invalidateStudentCaches(schoolId);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// TEACHERS
// ---------------------------------------------------------------------------
export async function getTeachersServer(schoolId: string, maxLimit?: number): Promise<TeacherDoc[]> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      // The faculty list is small and read by many pages (classes, timetable, dashboard), so the
      // whole school's list is cached for SCHOOL_REFERENCE and the limit (max 250) applied here.
      const teachers = await cached(cacheKeys.teachers(schoolId), CACHE_TTL_MS.SCHOOL_REFERENCE, async () => {
        const snap = await withFirestoreRetry("getTeachersServer", () =>
          adminDb.collection("teachers").where("schoolId", "==", schoolId).get()
        );
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TeacherDoc));
      });
      // Trust a real (possibly empty) Firestore result in production instead of
      // silently falling through to the in-memory dev fallback store.
      if (teachers.length > 0 || process.env.NODE_ENV === "production") {
        const sorted = teachers.sort((a, b) => a.fullName.localeCompare(b.fullName));
        return maxLimit && maxLimit > 0 ? sorted.slice(0, Math.min(maxLimit, 250)) : sorted;
      }
    } catch (e) {
      onFirestoreError(`getTeachersServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const local = Array.from(localStore.teachers.values()).filter((t) => t.schoolId === schoolId);
  const sorted = local.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return maxLimit && maxLimit > 0 ? sorted.slice(0, Math.min(maxLimit, 250)) : sorted;
}

export async function getTeacherByIdServer(schoolId: string, teacherId: string): Promise<TeacherDoc | null> {
  if (hasAdminCredentials) {
    try {
      const fromList = peekCached<TeacherDoc[]>(cacheKeys.teachers(schoolId))?.find((t) => t.id === teacherId);
      const data =
        fromList ||
        (await cached(cacheKeys.teacher(schoolId, teacherId), CACHE_TTL_MS.SCHOOL_REFERENCE, async () => {
          const doc = await withFirestoreRetry("getTeacherByIdServer", () => adminDb.collection("teachers").doc(teacherId).get());
          return doc.exists ? ({ id: doc.id, ...doc.data() } as TeacherDoc) : null;
        }));
      if (data && data.schoolId === schoolId) return data;
    } catch (e) {
      onFirestoreError(`getTeacherByIdServer(${teacherId})`, e);
    }
  }

  const local = localStore.teachers.get(teacherId);
  if (local && local.schoolId === schoolId) return local;
  return null;
}

function invalidateTeacherCaches(schoolId: string, teacherId: string): void {
  invalidateCache(cacheKeys.teachers(schoolId));
  invalidateCache(cacheKeys.teacher(schoolId, teacherId));
  invalidateCache(cacheKeys.teacherCounts(schoolId));
}

export async function saveTeacherServer(teacher: TeacherDoc): Promise<string> {
  const id = teacher.id || `tch-${Date.now()}`;
  const data: TeacherDoc = {
    ...teacher,
    id,
    updatedAt: new Date().toISOString(),
    createdAt: teacher.createdAt || new Date().toISOString()
  };
  localStore.teachers.set(id, data);
  invalidateTeacherCaches(data.schoolId, id);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("teachers").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveTeacherServer(${id})`, e);
    } finally {
      invalidateTeacherCaches(data.schoolId, id);
    }
  }
  return id;
}

export async function deleteTeacherServer(schoolId: string, teacherId: string): Promise<boolean> {
  const existing = await getTeacherByIdServer(schoolId, teacherId);
  if (!existing) return false;

  localStore.teachers.delete(teacherId);
  invalidateTeacherCaches(schoolId, teacherId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("teachers").doc(teacherId).delete();
    } catch (e) {
      onFirestoreError(`deleteTeacherServer(${teacherId})`, e);
    } finally {
      invalidateTeacherCaches(schoolId, teacherId);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// CLASSES & COHORTS
// ---------------------------------------------------------------------------
async function fetchClassesRaw(schoolId: string): Promise<ClassDoc[]> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("classes").where("schoolId", "==", schoolId).get();
      const classes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClassDoc));
      if (classes.length > 0 || process.env.NODE_ENV === "production") {
        return classes.sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch (e) {
      onFirestoreError(`getClassesServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const local = Array.from(localStore.classes.values()).filter((c) => c.schoolId === schoolId);
  return local.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClassesServer(schoolId: string, scope?: SessionScope): Promise<ClassDoc[]> {
  const ctx = await loadSessionContext(schoolId);
  const year = scope?.allSessions ? null : scope?.academicYear || ctx.academicYear;
  const classes = ctx.classes;
  if (!year) return classes;
  return classes.filter((c) => (c.academicYear || ctx.academicYear) === year);
}

export async function getClassByIdServer(schoolId: string, classId: string): Promise<ClassDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("classes").doc(classId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as ClassDoc;
        if (data.schoolId === schoolId) return data;
      }
    } catch (e) {
      onFirestoreError(`getClassByIdServer(${classId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const local = localStore.classes.get(classId);
  if (local && local.schoolId === schoolId) return local;
  return null;
}

export async function saveClassServer(classData: ClassDoc): Promise<string> {
  const id = classData.id || `cls-${Date.now()}`;
  const data: ClassDoc = {
    ...classData,
    id,
    updatedAt: new Date().toISOString(),
    createdAt: classData.createdAt || new Date().toISOString()
  };
  invalidateAcademicSessionCache(data.schoolId);
  localStore.classes.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("classes").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveClassServer(${id})`, e);
    }
  }
  return id;
}

export async function deleteClassServer(schoolId: string, classId: string): Promise<boolean> {
  assertProductionDbReady();
  const existing = await getClassByIdServer(schoolId, classId);
  if (!existing) return false;

  invalidateAcademicSessionCache(schoolId);
  localStore.classes.delete(classId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("classes").doc(classId).delete();
    } catch (e) {
      onFirestoreError(`deleteClassServer(${classId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// SUBJECTS
// ---------------------------------------------------------------------------
async function fetchSubjectsRaw(schoolId: string, classId?: string): Promise<SubjectDoc[]> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      // Whole-school subject list cached for SCHOOL_REFERENCE (teacher allocation reads it on every
      // teacher request); one class's subjects come from it when cached, else from a class query.
      const forClass = classId && classId !== "ALL" ? classId : null;
      const readAll = async () => {
        const snap = await withFirestoreRetry("getSubjectsServer", () =>
          adminDb.collection("subjects").where("schoolId", "==", schoolId).get()
        );
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectDoc));
      };
      let subjects: SubjectDoc[];
      if (!forClass) {
        subjects = await cached(cacheKeys.subjects(schoolId), CACHE_TTL_MS.SCHOOL_REFERENCE, readAll);
      } else {
        const whole = peekCached<SubjectDoc[]>(cacheKeys.subjects(schoolId));
        if (whole) {
          subjects = whole.filter((sb) => sb.classId === forClass);
        } else {
          const snap = await withFirestoreRetry("getSubjectsServer", () =>
            adminDb.collection("subjects").where("schoolId", "==", schoolId).where("classId", "==", forClass).get()
          );
          subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectDoc));
        }
      }
      if (subjects.length > 0 || process.env.NODE_ENV === "production") {
        return subjects.sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch (e) {
      onFirestoreError(`getSubjectsServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  let list = Array.from(localStore.subjects.values()).filter((s) => s.schoolId === schoolId);
  if (classId && classId !== "ALL") list = list.filter((s) => s.classId === classId);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSubjectsServer(
  schoolId: string,
  classId?: string,
  scope?: SessionScope
): Promise<SubjectDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  return filterToSession(ctx, year, await fetchSubjectsRaw(schoolId, classId));
}

export async function getSubjectByIdServer(schoolId: string, subjectId: string): Promise<SubjectDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("subjects").doc(subjectId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as SubjectDoc;
        if (data.schoolId === schoolId) return data;
      }
    } catch (e) {
      onFirestoreError(`getSubjectByIdServer(${subjectId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const local = localStore.subjects.get(subjectId);
  if (local && local.schoolId === schoolId) return local;
  return null;
}

export async function saveSubjectServer(subject: SubjectDoc): Promise<string> {
  const id = subject.id || `sb-${Date.now()}`;
  const academicYear = await sessionForWrite(subject.schoolId, subject);
  const data: SubjectDoc = {
    ...subject,
    ...(academicYear ? { academicYear } : {}),
    id,
    updatedAt: new Date().toISOString(),
    createdAt: subject.createdAt || new Date().toISOString(),
  };
  localStore.subjects.set(id, data);
  invalidateCache(cacheKeys.subjects(data.schoolId));

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("subjects").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveSubjectServer(${id})`, e);
    } finally {
      invalidateCache(cacheKeys.subjects(data.schoolId));
    }
  }
  return id;
}

export async function deleteSubjectServer(schoolId: string, subjectId: string): Promise<boolean> {
  const existing = await getSubjectByIdServer(schoolId, subjectId);
  if (!existing) return false;

  localStore.subjects.delete(subjectId);
  invalidateCache(cacheKeys.subjects(schoolId));

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("subjects").doc(subjectId).delete();
    } catch (e) {
      onFirestoreError(`deleteSubjectServer(${subjectId})`, e);
    } finally {
      invalidateCache(cacheKeys.subjects(schoolId));
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// TIMETABLE & DAILY SCHEDULE
// ---------------------------------------------------------------------------
async function fetchTimetableRaw(
  schoolId: string,
  teacherId?: string,
  classId?: string,
  dayOfWeek?: string
): Promise<TimetableDoc[]> {
  if (hasAdminCredentials) {
    try {
      const day = dayOfWeek && dayOfWeek !== "All" ? dayOfWeek : undefined;
      const keep = (t: TimetableDoc) =>
        (!teacherId || t.teacherId === teacherId) && (!classId || t.classId === classId) && (!day || t.dayOfWeek === day);
      const readAll = async () => {
        const snap = await withFirestoreRetry("getTimetableServer", () =>
          adminDb.collection("timetables").where("schoolId", "==", schoolId).get()
        );
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableDoc));
      };
      let items: TimetableDoc[];
      if (!teacherId && !classId && !day) {
        // Whole-school timetable (admin page): cached for SCHOOL_REFERENCE, dropped on slot writes.
        items = await cached(cacheKeys.timetableAll(schoolId), CACHE_TTL_MS.SCHOOL_REFERENCE, readAll);
      } else {
        const whole = peekCached<TimetableDoc[]>(cacheKeys.timetableAll(schoolId));
        if (whole) {
          items = whole.filter(keep);
        } else {
          // One class's / teacher's slots (student and teacher timetables), cached the same way.
          items = await cached(
            `${cacheKeys.timetableAll(schoolId)}:${teacherId || ""}:${classId || ""}:${day || ""}`,
            CACHE_TTL_MS.SCHOOL_REFERENCE,
            async () => {
              let ref: Query = adminDb.collection("timetables").where("schoolId", "==", schoolId);
              if (teacherId) ref = ref.where("teacherId", "==", teacherId);
              if (classId) ref = ref.where("classId", "==", classId);
              if (day) ref = ref.where("dayOfWeek", "==", day);
              const snap = await withFirestoreRetry("getTimetableServer", () => ref.get());
              return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableDoc));
            }
          );
        }
      }
      return items.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    } catch (e) {
      onFirestoreError(`getTimetableServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.timetables.values()).filter((t) => t.schoolId === schoolId);
  if (teacherId) list = list.filter((t) => t.teacherId === teacherId);
  if (classId) list = list.filter((t) => t.classId === classId);
  if (dayOfWeek && dayOfWeek !== "All") list = list.filter((t) => t.dayOfWeek === dayOfWeek);
  return list.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
}

export async function getTimetableServer(
  schoolId: string,
  teacherId?: string,
  classId?: string,
  dayOfWeek?: string,
  scope?: SessionScope
): Promise<TimetableDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  return filterToSession(ctx, year, await fetchTimetableRaw(schoolId, teacherId, classId, dayOfWeek));
}

export async function getTimetableEntryByIdServer(schoolId: string, entryId: string): Promise<TimetableDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("timetables").doc(entryId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as TimetableDoc;
        return data.schoolId === schoolId ? data : null;
      }
      if (process.env.NODE_ENV === "production") return null;
    } catch (e) {
      onFirestoreError(`getTimetableEntryByIdServer(${entryId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  const local = localStore.timetables.get(entryId);
  return local && local.schoolId === schoolId ? local : null;
}

/** Deletes one slot, only if it belongs to `schoolId`. Returns false when it doesn't exist there. */
export async function deleteTimetableEntryServer(schoolId: string, entryId: string): Promise<boolean> {
  const existing = await getTimetableEntryByIdServer(schoolId, entryId);
  if (!existing) return false;
  localStore.timetables.delete(entryId);
  invalidateCachePrefix(cacheKeys.timetableAll(schoolId));
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("timetables").doc(entryId).delete();
      invalidateCachePrefix(cacheKeys.timetableAll(schoolId));
    } catch (e) {
      onFirestoreError(`deleteTimetableEntryServer(${entryId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  return true;
}

export async function saveTimetableEntryServer(entry: TimetableDoc): Promise<string> {
  const id = entry.id || `tt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const academicYear = await sessionForWrite(entry.schoolId, entry);
  const data: TimetableDoc = {
    ...entry,
    ...(academicYear ? { academicYear } : {}),
    id,
    updatedAt: new Date().toISOString(),
    createdAt: entry.createdAt || new Date().toISOString()
  };
  localStore.timetables.set(id, data);
  invalidateCachePrefix(cacheKeys.timetableAll(data.schoolId));

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("timetables").doc(id).set(cleanUndefined(data), { merge: true });
      invalidateCachePrefix(cacheKeys.timetableAll(data.schoolId));
    } catch (e) {
      onFirestoreError(`saveTimetableEntryServer(${id})`, e);
    }
  }
  return id;
}

/**
 * Saves several periods in batched commits (an import). Each is stamped with its class's session
 * like a single save.
 */
export async function saveTimetableEntriesBulkServer(entries: TimetableDoc[]): Promise<number> {
  if (entries.length === 0) return 0;
  const docs: TimetableDoc[] = [];
  for (const entry of entries) {
    const academicYear = await sessionForWrite(entry.schoolId, entry);
    docs.push({ ...entry, ...(academicYear ? { academicYear } : {}) });
  }
  const schools = new Set(docs.map((d) => d.schoolId));
  for (const schoolId of schools) invalidateCachePrefix(cacheKeys.timetableAll(schoolId));
  if (hasAdminCredentials) {
    try {
      for (const part of chunk(docs, FIRESTORE_BATCH_LIMIT)) {
        const batch = adminDb.batch();
        for (const d of part) batch.set(adminDb.collection("timetables").doc(d.id), cleanUndefined(d));
        await batch.commit();
      }
    } catch (e) {
      onFirestoreError(`saveTimetableEntriesBulkServer(${docs.length})`, e);
      throw e;
    } finally {
      for (const schoolId of schools) invalidateCachePrefix(cacheKeys.timetableAll(schoolId));
    }
  }
  for (const d of docs) localStore.timetables.set(d.id, d);
  return docs.length;
}

/** Deletes the given periods of `schoolId` (ids of another school are ignored). */
export async function deleteTimetableEntriesServer(schoolId: string, ids: string[]): Promise<number> {
  const own = (await getTimetableServer(schoolId, undefined, undefined, undefined, { allSessions: true }))
    .filter((t) => ids.includes(t.id))
    .map((t) => t.id);
  if (own.length === 0) return 0;
  invalidateCachePrefix(cacheKeys.timetableAll(schoolId));
  if (hasAdminCredentials) {
    try {
      for (const part of chunk(own, FIRESTORE_BATCH_LIMIT)) {
        const batch = adminDb.batch();
        for (const id of part) batch.delete(adminDb.collection("timetables").doc(id));
        await batch.commit();
      }
    } catch (e) {
      onFirestoreError(`deleteTimetableEntriesServer(${own.length})`, e);
      throw e;
    } finally {
      invalidateCachePrefix(cacheKeys.timetableAll(schoolId));
    }
  }
  for (const id of own) localStore.timetables.delete(id);
  return own.length;
}

// ---------------------------------------------------------------------------
// TIMETABLE IMPORTS (server-only collection)
// ---------------------------------------------------------------------------
export async function getTimetableImportsServer(schoolId: string): Promise<TimetableImportDoc[]> {
  const byNewest = (a: TimetableImportDoc, b: TimetableImportDoc) => (b.createdAt || "").localeCompare(a.createdAt || "");
  if (hasAdminCredentials) {
    try {
      const snap = await withFirestoreRetry("getTimetableImportsServer", () =>
        adminDb.collection("timetableImports").where("schoolId", "==", schoolId).limit(200).get()
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableImportDoc)).sort(byNewest);
    } catch (e) {
      onFirestoreError(`getTimetableImportsServer(${schoolId})`, e);
    }
  }
  return Array.from(localStore.timetableImports.values()).filter((t) => t.schoolId === schoolId).sort(byNewest);
}

export async function getTimetableImportByIdServer(schoolId: string, id: string): Promise<TimetableImportDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await withFirestoreRetry("getTimetableImportByIdServer", () => adminDb.collection("timetableImports").doc(id).get());
      if (!doc.exists) return null;
      const data = { id: doc.id, ...doc.data() } as TimetableImportDoc;
      return data.schoolId === schoolId ? data : null;
    } catch (e) {
      onFirestoreError(`getTimetableImportByIdServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.timetableImports.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

export async function saveTimetableImportServer(rec: TimetableImportDoc): Promise<void> {
  const data: TimetableImportDoc = { ...rec, updatedAt: new Date().toISOString() };
  localStore.timetableImports.set(data.id, data);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("timetableImports").doc(data.id).set(cleanUndefined(data));
    } catch (e) {
      onFirestoreError(`saveTimetableImportServer(${data.id})`, e);
      throw e;
    }
  }
}

export async function deleteTimetableImportServer(schoolId: string, id: string): Promise<boolean> {
  const existing = await getTimetableImportByIdServer(schoolId, id);
  if (!existing) return false;
  localStore.timetableImports.delete(id);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("timetableImports").doc(id).delete();
    } catch (e) {
      onFirestoreError(`deleteTimetableImportServer(${id})`, e);
      throw e;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// ATTENDANCE REGISTER
// ---------------------------------------------------------------------------
/**
 * `fromDate` (inclusive, YYYY-MM-DD) bounds the read to a recent window. `attendance` is the
 * fastest-growing collection in the system — one document per student per school day, so a
 * 500-student school accumulates ~100,000 documents per academic year — and the school-wide
 * analytics callers (/api/dashboard, /api/reports) previously read all of it, unfiltered, on
 * every page load. A plain `.limit()` was deliberately not used for those callers: without an
 * ordering it would return an arbitrary subset and produce a *wrong* attendance percentage,
 * which is worse than a slow one. A date window is bounded and still arithmetically honest, as
 * long as the window is reported alongside the figure (both callers do).
 *
 * The equality-on-schoolId + range-on-date combination needs the composite index added to
 * firestore.indexes.json (`attendance: schoolId ASC, date ASC`).
 */
async function fetchAttendanceRaw(
  schoolId: string,
  date?: string,
  classId?: string,
  studentId?: string,
  fromDate?: string,
  register: AttendanceRegister = DAILY_REGISTER
): Promise<AttendanceDoc[]> {
  const subjectId = register === "ALL" ? undefined : register.subjectId;
  const inRegister = (a: AttendanceDoc) =>
    register === "ALL" || (subjectId ? a.subjectId === subjectId : !a.subjectId);

  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("attendance").where("schoolId", "==", schoolId);
      if (date) ref = ref.where("date", "==", date);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      if (subjectId) ref = ref.where("subjectId", "==", subjectId);
      const snap = await ref.get();
      let records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc)).filter(inRegister);
      if (fromDate) {
        records = records.filter((a) => a.date >= fromDate);
      }
      if (records.length > 0 || process.env.NODE_ENV === "production") {
        return records;
      }
    } catch (e) {
      onFirestoreError(`getAttendanceServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.attendance.values()).filter((a) => a.schoolId === schoolId && inRegister(a));
  if (date) list = list.filter((a) => a.date === date);
  else if (fromDate) list = list.filter((a) => a.date >= fromDate);
  if (classId && classId !== "ALL") list = list.filter((a) => a.classId === classId);
  if (studentId) list = list.filter((a) => a.studentId === studentId);
  return list;
}

/**
 * Which attendance register a read covers. The default is the class's daily register (records
 * without a subjectId) — the one every student/parent/report/dashboard figure is computed from,
 * so subject registers never double-count a student's day. `{ subjectId }` selects one subject
 * register; "ALL" ignores the distinction (e.g. dependency checks before deleting a class).
 */
export type AttendanceRegister = { subjectId: string | null } | "ALL";
export const DAILY_REGISTER: AttendanceRegister = { subjectId: null };

export async function getAttendanceServer(
  schoolId: string,
  date?: string,
  classId?: string,
  studentId?: string,
  fromDate?: string,
  scope?: SessionScope,
  register: AttendanceRegister = DAILY_REGISTER
): Promise<AttendanceDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  return filterToSession(ctx, year, await fetchAttendanceRaw(schoolId, date, classId, studentId, fromDate, register));
}

/** Inclusive start date of the rolling analytics window used by the school-wide dashboards. */
export const ANALYTICS_ATTENDANCE_WINDOW_DAYS = 30;

export function analyticsAttendanceWindowStart(days = ANALYTICS_ATTENDANCE_WINDOW_DAYS): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

export async function getStudentAttendanceServer(schoolId: string, studentId: string): Promise<AttendanceDoc[]> {
  return getAttendanceServer(schoolId, undefined, undefined, studentId);
}

export async function saveAttendanceRecordServer(record: AttendanceDoc): Promise<string> {
  const id = record.id || `att-${record.studentId}-${record.date}`;
  const academicYear = await sessionForWrite(record.schoolId, record);
  const data: AttendanceDoc = {
    ...record,
    ...(academicYear ? { academicYear } : {}),
    id,
    updatedAt: new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString()
  };
  localStore.attendance.set(id, data);

  if (hasAdminCredentials) {
    try {
      await writeAttendanceWithTotals([data]);
    } catch (e) {
      onFirestoreError(`saveAttendanceRecordServer(${id})`, e);
    }
  }
  return id;
}

// The (schoolId, records[], recordedBy) call shape this function previously also accepted has
// no real caller anywhere in the codebase (verified by grep — /api/attendance always builds
// full AttendanceDoc objects itself and calls this with a single array argument). Removed the
// same way the equivalent dead overload was removed from saveExamResultsBulkServer, rather
// than leaving a second, unused code path a future caller could pick up by mistake.
/**
 * `previous`: the stored versions of these records the caller already read (the attendance route
 * reads the day's register anyway). They let the attendance totals be adjusted without reading
 * the records again; when omitted, they are read here.
 */
export async function saveAttendanceBulkServer(
  records: AttendanceDoc[],
  previous?: AttendanceDoc[]
): Promise<{ count: number }> {
  const docs: AttendanceDoc[] = [];
  for (const record of records) {
    const academicYear = await sessionForWrite(record.schoolId, record);
    docs.push({ ...record, ...(academicYear ? { academicYear } : {}) });
  }

  // One batched commit per chunk instead of one sequential write per student: a class register
  // is saved in a single round trip (with its attendance totals), and a failure can no longer
  // leave half the class written.
  if (hasAdminCredentials) {
    try {
      await writeAttendanceWithTotals(docs, previous);
    } catch (e) {
      onFirestoreError(`saveAttendanceBulkServer(${docs.length} records)`, e);
    }
  }
  for (const doc of docs) localStore.attendance.set(doc.id, doc);
  return { count: docs.length };
}

// ---------------------------------------------------------------------------
// ATTENDANCE TOTALS (summary documents)
// ---------------------------------------------------------------------------
/**
 * `attendance` is the largest collection (one document per student per school day), and the
 * dashboard, reports and student/parent portals used to read it in full on every load. Two
 * server-only summary collections now hold the counts those screens show:
 *  - attendanceDailyTotals/{schoolId}_{date}
 *      { schoolId, date, complete, classes: { [classId]: { PRESENT, LATE, ABSENT, LEAVE } } }
 *    → the 30-day dashboard/report window is ~31 document reads instead of ~9,000;
 *  - studentAttendanceTotals/{schoolId}_{studentId}
 *      { schoolId, studentId, complete, sessions: { [academicYear]: { PRESENT, LATE, ABSENT, LEAVE } } }
 *    → a student's session totals are 1 read instead of their whole history.
 * Both count the daily register only (records without subjectId), like every attendance figure.
 * Every attendance write adjusts them in the same batch (FieldValue.increment deltas computed from
 * the previous status). A summary that is missing or predates this code is rebuilt once from the
 * raw records inside a transaction and marked `complete`; the increments keep it exact afterwards.
 * Firestore rules deny clients access to both collections (no rule matches them).
 */
export const ATTENDANCE_DAILY_TOTALS = "attendanceDailyTotals";
export const STUDENT_ATTENDANCE_TOTALS = "studentAttendanceTotals";
export type AttendanceCounts = Record<AttendanceStatus, number>;
const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "LEAVE"];
const NO_SESSION_KEY = "none";

export function emptyAttendanceCounts(): AttendanceCounts {
  return { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0 };
}

function isDailyRegister(a: Pick<AttendanceDoc, "subjectId">): boolean {
  return !a.subjectId;
}

function addAttendanceCounts(target: AttendanceCounts, src?: Record<string, unknown> | null): void {
  for (const st of ATTENDANCE_STATUSES) target[st] += Number(src?.[st]) || 0;
}

const dailyTotalsRef = (schoolId: string, date: string) =>
  adminDb.collection(ATTENDANCE_DAILY_TOTALS).doc(`${schoolId}_${date}`);
const studentTotalsRef = (schoolId: string, studentId: string) =>
  adminDb.collection(STUDENT_ATTENDANCE_TOTALS).doc(`${schoolId}_${studentId}`);

type NestedCounts = Map<string, Map<string, AttendanceCounts>>;

function bumpCount(map: NestedCounts, k1: string, k2: string, status: AttendanceStatus, by: number): void {
  if (!ATTENDANCE_STATUSES.includes(status)) return;
  let inner = map.get(k1);
  if (!inner) map.set(k1, (inner = new Map()));
  let counts = inner.get(k2);
  if (!counts) inner.set(k2, (counts = emptyAttendanceCounts()));
  counts[status] += by;
}

/** Firestore set-merge payload of increments for the non-zero deltas, or null if none. */
function incrementPayload(inner: Map<string, AttendanceCounts>): Record<string, Record<string, FieldValue>> | null {
  const out: Record<string, Record<string, FieldValue>> = {};
  for (const [key, counts] of inner) {
    for (const st of ATTENDANCE_STATUSES) {
      if (counts[st] !== 0) (out[key] ||= {})[st] = FieldValue.increment(counts[st]);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Writes attendance records plus the matching totals deltas, in batches of FIRESTORE_BATCH_LIMIT. */
async function writeAttendanceWithTotals(docs: AttendanceDoc[], previous?: AttendanceDoc[]): Promise<void> {
  if (docs.length === 0) return;
  const ids = new Set(docs.map((d) => d.id));
  const prevById = new Map<string, AttendanceDoc>();
  if (previous) {
    for (const p of previous) if (ids.has(p.id)) prevById.set(p.id, p);
  } else {
    for (const part of chunk(docs, 300)) {
      const snaps = await withFirestoreRetry("attendance.previous", () =>
        adminDb.getAll(...part.map((d) => adminDb.collection("attendance").doc(d.id)))
      );
      for (const snap of snaps) if (snap.exists) prevById.set(snap.id, { id: snap.id, ...snap.data() } as AttendanceDoc);
    }
  }

  const ops: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = docs.map((d) => ({
    ref: adminDb.collection("attendance").doc(d.id),
    data: cleanUndefined(d) as unknown as Record<string, unknown>,
  }));

  for (const schoolId of new Set(docs.map((d) => d.schoolId))) {
    const ctx = await getAcademicSessionContextServer(schoolId);
    const sessionOf = (a: AttendanceDoc) => a.academicYear || resolveRecordSession(ctx, a) || NO_SESSION_KEY;
    const daily: NestedCounts = new Map();
    const perStudent: NestedCounts = new Map();
    for (const doc of docs.filter((d) => d.schoolId === schoolId)) {
      const prev = prevById.get(doc.id);
      if (prev && isDailyRegister(prev)) {
        bumpCount(daily, prev.date, prev.classId, prev.status, -1);
        bumpCount(perStudent, prev.studentId, sessionOf(prev), prev.status, -1);
      }
      if (isDailyRegister(doc)) {
        bumpCount(daily, doc.date, doc.classId, doc.status, 1);
        bumpCount(perStudent, doc.studentId, sessionOf(doc), doc.status, 1);
      }
    }
    for (const [date, classes] of daily) {
      const inc = incrementPayload(classes);
      if (inc) ops.push({ ref: dailyTotalsRef(schoolId, date), data: { schoolId, date, classes: inc } });
    }
    for (const [studentId, sessions] of perStudent) {
      const inc = incrementPayload(sessions);
      if (inc) ops.push({ ref: studentTotalsRef(schoolId, studentId), data: { schoolId, studentId, sessions: inc } });
    }
  }

  const schools = new Set(docs.map((d) => d.schoolId));
  for (const schoolId of schools) invalidateCachePrefix(cacheKeys.attendanceTotalsPrefix(schoolId));
  try {
    for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = adminDb.batch();
      for (const op of ops.slice(i, i + FIRESTORE_BATCH_LIMIT)) batch.set(op.ref, op.data, { merge: true });
      await batch.commit();
    }
  } finally {
    for (const schoolId of schools) invalidateCachePrefix(cacheKeys.attendanceTotalsPrefix(schoolId));
  }
}

function calendarDates(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().split("T")[0]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Rebuilds one day's per-class totals from the raw records (once per day, ever). */
async function rebuildDailyTotals(schoolId: string, date: string): Promise<Record<string, AttendanceCounts>> {
  const ref = dailyTotalsRef(schoolId, date);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.complete) return (snap.data()?.classes || {}) as Record<string, AttendanceCounts>;
    const records = await tx.get(
      adminDb.collection("attendance").where("schoolId", "==", schoolId).where("date", "==", date)
    );
    const classes: Record<string, AttendanceCounts> = {};
    for (const d of records.docs) {
      const a = d.data() as AttendanceDoc;
      if (!isDailyRegister(a) || !ATTENDANCE_STATUSES.includes(a.status) || !a.classId) continue;
      (classes[a.classId] ||= emptyAttendanceCounts())[a.status]++;
    }
    tx.set(ref, { schoolId, date, complete: true, classes, rebuiltAt: new Date().toISOString() });
    return classes;
  });
}

/**
 * Daily-register status counts per class over [fromDate, toDate] (YYYY-MM-DD, inclusive), from
 * attendanceDailyTotals: one read per calendar day in the window.
 */
export async function getAttendanceTotalsByClassServer(
  schoolId: string,
  fromDate: string,
  toDate: string
): Promise<Map<string, AttendanceCounts>> {
  const totals = new Map<string, AttendanceCounts>();
  const add = (classId: string, counts: Record<string, unknown> | null | undefined) => {
    let t = totals.get(classId);
    if (!t) totals.set(classId, (t = emptyAttendanceCounts()));
    addAttendanceCounts(t, counts);
  };

  if (!hasAdminCredentials) {
    const records = (await getAttendanceServer(schoolId, undefined, undefined, undefined, fromDate)).filter((a) => a.date <= toDate);
    for (const a of records) add(a.classId, { [a.status]: 1 });
    return totals;
  }

  // Cached for AGGREGATES; every attendance write in this instance drops it.
  const rows = await cached(`${cacheKeys.attendanceTotalsPrefix(schoolId)}${fromDate}:${toDate}`, CACHE_TTL_MS.AGGREGATES, async () =>
    Array.from((await readAttendanceTotalsByClass(schoolId, fromDate, toDate)).entries())
  );
  return new Map(rows);
}

async function readAttendanceTotalsByClass(schoolId: string, fromDate: string, toDate: string): Promise<Map<string, AttendanceCounts>> {
  const totals = new Map<string, AttendanceCounts>();
  const add = (classId: string, counts: Record<string, unknown> | null | undefined) => {
    let t = totals.get(classId);
    if (!t) totals.set(classId, (t = emptyAttendanceCounts()));
    addAttendanceCounts(t, counts);
  };
  const dates = calendarDates(fromDate, toDate);
  if (dates.length === 0) return totals;
  const snaps = await withFirestoreRetry("attendanceDailyTotals", () => adminDb.getAll(...dates.map((d) => dailyTotalsRef(schoolId, d))));
  const missing: string[] = [];
  snaps.forEach((snap: DocumentSnapshot, i: number) => {
    const data = snap.exists ? snap.data() : null;
    if (data?.complete) {
      for (const [classId, counts] of Object.entries((data.classes || {}) as Record<string, Record<string, unknown>>)) add(classId, counts);
    } else {
      missing.push(dates[i]);
    }
  });
  for (const part of chunk(missing, 5)) {
    const rebuilt = await Promise.all(part.map((date) => rebuildDailyTotals(schoolId, date)));
    for (const classes of rebuilt) for (const [classId, counts] of Object.entries(classes)) add(classId, counts as unknown as Record<string, unknown>);
  }
  return totals;
}

/** Rebuilds one student's per-session totals from their raw records (once per student, ever). */
async function rebuildStudentTotals(schoolId: string, studentId: string): Promise<Record<string, AttendanceCounts>> {
  const ctx = await getAcademicSessionContextServer(schoolId);
  const ref = studentTotalsRef(schoolId, studentId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.complete) return (snap.data()?.sessions || {}) as Record<string, AttendanceCounts>;
    const records = await tx.get(
      adminDb.collection("attendance").where("schoolId", "==", schoolId).where("studentId", "==", studentId)
    );
    const sessions: Record<string, AttendanceCounts> = {};
    for (const d of records.docs) {
      const a = { id: d.id, ...d.data() } as AttendanceDoc;
      if (!isDailyRegister(a) || !ATTENDANCE_STATUSES.includes(a.status)) continue;
      const key = resolveRecordSession(ctx, a) || NO_SESSION_KEY;
      (sessions[key] ||= emptyAttendanceCounts())[a.status]++;
    }
    tx.set(ref, { schoolId, studentId, complete: true, sessions, rebuiltAt: new Date().toISOString() });
    return sessions;
  });
}

/** A student's daily-register status counts for the active session (all sessions if none is set). */
export async function getStudentAttendanceTotalsServer(schoolId: string, studentId: string): Promise<AttendanceCounts> {
  const counts = emptyAttendanceCounts();
  if (!hasAdminCredentials) {
    for (const a of await getStudentAttendanceServer(schoolId, studentId)) addAttendanceCounts(counts, { [a.status]: 1 });
    return counts;
  }
  const { year } = await resolveSessionScope(schoolId);
  const snap = await withFirestoreRetry("studentAttendanceTotals", () => studentTotalsRef(schoolId, studentId).get());
  const data = snap.exists ? snap.data() : null;
  const sessions = data?.complete
    ? ((data.sessions || {}) as Record<string, Record<string, unknown>>)
    : ((await rebuildStudentTotals(schoolId, studentId)) as unknown as Record<string, Record<string, unknown>>);
  if (year) addAttendanceCounts(counts, sessions[year]);
  else for (const v of Object.values(sessions)) addAttendanceCounts(counts, v);
  return counts;
}

/** Recent days for on-screen attendance tables. */
export const RECENT_ATTENDANCE_DAYS = 60;

/**
 * A student's daily-register records of the last `days` calendar days (active session), newest
 * first — equality/`in` queries on the date, so only those records are read. The full history is
 * still available in the printable attendance report.
 */
export async function getStudentRecentAttendanceServer(
  schoolId: string,
  studentId: string,
  days = RECENT_ATTENDANCE_DAYS
): Promise<AttendanceDoc[]> {
  const to = new Date().toISOString().split("T")[0];
  const fromD = new Date();
  fromD.setUTCDate(fromD.getUTCDate() - (days - 1));
  const from = fromD.toISOString().split("T")[0];
  const byDateDesc = (a: AttendanceDoc, b: AttendanceDoc) => (b.date || "").localeCompare(a.date || "");
  if (!hasAdminCredentials) {
    return (await getStudentAttendanceServer(schoolId, studentId)).filter((a) => a.date >= from && a.date <= to).sort(byDateDesc);
  }
  const { ctx, year } = await resolveSessionScope(schoolId);
  const out: AttendanceDoc[] = [];
  for (const dates of chunk(calendarDates(from, to), 30)) {
    const snap = await withFirestoreRetry("attendance.recent", () =>
      adminDb.collection("attendance").where("schoolId", "==", schoolId).where("studentId", "==", studentId).where("date", "in", dates).get()
    );
    out.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc)).filter(isDailyRegister));
  }
  return filterToSession(ctx, year, out).sort(byDateDesc);
}

// ---------------------------------------------------------------------------
// FEE CHALLANS & CASHIER PAYMENTS
// ---------------------------------------------------------------------------
async function fetchFeeChallansRaw(
  schoolId: string,
  studentId?: string,
  month?: string,
  year?: number,
  status?: string,
  maxLimit?: number
): Promise<FeeChallanDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("feeChallans").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      if (month) ref = ref.where("month", "==", month);
      if (year) ref = ref.where("year", "==", year);
      if (status && status.toUpperCase() !== "ALL") ref = ref.where("status", "==", status);
      if (maxLimit && maxLimit > 0) ref = ref.limit(Math.min(maxLimit, 250));
      const snap = await ref.get();
      const challans = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc));
      if (challans.length > 0 || process.env.NODE_ENV === "production") {
        return challans;
      }
    } catch (e) {
      onFirestoreError(`getFeeChallansServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.feeChallans.values()).filter((f) => f.schoolId === schoolId);
  if (studentId) list = list.filter((f) => f.studentId === studentId);
  if (month) list = list.filter((f) => f.month.toLowerCase() === month.toLowerCase());
  if (year) list = list.filter((f) => f.year === year);
  if (status && status.toUpperCase() !== "ALL") list = list.filter((f) => f.status === status);
  const sorted = list.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return maxLimit && maxLimit > 0 ? sorted.slice(0, Math.min(maxLimit, 250)) : sorted;
}

export async function getFeeChallansServer(
  schoolId: string,
  studentId?: string,
  month?: string,
  year?: number,
  status?: string,
  maxLimit?: number,
  scope?: SessionScope
): Promise<FeeChallanDoc[]> {
  const { ctx, year: session } = await resolveSessionScope(schoolId, scope);
  if (!session) return fetchFeeChallansRaw(schoolId, studentId, month, year, status, maxLimit);
  // Limit after the session filter, as in getStudentsServer.
  const scoped = filterToSession(ctx, session, await fetchFeeChallansRaw(schoolId, studentId, month, year, status));
  return maxLimit && maxLimit > 0 ? scoped.slice(0, Math.min(maxLimit, 250)) : scoped;
}

export interface FeeTotals {
  count: number;
  expected: number;
  collected: number;
}

/**
 * Challan count / expected / collected per class of the active session, via one count+sum
 * aggregation per class instead of reading every challan. A challan belongs to the session of its
 * class (challans always carry a classId and are stamped from it). Cached for AGGREGATES and
 * dropped on every challan save / payment in this instance.
 */
export async function getFeeTotalsByClassServer(schoolId: string): Promise<Map<string, FeeTotals>> {
  const classes = await getSessionClassesServer(schoolId);
  const fromList = async () => {
    const totals = new Map<string, FeeTotals>();
    for (const c of classes) totals.set(c.id, { count: 0, expected: 0, collected: 0 });
    for (const ch of await getFeeChallansServer(schoolId)) {
      const t = totals.get(ch.classId);
      if (!t) continue;
      t.count++;
      t.expected += ch.totalExpected || 0;
      t.collected += ch.paidAmount || 0;
    }
    return totals;
  };
  if (!hasAdminCredentials) return fromList();
  const rows = await cached(`${cacheKeys.feeAggregatesPrefix(schoolId)}byclass`, CACHE_TTL_MS.AGGREGATES, () =>
    withIndexFallback(
      "feeChallans totals by class",
      () =>
        Promise.all(
          classes.map(async (c) => {
            const q = adminDb.collection("feeChallans").where("schoolId", "==", schoolId).where("classId", "==", c.id);
            const snap = await withFirestoreRetry("feeChallans.aggregate", () =>
              q.aggregate({ count: AggregateField.count(), expected: AggregateField.sum("totalExpected"), collected: AggregateField.sum("paidAmount") }).get()
            );
            const d = snap.data();
            return [c.id, { count: d.count || 0, expected: d.expected || 0, collected: d.collected || 0 }] as [string, FeeTotals];
          })
        ),
      async () => Array.from((await fromList()).entries())
    )
  );
  return new Map(rows);
}

export interface FeeChallanListFilter {
  /** One class; omitted = every class of the active session. */
  classId?: string;
  month?: string;
  /** Stored statuses to include (UNPAID = PENDING + OVERDUE); omitted = all. */
  statuses?: FeeStatus[];
}

export interface FeeChallanStats {
  totalExpected: number;
  totalCollected: number;
  totalOutstanding: number;
  paidCount: number;
  unpaidCount: number;
  partialCount: number;
  totalChallans: number;
}

const ALL_FEE_STATUSES: FeeStatus[] = ["PAID", "PENDING", "OVERDUE", "PARTIAL"];

/** One query per chunk of classes; `in` disjunctions stay within Firestore's limit of 30. */
function feeChallanQueries(schoolId: string, classIds: string[], filter: FeeChallanListFilter): Query[] {
  const statuses = filter.statuses && filter.statuses.length < ALL_FEE_STATUSES.length ? filter.statuses : undefined;
  const perChunk = statuses && statuses.length > 1 ? Math.max(1, Math.floor(30 / statuses.length)) : 30;
  return chunk(classIds, perChunk).map((ids) => {
    let q: Query = adminDb.collection("feeChallans").where("schoolId", "==", schoolId);
    q = whereOneOf(q, "classId", ids);
    if (filter.month) q = q.where("month", "==", filter.month);
    if (statuses) q = whereOneOf(q, "status", statuses);
    return q;
  });
}

async function feeChallanScopeClassIds(schoolId: string, classId?: string): Promise<string[]> {
  const sessionClassIds = (await getSessionClassesServer(schoolId)).map((c) => c.id);
  if (!classId) return sessionClassIds;
  // A class of another session is still listable explicitly (its challans belong to it).
  const all = (await loadSessionContext(schoolId)).classes.map((c) => c.id);
  return all.includes(classId) ? [classId] : [];
}

function encodeCursor(value: { q: number; after: string }): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor?: string | null): { q: number; after: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    return typeof v?.q === "number" && typeof v?.after === "string" ? v : null;
  } catch {
    return null;
  }
}

function filterChallansInMemory(list: FeeChallanDoc[], classIds: string[], filter: FeeChallanListFilter): FeeChallanDoc[] {
  const allowed = new Set(classIds);
  return list.filter(
    (c) =>
      allowed.has(c.classId) &&
      (!filter.month || c.month === filter.month) &&
      (!filter.statuses || filter.statuses.includes(c.status))
  );
}

/**
 * One page of challans (default 50) for the admin fee ledger, reading only that page instead of
 * every challan of the school. Ordered by document id; `nextCursor` continues the listing.
 */
export async function getFeeChallansPageServer(
  schoolId: string,
  filter: FeeChallanListFilter,
  pageSize = 50,
  cursor?: string | null
): Promise<{ challans: FeeChallanDoc[]; nextCursor: string | null }> {
  const size = Math.max(1, Math.min(pageSize, 200));
  const classIds = await feeChallanScopeClassIds(schoolId, filter.classId);
  if (classIds.length === 0) return { challans: [], nextCursor: null };

  const legacyPage = async () => {
    const all = filterChallansInMemory(await getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true }), classIds, filter)
      .sort((a, b) => a.id.localeCompare(b.id));
    const start = decodeCursor(cursor);
    const from = start ? all.findIndex((c) => c.id > start.after) : 0;
    const page = from < 0 ? [] : all.slice(from, from + size);
    const more = from >= 0 && from + size < all.length;
    return { challans: page, nextCursor: more ? encodeCursor({ q: 0, after: page[page.length - 1].id }) : null };
  };
  if (!hasAdminCredentials) return legacyPage();

  return withIndexFallback("feeChallans page", async () => {
    const queries = feeChallanQueries(schoolId, classIds, filter);
    const start = decodeCursor(cursor) || { q: 0, after: "" };
    const out: FeeChallanDoc[] = [];
    let qi = Math.min(start.q, queries.length);
    let after = start.after;
    while (qi < queries.length && out.length < size) {
      let q = queries[qi].orderBy(FieldPath.documentId());
      if (after) q = q.startAfter(after);
      const need = size - out.length;
      const snap = await withFirestoreRetry("feeChallans.page", () => q.limit(need + 1).get());
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc));
      out.push(...docs.slice(0, need));
      if (docs.length > need) {
        return { challans: out, nextCursor: encodeCursor({ q: qi, after: out[out.length - 1].id }) };
      }
      qi++;
      after = "";
    }
    return { challans: out, nextCursor: null };
  }, legacyPage);
}

export function computeFeeChallanStats(list: FeeChallanDoc[]): FeeChallanStats {
  const totalExpected = list.reduce((s, c) => s + (c.totalExpected || 0), 0);
  const totalCollected = list.reduce((s, c) => s + (c.paidAmount || 0), 0);
  return {
    totalExpected,
    totalCollected,
    totalOutstanding: list.reduce((s, c) => s + Math.max(0, (c.totalExpected || 0) - (c.paidAmount || 0)), 0),
    paidCount: list.filter((c) => c.status === "PAID").length,
    unpaidCount: list.filter((c) => c.status === "PENDING" || c.status === "OVERDUE").length,
    partialCount: list.filter((c) => c.status === "PARTIAL").length,
    totalChallans: list.length,
  };
}

/**
 * Ledger totals for the same filter as getFeeChallansPageServer, via count/sum aggregations
 * (about 4 aggregation reads per 30 classes) instead of reading the challans. Outstanding is
 * expected minus collected: a payment is always capped at the challan's balance.
 */
export async function getFeeChallanStatsServer(schoolId: string, filter: FeeChallanListFilter): Promise<FeeChallanStats> {
  const classIds = await feeChallanScopeClassIds(schoolId, filter.classId);
  const empty: FeeChallanStats = { totalExpected: 0, totalCollected: 0, totalOutstanding: 0, paidCount: 0, unpaidCount: 0, partialCount: 0, totalChallans: 0 };
  if (classIds.length === 0) return empty;
  const fromList = async () =>
    computeFeeChallanStats(
      filterChallansInMemory(await getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true }), classIds, filter)
    );
  if (!hasAdminCredentials) return fromList();

  const key = `${cacheKeys.feeAggregatesPrefix(schoolId)}stats:${JSON.stringify([filter.classId || "", filter.month || "", filter.statuses || []])}`;
  return cached(key, CACHE_TTL_MS.AGGREGATES, () =>
    withIndexFallback("feeChallans stats", async () => {
      const wanted = filter.statuses || ALL_FEE_STATUSES;
      const totals = await Promise.all(
        feeChallanQueries(schoolId, classIds, filter).map(async (q) => {
          const snap = await withFirestoreRetry("feeChallans.stats", () =>
            q.aggregate({ count: AggregateField.count(), expected: AggregateField.sum("totalExpected"), collected: AggregateField.sum("paidAmount") }).get()
          );
          return snap.data();
        })
      );
      const bucket = async (statuses: FeeStatus[]) => {
        const effective = statuses.filter((st) => wanted.includes(st));
        if (effective.length === 0) return 0;
        const counts = await Promise.all(
          feeChallanQueries(schoolId, classIds, { ...filter, statuses: effective }).map((q) => countQuery("feeChallans.bucket", q))
        );
        return counts.reduce((a, b) => a + b, 0);
      };
      const [paidCount, unpaidCount, partialCount] = await Promise.all([
        bucket(["PAID"]),
        bucket(["PENDING", "OVERDUE"]),
        bucket(["PARTIAL"]),
      ]);
      const totalExpected = totals.reduce((a, t) => a + (t.expected || 0), 0);
      const totalCollected = totals.reduce((a, t) => a + (t.collected || 0), 0);
      return {
        totalExpected,
        totalCollected,
        totalOutstanding: Math.max(0, totalExpected - totalCollected),
        paidCount,
        unpaidCount,
        partialCount,
        totalChallans: totals.reduce((a, t) => a + (t.count || 0), 0),
      };
    }, fromList)
  );
}

/** Challans of specific students (active session), e.g. the students matching a ledger search. */
export async function getFeeChallansForStudentsServer(schoolId: string, studentIds: string[]): Promise<FeeChallanDoc[]> {
  const ids = Array.from(new Set(studentIds.filter(Boolean)));
  if (ids.length === 0) return [];
  if (!hasAdminCredentials) {
    const wanted = new Set(ids);
    return (await getFeeChallansServer(schoolId)).filter((c) => wanted.has(c.studentId));
  }
  const { ctx, year } = await resolveSessionScope(schoolId);
  const out: FeeChallanDoc[] = [];
  for (const part of chunk(ids, 30)) {
    const snap = await withFirestoreRetry("feeChallans.forStudents", () =>
      whereOneOf(adminDb.collection("feeChallans").where("schoolId", "==", schoolId), "studentId", part).get()
    );
    out.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc)));
  }
  return filterToSession(ctx, year, out);
}

/** Challans with this exact challan number (search box), active session. */
export async function getFeeChallansByNumberServer(schoolId: string, challanNo: string): Promise<FeeChallanDoc[]> {
  const raw = challanNo.trim();
  if (!raw) return [];
  const variants = Array.from(new Set([raw, raw.toUpperCase()]));
  if (!hasAdminCredentials) {
    return (await getFeeChallansServer(schoolId)).filter((c) => variants.includes(c.challanNo));
  }
  const { ctx, year } = await resolveSessionScope(schoolId);
  const snap = await withFirestoreRetry("feeChallans.byNumber", () =>
    whereOneOf(adminDb.collection("feeChallans").where("schoolId", "==", schoolId), "challanNo", variants).get()
  );
  return filterToSession(ctx, year, snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc)));
}

export async function getStudentFeeChallansServer(schoolId: string, studentId: string): Promise<FeeChallanDoc[]> {
  return getFeeChallansServer(schoolId, studentId);
}

export async function getFeeChallanByIdServer(schoolId: string, challanId: string): Promise<FeeChallanDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("feeChallans").doc(challanId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as FeeChallanDoc;
        if (data.schoolId === schoolId) {
          return data;
        }
        return null;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getFeeChallanByIdServer(${challanId})`, e);
      return null;
    }
  }

  const challan = localStore.feeChallans.get(challanId);
  if (challan && challan.schoolId === schoolId) {
    return challan;
  }
  return null;
}

export async function saveFeeChallanServer(challan: FeeChallanDoc): Promise<string> {
  assertProductionDbReady();
  const id = challan.id || `ch-${Date.now()}`;
  const academicYear = await sessionForWrite(challan.schoolId, challan);
  const data: FeeChallanDoc = {
    ...challan,
    ...(academicYear ? { academicYear } : {}),
    id,
    updatedAt: new Date().toISOString(),
    createdAt: challan.createdAt || new Date().toISOString()
  };
  localStore.feeChallans.set(id, data);
  invalidateCachePrefix(cacheKeys.feeAggregatesPrefix(data.schoolId));

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("feeChallans").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveFeeChallanServer(${id})`, e);
    } finally {
      invalidateCachePrefix(cacheKeys.feeAggregatesPrefix(data.schoolId));
    }
  }
  return id;
}

// Only ever called with a single, fully-formed PaymentDoc (/api/fees PUT, via the
// recordPaymentServer alias below) — verified by grep. The alternate positional-args shape
// this previously also accepted had no real caller and stored `studentId: "placeholder"`
// until the real challan was read inside the transaction below; removed as an unused,
// confusing second code path rather than left for a future caller to invoke by mistake.
export async function recordFeePaymentServer(payment: PaymentDoc): Promise<PaymentDoc> {
  assertProductionDbReady();
  const schoolId = payment.schoolId;
  const challanId = payment.challanId;
  const amount = Number(payment.amount);
  const sessionCtx = await getAcademicSessionContextServer(schoolId);
  invalidateCachePrefix(cacheKeys.feeAggregatesPrefix(schoolId));
  invalidateCachePrefix(cacheKeys.recentPayments(schoolId));
  // A payment belongs to the same session as the challan it settles.
  const stampPaymentSession = (challan: FeeChallanDoc) => {
    const academicYear = resolveRecordSession(sessionCtx, challan);
    if (academicYear) payment.academicYear = academicYear;
  };

  if (hasAdminCredentials) {
    try {
      await adminDb.runTransaction(async (transaction) => {
        const challanRef = adminDb.collection("feeChallans").doc(challanId);
        const challanSnap = await transaction.get(challanRef);

        if (!challanSnap.exists) {
          throw new Error("Fee challan record not found.");
        }

        const challanData = challanSnap.data() as FeeChallanDoc;
        if (challanData.schoolId !== schoolId) {
          throw new Error("Unauthorized: Target challan belongs to a different institution.");
        }

        // Derive actual student identity from target challan (P0-2)
        payment.studentId = challanData.studentId;
        payment.studentName = challanData.studentName;
        stampPaymentSession(challanData);

        const newPaid = (challanData.paidAmount || 0) + amount;
        const newBalance = Math.max(0, (challanData.totalExpected || 0) - newPaid);
        let newStatus: FeeStatus = "PARTIAL";
        if (newBalance === 0) {
          newStatus = "PAID";
        } else if (newPaid <= 0) {
          newStatus = "PENDING";
        }

        const updatedChallan: Partial<FeeChallanDoc> = {
          paidAmount: newPaid,
          balanceAmount: newBalance,
          status: newStatus,
          updatedAt: new Date().toISOString(),
          ...(payment.receiptUrl ? { receiptUrl: payment.receiptUrl } : {}),
        };

        const paymentRef = adminDb.collection("payments").doc(payment.id);
        transaction.set(paymentRef, payment);
        transaction.set(challanRef, updatedChallan, { merge: true });

        localStore.payments.set(payment.id, payment);
        localStore.feeChallans.set(challanId, { ...challanData, ...updatedChallan });
      });
      invalidateCachePrefix(cacheKeys.feeAggregatesPrefix(schoolId));
      invalidateCachePrefix(cacheKeys.recentPayments(schoolId));

      return payment;
    } catch (e: any) {
      onFirestoreError(`recordFeePaymentServer(${challanId})`, e);
      throw e;
    }
  }

  // Non-production fallback
  const challan = localStore.feeChallans.get(challanId);
  if (!challan) throw new Error("Fee challan not found.");
  if (challan.schoolId !== schoolId) {
    throw new Error("Unauthorized: Target challan belongs to a different institution.");
  }

  payment.studentId = challan.studentId;
  payment.studentName = challan.studentName;
  stampPaymentSession(challan);
  localStore.payments.set(payment.id, payment);

  const newPaid = (challan.paidAmount || 0) + amount;
  challan.paidAmount = newPaid;
  challan.balanceAmount = Math.max(0, challan.totalExpected - newPaid);
  if (challan.balanceAmount === 0) {
    challan.status = "PAID";
  } else if (challan.paidAmount > 0) {
    challan.status = "PARTIAL";
  }
  if (payment.receiptUrl) {
    challan.receiptUrl = payment.receiptUrl;
  }
  challan.updatedAt = new Date().toISOString();
  localStore.feeChallans.set(challanId, challan);

  return payment;
}

export const recordPaymentServer = recordFeePaymentServer;

async function fetchPaymentsRaw(schoolId: string, studentId?: string, maxLimit?: number): Promise<PaymentDoc[]> {
  assertProductionDbReady();
  // Bounded read — this collection accumulates every fee payment across every academic year
  // and was previously fetched in full on every dashboard load. Matches the same
  // where(schoolId)+limit()+client-side-sort convention already used by getAuditLogsServer,
  // so no new Firestore composite index is required to deploy this.
  const effectiveLimit = Math.min(maxLimit && maxLimit > 0 ? maxLimit : 200, 500);
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("payments").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      const snap = await ref.limit(effectiveLimit).get();
      const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentDoc));
      if (payments.length > 0 || process.env.NODE_ENV === "production") {
        return payments.sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));
      }
    } catch (e) {
      onFirestoreError(`getPaymentsServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  let list = Array.from(localStore.payments.values()).filter((p) => p.schoolId === schoolId);
  if (studentId) list = list.filter((p) => p.studentId === studentId);
  return list.sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || "")).slice(0, effectiveLimit);
}

export async function getPaymentsServer(
  schoolId: string,
  studentId?: string,
  maxLimit?: number,
  scope?: SessionScope
): Promise<PaymentDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  if (!year) return fetchPaymentsRaw(schoolId, studentId, maxLimit);

  const effectiveLimit = Math.min(maxLimit && maxLimit > 0 ? maxLimit : 200, 500);
  const payments = await fetchPaymentsRaw(schoolId, studentId, 500);
  // Payments recorded before they were session-stamped follow the challan they settled.
  let challanSession = new Map<string, string | null>();
  if (payments.some((p) => !p.academicYear)) {
    const challans = await fetchFeeChallansRaw(schoolId, studentId);
    challanSession = new Map(challans.map((c) => [c.id, resolveRecordSession(ctx, c)]));
  }
  return payments
    .filter((p) => (p.academicYear || challanSession.get(p.challanId) || ctx.academicYear) === year)
    .slice(0, effectiveLimit);
}

/**
 * The `n` most recent payments of the active session (dashboard). Newest-first via the
 * payments (schoolId ASC, paymentDate DESC) index; until that index is deployed a bounded read of
 * 100 payments is used instead of the old 500-payment + every-challan read.
 */
export async function getRecentPaymentsServer(schoolId: string, n = 6): Promise<PaymentDoc[]> {
  if (!hasAdminCredentials) return (await getPaymentsServer(schoolId, undefined, 50)).slice(0, n);
  // Cached for AGGREGATES; dropped when a payment is recorded in this instance.
  return cached(`${cacheKeys.recentPayments(schoolId)}:${n}`, CACHE_TTL_MS.AGGREGATES, () => readRecentPayments(schoolId, n));
}

async function readRecentPayments(schoolId: string, n: number): Promise<PaymentDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId);
  const candidates = await withIndexFallback(
    "payments recent",
    async () => {
      const snap = await withFirestoreRetry("payments.recent", () =>
        adminDb.collection("payments").where("schoolId", "==", schoolId).orderBy("paymentDate", "desc").limit(n * 4).get()
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentDoc));
    },
    () => fetchPaymentsRaw(schoolId, undefined, 100)
  );
  if (!year) return candidates.slice(0, n);
  // Unstamped (legacy) payments follow the challan they settled: read just those challans.
  const unstampedChallanIds = Array.from(new Set(candidates.filter((p) => !p.academicYear).map((p) => p.challanId).filter(Boolean)));
  const challanSession = new Map<string, string | null>();
  if (unstampedChallanIds.length > 0) {
    const snaps = await withFirestoreRetry("payments.recent.challans", () =>
      adminDb.getAll(...unstampedChallanIds.map((id) => adminDb.collection("feeChallans").doc(id)))
    );
    for (const snap of snaps) {
      if (snap.exists) challanSession.set(snap.id, resolveRecordSession(ctx, snap.data() as FeeChallanDoc));
    }
  }
  return candidates
    .filter((p) => (p.academicYear || challanSession.get(p.challanId) || ctx.academicYear) === year)
    .sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""))
    .slice(0, n);
}

export async function getPaymentsByStudentServer(schoolId: string, studentId: string): Promise<PaymentDoc[]> {
  return getPaymentsServer(schoolId, studentId);
}

// ---------------------------------------------------------------------------
// EXAMS & RAPID GRADEBOOK
// ---------------------------------------------------------------------------
async function fetchExamsRaw(schoolId: string): Promise<ExamDoc[]> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("exams").where("schoolId", "==", schoolId).get();
      const exams = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamDoc));
      if (exams.length > 0 || process.env.NODE_ENV === "production") {
        return exams.sort((a, b) => b.startDate.localeCompare(a.startDate));
      }
    } catch (e) {
      onFirestoreError(`getExamsServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  const list = Array.from(localStore.exams.values()).filter((e) => e.schoolId === schoolId);
  return list.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export async function getExamsServer(schoolId: string, scope?: SessionScope): Promise<ExamDoc[]> {
  const ctx = await loadSessionContext(schoolId);
  const year = scope?.allSessions ? null : scope?.academicYear || ctx.academicYear;
  const exams = ctx.exams;
  if (!year) return exams;
  return exams.filter((e) => (e.session || ctx.academicYear) === year);
}

// Only ever called with a single, fully-formed ExamDoc (/api/exams POST) — verified by grep.
// The alternate (schoolId, partialExamData) shape this previously also accepted had no real
// caller, and its `examData.schoolId || DEFAULT_SCHOOL` fallback would have silently written
// a brand-new school's exam into the seeded demo tenant's collection if it had ever been
// exercised. Removed as an unused, latently dangerous code path.
export async function saveExamServer(examData: ExamDoc): Promise<string> {
  const schoolId = examData.schoolId;
  const id = examData.id || `ex-${Date.now()}`;
  const data: ExamDoc = {
    id,
    schoolId,
    name: examData.name || "Exam",
    term: examData.term || "Annual",
    session: examData.session || getDefaultAcademicYear(),
    startDate: examData.startDate || new Date().toISOString(),
    endDate: examData.endDate || new Date().toISOString(),
    status: examData.status || "UPCOMING",
    ...(examData.resultSheetUrl ? { resultSheetUrl: examData.resultSheetUrl } : {}),
    ...(examData.category ? { category: examData.category } : {}),
    createdAt: examData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  invalidateAcademicSessionCache(schoolId);
  localStore.exams.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("exams").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveExamServer(${id})`, e);
    }
  }
  return id;
}

export async function getExamSchedulesServer(schoolId: string, examId: string): Promise<ExamScheduleDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("examSchedules")
        .where("schoolId", "==", schoolId)
        .where("examId", "==", examId)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamScheduleDoc));
    } catch (e) {
      onFirestoreError(`getExamSchedulesServer(${schoolId},${examId})`, e);
    }
  }

  return Array.from(localStore.examSchedules.values()).filter(
    (s) => s.schoolId === schoolId && s.examId === examId
  );
}

export async function saveExamScheduleServer(sched: ExamScheduleDoc): Promise<string> {
  const id = sched.id || `esch-${Date.now()}`;
  const data: ExamScheduleDoc = {
    ...sched,
    id,
    createdAt: sched.createdAt || new Date().toISOString()
  };
  localStore.examSchedules.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("examSchedules").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveExamScheduleServer(${id})`, e);
    }
  }
  return id;
}

async function fetchExamResultsRaw(
  schoolId: string,
  examId?: string,
  classId?: string,
  studentId?: string
): Promise<ExamResultDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("examResults").where("schoolId", "==", schoolId);
      if (examId) ref = ref.where("examId", "==", examId);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamResultDoc));
    } catch (e) {
      onFirestoreError(`getExamResultsServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.examResults.values()).filter((r) => r.schoolId === schoolId);
  if (examId) list = list.filter((r) => r.examId === examId);
  if (classId && classId !== "ALL") list = list.filter((r) => r.classId === classId);
  if (studentId) list = list.filter((r) => r.studentId === studentId);
  return list;
}

export async function getExamResultsServer(
  schoolId: string,
  examId?: string,
  classId?: string,
  studentId?: string,
  scope?: SessionScope
): Promise<ExamResultDoc[]> {
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  return filterToSession(ctx, year, await fetchExamResultsRaw(schoolId, examId, classId, studentId));
}

/**
 * Result counts per grade for the exams of the active session (reports), via count()
 * aggregations instead of reading every result. Cached for AGGREGATES; dropped on result writes.
 */
export async function getExamGradeCountsServer(
  schoolId: string,
  grades: string[]
): Promise<{ total: number; byGrade: Record<string, number> }> {
  const fromList = async () => {
    const results = await getExamResultsServer(schoolId);
    const byGrade: Record<string, number> = {};
    for (const g of grades) byGrade[g] = results.filter((r) => r.grade === g).length;
    return { total: results.length, byGrade };
  };
  if (!hasAdminCredentials) return fromList();
  const examIds = (await getExamsServer(schoolId)).map((e) => e.id);
  const zero = () => Object.fromEntries(grades.map((g) => [g, 0])) as Record<string, number>;
  if (examIds.length === 0) return { total: 0, byGrade: zero() };
  const key = `${cacheKeys.examGradesPrefix(schoolId)}${grades.join(",")}`;
  return cached(key, CACHE_TTL_MS.AGGREGATES, () =>
    withIndexFallback("examResults grade counts", async () => {
      const byGrade = zero();
      let total = 0;
      for (const ids of chunk(examIds, 30)) {
        const base = whereOneOf(adminDb.collection("examResults").where("schoolId", "==", schoolId), "examId", ids);
        const [t, ...perGrade] = await Promise.all([
          countQuery("examResults.count", base),
          ...grades.map((g) => countQuery("examResults.countGrade", base.where("grade", "==", g))),
        ]);
        total += t;
        grades.forEach((g, i) => (byGrade[g] += perGrade[i]));
      }
      return { total, byGrade };
    }, fromList)
  );
}

export async function saveExamResultServer(result: ExamResultDoc): Promise<string> {
  const id = result.id || `${result.schoolId}_${result.examId}_${result.studentId}_${result.subjectId}`;
  const academicYear = await sessionForWrite(result.schoolId, result);
  const data: ExamResultDoc = {
    ...result,
    ...(academicYear ? { academicYear } : {}),
    id,
    updatedAt: new Date().toISOString(),
    createdAt: result.createdAt || new Date().toISOString()
  };
  localStore.examResults.set(id, data);
  invalidateCachePrefix(cacheKeys.examGradesPrefix(data.schoolId));

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("examResults").doc(id).set(data, { merge: true });
    } catch (e) {
      onFirestoreError(`saveExamResultServer(${id})`, e);
    }
  }
  return id;
}

/**
 * Persists a batch of already-computed ExamResultDoc records.
 *
 * A second calling convention — `(schoolId, examId, results[], evaluatedBy)` — used to live
 * here and derived grade/GPA/pass-fail from a grading scale hardcoded in this file
 * (A+ >= 80, A >= 70, ... pass >= 40), completely ignoring the school's own configurable
 * `SchoolSettingsDoc.gradingScale`. It was unreachable — every caller in the codebase passes an
 * array — and grading is correctly performed against the school's real configured scale by
 * /api/exams (see `gradeFor`) before results reach this function. It has been removed rather
 * than left in place as a second, silently-wrong grading implementation for a future caller to
 * pick up by mistake.
 */
export async function saveExamResultsBulkServer(
  results: ExamResultDoc[]
): Promise<{ count: number }> {
  let count = 0;
  for (const schoolId of new Set(results.map((r) => r.schoolId))) invalidateCachePrefix(cacheKeys.examGradesPrefix(schoolId));
  for (const result of results) {
    const academicYear = await sessionForWrite(result.schoolId, result);
    const doc: ExamResultDoc = { ...result, ...(academicYear ? { academicYear } : {}) };
    localStore.examResults.set(doc.id, doc);
    if (hasAdminCredentials) {
      try {
        await adminDb.collection("examResults").doc(doc.id).set(doc, { merge: true });
      } catch (e) {
        onFirestoreError(`saveExamResultsBulkServer(${doc.id})`, e);
      }
    }
    count++;
  }
  for (const schoolId of new Set(results.map((r) => r.schoolId))) invalidateCachePrefix(cacheKeys.examGradesPrefix(schoolId));
  return { count };
}

/** One exam schedule by its document id, only if it belongs to `schoolId`. */
export async function getExamScheduleByIdServer(schoolId: string, scheduleId: string): Promise<ExamScheduleDoc | null> {
  if (!scheduleId) return null;
  if (hasAdminCredentials) {
    try {
      const doc = await withFirestoreRetry("getExamScheduleByIdServer", () =>
        adminDb.collection("examSchedules").doc(scheduleId).get()
      );
      if (!doc.exists) return null;
      const data = { id: doc.id, ...doc.data() } as ExamScheduleDoc;
      return data.schoolId === schoolId ? data : null;
    } catch (e) {
      onFirestoreError(`getExamScheduleByIdServer(${scheduleId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  const local = localStore.examSchedules.get(scheduleId);
  return local && local.schoolId === schoolId ? local : null;
}

/**
 * Writes the marks of one marks-entry save as a single unit: every upsert and every removal goes
 * into Firestore batches, and the call throws if any batch fails, so the route only reports
 * success once the data is really stored. (The earlier per-document loop swallowed write errors
 * outside production, letting the page claim "saved" for marks that were never written.)
 * Result ids are deterministic (`schoolId_examId_studentId_subjectId`), so re-saving updates
 * the same documents instead of creating duplicates.
 */
export async function commitExamResultsServer(
  schoolId: string,
  upserts: ExamResultDoc[],
  deleteIds: string[] = []
): Promise<{ written: number; deleted: number }> {
  if (upserts.some((r) => r.schoolId !== schoolId)) {
    throw new Error("commitExamResultsServer: every result must belong to the given school.");
  }
  const docs: ExamResultDoc[] = [];
  for (const result of upserts) {
    const academicYear = await sessionForWrite(schoolId, result);
    docs.push(cleanUndefined({ ...result, ...(academicYear ? { academicYear } : {}) }) as ExamResultDoc);
  }

  if (hasAdminCredentials) {
    type Op = { kind: "set"; doc: ExamResultDoc } | { kind: "delete"; id: string };
    const ops: Op[] = [
      ...docs.map((doc) => ({ kind: "set" as const, doc })),
      ...deleteIds.map((id) => ({ kind: "delete" as const, id })),
    ];
    try {
      for (const part of chunk(ops, FIRESTORE_BATCH_LIMIT)) {
        const batch = adminDb.batch();
        for (const op of part) {
          if (op.kind === "set") batch.set(adminDb.collection("examResults").doc(op.doc.id), op.doc);
          else batch.delete(adminDb.collection("examResults").doc(op.id));
        }
        await withFirestoreRetry("commitExamResultsServer", () => batch.commit());
      }
    } catch (e) {
      onFirestoreError(`commitExamResultsServer(${schoolId})`, e);
      throw e;
    }
  }

  for (const doc of docs) localStore.examResults.set(doc.id, doc);
  for (const id of deleteIds) {
    const existing = localStore.examResults.get(id);
    if (existing && existing.schoolId === schoolId) localStore.examResults.delete(id);
  }
  invalidateCachePrefix(cacheKeys.examGradesPrefix(schoolId));
  return { written: docs.length, deleted: deleteIds.length };
}

/** Removes one exam schedule. Callers must first make sure no marks are recorded against it. */
export async function deleteExamScheduleServer(schoolId: string, scheduleId: string): Promise<boolean> {
  const existing = await getExamScheduleByIdServer(schoolId, scheduleId);
  if (!existing) return false;
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("examSchedules").doc(scheduleId).delete();
    } catch (e) {
      onFirestoreError(`deleteExamScheduleServer(${scheduleId})`, e);
      throw e;
    }
  }
  localStore.examSchedules.delete(scheduleId);
  return true;
}

/**
 * Removes an exam together with its schedules, atomically. Callers must first make sure no marks
 * are recorded for the exam — results are never deleted as a side effect.
 */
export async function deleteExamServer(schoolId: string, examId: string): Promise<boolean> {
  const exam = (await fetchExamsRaw(schoolId)).find((e) => e.id === examId);
  if (!exam) return false;
  const schedules = await getExamSchedulesServer(schoolId, examId);
  if (hasAdminCredentials) {
    try {
      for (const part of chunk([...schedules.map((s) => s.id), null], FIRESTORE_BATCH_LIMIT)) {
        const batch = adminDb.batch();
        for (const id of part) {
          batch.delete(id === null ? adminDb.collection("exams").doc(examId) : adminDb.collection("examSchedules").doc(id));
        }
        await batch.commit();
      }
    } catch (e) {
      onFirestoreError(`deleteExamServer(${examId})`, e);
      throw e;
    }
  }
  for (const s of schedules) localStore.examSchedules.delete(s.id);
  localStore.exams.delete(examId);
  invalidateAcademicSessionCache(schoolId);
  return true;
}

// ---------------------------------------------------------------------------
// OBSERVATIONS & LOCKED RECORDS
// ---------------------------------------------------------------------------
async function fetchStudentObservationsRaw(
  schoolId: string,
  studentId: string
): Promise<StudentObservationDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("studentObservations")
        .where("schoolId", "==", schoolId)
        .where("studentId", "==", studentId)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentObservationDoc));
    } catch (e) {
      onFirestoreError(`getStudentObservationsServer(${studentId})`, e);
    }
  }

  return Array.from(localStore.studentObservations.values()).filter(
    (o) => o.schoolId === schoolId && o.studentId === studentId
  );
}

/** Observations carry no classId; untagged ones follow the student's own session. */
async function observationSession(schoolId: string, obs: StudentObservationDoc): Promise<string | undefined> {
  if (obs.academicYear) return obs.academicYear;
  const student = await getStudentByIdServer(schoolId, obs.studentId);
  return sessionForWrite(schoolId, { academicYear: student?.academicYear, classId: student?.classId });
}

export async function getStudentObservationsServer(
  schoolId: string,
  studentId: string,
  scope?: SessionScope
): Promise<StudentObservationDoc[]> {
  const { year } = await resolveSessionScope(schoolId, scope);
  const observations = (await fetchStudentObservationsRaw(schoolId, studentId)).filter((o) => !o.deletedAt);
  if (!year || observations.length === 0) return observations;
  const fallback = observations.some((o) => !o.academicYear)
    ? await observationSession(schoolId, { studentId } as StudentObservationDoc)
    : undefined;
  return observations.filter((o) => (o.academicYear || fallback) === year);
}

export interface ObservationSearchFilter {
  classId?: string;
  teacherId?: string;
  category?: string;
  /** Inclusive, ISO date (YYYY-MM-DD) compared against createdAt. */
  fromDate?: string;
  /** Inclusive, ISO date (YYYY-MM-DD) compared against createdAt. */
  toDate?: string;
}

/**
 * School-wide observation search for the admin review screen (not scoped to one student). Soft
 * deleted notes are always excluded. Firestore has no server-side free-text search, so the
 * (small, school-scale) collection is read scoped to the school and filtered in-process — the
 * same approach already used for exam results and timetable rows in this file.
 */
export async function getAllObservationsServer(
  schoolId: string,
  filter: ObservationSearchFilter = {}
): Promise<StudentObservationDoc[]> {
  let list: StudentObservationDoc[];
  if (hasAdminCredentials) {
    try {
      const snap = await withFirestoreRetry("getAllObservationsServer", () =>
        adminDb.collection("studentObservations").where("schoolId", "==", schoolId).get()
      );
      list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentObservationDoc));
    } catch (e) {
      onFirestoreError(`getAllObservationsServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
      list = Array.from(localStore.studentObservations.values()).filter((o) => o.schoolId === schoolId);
    }
  } else {
    list = Array.from(localStore.studentObservations.values()).filter((o) => o.schoolId === schoolId);
  }
  list = list.filter((o) => !o.deletedAt);
  if (filter.classId) list = list.filter((o) => o.classId === filter.classId);
  if (filter.teacherId) list = list.filter((o) => o.teacherId === filter.teacherId);
  if (filter.category) list = list.filter((o) => o.category === filter.category);
  if (filter.fromDate) list = list.filter((o) => o.createdAt.slice(0, 10) >= filter.fromDate!);
  if (filter.toDate) list = list.filter((o) => o.createdAt.slice(0, 10) <= filter.toDate!);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One observation by its document id, only if it belongs to `schoolId`. */
export async function getStudentObservationByIdServer(
  schoolId: string,
  obsId: string
): Promise<StudentObservationDoc | null> {
  if (!obsId) return null;
  if (hasAdminCredentials) {
    try {
      const doc = await withFirestoreRetry("getStudentObservationByIdServer", () =>
        adminDb.collection("studentObservations").doc(obsId).get()
      );
      if (!doc.exists) return null;
      const data = { id: doc.id, ...doc.data() } as StudentObservationDoc;
      return data.schoolId === schoolId ? data : null;
    } catch (e) {
      onFirestoreError(`getStudentObservationByIdServer(${obsId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  const local = localStore.studentObservations.get(obsId);
  return local && local.schoolId === schoolId ? local : null;
}

export async function saveStudentObservationServer(obs: StudentObservationDoc): Promise<string> {
  const id = obs.id || `obs-${Date.now()}`;
  const academicYear = await observationSession(obs.schoolId, obs);
  const data: StudentObservationDoc = {
    ...obs,
    ...(academicYear ? { academicYear } : {}),
    id,
    createdAt: obs.createdAt || new Date().toISOString()
  };
  localStore.studentObservations.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("studentObservations").doc(id).set(cleanUndefined(data));
    } catch (e) {
      onFirestoreError(`saveStudentObservationServer(${id})`, e);
      // Never let the page report a note as saved when the write failed.
      throw e;
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// LESSON PLANS (ASD Weekly & Daily Lesson Plan)
// ---------------------------------------------------------------------------
export interface LessonPlanFilter {
  teacherId?: string;
  classId?: string;
  subjectId?: string;
  weekId?: string;
  academicYear?: string;
  /** Default false: soft-deleted records are excluded. */
  includeDeleted?: boolean;
}

export async function getLessonPlansServer(schoolId: string, filter: LessonPlanFilter = {}): Promise<LessonPlanDoc[]> {
  let list: LessonPlanDoc[];
  if (hasAdminCredentials) {
    try {
      let ref: Query = adminDb.collection("lessonPlans").where("schoolId", "==", schoolId);
      if (filter.teacherId) ref = ref.where("teacherId", "==", filter.teacherId);
      if (filter.classId) ref = ref.where("classId", "==", filter.classId);
      if (filter.subjectId) ref = ref.where("subjectId", "==", filter.subjectId);
      if (filter.weekId) ref = ref.where("weekId", "==", filter.weekId);
      if (filter.academicYear) ref = ref.where("academicYear", "==", filter.academicYear);
      const snap = await withFirestoreRetry("getLessonPlansServer", () => ref.get());
      list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LessonPlanDoc));
    } catch (e) {
      onFirestoreError(`getLessonPlansServer(${schoolId})`, e);
      if (process.env.NODE_ENV === "production") throw e;
      list = Array.from(localStore.lessonPlans.values()).filter((p) => p.schoolId === schoolId);
    }
  } else {
    list = Array.from(localStore.lessonPlans.values()).filter((p) => p.schoolId === schoolId);
    if (filter.teacherId) list = list.filter((p) => p.teacherId === filter.teacherId);
    if (filter.classId) list = list.filter((p) => p.classId === filter.classId);
    if (filter.subjectId) list = list.filter((p) => p.subjectId === filter.subjectId);
    if (filter.weekId) list = list.filter((p) => p.weekId === filter.weekId);
    if (filter.academicYear) list = list.filter((p) => p.academicYear === filter.academicYear);
  }
  if (!filter.includeDeleted) list = list.filter((p) => !p.deletedAt);
  return list.sort((a, b) => b.weekId.localeCompare(a.weekId) || (a.subjectName || "").localeCompare(b.subjectName || ""));
}

export async function getLessonPlanByIdServer(schoolId: string, id: string): Promise<LessonPlanDoc | null> {
  if (!id) return null;
  if (hasAdminCredentials) {
    try {
      const doc = await withFirestoreRetry("getLessonPlanByIdServer", () => adminDb.collection("lessonPlans").doc(id).get());
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as LessonPlanDoc;
        return data.schoolId === schoolId ? data : null;
      }
      if (process.env.NODE_ENV === "production") return null;
    } catch (e) {
      onFirestoreError(`getLessonPlanByIdServer(${id})`, e);
      if (process.env.NODE_ENV === "production") throw e;
    }
  }
  const local = localStore.lessonPlans.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

/**
 * Upserts one lesson-plan record (create or edit, by its deterministic id — see
 * lessonPlanDocId). A Firestore transaction re-reads the document immediately before writing so
 * two concurrent saves of the same week can't silently overwrite one another's `days`/`submitted`
 * state (test: duplicate/concurrent submissions). The in-memory fallback is single-threaded, so
 * no equivalent race exists there.
 */
export async function saveLessonPlanServer(
  doc: LessonPlanDoc,
  guard?: (current: LessonPlanDoc | null) => void
): Promise<string> {
  const data: LessonPlanDoc = { ...doc, updatedAt: new Date().toISOString(), createdAt: doc.createdAt || new Date().toISOString() };
  if (hasAdminCredentials) {
    try {
      await withFirestoreRetry("saveLessonPlanServer", () =>
        adminDb.runTransaction(async (tx) => {
          const ref = adminDb.collection("lessonPlans").doc(data.id);
          const snap = await tx.get(ref);
          const current = snap.exists ? ({ id: snap.id, ...snap.data() } as LessonPlanDoc) : null;
          if (guard) guard(current);
          tx.set(ref, cleanUndefined(data), { merge: true });
        })
      );
    } catch (e) {
      onFirestoreError(`saveLessonPlanServer(${data.id})`, e);
      throw e;
    }
  } else if (guard) {
    guard(localStore.lessonPlans.get(data.id) || null);
  }
  localStore.lessonPlans.set(data.id, data);
  return data.id;
}

/** Soft delete: the record is kept (with deletedAt/deletedBy) rather than removed, for the audit trail. */
export async function softDeleteLessonPlanServer(schoolId: string, id: string, deletedBy: string): Promise<boolean> {
  const existing = await getLessonPlanByIdServer(schoolId, id);
  if (!existing) return false;
  await saveLessonPlanServer({ ...existing, deletedAt: new Date().toISOString(), deletedBy, updatedBy: deletedBy });
  return true;
}

export async function getLockedRecordsServer(schoolId: string, studentId?: string): Promise<LockedRecordDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("lockedRecords").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as LockedRecordDoc));
    } catch (e) {
      onFirestoreError(`getLockedRecordsServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.lockedRecords.values()).filter((l) => l.schoolId === schoolId);
  if (studentId) list = list.filter((l) => l.studentId === studentId);
  return list;
}

export async function createLockedRecordServer(rec: LockedRecordDoc): Promise<string> {
  const id = rec.id || `lock-${Date.now()}`;
  const data: LockedRecordDoc = {
    ...rec,
    id,
    sealedAt: rec.sealedAt || new Date().toISOString()
  };
  localStore.lockedRecords.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("lockedRecords").doc(id).set(data);
    } catch (e) {
      onFirestoreError(`createLockedRecordServer(${id})`, e);
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// DASHBOARD STATS
// ---------------------------------------------------------------------------
/** School totals from aggregates (count()/sum() per class, cached) — no document scans. */
export async function getDashboardStatsServer(schoolId: string) {
  const [classes, studentCounts, teachers, feeTotals] = await Promise.all([
    getSessionClassesServer(schoolId),
    getStudentCountsByClassServer(schoolId),
    getTeachersServer(schoolId),
    getFeeTotalsByClassServer(schoolId),
  ]);

  let activeStudents = 0;
  let totalExpectedFees = 0;
  let totalCollectedFees = 0;
  for (const c of classes) {
    activeStudents += studentCounts.get(c.id)?.active || 0;
    totalExpectedFees += feeTotals.get(c.id)?.expected || 0;
    totalCollectedFees += feeTotals.get(c.id)?.collected || 0;
  }
  const activeTeachers = teachers.filter((t: TeacherDoc) => t.status === "ACTIVE").length;
  const outstandingFees = Math.max(0, totalExpectedFees - totalCollectedFees);
  const collectionRate = totalExpectedFees > 0 ? Math.round((totalCollectedFees / totalExpectedFees) * 100) : 0;

  return {
    totalStudents: activeStudents,
    totalTeachers: activeTeachers,
    totalClasses: classes.length,
    totalExpectedFees,
    totalCollectedFees,
    outstandingFees,
    collectionRate,
  };
}

// ---------------------------------------------------------------------------
// ANNOUNCEMENTS
// ---------------------------------------------------------------------------
export async function getAnnouncementsServer(schoolId: string): Promise<AnnouncementDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("announcements").where("schoolId", "==", schoolId).get();
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AnnouncementDoc));
      return list.sort((a, b) => (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || ""));
    } catch (e) {
      onFirestoreError(`getAnnouncementsServer(${schoolId})`, e);
    }
  }

  return Array.from(localStore.announcements.values())
    .filter((a) => a.schoolId === schoolId)
    .sort((a, b) => (b.publishedAt || b.createdAt || "").localeCompare(a.publishedAt || a.createdAt || ""));
}

export async function getAnnouncementByIdServer(
  schoolId: string,
  announcementId: string
): Promise<AnnouncementDoc | null> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("announcements").doc(announcementId).get();
      if (snap.exists) {
        const data = { id: snap.id, ...snap.data() } as AnnouncementDoc;
        if (data.schoolId === schoolId) return data;
        return null;
      }
    } catch (e) {
      onFirestoreError(`getAnnouncementByIdServer(${announcementId})`, e);
    }
  }

  const local = localStore.announcements.get(announcementId);
  if (local && local.schoolId === schoolId) return local;
  return null;
}

export async function saveAnnouncementServer(announcement: AnnouncementDoc): Promise<string> {
  const id = announcement.id || `ann-${Date.now()}`;
  const data: AnnouncementDoc = {
    ...announcement,
    id,
    updatedAt: new Date().toISOString(),
    createdAt: announcement.createdAt || new Date().toISOString(),
  };
  if (!data.publishedAt) {
    delete (data as { publishedAt?: string }).publishedAt;
  }
  localStore.announcements.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("announcements").doc(id).set(data);
    } catch (e) {
      onFirestoreError(`saveAnnouncementServer(${id})`, e);
    }
  }
  return id;
}

export async function deleteAnnouncementServer(schoolId: string, announcementId: string): Promise<boolean> {
  const existing = await getAnnouncementByIdServer(schoolId, announcementId);
  if (!existing) return false;

  localStore.announcements.delete(announcementId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("announcements").doc(announcementId).delete();
    } catch (e) {
      onFirestoreError(`deleteAnnouncementServer(${announcementId})`, e);
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// PAYROLL RECORDS
// ---------------------------------------------------------------------------
export async function getPayrollRecordsServer(
  schoolId: string,
  month?: string,
  year?: number,
  teacherId?: string
): Promise<PayrollRecordDoc[]> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      let query: FirebaseFirestore.Query = adminDb
        .collection("payrollRecords")
        .where("schoolId", "==", schoolId);

      if (month) {
        query = query.where("month", "==", month);
      }
      if (year !== undefined) {
        query = query.where("year", "==", Number(year));
      }
      if (teacherId) {
        query = query.where("teacherId", "==", teacherId);
      }

      const snap = await query.get();
      return snap.docs.map((d) => d.data() as PayrollRecordDoc);
    } catch (e) {
      onFirestoreError("getPayrollRecordsServer", e);
    }
  }

  // In-memory fallback
  let list = Array.from(localStore.payrollRecords.values()).filter(
    (p) => p.schoolId === schoolId
  );
  if (month) {
    list = list.filter((p) => p.month.toLowerCase() === month.toLowerCase());
  }
  if (year !== undefined) {
    list = list.filter((p) => p.year === Number(year));
  }
  if (teacherId) {
    list = list.filter((p) => p.teacherId === teacherId);
  }
  return list;
}

export async function savePayrollRecordServer(
  record: PayrollRecordDoc
): Promise<string> {
  assertProductionDbReady();
  const id =
    record.id ||
    `payrec_${record.schoolId}_${record.teacherId}_${record.year}_${record.month.toLowerCase()}`;
  const data: PayrollRecordDoc = {
    ...record,
    id,
    updatedAt: new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString(),
  };
  localStore.payrollRecords.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb
        .collection("payrollRecords")
        .doc(id)
        .set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`savePayrollRecordServer(${id})`, e);
      throw e;
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// STUDENT FEE LEDGERS (12-month + annual-fee paid status) & ADDITIONAL CHARGES
// ---------------------------------------------------------------------------
export function studentFeeLedgerId(schoolId: string, studentId: string, year: number): string {
  return `${schoolId}_${studentId}_${year}`;
}

export async function getStudentFeeLedgerServer(
  schoolId: string,
  studentId: string,
  year: number
): Promise<StudentFeeLedgerDoc | null> {
  assertProductionDbReady();
  const id = studentFeeLedgerId(schoolId, studentId, year);
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("studentFeeLedgers").doc(id).get();
      if (!doc.exists) return null;
      const data = { id: doc.id, ...doc.data() } as StudentFeeLedgerDoc;
      return data.schoolId === schoolId && data.studentId === studentId ? data : null;
    } catch (e) {
      onFirestoreError(`getStudentFeeLedgerServer(${id})`, e);
      throw e;
    }
  }
  const local = localStore.studentFeeLedgers.get(id);
  return local && local.schoolId === schoolId && local.studentId === studentId ? local : null;
}

/**
 * Writes only the given month and/or the annual-fee flag into the ledger. Firestore merges the
 * nested `months.<Month>` map, so each month persists independently of the other eleven.
 */
export async function updateStudentFeeLedgerServer(
  key: { schoolId: string; studentId: string; studentName?: string; year: number },
  patch: { month?: { name: FeeMonth; paid: boolean }; annualFeePaid?: boolean },
  updatedBy: string
): Promise<StudentFeeLedgerDoc> {
  assertProductionDbReady();
  const id = studentFeeLedgerId(key.schoolId, key.studentId, key.year);
  const nowIso = new Date().toISOString();
  const partial: Record<string, any> = {
    id,
    schoolId: key.schoolId,
    studentId: key.studentId,
    year: key.year,
    updatedAt: nowIso,
    ...(key.studentName ? { studentName: key.studentName } : {}),
  };
  if (patch.month) {
    partial.months = {
      [patch.month.name]: { paid: patch.month.paid, paidAt: patch.month.paid ? nowIso : null, updatedBy, updatedAt: nowIso },
    };
  }
  if (patch.annualFeePaid !== undefined) {
    partial.annualFeePaid = patch.annualFeePaid;
    partial.annualFeePaidAt = patch.annualFeePaid ? nowIso : null;
  }

  const existing = localStore.studentFeeLedgers.get(id);
  const mergedLocal: StudentFeeLedgerDoc = {
    ...(existing || { months: {}, createdAt: nowIso }),
    ...partial,
    months: { ...(existing?.months || {}), ...(partial.months || {}) },
  } as StudentFeeLedgerDoc;
  localStore.studentFeeLedgers.set(id, mergedLocal);

  if (hasAdminCredentials) {
    try {
      const ref = adminDb.collection("studentFeeLedgers").doc(id);
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && (snap.data() as StudentFeeLedgerDoc).schoolId !== key.schoolId) {
          throw new Error("Unauthorized: fee ledger belongs to a different institution.");
        }
        tx.set(ref, snap.exists ? partial : { ...partial, months: partial.months || {}, createdAt: nowIso }, { merge: true });
      });
      const fresh = await ref.get();
      return { id, ...fresh.data() } as StudentFeeLedgerDoc;
    } catch (e) {
      onFirestoreError(`updateStudentFeeLedgerServer(${id})`, e);
      throw e;
    }
  }
  return mergedLocal;
}

export async function getStudentChargesServer(schoolId: string, studentId: string): Promise<StudentChargeDoc[]> {
  assertProductionDbReady();
  const sort = (list: StudentChargeDoc[]) => list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb
        .collection("studentCharges")
        .where("schoolId", "==", schoolId)
        .where("studentId", "==", studentId)
        .limit(500)
        .get();
      return sort(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentChargeDoc)));
    } catch (e) {
      onFirestoreError(`getStudentChargesServer(${studentId})`, e);
      throw e;
    }
  }
  return sort(
    Array.from(localStore.studentCharges.values()).filter((c) => c.schoolId === schoolId && c.studentId === studentId)
  );
}

export async function getStudentChargeByIdServer(schoolId: string, chargeId: string): Promise<StudentChargeDoc | null> {
  assertProductionDbReady();
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("studentCharges").doc(chargeId).get();
      if (!doc.exists) return null;
      const data = { id: doc.id, ...doc.data() } as StudentChargeDoc;
      return data.schoolId === schoolId ? data : null;
    } catch (e) {
      onFirestoreError(`getStudentChargeByIdServer(${chargeId})`, e);
      throw e;
    }
  }
  const local = localStore.studentCharges.get(chargeId);
  return local && local.schoolId === schoolId ? local : null;
}

export async function saveStudentChargeServer(charge: StudentChargeDoc): Promise<StudentChargeDoc> {
  assertProductionDbReady();
  const data: StudentChargeDoc = { ...charge, updatedAt: new Date().toISOString() };
  localStore.studentCharges.set(data.id, data);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("studentCharges").doc(data.id).set(cleanUndefined(data));
    } catch (e) {
      onFirestoreError(`saveStudentChargeServer(${data.id})`, e);
      throw e;
    }
  }
  return data;
}
