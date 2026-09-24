import { adminDb, hasAdminCredentials } from "./admin";
import { getDefaultAcademicYear } from "../school-display";
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

// ---------------------------------------------------------------------------
// STUDENTS
// ---------------------------------------------------------------------------
export async function getStudentsServer(
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
  const data: StudentDoc = {
    ...student,
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

// ---------------------------------------------------------------------------
// CLASSES & COHORTS
// ---------------------------------------------------------------------------
export async function getClassesServer(schoolId: string): Promise<ClassDoc[]> {
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

// ---------------------------------------------------------------------------
// SUBJECTS
// ---------------------------------------------------------------------------
export async function getSubjectsServer(schoolId: string, classId?: string): Promise<SubjectDoc[]> {
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
  const data: SubjectDoc = {
    ...subject,
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
export async function getTimetableServer(
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

export async function saveTimetableEntryServer(entry: TimetableDoc): Promise<string> {
  const id = entry.id || `tt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const data: TimetableDoc = {
    ...entry,
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
export async function getAttendanceServer(
  schoolId: string,
  date?: string,
  classId?: string,
  studentId?: string,
  fromDate?: string
): Promise<AttendanceDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("attendance").where("schoolId", "==", schoolId);
      if (date) ref = ref.where("date", "==", date);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      const snap = await ref.get();
      let records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc));
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

  let list = Array.from(localStore.attendance.values()).filter((a) => a.schoolId === schoolId);
  if (date) list = list.filter((a) => a.date === date);
  else if (fromDate) list = list.filter((a) => a.date >= fromDate);
  if (classId && classId !== "ALL") list = list.filter((a) => a.classId === classId);
  if (studentId) list = list.filter((a) => a.studentId === studentId);
  return list;
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
  const data: AttendanceDoc = {
    ...record,
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
  let count = 0;
  for (const doc of records) {
    localStore.attendance.set(doc.id, doc);
    if (hasAdminCredentials) {
      try {
        await adminDb.collection("attendance").doc(doc.id).set(doc, { merge: true });
      } catch (e) {
        onFirestoreError(`saveAttendanceBulkServer(${doc.id})`, e);
      }
    }
    count++;
  }
  return { count };
}

// ---------------------------------------------------------------------------
// FEE CHALLANS & CASHIER PAYMENTS
// ---------------------------------------------------------------------------
export async function getFeeChallansServer(
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
  const data: FeeChallanDoc = {
    ...challan,
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

export async function getPaymentsServer(schoolId: string, studentId?: string, maxLimit?: number): Promise<PaymentDoc[]> {
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

export async function getPaymentsByStudentServer(schoolId: string, studentId: string): Promise<PaymentDoc[]> {
  return getPaymentsServer(schoolId, studentId);
}

// ---------------------------------------------------------------------------
// EXAMS & RAPID GRADEBOOK
// ---------------------------------------------------------------------------
export async function getExamsServer(schoolId: string): Promise<ExamDoc[]> {
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

export async function getExamResultsServer(
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

export async function saveExamResultServer(result: ExamResultDoc): Promise<string> {
  const id = result.id || `${result.schoolId}_${result.examId}_${result.studentId}_${result.subjectId}`;
  const data: ExamResultDoc = {
    ...result,
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
  for (const doc of results) {
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
export async function getStudentObservationsServer(
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

export async function saveStudentObservationServer(obs: StudentObservationDoc): Promise<string> {
  const id = obs.id || `obs-${Date.now()}`;
  const data: StudentObservationDoc = {
    ...obs,
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

