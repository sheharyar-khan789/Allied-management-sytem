import { adminDb, hasAdminCredentials } from "./admin";
import {
  School,
  UserProfile,
  StudentDoc,
  TeacherDoc,
  ClassDoc,
  SubjectDoc,
  AttendanceDoc,
  AttendanceStatus,
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
  YearlyFeeStructureDoc,
  ImportBatchDoc,
  ImportBatchType,
  VoucherGenerationBatchDoc,
  AdvanceBalanceDoc,
  AdvanceBalanceLedgerEntry,
  FeeAdjustmentDoc,
  OtherCollectionDoc,
  OtherExpenseDoc,
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
  yearlyFeeStructures: Map<string, YearlyFeeStructureDoc>;
  importBatches: Map<string, ImportBatchDoc>;
  voucherGenerationBatches: Map<string, VoucherGenerationBatchDoc>;
  advanceBalances: Map<string, AdvanceBalanceDoc>;
  feeAdjustments: Map<string, FeeAdjustmentDoc>;
  otherCollections: Map<string, OtherCollectionDoc>;
  otherExpenses: Map<string, OtherExpenseDoc>;
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
  yearlyFeeStructures: new Map(),
  importBatches: new Map(),
  voucherGenerationBatches: new Map(),
  advanceBalances: new Map(),
  feeAdjustments: new Map(),
  otherCollections: new Map(),
  otherExpenses: new Map(),
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
    } catch {}
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
      await adminDb.collection("students").doc(id).set(data, { merge: true });
    } catch (e) {
      onFirestoreError(`saveStudentServer(${id})`, e);
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// TEACHERS
// ---------------------------------------------------------------------------
export async function getTeachersServer(schoolId: string): Promise<TeacherDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("teachers").where("schoolId", "==", schoolId).get();
      const teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TeacherDoc));
      if (teachers.length > 0) return teachers.sort((a, b) => a.fullName.localeCompare(b.fullName));
    } catch (e) {
      onFirestoreError(`getTeachersServer(${schoolId})`, e);
    }
  }

  const local = Array.from(localStore.teachers.values()).filter((t) => t.schoolId === schoolId);
  return local.sort((a, b) => a.fullName.localeCompare(b.fullName));
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
      await adminDb.collection("teachers").doc(id).set(data, { merge: true });
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
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("classes").where("schoolId", "==", schoolId).get();
      const classes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClassDoc));
      if (classes.length > 0) return classes.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      onFirestoreError(`getClassesServer(${schoolId})`, e);
    }
  }

  const local = Array.from(localStore.classes.values()).filter((c) => c.schoolId === schoolId);
  return local.sort((a, b) => a.name.localeCompare(b.name));
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
      await adminDb.collection("classes").doc(id).set(data, { merge: true });
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
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("subjects").where("schoolId", "==", schoolId);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      const snap = await ref.get();
      const subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectDoc));
      if (subjects.length > 0) return subjects.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      onFirestoreError(`getSubjectsServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.subjects.values()).filter((s) => s.schoolId === schoolId);
  if (classId && classId !== "ALL") list = list.filter((s) => s.classId === classId);
  return list.sort((a, b) => a.name.localeCompare(b.name));
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
      await adminDb.collection("timetables").doc(id).set(data, { merge: true });
    } catch (e) {
      onFirestoreError(`saveTimetableEntryServer(${id})`, e);
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// ATTENDANCE REGISTER
// ---------------------------------------------------------------------------
export async function getAttendanceServer(
  schoolId: string,
  date?: string,
  classId?: string,
  studentId?: string
): Promise<AttendanceDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("attendance").where("schoolId", "==", schoolId);
      if (date) ref = ref.where("date", "==", date);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc));
    } catch (e) {
      onFirestoreError(`getAttendanceServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.attendance.values()).filter((a) => a.schoolId === schoolId);
  if (date) list = list.filter((a) => a.date === date);
  if (classId && classId !== "ALL") list = list.filter((a) => a.classId === classId);
  if (studentId) list = list.filter((a) => a.studentId === studentId);
  return list;
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

