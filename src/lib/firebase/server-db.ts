import { FieldValue } from "firebase-admin/firestore";
import { adminDb, hasAdminCredentials } from "./admin";
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
  LockedRecordDoc,
  AuditLogDoc,
  SchoolSettingsDoc,
  TimetableDoc,
  AnnouncementDoc,
  PayrollRecordDoc,
  PasswordResetTokenDoc,
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
  lockedRecords: Map<string, LockedRecordDoc>;
  auditLogs: Map<string, AuditLogDoc>;
  timetables: Map<string, TimetableDoc>;
  announcements: Map<string, AnnouncementDoc>;
  payrollRecords: Map<string, PayrollRecordDoc>;
  passwordResetTokens: Map<string, PasswordResetTokenDoc>;
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
  lockedRecords: new Map(),
  auditLogs: new Map(),
  timetables: new Map(),
  announcements: new Map(),
  payrollRecords: new Map(),
  passwordResetTokens: new Map(),
};

export function assertProductionDbReady() {
  if (process.env.NODE_ENV === "production" && !hasAdminCredentials) {
    throw new Error(
      "Critical: Cloud Firestore database connection not initialized. Server-side Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) must be properly configured in production environment."
    );
  }
}

export function onFirestoreError(operation: string, error: any): void {
  console.error(`[Firestore Error] ${operation} failed:`, error);
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Database error during ${operation}: ${error?.message || "Operation failed"}`);
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
      const snap = await adminDb.collection("auditLogs")
        .where("schoolId", "==", schoolId)
        .limit(maxLimit)
        .get();
      const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc));
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
      const doc = await adminDb.collection("schools").doc(schoolId).get();
      if (doc.exists) return { id: doc.id, ...doc.data() } as School;
    } catch (e) {
      onFirestoreError(`getSchoolServer(${schoolId})`, e);
    }
  }
  return localStore.schools.get(schoolId) || null;
}

export async function saveSchoolServer(school: School): Promise<void> {
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
      const doc = await adminDb.collection("schoolSettings").doc(schoolId).get();
      if (doc.exists) return { id: doc.id, ...doc.data() } as SchoolSettingsDoc;
    } catch (e) {
      onFirestoreError(`getSchoolSettingsServer(${schoolId})`, e);
    }
  }
  return localStore.settings.get(schoolId) || null;
}

export async function updateSchoolSettingsServer(settings: SchoolSettingsDoc): Promise<void> {
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

// Short-lived per-school memo so a single request that calls several list getters doesn't
// re-read settings/classes/exams for each one. Invalidated in-process on every write that can
// change it (settings, classes, exams).
const SESSION_CONTEXT_TTL_MS = 5_000;
const sessionContextCache = new Map<string, { at: number; promise: Promise<AcademicSessionContext> }>();

export function invalidateAcademicSessionCache(schoolId: string): void {
  sessionContextCache.delete(schoolId);
}

export async function getAcademicSessionContextServer(schoolId: string): Promise<AcademicSessionContext> {
  const cached = sessionContextCache.get(schoolId);
  if (cached && Date.now() - cached.at < SESSION_CONTEXT_TTL_MS) return cached.promise;

  const promise = (async () => {
    const [settings, school, classes, exams] = await Promise.all([
      getSchoolSettingsServer(schoolId),
      getSchoolServer(schoolId),
      fetchClassesRaw(schoolId),
      fetchExamsRaw(schoolId),
    ]);
    const academicYear = settings?.academicYear || school?.academicYear || null;
    const classYears = new Map<string, string>();
    for (const c of classes) {
      if (c.academicYear) classYears.set(c.id, c.academicYear);
    }
    const examSessions = new Map<string, string>();
    for (const e of exams) {
      if (e.session) examSessions.set(e.id, e.session);
    }
    return { academicYear, classYears, examSessions };
  })();

  sessionContextCache.set(schoolId, { at: Date.now(), promise });
  promise.catch(() => sessionContextCache.delete(schoolId));
  return promise;
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
      const snap = await adminDb.collection("users").where("email", "==", norm).limit(1).get();
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
      const doc = await adminDb.collection("users").doc(uid).get();
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

export async function createUserServer(user: UserProfile): Promise<void> {
  localStore.users.set(user.email.toLowerCase().trim(), user);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(user.uid).set(user);
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

  for (const [key, existing] of localStore.users.entries()) {
    if (existing.uid === merged.uid) {
      localStore.users.delete(key);
    }
  }
  localStore.users.set(merged.email, merged);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(merged.uid).set(merged, { merge: true });
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
    } catch (e) {
      onFirestoreError(`deleteUserFieldsServer(${uid})`, e);
    }
  }
}

/** Hard-deletes a user profile document. Callers verify ownership/role before calling. */
export async function deleteUserProfileServer(uid: string): Promise<void> {
  for (const [key, existing] of localStore.users.entries()) {
    if (existing.uid === uid) localStore.users.delete(key);
  }
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(uid).delete();
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
  syncLocalUser(uid, { sessionsValidAfter: atIso });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(uid).set({ sessionsValidAfter: atIso, updatedAt: atIso }, { merge: true });
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
    } catch (e) {
      onFirestoreError(`revokeSessionIdServer(${uid})`, e);
    }
  }
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
      let ref = adminDb.collection("students").where("schoolId", "==", schoolId);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      if (status && status.toUpperCase() !== "ALL") ref = ref.where("status", "==", status);
      if (maxLimit && maxLimit > 0) ref = ref.limit(Math.min(maxLimit, 250));
      const snap = await ref.get();
      students = snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentDoc));
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
      const doc = await adminDb.collection("students").doc(studentId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as StudentDoc;
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

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("students").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveStudentServer(${id})`, e);
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

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("students").doc(studentId).delete();
    } catch (e) {
      onFirestoreError(`deleteStudentServer(${studentId})`, e);
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
      let ref = adminDb.collection("teachers").where("schoolId", "==", schoolId);
      // Bounded read (capped at 250, matching the same convention already used by
      // getStudentsServer) instead of an unconditionally unbounded full-collection fetch.
      if (maxLimit && maxLimit > 0) ref = ref.limit(Math.min(maxLimit, 250));
      const snap = await ref.get();
      const teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TeacherDoc));
      // Trust a real (possibly empty) Firestore result in production instead of
      // silently falling through to the in-memory dev fallback store.
      if (teachers.length > 0 || process.env.NODE_ENV === "production") {
        return teachers.sort((a, b) => a.fullName.localeCompare(b.fullName));
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
      const doc = await adminDb.collection("teachers").doc(teacherId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as TeacherDoc;
        if (data.schoolId === schoolId) return data;
      }
    } catch (e) {
      onFirestoreError(`getTeacherByIdServer(${teacherId})`, e);
    }
  }

  const local = localStore.teachers.get(teacherId);
  if (local && local.schoolId === schoolId) return local;
  return null;
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

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("teachers").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveTeacherServer(${id})`, e);
    }
  }
  return id;
}

export async function deleteTeacherServer(schoolId: string, teacherId: string): Promise<boolean> {
  const existing = await getTeacherByIdServer(schoolId, teacherId);
  if (!existing) return false;

  localStore.teachers.delete(teacherId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("teachers").doc(teacherId).delete();
    } catch (e) {
      onFirestoreError(`deleteTeacherServer(${teacherId})`, e);
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
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  const classes = await fetchClassesRaw(schoolId);
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
      let ref = adminDb.collection("subjects").where("schoolId", "==", schoolId);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      const snap = await ref.get();
      const subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectDoc));
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

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("subjects").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveSubjectServer(${id})`, e);
    }
  }
  return id;
}

