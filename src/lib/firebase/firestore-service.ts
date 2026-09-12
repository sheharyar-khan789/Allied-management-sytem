import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch
} from "firebase/firestore";
import { db } from "./config";
import {
  School,
  UserProfile,
  StudentDoc,
  TeacherDoc,
  ClassDoc,
  SubjectDoc,
  AttendanceDoc,
  FeeChallanDoc,
  PaymentDoc,
  ExamDoc,
  ExamScheduleDoc,
  ExamResultDoc,
  StudentObservationDoc,
  LockedRecordDoc,
  AuditLogDoc,
  SchoolSettingsDoc,
  AttendanceStatus
} from "./types";

// ============================================================================
// AUDIT LOGGING
// ============================================================================
export async function logAuditEvent(
  schoolId: string,
  userId: string,
  userEmail: string,
  role: string,
  action: string,
  entity: string,
  entityId: string,
  details: string
) {
  try {
    const logRef = doc(collection(db, "auditLogs"));
    const logData: AuditLogDoc = {
      id: logRef.id,
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
    await setDoc(logRef, logData);
  } catch (e) {
    console.error("Failed to write audit log:", e);
  }
}

// ============================================================================
// SCHOOLS
// ============================================================================
export async function getSchool(schoolId: string): Promise<School | null> {
  const docRef = doc(db, "schools", schoolId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as School;
}

export async function createSchool(schoolData: School): Promise<void> {
  const docRef = doc(db, "schools", schoolData.id);
  await setDoc(docRef, schoolData);
}

// ============================================================================
// USERS & PROFILES
// ============================================================================
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const docRef = doc(db, "users", uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

export async function createUserProfile(profile: UserProfile): Promise<void> {
  const docRef = doc(db, "users", profile.uid);
  await setDoc(docRef, profile);
}

export async function updateUserProfile(uid: string, updates: Partial<UserProfile>): Promise<void> {
  const docRef = doc(db, "users", uid);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: new Date().toISOString()
  });
}

// ============================================================================
// STUDENTS
// ============================================================================
export async function getStudentsBySchool(schoolId: string): Promise<StudentDoc[]> {
  const q = query(
    collection(db, "students"),
    where("schoolId", "==", schoolId)
  );
  const snap = await getDocs(q);
  const students = snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentDoc));
  return students.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getStudentById(studentId: string): Promise<StudentDoc | null> {
  const docRef = doc(db, "students", studentId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as StudentDoc;
}

export async function getStudentByUserId(userId: string): Promise<StudentDoc | null> {
  const q = query(collection(db, "students"), where("userId", "==", userId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as StudentDoc;
}

export async function saveStudent(student: StudentDoc): Promise<string> {
  const docRef = student.id ? doc(db, "students", student.id) : doc(collection(db, "students"));
  const data = {
    ...student,
    id: docRef.id,
    updatedAt: new Date().toISOString(),
    createdAt: student.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

// ============================================================================
// TEACHERS
// ============================================================================
export async function getTeachersBySchool(schoolId: string): Promise<TeacherDoc[]> {
  const q = query(
    collection(db, "teachers"),
    where("schoolId", "==", schoolId)
  );
  const snap = await getDocs(q);
  const teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TeacherDoc));
  return teachers.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getTeacherById(teacherId: string): Promise<TeacherDoc | null> {
  const docRef = doc(db, "teachers", teacherId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as TeacherDoc;
}

export async function getTeacherByUserId(userId: string): Promise<TeacherDoc | null> {
  const q = query(collection(db, "teachers"), where("userId", "==", userId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as TeacherDoc;
}

export async function saveTeacher(teacher: TeacherDoc): Promise<string> {
  const docRef = teacher.id ? doc(db, "teachers", teacher.id) : doc(collection(db, "teachers"));
  const data = {
    ...teacher,
    id: docRef.id,
    updatedAt: new Date().toISOString(),
    createdAt: teacher.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

// ============================================================================
// CLASSES & SUBJECTS
// ============================================================================
export async function getClassesBySchool(schoolId: string): Promise<ClassDoc[]> {
  const q = query(
    collection(db, "classes"),
    where("schoolId", "==", schoolId)
  );
  const snap = await getDocs(q);
  const classes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClassDoc));
  return classes.sort((a, b) => a.numericLevel - b.numericLevel || a.section.localeCompare(b.section));
}

export async function saveClass(classData: ClassDoc): Promise<string> {
  const docRef = classData.id ? doc(db, "classes", classData.id) : doc(collection(db, "classes"));
  const data = {
    ...classData,
    id: docRef.id,
    updatedAt: new Date().toISOString(),
    createdAt: classData.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

export async function getSubjectsBySchool(schoolId: string): Promise<SubjectDoc[]> {
  const q = query(
    collection(db, "subjects"),
    where("schoolId", "==", schoolId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectDoc));
}

export async function saveSubject(subject: SubjectDoc): Promise<string> {
  const docRef = subject.id ? doc(db, "subjects", subject.id) : doc(collection(db, "subjects"));
  const data = {
    ...subject,
    id: docRef.id,
    updatedAt: new Date().toISOString(),
    createdAt: subject.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

// ============================================================================
// ATTENDANCE
// ============================================================================
export async function getAttendanceByClassAndDate(
  schoolId: string,
  classId: string,
  date: string
): Promise<AttendanceDoc[]> {
  const q = query(
    collection(db, "attendance"),
    where("schoolId", "==", schoolId),
    where("classId", "==", classId),
    where("date", "==", date)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc));
}

export async function getAttendanceByStudent(
  schoolId: string,
  studentId: string
): Promise<AttendanceDoc[]> {
  const q = query(
    collection(db, "attendance"),
    where("schoolId", "==", schoolId),
    where("studentId", "==", studentId)
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc));
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveAttendanceBulk(records: AttendanceDoc[]): Promise<void> {
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  for (const r of records) {
    const docId = `${r.schoolId}_${r.classId}_${r.studentId}_${r.date}`;
    const docRef = doc(db, "attendance", docId);
    batch.set(docRef, {
      ...r,
      id: docId,
      updatedAt: now,
      createdAt: r.createdAt || now
    }, { merge: true });
  }
  await batch.commit();
}

// ============================================================================
// FEES & PAYMENTS
// ============================================================================
export async function getFeeChallansBySchool(schoolId: string): Promise<FeeChallanDoc[]> {
  const q = query(
    collection(db, "feeChallans"),
    where("schoolId", "==", schoolId)
  );
  const snap = await getDocs(q);
  const challans = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc));
  return challans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getFeeChallansByStudent(
  schoolId: string,
  studentId: string
): Promise<FeeChallanDoc[]> {
  const q = query(
    collection(db, "feeChallans"),
    where("schoolId", "==", schoolId),
    where("studentId", "==", studentId)
  );
  const snap = await getDocs(q);
  const challans = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeChallanDoc));
  return challans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveFeeChallan(challan: FeeChallanDoc): Promise<string> {
  const docRef = challan.id ? doc(db, "feeChallans", challan.id) : doc(collection(db, "feeChallans"));
  const balance = Math.max(0, challan.totalExpected - (challan.paidAmount || 0));
  let status: FeeChallanDoc["status"] = "PENDING";
  if (balance === 0) status = "PAID";
  else if (challan.paidAmount > 0) status = "PARTIAL";

  const data = {
    ...challan,
    id: docRef.id,
    balanceAmount: balance,
    status,
    updatedAt: new Date().toISOString(),
    createdAt: challan.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

export async function recordPayment(payment: PaymentDoc): Promise<string> {
  const paymentRef = doc(collection(db, "payments"));
  const payData = {
    ...payment,
    id: paymentRef.id,
    createdAt: new Date().toISOString()
  };
  await setDoc(paymentRef, payData);

  // Update Challan
  const challanRef = doc(db, "feeChallans", payment.challanId);
  const challanSnap = await getDoc(challanRef);
  if (challanSnap.exists()) {
    const cData = challanSnap.data() as FeeChallanDoc;
    const newPaid = (cData.paidAmount || 0) + payment.amount;
    const newBalance = Math.max(0, cData.totalExpected - newPaid);
    const newStatus = newBalance === 0 ? "PAID" : newPaid > 0 ? "PARTIAL" : "PENDING";
    await updateDoc(challanRef, {
      paidAmount: newPaid,
      balanceAmount: newBalance,
      status: newStatus,
      updatedAt: new Date().toISOString()
    });
  }
  return paymentRef.id;
}

export async function getPaymentsBySchool(schoolId: string): Promise<PaymentDoc[]> {
  const q = query(
    collection(db, "payments"),
    where("schoolId", "==", schoolId)
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentDoc));
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ============================================================================
// EXAMS & RESULTS
// ============================================================================
export async function getExamsBySchool(schoolId: string): Promise<ExamDoc[]> {
  const q = query(collection(db, "exams"), where("schoolId", "==", schoolId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamDoc));
}

export async function saveExam(exam: ExamDoc): Promise<string> {
  const docRef = exam.id ? doc(db, "exams", exam.id) : doc(collection(db, "exams"));
  const data = {
    ...exam,
    id: docRef.id,
    updatedAt: new Date().toISOString(),
    createdAt: exam.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

export async function getExamSchedules(schoolId: string, examId: string): Promise<ExamScheduleDoc[]> {
  const q = query(
    collection(db, "examSchedules"),
    where("schoolId", "==", schoolId),
    where("examId", "==", examId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamScheduleDoc));
}

export async function saveExamSchedule(schedule: ExamScheduleDoc): Promise<string> {
  const docRef = schedule.id ? doc(db, "examSchedules", schedule.id) : doc(collection(db, "examSchedules"));
  const data = {
    ...schedule,
    id: docRef.id,
    createdAt: schedule.createdAt || new Date().toISOString()
  };
  await setDoc(docRef, data, { merge: true });
  return docRef.id;
}

export async function getExamResultsByExamAndClass(
  schoolId: string,
  examId: string,
  classId: string
): Promise<ExamResultDoc[]> {
  const q = query(
    collection(db, "examResults"),
    where("schoolId", "==", schoolId),
    where("examId", "==", examId),
    where("classId", "==", classId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamResultDoc));
}

export async function getExamResultsByStudent(
  schoolId: string,
  studentId: string
): Promise<ExamResultDoc[]> {
  const q = query(
    collection(db, "examResults"),
    where("schoolId", "==", schoolId),
    where("studentId", "==", studentId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamResultDoc));
}

export function computeGradeAndGPA(obtained: number, total: number) {
  const percentage = total > 0 ? (obtained / total) * 100 : 0;
  let grade = "F";
  let gpa = 0.0;
  if (percentage >= 90) { grade = "A+"; gpa = 4.0; }
  else if (percentage >= 80) { grade = "A"; gpa = 3.7; }
  else if (percentage >= 70) { grade = "B+"; gpa = 3.3; }
  else if (percentage >= 60) { grade = "B"; gpa = 3.0; }
  else if (percentage >= 50) { grade = "C"; gpa = 2.5; }
  else if (percentage >= 40) { grade = "D"; gpa = 2.0; }
  else { grade = "F"; gpa = 0.0; }
  return { percentage: Math.round(percentage * 10) / 10, grade, gpa, status: percentage >= 33 ? "PASS" : "FAIL" as const };
}

export async function saveExamResultsBulk(results: ExamResultDoc[]): Promise<void> {
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  for (const r of results) {
    const docId = `${r.schoolId}_${r.examId}_${r.studentId}_${r.subjectId}`;
    const docRef = doc(db, "examResults", docId);
    const { percentage, grade, gpa, status } = computeGradeAndGPA(r.obtainedMarks, r.totalMarks);
    batch.set(docRef, {
      ...r,
      id: docId,
      percentage,
      grade,
      gpa,
      status,
      updatedAt: now,
      createdAt: r.createdAt || now
    }, { merge: true });
  }
  await batch.commit();
}

// ============================================================================
// STUDENT OBSERVATIONS
// ============================================================================
export async function getStudentObservations(schoolId: string, studentId: string): Promise<StudentObservationDoc[]> {
  const q = query(
    collection(db, "studentObservations"),
    where("schoolId", "==", schoolId),
    where("studentId", "==", studentId)
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentObservationDoc));
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveStudentObservation(obs: StudentObservationDoc): Promise<string> {
  const docRef = doc(collection(db, "studentObservations"));
  const data = {
    ...obs,
    id: docRef.id,
    createdAt: new Date().toISOString()
  };
  await setDoc(docRef, data);
  return docRef.id;
}

// ============================================================================
// LOCKED RECORDS
// ============================================================================
export async function getLockedRecords(schoolId: string): Promise<LockedRecordDoc[]> {
  const q = query(collection(db, "lockedRecords"), where("schoolId", "==", schoolId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as LockedRecordDoc));
}

// ============================================================================
// AUDIT LOGS
// ============================================================================
export async function getAuditLogs(schoolId: string, maxLimit = 50): Promise<AuditLogDoc[]> {
  const q = query(
    collection(db, "auditLogs"),
    where("schoolId", "==", schoolId),
    limit(maxLimit)
  );
  const snap = await getDocs(q);
  const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogDoc));
  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ============================================================================
// SCHOOL SETTINGS
// ============================================================================
export async function getSchoolSettings(schoolId: string): Promise<SchoolSettingsDoc | null> {
  const docRef = doc(db, "schoolSettings", schoolId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as SchoolSettingsDoc;
}

export async function saveSchoolSettings(settings: SchoolSettingsDoc): Promise<void> {
  const docRef = doc(db, "schoolSettings", settings.schoolId);
  await setDoc(docRef, {
    ...settings,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}
