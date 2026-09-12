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
};

export function assertProductionDbReady() {
  if (process.env.NODE_ENV === "production" && !hasAdminCredentials) {
    throw new Error(
      "Critical: Cloud Firestore database connection not initialized. Server-side Firebase credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) must be properly configured in production environment."
    );
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
    } catch {}
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
    } catch {}
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
    } catch {}
  }
  return localStore.schools.get(schoolId) || null;
}

export async function getSchoolSettingsServer(schoolId: string): Promise<SchoolSettingsDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("schoolSettings").doc(schoolId).get();
      if (doc.exists) return { id: doc.id, ...doc.data() } as SchoolSettingsDoc;
    } catch {}
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
    } catch {}
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
      if (process.env.NODE_ENV === "production") throw e;
    }
  }

  for (const u of localStore.users.values()) {
    if (u.uid === uid) return u;
  }
  return null;
}

export async function createUserServer(user: UserProfile): Promise<void> {
  localStore.users.set(user.email, user);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("users").doc(user.uid).set(user);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// STUDENTS
// ---------------------------------------------------------------------------
export async function getStudentsServer(
  schoolId: string,
  classId?: string,
  search?: string
): Promise<StudentDoc[]> {
  assertProductionDbReady();
  let students: StudentDoc[] = [];
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("students").where("schoolId", "==", schoolId);
      if (classId && classId !== "ALL") ref = ref.where("classId", "==", classId);
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
  return students.sort((a, b) => a.fullName.localeCompare(b.fullName));
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
  }

  let list = Array.from(localStore.subjects.values()).filter((s) => s.schoolId === schoolId);
  if (classId && classId !== "ALL") list = list.filter((s) => s.classId === classId);
  return list.sort((a, b) => a.name.localeCompare(b.name));
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
    } catch {}
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
    } catch {}
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
        } catch {}
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
        } catch {}
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
  status?: string
): Promise<FeeChallanDoc[]> {
  if (hasAdminCredentials) {
    try {
      let ref = adminDb.collection("feeChallans").where("schoolId", "==", schoolId);
      if (studentId) ref = ref.where("studentId", "==", studentId);
      if (month) ref = ref.where("month", "==", month);
      if (year) ref = ref.where("year", "==", year);
      if (status && status !== "ALL") ref = ref.where("status", "==", status);
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc));
    } catch {}
  }

  let list = Array.from(localStore.feeChallans.values()).filter((f) => f.schoolId === schoolId);
  if (studentId) list = list.filter((f) => f.studentId === studentId);
  if (month) list = list.filter((f) => f.month.toLowerCase() === month.toLowerCase());
  if (year) list = list.filter((f) => f.year === year);
  if (status && status !== "ALL") list = list.filter((f) => f.status === status);
  return list.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
}

export async function getStudentFeeChallansServer(schoolId: string, studentId: string): Promise<FeeChallanDoc[]> {
  return getFeeChallansServer(schoolId, studentId);
}

export async function saveFeeChallanServer(challan: FeeChallanDoc): Promise<string> {
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
    } catch {}
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
  if (typeof arg1 === "object" && arg1 !== null && arg1.challanId) {
    const payment = arg1 as PaymentDoc;
    localStore.payments.set(payment.id, payment);

    const challan = localStore.feeChallans.get(payment.challanId);
    if (challan) {
      challan.paidAmount = (challan.paidAmount || 0) + payment.amount;
      challan.balanceAmount = Math.max(0, challan.totalExpected - challan.paidAmount);
      if (challan.balanceAmount === 0) {
        challan.status = "PAID";
      } else if (challan.paidAmount > 0) {
        challan.status = "PARTIAL";
      }
      challan.updatedAt = new Date().toISOString();
      localStore.feeChallans.set(payment.challanId, challan);
    }

    if (hasAdminCredentials) {
      try {
        await adminDb.collection("payments").doc(payment.id).set(payment);
        if (challan) {
          await adminDb.collection("feeChallans").doc(payment.challanId).set(challan, { merge: true });
        }
      } catch {}
    }
    return payment;
  }

  const schoolId = arg1;
  const challanId = arg2;
  const amount = arg3;
  const paymentMode = arg4 || "CASH";
  const transactionRef = arg5;
  const notes = arg6;
  const collectedBy = arg7 || "Cashier";

  const challan = localStore.feeChallans.get(challanId);
  if (!challan) throw new Error("Challan not found");

  const paymentId = `pmt-${Date.now()}`;
  const payment: PaymentDoc = {
    id: paymentId,
    schoolId,
    challanId,
    studentId: challan.studentId,
    studentName: challan.studentName,
    receiptNo: `REC-${Date.now().toString().slice(-6)}`,
    amount,
    paymentDate: new Date().toISOString(),
    paymentMode,
    transactionRef,
    notes,
    collectedBy,
    createdAt: new Date().toISOString()
  };
  localStore.payments.set(paymentId, payment);

  // Update challan paid amount and balance
  challan.paidAmount = (challan.paidAmount || 0) + amount;
  challan.balanceAmount = Math.max(0, challan.totalExpected - challan.paidAmount);
  if (challan.balanceAmount === 0) {
    challan.status = "PAID";
  } else if (challan.paidAmount > 0) {
    challan.status = "PARTIAL";
  }
  challan.updatedAt = new Date().toISOString();
  localStore.feeChallans.set(challanId, challan);

  if (hasAdminCredentials) {
    try {
      await adminDb.collection("payments").doc(paymentId).set(payment);
      await adminDb.collection("feeChallans").doc(challanId).set(challan, { merge: true });
    } catch {}
  }

  return payment;
}

export const recordPaymentServer = recordFeePaymentServer;

export async function getPaymentsServer(schoolId: string): Promise<PaymentDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("payments").where("schoolId", "==", schoolId).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentDoc));
    } catch {}
  }
  return Array.from(localStore.payments.values()).filter((p) => p.schoolId === schoolId);
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
    } catch {}
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
        } catch {}
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
        } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