export async function deleteSubjectServer(schoolId: string, subjectId: string): Promise<boolean> {
  const existing = await getSubjectByIdServer(schoolId, subjectId);
  if (!existing) return false;

  localStore.subjects.delete(subjectId);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("subjects").doc(subjectId).delete();
    } catch (e) {
      onFirestoreError(`deleteSubjectServer(${subjectId})`, e);
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
      let ref = adminDb.collection("timetables").where("schoolId", "==", schoolId);
      if (teacherId) ref = ref.where("teacherId", "==", teacherId);
      if (classId) ref = ref.where("classId", "==", classId);
      if (dayOfWeek && dayOfWeek !== "All") ref = ref.where("dayOfWeek", "==", dayOfWeek);
      const snap = await ref.get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimetableDoc));
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
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("timetables").doc(entryId).delete();
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

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("timetables").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveTimetableEntryServer(${id})`, e);
    }
  }
  return id;
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
      await adminDb.collection("attendance").doc(id).set(data, { merge: true });
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
export async function saveAttendanceBulkServer(
  records: AttendanceDoc[]
): Promise<{ count: number }> {
  const docs: AttendanceDoc[] = [];
  for (const record of records) {
    const academicYear = await sessionForWrite(record.schoolId, record);
    docs.push({ ...record, ...(academicYear ? { academicYear } : {}) });
  }

  // One batched commit per chunk instead of one sequential write per student: a class register
  // is saved in a single round trip, and a failure can no longer leave half the class written.
  if (hasAdminCredentials) {
    try {
      for (let i = 0; i < docs.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = adminDb.batch();
        for (const doc of docs.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
          batch.set(adminDb.collection("attendance").doc(doc.id), cleanUndefined(doc), { merge: true });
        }
        await batch.commit();
      }
    } catch (e) {
      onFirestoreError(`saveAttendanceBulkServer(${docs.length} records)`, e);
    }
  }
  for (const doc of docs) localStore.attendance.set(doc.id, doc);
  return { count: docs.length };
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

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("feeChallans").doc(id).set(cleanUndefined(data), { merge: true });
    } catch (e) {
      onFirestoreError(`saveFeeChallanServer(${id})`, e);
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
  const { ctx, year } = await resolveSessionScope(schoolId, scope);
  const exams = await fetchExamsRaw(schoolId);
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
  return { count };
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
  const observations = await fetchStudentObservationsRaw(schoolId, studentId);
  if (!year || observations.length === 0) return observations;
  const fallback = observations.some((o) => !o.academicYear)
    ? await observationSession(schoolId, { studentId } as StudentObservationDoc)
    : undefined;
  return observations.filter((o) => (o.academicYear || fallback) === year);
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
    }
  }
  return id;
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
export async function getDashboardStatsServer(schoolId: string) {
  const students = await getStudentsServer(schoolId);
  const teachers = await getTeachersServer(schoolId);
  const classes = await getClassesServer(schoolId);
  const challans = await getFeeChallansServer(schoolId);

  const activeStudents = students.filter((s: StudentDoc) => s.status === "ACTIVE").length;
  const activeTeachers = teachers.filter((t: TeacherDoc) => t.status === "ACTIVE").length;
  const totalClasses = classes.length;

  let totalExpectedFees = 0;
  let totalCollectedFees = 0;

  challans.forEach((c: FeeChallanDoc) => {
    totalExpectedFees += c.totalExpected || 0;
    totalCollectedFees += c.paidAmount || 0;
  });

  const outstandingFees = Math.max(0, totalExpectedFees - totalCollectedFees);
  const collectionRate = totalExpectedFees > 0 ? Math.round((totalCollectedFees / totalExpectedFees) * 100) : 0;

  return {
    totalStudents: activeStudents,
    totalTeachers: activeTeachers,
    totalClasses,
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