export async function saveAttendanceBulkServer(
  arg1: any,
  arg2?: any,
  arg3?: any
): Promise<{ count: number }> {
  let count = 0;
  if (Array.isArray(arg1) && (!arg2 || typeof arg2 === "string")) {
    const list = arg1 as AttendanceDoc[];
    for (const doc of list) {
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
  } else if (typeof arg1 === "string" && Array.isArray(arg2)) {
    const schoolId = arg1;
    const records = arg2;
    const recordedBy = arg3 || "System";
    for (const r of records) {
      const id = `${schoolId}_${r.classId}_${r.studentId}_${r.date}`;
      const doc: AttendanceDoc = {
        id,
        schoolId,
        classId: r.classId,
        studentId: r.studentId,
        studentName: r.studentName,
        date: r.date,
        status: r.status,
        remarks: r.remarks,
        recordedBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStore.attendance.set(id, doc);
      if (hasAdminCredentials) {
        try {
          await adminDb.collection("attendance").doc(id).set(doc, { merge: true });
        } catch (e) {
          onFirestoreError(`saveAttendanceBulkServer(${id})`, e);
        }
      }
      count++;
    }
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
  maxLimit?: number,
  academicYear?: string
): Promise<FeeChallanDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("feeChallans").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      if (month) ref = ref.where("month", "==", month);
      if (year) ref = ref.where("year", "==", year);
      if (status && status.toUpperCase() !== "ALL") ref = ref.where("status", "==", status);
      if (academicYear) ref = ref.where("academicYear", "==", academicYear);
      if (maxLimit && maxLimit > 0) ref = ref.limit(Math.min(maxLimit, 250));
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc));
    } catch (e) {
      onFirestoreError(`getFeeChallansServer(${schoolId})`, e);
    }
  }

  let list = Array.from(localStore.feeChallans.values()).filter((f) => f.schoolId === schoolId);
  if (studentId) list = list.filter((f) => f.studentId === studentId);
  if (month) list = list.filter((f) => f.month.toLowerCase() === month.toLowerCase());
  if (year) list = list.filter((f) => f.year === year);
  if (status && status.toUpperCase() !== "ALL") list = list.filter((f) => f.status === status);
  if (academicYear) list = list.filter((f) => f.academicYear === academicYear);
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
      await adminDb.collection("feeChallans").doc(id).set(data, { merge: true });
    } catch (e) {
      onFirestoreError(`saveFeeChallanServer(${id})`, e);
    }
  }
  return id;
}

