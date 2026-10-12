/**
 * TEST-ONLY seed for the Firestore emulator: a realistic school so read costs can be measured.
 * Never run against a real project (the quota test refuses to start without
 * FIRESTORE_EMULATOR_HOST and a demo- project id).
 *
 * Shape (active session 2026-2027):
 *  - 10 classes x 30 students = 300 active students, 20 teachers, 80 subjects
 *  - a third of students/challans/attendance are "legacy" records with no academicYear stamp
 *    (written before session stamping existed); they follow their class's session
 *  - 3 months of challans (900), 300 payments, 30 school days of daily attendance (9,000)
 *  - previous session 2025-2026: 2 classes, 60 alumni, 600 challans, 2,400 attendance records
 *  - 1 published exam with 2,400 results, 300 timetable slots, 200 audit logs, 10 announcements
 *  - one parent linked to two children
 */
import bcrypt from "bcryptjs";
import type { Firestore } from "firebase-admin/firestore";

export const SCHOOL = "demo-quota-school";
export const ACTIVE_YEAR = "2026-2027";
export const OLD_YEAR = "2025-2026";
export const PASSWORD = "QuotaTest#2026";

export const ids = {
  admin: { uid: "u-admin", email: "admin@quota.test" },
  teacher: { uid: "u-tch-0", email: "teacher0@quota.test", teacherId: "tch-0" },
  student: { uid: "u-std-0", email: "student0@quota.test", studentId: "std-0" },
  parent: { uid: "u-parent", email: "parent@quota.test", studentIds: ["std-0", "std-1"] },
  classIds: Array.from({ length: 10 }, (_, i) => `cls-${i}`),
  oldClassIds: ["cls-old-0", "cls-old-1"],
};

const STATUSES = ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT", "LEAVE", "PRESENT"] as const;

/** The last `n` school days (Mon–Sat) up to and including `end`. */
export function schoolDays(end: Date, n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (out.length < n) {
    if (d.getUTCDay() !== 0) out.push(d.toISOString().split("T")[0]);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** Empties the emulator database (emulator-only REST endpoint) so every run starts clean. */
async function wipeEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  if (!host || !project || !project.startsWith("demo-")) throw new Error("wipeEmulator: emulator + demo- project required");
  const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`wipeEmulator failed: HTTP ${res.status}`);
}