export async function recordFeePaymentServer(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any,
  arg5?: any,
  arg6?: any,
  arg7?: any
): Promise<PaymentDoc> {
  assertProductionDbReady();
  let payment: PaymentDoc;
  let schoolId: string;
  let challanId: string;
  let amount: number;

  if (typeof arg1 === "object" && arg1 !== null && arg1.challanId) {
    payment = arg1 as PaymentDoc;
    schoolId = payment.schoolId;
    challanId = payment.challanId;
    amount = Number(payment.amount);
  } else {
    schoolId = arg1;
    challanId = arg2;
    amount = Number(arg3);
    const paymentMode = arg4 || "CASH";
    const transactionRef = arg5;
    const notes = arg6;
    const collectedBy = arg7 || "Cashier";
    const paymentId = `pmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    payment = {
      id: paymentId,
      schoolId,
      challanId,
      studentId: "placeholder",
      receiptNo: `REC-${Date.now().toString().slice(-6)}`,
      amount,
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMode,
      transactionRef,
      notes,
      collectedBy,
      createdAt: new Date().toISOString(),
    };
  }

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
  challan.updatedAt = new Date().toISOString();
  localStore.feeChallans.set(challanId, challan);

  return payment;
}

export const recordPaymentServer = recordFeePaymentServer;

export async function getPaymentsServer(schoolId: string, studentId?: string): Promise<PaymentDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("payments").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentDoc));
    } catch {}
  }
  let list = Array.from(localStore.payments.values()).filter((p) => p.schoolId === schoolId);
  if (studentId) list = list.filter((p) => p.studentId === studentId);
  return list.sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));
}

export async function getPaymentsByStudentServer(schoolId: string, studentId: string): Promise<PaymentDoc[]> {
  return getPaymentsServer(schoolId, studentId);
}

// ---------------------------------------------------------------------------
// YEARLY FEE STRUCTURE
// ---------------------------------------------------------------------------
export function yearlyFeeStructureId(schoolId: string, academicYear: string, admissionNo: string): string {
  return `${schoolId}__${academicYear}__${admissionNo.trim().toUpperCase()}`;
}

export async function getYearlyFeeStructuresServer(
  schoolId: string,
  academicYear: string
): Promise<YearlyFeeStructureDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb
        .collection("yearlyFeeStructures")
        .where("schoolId", "==", schoolId)
        .where("academicYear", "==", academicYear)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as YearlyFeeStructureDoc));
    } catch (e) {
      onFirestoreError(`getYearlyFeeStructuresServer(${schoolId})`, e);
    }
  }
  return Array.from(localStore.yearlyFeeStructures.values()).filter(
    (f) => f.schoolId === schoolId && f.academicYear === academicYear
  );
}

export async function getYearlyFeeStructureServer(
  schoolId: string,
  academicYear: string,
  admissionNo: string
): Promise<YearlyFeeStructureDoc | null> {
  const id = yearlyFeeStructureId(schoolId, academicYear, admissionNo);
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("yearlyFeeStructures").doc(id).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as YearlyFeeStructureDoc;
        if (data.schoolId === schoolId) return data;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getYearlyFeeStructureServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.yearlyFeeStructures.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

export async function saveYearlyFeeStructureServer(doc: YearlyFeeStructureDoc): Promise<string> {
  assertProductionDbReady();
  localStore.yearlyFeeStructures.set(doc.id, doc);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("yearlyFeeStructures").doc(doc.id).set(doc, { merge: true });
    } catch (e) {
      onFirestoreError(`saveYearlyFeeStructureServer(${doc.id})`, e);
    }
  }
  return doc.id;
}

// Writes many yearly fee structure docs idempotently in Firestore batches of <=400 writes,
// safely within Firestore's 500-operation batch limit.
export async function commitYearlyFeeStructureDocsServer(docs: YearlyFeeStructureDoc[]): Promise<void> {
  assertProductionDbReady();
  docs.forEach((d) => localStore.yearlyFeeStructures.set(d.id, d));

  if (!hasAdminCredentials) return;
  try {
    const chunkSize = 400;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const batch = adminDb.batch();
      chunk.forEach((d) => {
        batch.set(adminDb.collection("yearlyFeeStructures").doc(d.id), d, { merge: true });
      });
      await batch.commit();
    }
  } catch (e) {
    onFirestoreError("commitYearlyFeeStructureDocsServer", e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// IMPORT BATCHES (audit trail for yearly fee structure / daily transaction imports)
// ---------------------------------------------------------------------------
export async function saveImportBatchServer(doc: ImportBatchDoc): Promise<string> {
  assertProductionDbReady();
  localStore.importBatches.set(doc.id, doc);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("importBatches").doc(doc.id).set(doc);
    } catch (e) {
      onFirestoreError(`saveImportBatchServer(${doc.id})`, e);
    }
  }
  return doc.id;
}

export async function getImportBatchesServer(
  schoolId: string,
  type: ImportBatchType,
  academicYear?: string
): Promise<ImportBatchDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("importBatches").where("schoolId", "==", schoolId).where("type", "==", type);
      if (academicYear) ref = ref.where("academicYear", "==", academicYear);
      const snap = await ref.get();
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ImportBatchDoc))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      onFirestoreError(`getImportBatchesServer(${schoolId})`, e);
    }
  }
  let list = Array.from(localStore.importBatches.values()).filter((b) => b.schoolId === schoolId && b.type === type);
  if (academicYear) list = list.filter((b) => b.academicYear === academicYear);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getImportBatchByIdServer(schoolId: string, id: string): Promise<ImportBatchDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("importBatches").doc(id).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as ImportBatchDoc;
        if (data.schoolId === schoolId) return data;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getImportBatchByIdServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.importBatches.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

// ---------------------------------------------------------------------------
// MONTHLY VOUCHER GENERATION (Phase 3)
// ---------------------------------------------------------------------------
// Writes many generated FeeChallanDocs idempotently in Firestore batches of <=400 writes.
export async function commitFeeChallanDocsServer(docs: FeeChallanDoc[]): Promise<void> {
  assertProductionDbReady();
  docs.forEach((d) => localStore.feeChallans.set(d.id, d));

  if (!hasAdminCredentials) return;
  try {
    const chunkSize = 400;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const batch = adminDb.batch();
      chunk.forEach((d) => {
        batch.set(adminDb.collection("feeChallans").doc(d.id), d, { merge: true });
      });
      await batch.commit();
    }
  } catch (e) {
    onFirestoreError("commitFeeChallanDocsServer", e);
    throw e;
  }
}

export async function saveVoucherGenerationBatchServer(doc: VoucherGenerationBatchDoc): Promise<string> {
  assertProductionDbReady();
  localStore.voucherGenerationBatches.set(doc.id, doc);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("voucherGenerationBatches").doc(doc.id).set(doc);
    } catch (e) {
      onFirestoreError(`saveVoucherGenerationBatchServer(${doc.id})`, e);
    }
  }
  return doc.id;
}

export async function getVoucherGenerationBatchesServer(
  schoolId: string,
  academicYear?: string
): Promise<VoucherGenerationBatchDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("voucherGenerationBatches").where("schoolId", "==", schoolId);
      if (academicYear) ref = ref.where("academicYear", "==", academicYear);
      const snap = await ref.get();
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as VoucherGenerationBatchDoc))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      onFirestoreError(`getVoucherGenerationBatchesServer(${schoolId})`, e);
    }
  }
  let list = Array.from(localStore.voucherGenerationBatches.values()).filter((b) => b.schoolId === schoolId);
  if (academicYear) list = list.filter((b) => b.academicYear === academicYear);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getVoucherGenerationBatchByIdServer(
  schoolId: string,
  id: string
): Promise<VoucherGenerationBatchDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("voucherGenerationBatches").doc(id).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as VoucherGenerationBatchDoc;
        if (data.schoolId === schoolId) return data;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getVoucherGenerationBatchByIdServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.voucherGenerationBatches.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

// ---------------------------------------------------------------------------
// ADVANCE BALANCES (Phase 4) — money a student has paid beyond their current dues,
// held per academic year and consumed automatically as future vouchers are generated.
// ---------------------------------------------------------------------------
export function advanceBalanceId(schoolId: string, studentId: string, academicYear: string): string {
  return `${schoolId}__${academicYear}__${studentId}`;
}

export async function getAdvanceBalanceServer(
  schoolId: string,
  studentId: string,
  academicYear: string
): Promise<AdvanceBalanceDoc | null> {
  const id = advanceBalanceId(schoolId, studentId, academicYear);
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("advanceBalances").doc(id).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as AdvanceBalanceDoc;
        if (data.schoolId === schoolId) return data;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getAdvanceBalanceServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.advanceBalances.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

// School-wide view used by the centralized financial summary (Phase 7) — unconsumed
// advance balances are real cash already collected, so they must be counted as part of
// total student fee collections even before a future voucher consumes them.
export async function getAdvanceBalancesForSchoolServer(
  schoolId: string,
  academicYear: string
): Promise<AdvanceBalanceDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb
        .collection("advanceBalances")
        .where("schoolId", "==", schoolId)
        .where("academicYear", "==", academicYear)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdvanceBalanceDoc));
    } catch (e) {
      onFirestoreError(`getAdvanceBalancesForSchoolServer(${schoolId})`, e);
    }
  }
  return Array.from(localStore.advanceBalances.values()).filter((a) => a.schoolId === schoolId && a.academicYear === academicYear);
}

// Atomic read-modify-write so concurrent payments/generations never clobber each other's
// credit/debit. `delta` is signed: positive credits the balance, negative debits it.
// Debits are clamped so the balance never goes negative (never invent credit from thin air).
export async function adjustAdvanceBalanceServer(
  schoolId: string,
  studentId: string,
  academicYear: string,
  delta: number,
  reason: string,
  refId: string
): Promise<AdvanceBalanceDoc> {
  assertProductionDbReady();
  const id = advanceBalanceId(schoolId, studentId, academicYear);
  const nowIso = new Date().toISOString();
  const entry: AdvanceBalanceLedgerEntry = {
    type: delta >= 0 ? "CREDIT" : "DEBIT",
    amount: Math.abs(delta),
    reason,
    refId,
    date: nowIso,
  };

  if (hasAdminCredentials) {
    try {
      const result = await adminDb.runTransaction(async (transaction) => {
        const ref = adminDb.collection("advanceBalances").doc(id);
        const snap = await transaction.get(ref);
        const existing = snap.exists ? (snap.data() as AdvanceBalanceDoc) : null;
        const currentBalance = existing?.balance || 0;
        const newBalance = Math.max(0, currentBalance + delta);
        const ledger = [...(existing?.ledger || []), entry].slice(-200);
        const updated: AdvanceBalanceDoc = {
          id,
          schoolId,
          studentId,
          academicYear,
          balance: newBalance,
          ledger,
          updatedAt: nowIso,
        };
        transaction.set(ref, updated);
        return updated;
      });
      localStore.advanceBalances.set(id, result);
      return result;
    } catch (e) {
      onFirestoreError(`adjustAdvanceBalanceServer(${id})`, e);
      throw e;
    }
  }

  const existing = localStore.advanceBalances.get(id);
  const currentBalance = existing?.balance || 0;
  const updated: AdvanceBalanceDoc = {
    id,
    schoolId,
    studentId,
    academicYear,
    balance: Math.max(0, currentBalance + delta),
    ledger: [...(existing?.ledger || []), entry].slice(-200),
    updatedAt: nowIso,
  };
  localStore.advanceBalances.set(id, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// FEE ADJUSTMENTS (Phase 5) — immutable audit trail of every manual change to a
// student's fee structure or an individual voucher. Never mutated once written.
// ---------------------------------------------------------------------------
export async function saveFeeAdjustmentServer(doc: FeeAdjustmentDoc): Promise<string> {
  assertProductionDbReady();
  localStore.feeAdjustments.set(doc.id, doc);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("feeAdjustments").doc(doc.id).set(doc);
    } catch (e) {
      onFirestoreError(`saveFeeAdjustmentServer(${doc.id})`, e);
    }
  }
  return doc.id;
}

export async function getFeeAdjustmentsServer(
  schoolId: string,
  studentId?: string,
  academicYear?: string
): Promise<FeeAdjustmentDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("feeAdjustments").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      if (academicYear) ref = ref.where("academicYear", "==", academicYear);
      const snap = await ref.get();
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as FeeAdjustmentDoc))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      onFirestoreError(`getFeeAdjustmentsServer(${schoolId})`, e);
    }
  }
  let list = Array.from(localStore.feeAdjustments.values()).filter((a) => a.schoolId === schoolId);
  if (studentId) list = list.filter((a) => a.studentId === studentId);
  if (academicYear) list = list.filter((a) => a.academicYear === academicYear);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Applies a signed delta to a single voucher's totalExpected/balanceAmount (never to
// paidAmount or any already-recorded payment) — used for one-off additional charges,
// concessions, and previous-balance corrections against an existing voucher.
export async function applyChallanBalanceAdjustmentServer(
  schoolId: string,
  challanId: string,
  delta: number
): Promise<FeeChallanDoc> {
  assertProductionDbReady();

  if (hasAdminCredentials) {
    try {
      return await adminDb.runTransaction(async (transaction) => {
        const ref = adminDb.collection("feeChallans").doc(challanId);
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error("Fee challan record not found.");
        const challan = snap.data() as FeeChallanDoc;
        if (challan.schoolId !== schoolId) {
          throw new Error("Unauthorized: Target challan belongs to a different institution.");
        }

        const newTotal = Math.max(0, (challan.totalExpected || 0) + delta);
        const newBalance = Math.max(0, newTotal - (challan.paidAmount || 0));
        let newStatus: FeeStatus = "PARTIAL";
        if (newBalance === 0) newStatus = "PAID";
        else if ((challan.paidAmount || 0) <= 0) newStatus = "PENDING";

        const updated: FeeChallanDoc = {
          ...challan,
          id: challanId,
          totalExpected: newTotal,
          balanceAmount: newBalance,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
        transaction.set(ref, updated, { merge: true });
        localStore.feeChallans.set(challanId, updated);
        return updated;
      });
    } catch (e: any) {
      onFirestoreError(`applyChallanBalanceAdjustmentServer(${challanId})`, e);
      throw e;
    }
  }

  const challan = localStore.feeChallans.get(challanId);
  if (!challan) throw new Error("Fee challan record not found.");
  if (challan.schoolId !== schoolId) {
    throw new Error("Unauthorized: Target challan belongs to a different institution.");
  }
  const newTotal = Math.max(0, (challan.totalExpected || 0) + delta);
  const newBalance = Math.max(0, newTotal - (challan.paidAmount || 0));
  challan.totalExpected = newTotal;
  challan.balanceAmount = newBalance;
  challan.status = newBalance === 0 ? "PAID" : (challan.paidAmount || 0) > 0 ? "PARTIAL" : "PENDING";
  challan.updatedAt = new Date().toISOString();
  localStore.feeChallans.set(challanId, challan);
  return challan;
}

// Reverses a payment without deleting it: writes a new negative-amount PaymentDoc linked
// via reversesPaymentId, marks the original reversed=true (idempotency guard — a payment
// can only be reversed once), and restores the challan's paidAmount/balanceAmount/status.
export async function reversePaymentServer(
  schoolId: string,
  paymentId: string,
  reason: string,
  reversedBy: string
): Promise<PaymentDoc> {
  assertProductionDbReady();

  if (hasAdminCredentials) {
    try {
      return await adminDb.runTransaction(async (transaction) => {
        const paymentRef = adminDb.collection("payments").doc(paymentId);
        const paymentSnap = await transaction.get(paymentRef);
        if (!paymentSnap.exists) throw new Error("Payment record not found.");
        const original = paymentSnap.data() as PaymentDoc;
        if (original.schoolId !== schoolId) throw new Error("Unauthorized: payment belongs to a different institution.");
        if (original.reversed) throw new Error("This payment has already been reversed.");
        if (original.amount < 0) throw new Error("Cannot reverse a reversal entry.");

        const challanRef = adminDb.collection("feeChallans").doc(original.challanId);
        const challanSnap = await transaction.get(challanRef);
        if (!challanSnap.exists) throw new Error("Related fee challan not found.");
        const challan = challanSnap.data() as FeeChallanDoc;

        const newPaid = Math.max(0, (challan.paidAmount || 0) - original.amount);
        const newBalance = Math.max(0, (challan.totalExpected || 0) - newPaid);
        let newStatus: FeeStatus = "PARTIAL";
        if (newBalance === 0 && newPaid > 0) newStatus = "PAID";
        else if (newPaid <= 0) newStatus = "PENDING";

        const nowIso = new Date().toISOString();
        const reversalId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const reversal: PaymentDoc = {
          id: reversalId,
          schoolId,
          challanId: original.challanId,
          studentId: original.studentId,
          studentName: original.studentName,
          receiptNo: `REV-${original.receiptNo}`,
          amount: -original.amount,
          paymentDate: nowIso.split("T")[0],
          paymentMode: original.paymentMode,
          notes: reason,
          collectedBy: reversedBy,
          createdAt: nowIso,
          source: "REVERSAL",
          reversesPaymentId: original.id,
        };

        transaction.set(adminDb.collection("payments").doc(reversalId), reversal);
        transaction.set(paymentRef, { reversed: true }, { merge: true });
        transaction.set(challanRef, { paidAmount: newPaid, balanceAmount: newBalance, status: newStatus, updatedAt: nowIso }, { merge: true });

        localStore.payments.set(reversalId, reversal);
        localStore.payments.set(original.id, { ...original, reversed: true });
        localStore.feeChallans.set(original.challanId, { ...challan, paidAmount: newPaid, balanceAmount: newBalance, status: newStatus, updatedAt: nowIso });

        return reversal;
      });
    } catch (e: any) {
      onFirestoreError(`reversePaymentServer(${paymentId})`, e);
      throw e;
    }
  }

  const original = localStore.payments.get(paymentId);
  if (!original) throw new Error("Payment record not found.");
  if (original.schoolId !== schoolId) throw new Error("Unauthorized: payment belongs to a different institution.");
  if (original.reversed) throw new Error("This payment has already been reversed.");
  if (original.amount < 0) throw new Error("Cannot reverse a reversal entry.");

  const challan = localStore.feeChallans.get(original.challanId);
  if (!challan) throw new Error("Related fee challan not found.");

  const newPaid = Math.max(0, (challan.paidAmount || 0) - original.amount);
  const newBalance = Math.max(0, (challan.totalExpected || 0) - newPaid);
  const nowIso = new Date().toISOString();
  const reversalId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const reversal: PaymentDoc = {
    id: reversalId,
    schoolId,
    challanId: original.challanId,
    studentId: original.studentId,
    studentName: original.studentName,
    receiptNo: `REV-${original.receiptNo}`,
    amount: -original.amount,
    paymentDate: nowIso.split("T")[0],
    paymentMode: original.paymentMode,
    notes: reason,
    collectedBy: reversedBy,
    createdAt: nowIso,
    source: "REVERSAL",
    reversesPaymentId: original.id,
  };

  original.reversed = true;
  challan.paidAmount = newPaid;
  challan.balanceAmount = newBalance;
  challan.status = newBalance === 0 && newPaid > 0 ? "PAID" : newPaid <= 0 ? "PENDING" : "PARTIAL";
  challan.updatedAt = nowIso;

  localStore.payments.set(paymentId, original);
  localStore.payments.set(reversalId, reversal);
  localStore.feeChallans.set(original.challanId, challan);

  return reversal;
}

// ---------------------------------------------------------------------------
// OTHER COLLECTIONS (Phase 6) — non-tuition school income (registration, certificates,
// fines, events, etc). Contributes to total income but must never be confused with
// student fee payments in reports.
// ---------------------------------------------------------------------------
export async function saveOtherCollectionServer(doc: OtherCollectionDoc): Promise<string> {
  assertProductionDbReady();
  localStore.otherCollections.set(doc.id, doc);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("otherCollections").doc(doc.id).set(doc);
    } catch (e) {
      onFirestoreError(`saveOtherCollectionServer(${doc.id})`, e);
    }
  }
  return doc.id;
}

export async function getOtherCollectionsServer(
  schoolId: string,
  dateFrom?: string,
  dateTo?: string,
  category?: string
): Promise<OtherCollectionDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("otherCollections").where("schoolId", "==", schoolId).get();
      let list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OtherCollectionDoc));
      if (dateFrom) list = list.filter((c) => c.date >= dateFrom);
      if (dateTo) list = list.filter((c) => c.date <= dateTo);
      if (category && category !== "ALL") list = list.filter((c) => c.category === category);
      return list.sort((a, b) => b.date.localeCompare(a.date));
    } catch (e) {
      onFirestoreError(`getOtherCollectionsServer(${schoolId})`, e);
    }
  }
  let list = Array.from(localStore.otherCollections.values()).filter((c) => c.schoolId === schoolId);
  if (dateFrom) list = list.filter((c) => c.date >= dateFrom);
  if (dateTo) list = list.filter((c) => c.date <= dateTo);
  if (category && category !== "ALL") list = list.filter((c) => c.category === category);
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getOtherCollectionByIdServer(schoolId: string, id: string): Promise<OtherCollectionDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("otherCollections").doc(id).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as OtherCollectionDoc;
        if (data.schoolId === schoolId) return data;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getOtherCollectionByIdServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.otherCollections.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

// Marks the record reversed=true rather than deleting it — a reversed entry stays visible
// in history but is excluded from income totals (see getOtherCollectionsServer callers).
export async function reverseOtherCollectionServer(
  schoolId: string,
  id: string,
  reason: string,
  reversedBy: string
): Promise<OtherCollectionDoc> {
  assertProductionDbReady();
  const existing = await getOtherCollectionByIdServer(schoolId, id);
  if (!existing) throw new Error("Other collection record not found.");
  if (existing.reversed) throw new Error("This record has already been reversed.");

  const updated: OtherCollectionDoc = {
    ...existing,
    reversed: true,
    reversedReason: reason,
    reversedBy,
    reversedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveOtherCollectionServer(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// OTHER EXPENSES (Phase 6) — operational spending (utilities, maintenance, staff, etc).
// Deducted from income when computing net balance; never a student-fee record.
// ---------------------------------------------------------------------------
export async function saveOtherExpenseServer(doc: OtherExpenseDoc): Promise<string> {
  assertProductionDbReady();
  localStore.otherExpenses.set(doc.id, doc);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("otherExpenses").doc(doc.id).set(doc);
    } catch (e) {
      onFirestoreError(`saveOtherExpenseServer(${doc.id})`, e);
    }
  }
  return doc.id;
}

export async function getOtherExpensesServer(
  schoolId: string,
  dateFrom?: string,
  dateTo?: string,
  category?: string
): Promise<OtherExpenseDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("otherExpenses").where("schoolId", "==", schoolId).get();
      let list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OtherExpenseDoc));
      if (dateFrom) list = list.filter((c) => c.date >= dateFrom);
      if (dateTo) list = list.filter((c) => c.date <= dateTo);
      if (category && category !== "ALL") list = list.filter((c) => c.category === category);
      return list.sort((a, b) => b.date.localeCompare(a.date));
    } catch (e) {
      onFirestoreError(`getOtherExpensesServer(${schoolId})`, e);
    }
  }
  let list = Array.from(localStore.otherExpenses.values()).filter((c) => c.schoolId === schoolId);
  if (dateFrom) list = list.filter((c) => c.date >= dateFrom);
  if (dateTo) list = list.filter((c) => c.date <= dateTo);
  if (category && category !== "ALL") list = list.filter((c) => c.category === category);
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getOtherExpenseByIdServer(schoolId: string, id: string): Promise<OtherExpenseDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("otherExpenses").doc(id).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as OtherExpenseDoc;
        if (data.schoolId === schoolId) return data;
      }
      return null;
    } catch (e) {
      onFirestoreError(`getOtherExpenseByIdServer(${id})`, e);
      return null;
    }
  }
  const local = localStore.otherExpenses.get(id);
  return local && local.schoolId === schoolId ? local : null;
}

export async function reverseOtherExpenseServer(
  schoolId: string,
  id: string,
  reason: string,
  reversedBy: string
): Promise<OtherExpenseDoc> {
  assertProductionDbReady();
  const existing = await getOtherExpenseByIdServer(schoolId, id);
  if (!existing) throw new Error("Other expense record not found.");
  if (existing.reversed) throw new Error("This record has already been reversed.");

  const updated: OtherExpenseDoc = {
    ...existing,
    reversed: true,
    reversedReason: reason,
    reversedBy,
    reversedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveOtherExpenseServer(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// EXAMS & RAPID GRADEBOOK
// ---------------------------------------------------------------------------
export async function getExamsServer(schoolId: string): Promise<ExamDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("exams").where("schoolId", "==", schoolId).get();
      const exams = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamDoc));
      if (exams.length > 0) return exams.sort((a, b) => b.startDate.localeCompare(a.startDate));
    } catch {}
  }

  const list = Array.from(localStore.exams.values()).filter((e) => e.schoolId === schoolId);
  return list.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export async function saveExamServer(arg1: any, arg2?: any): Promise<string> {
  const examData: Partial<ExamDoc> = typeof arg1 === "object" && arg1 !== null ? arg1 : (arg2 || {});
  const schoolId: string = typeof arg1 === "string" ? arg1 : (examData.schoolId || DEFAULT_SCHOOL);
  const id = examData.id || `ex-${Date.now()}`;
  const data: ExamDoc = {
    id,
    schoolId,
    name: examData.name || "Exam",
    term: examData.term || "Annual",
    session: examData.session || "2024-2025",
    startDate: examData.startDate || new Date().toISOString(),
    endDate: examData.endDate || new Date().toISOString(),
    status: examData.status || "UPCOMING",
    createdAt: examData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  localStore.exams.set(id, data);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("exams").doc(id).set(data, { merge: true });
    } catch {}
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
    } catch {}
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
      await adminDb.collection("examSchedules").doc(id).set(data, { merge: true });
    } catch {}
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
    } catch {}
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

export async function saveExamResultsBulkServer(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): Promise<{ count: number }> {
  let count = 0;
  if (Array.isArray(arg1)) {
    const list = arg1 as ExamResultDoc[];
    for (const doc of list) {
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
  } else if (typeof arg1 === "string" && typeof arg2 === "string" && Array.isArray(arg3)) {
    const schoolId = arg1;
    const examId = arg2;
    const results = arg3;
    const evaluatedBy = arg4 || "Teacher";
    for (const res of results) {
      const percentage = res.totalMarks > 0 ? (res.obtainedMarks / res.totalMarks) * 100 : 0;
      let grade = "F";
      let gpa = 0.0;
      if (percentage >= 80) { grade = "A+"; gpa = 4.0; }
      else if (percentage >= 70) { grade = "A"; gpa = 3.5; }
      else if (percentage >= 60) { grade = "B"; gpa = 3.0; }
      else if (percentage >= 50) { grade = "C"; gpa = 2.0; }
      else if (percentage >= 40) { grade = "D"; gpa = 1.0; }

      const id = `${schoolId}_${examId}_${res.studentId}_${res.subjectId}`;
      const doc: ExamResultDoc = {
        id,
        schoolId,
        examId,
        studentId: res.studentId,
        studentName: res.studentName,
        rollNo: res.rollNo,
        classId: res.classId,
        subjectId: res.subjectId,
        subjectName: res.subjectName,
        obtainedMarks: res.obtainedMarks,
        totalMarks: res.totalMarks,
        percentage: Math.round(percentage * 10) / 10,
        grade,
        gpa,
        status: percentage >= 40 ? "PASS" : "FAIL",
        remarks: res.remarks,
        evaluatedBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStore.examResults.set(id, doc);
      if (hasAdminCredentials) {
        try {
          await adminDb.collection("examResults").doc(id).set(doc, { merge: true });
        } catch (e) {
          onFirestoreError(`saveExamResultsBulkServer(${id})`, e);
        }
      }
      count++;
    }
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
      await adminDb.collection("studentObservations").doc(id).set(data);
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