export async function seedQuotaSchool(db: Firestore): Promise<{ attendanceDays: string[] }> {
  await wipeEmulator();
  const now = new Date().toISOString();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const writes: Array<[string, string, Record<string, unknown>]> = [];
  const put = (col: string, id: string, data: Record<string, unknown>) => writes.push([col, id, data]);

  put("schools", SCHOOL, { id: SCHOOL, name: "Quota Test School", academicYear: ACTIVE_YEAR, createdAt: now, updatedAt: now });
  put("schoolSettings", SCHOOL, {
    id: SCHOOL, schoolId: SCHOOL, schoolName: "Quota Test School", campusName: "Main", motto: "", address: "",
    phone: "", email: "admin@quota.test", principalName: "P", academicYear: ACTIVE_YEAR,
    gradingScale: [
      { minPercentage: 80, grade: "A+", gpa: 4 }, { minPercentage: 70, grade: "A", gpa: 3.7 },
      { minPercentage: 60, grade: "B", gpa: 3 }, { minPercentage: 50, grade: "C", gpa: 2.5 },
      { minPercentage: 40, grade: "D", gpa: 2 }, { minPercentage: 0, grade: "F", gpa: 0 },
    ],
    updatedAt: now,
  });

  put("users", ids.admin.uid, {
    uid: ids.admin.uid, email: ids.admin.email, name: "Admin", role: "ADMIN", schoolId: SCHOOL,
    status: "ACTIVE", passwordHash: hash, createdAt: now, updatedAt: now,
  });

  for (let t = 0; t < 20; t++) {
    const id = `tch-${t}`;
    put("teachers", id, {
      id, schoolId: SCHOOL, userId: `u-tch-${t}`, employeeId: `E${t}`, fullName: `Teacher ${String(t).padStart(2, "0")}`,
      email: `teacher${t}@quota.test`, phone: "", designation: "Teacher", department: "Science", qualification: "MSc",
      status: "ACTIVE", assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 20, createdAt: now, updatedAt: now,
    });
    put("users", `u-tch-${t}`, {
      uid: `u-tch-${t}`, email: `teacher${t}@quota.test`, name: `Teacher ${t}`, role: "TEACHER", schoolId: SCHOOL,
      teacherId: id, status: "ACTIVE", passwordHash: hash, createdAt: now, updatedAt: now,
    });
  }

  const allClasses = [
    ...ids.classIds.map((id, i) => ({ id, year: ACTIVE_YEAR, i })),
    ...ids.oldClassIds.map((id, i) => ({ id, year: OLD_YEAR, i })),
  ];
  for (const c of allClasses) {
    put("classes", c.id, {
      id: c.id, schoolId: SCHOOL, name: `Grade ${c.i + 1}${c.year === OLD_YEAR ? " (old)" : ""}`, section: "A",
      numericLevel: c.i + 1, capacity: 40, roomNo: `R${c.i}`, classTeacherId: `tch-${c.i}`,
      classTeacherName: `Teacher ${c.i}`, academicYear: c.year, createdAt: now, updatedAt: now,
    });
  }
  for (const [ci, classId] of ids.classIds.entries()) {
    for (let s = 0; s < 8; s++) {
      const id = `sub-${ci}-${s}`;
      put("subjects", id, {
        id, schoolId: SCHOOL, classId, name: `Subject ${s}`, code: `S${s}`, teacherId: `tch-${(ci + s) % 20}`,
        teacherName: `Teacher ${(ci + s) % 20}`, credits: 1, academicYear: ACTIVE_YEAR, createdAt: now, updatedAt: now,
      });
    }
  }

  // Active students: std-0 .. std-299; every third one is a legacy (unstamped) record.
  const students: { id: string; classId: string; legacy: boolean }[] = [];
  for (let n = 0; n < 300; n++) {
    const classId = ids.classIds[n % 10];
    const id = `std-${n}`;
    const legacy = n % 3 === 2;
    students.push({ id, classId, legacy });
    put("students", id, {
      id, schoolId: SCHOOL, userId: `u-std-${n}`, admissionNo: `A${1000 + n}`, fullName: `Student ${String(n).padStart(3, "0")}`,
      fatherName: "F", gender: n % 2 ? "FEMALE" : "MALE", classId, className: `Grade ${(n % 10) + 1}`, section: "A",
      rollNo: String(n), status: n % 50 === 49 ? "INACTIVE" : "ACTIVE", guardianName: "G", guardianPhone: "", guardianRelation: "Father",
      monthlyFee: 3000, discount: 0, ...(legacy ? {} : { academicYear: ACTIVE_YEAR }),
      ...(ids.parent.studentIds.includes(id) ? { guardianEmail: ids.parent.email, parentUserIds: [ids.parent.uid] } : {}),
      createdAt: now, updatedAt: now,
    });
    put("users", `u-std-${n}`, {
      uid: `u-std-${n}`, email: `student${n}@quota.test`, name: `Student ${n}`, role: "STUDENT", schoolId: SCHOOL,
      studentId: id, status: "ACTIVE", passwordHash: hash, createdAt: now, updatedAt: now,
    });
  }
  for (let n = 0; n < 60; n++) {
    const id = `std-old-${n}`;
    put("students", id, {
      id, schoolId: SCHOOL, admissionNo: `O${n}`, fullName: `Alumnus ${n}`, fatherName: "F", gender: "MALE",
      classId: ids.oldClassIds[n % 2], section: "A", rollNo: String(n), status: "ALUMNI", guardianName: "G",
      guardianPhone: "", guardianRelation: "Father", monthlyFee: 2500, discount: 0, academicYear: OLD_YEAR,
      createdAt: now, updatedAt: now,
    });
  }
  put("users", ids.parent.uid, {
    uid: ids.parent.uid, email: ids.parent.email, name: "Parent", role: "PARENT", schoolId: SCHOOL,
    studentIds: ids.parent.studentIds, status: "ACTIVE", passwordHash: hash, createdAt: now, updatedAt: now,
  });

  // Challans: Aug/Sep/Oct 2026 for active students, 10 months for alumni.
  const months = ["August", "September", "October"];
  for (const st of students) {
    for (const [mi, month] of months.entries()) {
      const id = `ch-${st.id}-${mi}`;
      const paid = mi < 2 ? 3000 : (Number(st.id.split("-")[1]) % 4 === 0 ? 1500 : 0);
      put("feeChallans", id, {
        id, schoolId: SCHOOL, studentId: st.id, studentName: `Student ${st.id}`, admissionNo: "A", classId: st.classId,
        challanNo: `CH-${st.id}-${mi}`, month, year: 2026, issueDate: "2026-08-01", dueDate: `2026-${String(8 + mi).padStart(2, "0")}-10`,
        tuitionFee: 3000, admissionFee: 0, examFee: 0, otherFee: 0, discount: 0, totalExpected: 3000, paidAmount: paid,
        balanceAmount: 3000 - paid, status: paid === 3000 ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING",
        ...(st.legacy ? {} : { academicYear: ACTIVE_YEAR }), createdAt: now, updatedAt: now,
      });
    }
    put("payments", `pay-${st.id}`, {
      id: `pay-${st.id}`, schoolId: SCHOOL, challanId: `ch-${st.id}-0`, studentId: st.id, receiptNo: `R-${st.id}`,
      amount: 3000, paymentDate: `2026-08-${String(1 + (Number(st.id.split("-")[1]) % 28)).padStart(2, "0")}`,
      paymentMode: "CASH", collectedBy: ids.admin.uid, ...(st.legacy ? {} : { academicYear: ACTIVE_YEAR }),
      createdAt: now,
    });
  }
  for (let n = 0; n < 60; n++) {
    for (let m = 0; m < 10; m++) {
      const id = `ch-old-${n}-${m}`;
      put("feeChallans", id, {
        id, schoolId: SCHOOL, studentId: `std-old-${n}`, classId: ids.oldClassIds[n % 2], challanNo: `CHO-${n}-${m}`,
        month: "March", year: 2026, issueDate: "2026-03-01", dueDate: "2026-03-10", tuitionFee: 2500, admissionFee: 0,
        examFee: 0, otherFee: 0, discount: 0, totalExpected: 2500, paidAmount: 2500, balanceAmount: 0, status: "PAID",
        academicYear: OLD_YEAR, createdAt: now, updatedAt: now,
      });
    }
  }

  // Attendance: 30 school days for active classes (daily register), 40 old-session days.
  const attendanceDays = schoolDays(new Date(), 30);
  for (const [di, date] of attendanceDays.entries()) {
    for (const [si, st] of students.entries()) {
      const id = `${SCHOOL}_${st.classId}_${st.id}_${date}`;
      put("attendance", id, {
        id, schoolId: SCHOOL, classId: st.classId, studentId: st.id, date, status: STATUSES[(si + di) % STATUSES.length],
        remarks: "", recordedBy: `u-tch-0`, ...(st.legacy ? {} : { academicYear: ACTIVE_YEAR }),
        createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`,
      });
    }
  }
  for (const date of schoolDays(new Date(Date.UTC(2026, 2, 31)), 40)) {
    for (let n = 0; n < 60; n++) {
      const classId = ids.oldClassIds[n % 2];
      const id = `${SCHOOL}_${classId}_std-old-${n}_${date}`;
      put("attendance", id, {
        id, schoolId: SCHOOL, classId, studentId: `std-old-${n}`, date, status: "PRESENT", recordedBy: "u-tch-0",
        academicYear: OLD_YEAR, createdAt: now, updatedAt: now,
      });
    }
  }

  // One published exam: 300 students x 8 subjects.
  put("exams", "ex-1", {
    id: "ex-1", schoolId: SCHOOL, name: "Mid Term", term: "Mid", session: ACTIVE_YEAR, startDate: "2026-10-01",
    endDate: "2026-10-05", status: "PUBLISHED", createdAt: now, updatedAt: now,
  });
  put("exams", "ex-old", {
    id: "ex-old", schoolId: SCHOOL, name: "Final", term: "Final", session: OLD_YEAR, startDate: "2026-03-01",
    endDate: "2026-03-05", status: "PUBLISHED", createdAt: now, updatedAt: now,
  });
  const GRADES = ["A+", "A", "B", "C", "D", "F"];
  for (const [ci, classId] of ids.classIds.entries()) {
    for (let s = 0; s < 8; s++) {
      put("examSchedules", `esch-${ci}-${s}`, {
        id: `esch-${ci}-${s}`, schoolId: SCHOOL, examId: "ex-1", classId, subjectId: `sub-${ci}-${s}`, subjectName: `Subject ${s}`,
        examDate: "2026-10-02", startTime: "09:00", endTime: "11:00", totalMarks: 100, passingMarks: 40, createdAt: now,
      });
    }
  }
  for (const [si, st] of students.entries()) {
    const ci = ids.classIds.indexOf(st.classId);
    for (let s = 0; s < 8; s++) {
      const id = `${SCHOOL}_ex-1_${st.id}_sub-${ci}-${s}`;
      const grade = GRADES[(si + s) % GRADES.length];
      put("examResults", id, {
        id, schoolId: SCHOOL, examId: "ex-1", studentId: st.id, classId: st.classId, subjectId: `sub-${ci}-${s}`,
        subjectName: `Subject ${s}`, obtainedMarks: 60, totalMarks: 100, percentage: 60, grade, gpa: 3,
        status: grade === "F" ? "FAIL" : "PASS", evaluatedBy: "u-tch-0", createdAt: now, updatedAt: now,
        ...(st.legacy ? {} : { academicYear: ACTIVE_YEAR }),
      });
    }
  }

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const [ci, classId] of ids.classIds.entries()) {
    for (let p = 0; p < 30; p++) {
      const id = `tt-${ci}-${p}`;
      put("timetables", id, {
        id, schoolId: SCHOOL, teacherId: `tch-${(ci + p) % 20}`, classId, className: `Grade ${ci + 1}`,
        subjectId: `sub-${ci}-${p % 8}`, subjectName: `Subject ${p % 8}`, dayOfWeek: DAYS[p % 6], periodName: `Period ${p % 5}`,
        startTime: `0${8 + (p % 5)}:00 AM`, endTime: `0${8 + (p % 5)}:45 AM`, academicYear: ACTIVE_YEAR, createdAt: now, updatedAt: now,
      });
    }
  }
  for (let n = 0; n < 200; n++) {
    put("auditLogs", `log-${n}`, {
      id: `log-${n}`, schoolId: SCHOOL, userId: ids.admin.uid, userEmail: ids.admin.email, role: "ADMIN",
      action: "UPDATE", entity: "STUDENT", entityId: "x", details: "seed",
      timestamp: new Date(Date.UTC(2026, 8, 1) + n * 3600_000).toISOString(),
    });
  }
  for (let n = 0; n < 10; n++) {
    put("announcements", `ann-${n}`, {
      id: `ann-${n}`, schoolId: SCHOOL, title: `Notice ${n}`, message: "m", audience: "EVERYONE", status: "PUBLISHED",
      publishedAt: now, createdBy: ids.admin.uid, createdAt: now, updatedAt: now,
    });
  }

  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const [col, id, data] of writes.slice(i, i + 450)) batch.set(db.collection(col).doc(id), data);
    await batch.commit();
  }
  return { attendanceDays };
}
