import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "allied-school-system";

const adminApp = getApps().length === 0 ? initializeApp({ projectId }) : getApp();
const db = getFirestore(adminApp);

const SCHOOL_ID = "allied-school-main";

async function seed() {
  console.log("==================================================");
  console.log("  SEEDING ALLIED SCHOOL FIRESTORE DATABASE        ");
  console.log("==================================================");

  const now = new Date().toISOString();

  // 1. School Document
  console.log("[1/10] Creating School & Settings...");
  await db.collection("schools").doc(SCHOOL_ID).set({
    id: SCHOOL_ID,
    name: "Allied School (Main Campus)",
    code: "ALLIED-01",
    address: "Campus Avenue, Sector F-8/4, Islamabad",
    phone: "+92 51 2854321",
    email: "info@alliedschool.edu",
    principalName: "Prof. Dr. Tariq Mehmood",
    academicYear: "2024-2025",
    logoUrl: "/images/logo.png",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("schoolSettings").doc(SCHOOL_ID).set({
    id: SCHOOL_ID,
    schoolId: SCHOOL_ID,
    schoolName: "Allied School",
    campusName: "Main Campus Islamabad",
    motto: "Excellence in Education, Character in Life",
    address: "Campus Avenue, Sector F-8/4, Islamabad",
    phone: "+92 51 2854321",
    email: "admin@alliedschool.edu",
    website: "https://alliedschool.edu.pk",
    principalName: "Prof. Dr. Tariq Mehmood",
    academicYear: "2024-2025",
    taxRegistration: "NTN-9847291-8",
    gradingScale: [
      { minPercentage: 90, grade: "A+", gpa: 4.0 },
      { minPercentage: 80, grade: "A", gpa: 3.7 },
      { minPercentage: 70, grade: "B+", gpa: 3.3 },
      { minPercentage: 60, grade: "B", gpa: 3.0 },
      { minPercentage: 50, grade: "C", gpa: 2.5 },
      { minPercentage: 40, grade: "D", gpa: 2.0 },
      { minPercentage: 0, grade: "F", gpa: 0.0 },
    ],
    updatedAt: now,
  });

  // 2. Admin User
  console.log("[2/10] Creating Admin User...");
  const adminUid = "admin_allied_001";
  await db.collection("users").doc(adminUid).set({
    uid: adminUid,
    name: "Dr. Tariq Mehmood (Principal)",
    email: "admin@alliedschool.edu",
    role: "ADMIN",
    schoolId: SCHOOL_ID,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });

  // 3. Teachers
  console.log("[3/10] Creating Faculty Teachers...");
  const teachersData = [
    { id: "tch-101", name: "Sir Asif Javed", email: "asif.javed@alliedschool.edu", phone: "+92 301 5551101", dept: "Science & Mathematics", desig: "Senior Master", qual: "M.Sc Mathematics (QAU)", load: 24 },
    { id: "tch-102", name: "Madam Fatima Noor", email: "fatima.noor@alliedschool.edu", phone: "+92 302 5551102", dept: "English Literature", desig: "Head of English", qual: "M.A English (PU)", load: 22 },
    { id: "tch-103", name: "Sir Khurram Shahzad", email: "khurram.shahzad@alliedschool.edu", phone: "+92 303 5551103", dept: "Computer Science", desig: "IT Specialist", qual: "MS Computer Science (NUST)", load: 20 },
    { id: "tch-104", name: "Madam Ayesha Siddiqua", email: "ayesha.siddiqua@alliedschool.edu", phone: "+92 304 5551104", dept: "Physics", desig: "Senior Lecturer", qual: "M.Phil Physics (QAU)", load: 22 },
    { id: "tch-105", name: "Sir Usman Ghani", email: "usman.ghani@alliedschool.edu", phone: "+92 305 5551105", dept: "Chemistry & Biology", desig: "Lab Incharge", qual: "M.Sc Chemistry (PU)", load: 20 },
    { id: "tch-106", name: "Madam Sana Malik", email: "sana.malik@alliedschool.edu", phone: "+92 306 5551106", dept: "Social Studies & Pak Studies", desig: "Subject Specialist", qual: "M.A History (PU)", load: 18 },
    { id: "tch-107", name: "Qari Abdul Rehman", email: "abdul.rehman@alliedschool.edu", phone: "+92 307 5551107", dept: "Islamiat & Arabic", desig: "Senior Qari", qual: "Shahadat-ul-Almiya / M.A Islamic Studies", load: 20 },
    { id: "tch-108", name: "Madam Hina Qureshi", email: "hina.qureshi@alliedschool.edu", phone: "+92 308 5551108", dept: "Urdu Literature", desig: "Senior Mistress", qual: "M.A Urdu (KU)", load: 20 },
  ];

  for (const t of teachersData) {
    const userUid = `user_${t.id}`;
    await db.collection("users").doc(userUid).set({
      uid: userUid,
      name: t.name,
      email: t.email,
      role: "TEACHER",
      schoolId: SCHOOL_ID,
      teacherId: t.id,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("teachers").doc(t.id).set({
      id: t.id,
      schoolId: SCHOOL_ID,
      userId: userUid,
      employeeId: t.id.toUpperCase(),
      fullName: t.name,
      email: t.email,
      phone: t.phone,
      department: t.dept,
      designation: t.desig,
      qualification: t.qual,
      joiningDate: "2021-08-15",
      status: "ACTIVE",
      assignedClassIds: ["cls-10a", "cls-10b", "cls-9a"],
      assignedSubjectIds: [],
      weeklyLoad: t.load,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Demo teacher account
  await db.collection("users").doc("teacher_demo_uid").set({
    uid: "teacher_demo_uid",
    name: "Madam Fatima Noor",
    email: "teacher@alliedschool.edu",
    role: "TEACHER",
    schoolId: SCHOOL_ID,
    teacherId: "tch-102",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });

  // 4. Classes (Cohorts)
  console.log("[4/10] Creating Class Cohorts...");
  const classesData = [
    { id: "cls-10a", name: "Class 10", section: "A", level: 10, cap: 40, room: "Room 101", teacherId: "tch-101", teacherName: "Sir Asif Javed" },
    { id: "cls-10b", name: "Class 10", section: "B", level: 10, cap: 40, room: "Room 102", teacherId: "tch-104", teacherName: "Madam Ayesha Siddiqua" },
    { id: "cls-9a",  name: "Class 9",  section: "A", level: 9,  cap: 40, room: "Room 103", teacherId: "tch-102", teacherName: "Madam Fatima Noor" },
    { id: "cls-9b",  name: "Class 9",  section: "B", level: 9,  cap: 40, room: "Room 104", teacherId: "tch-105", teacherName: "Sir Usman Ghani" },
    { id: "cls-8a",  name: "Class 8",  section: "A", level: 8,  cap: 35, room: "Room 201", teacherId: "tch-103", teacherName: "Sir Khurram Shahzad" },
    { id: "cls-8b",  name: "Class 8",  section: "B", level: 8,  cap: 35, room: "Room 202", teacherId: "tch-106", teacherName: "Madam Sana Malik" },
    { id: "cls-7a",  name: "Class 7",  section: "A", level: 7,  cap: 35, room: "Room 203", teacherId: "tch-107", teacherName: "Qari Abdul Rehman" },
    { id: "cls-7b",  name: "Class 7",  section: "B", level: 7,  cap: 35, room: "Room 204", teacherId: "tch-108", teacherName: "Madam Hina Qureshi" },
    { id: "cls-6a",  name: "Class 6",  section: "A", level: 6,  cap: 35, room: "Room 301", teacherId: "tch-101", teacherName: "Sir Asif Javed" },
    { id: "cls-6b",  name: "Class 6",  section: "B", level: 6,  cap: 35, room: "Room 302", teacherId: "tch-102", teacherName: "Madam Fatima Noor" },
  ];

  for (const c of classesData) {
    await db.collection("classes").doc(c.id).set({
      id: c.id,
      schoolId: SCHOOL_ID,
      name: c.name,
      section: c.section,
      numericLevel: c.level,
      capacity: c.cap,
      roomNo: c.room,
      classTeacherId: c.teacherId,
      classTeacherName: c.teacherName,
      academicYear: "2024-2025",
      createdAt: now,
      updatedAt: now,
    });
  }

  // 5. Subjects
  console.log("[5/10] Creating Curriculum Subjects...");
  const baseSubjects = [
    { name: "Mathematics", code: "MTH", teacherId: "tch-101", teacherName: "Sir Asif Javed", credits: 4 },
    { name: "English Literature", code: "ENG", teacherId: "tch-102", teacherName: "Madam Fatima Noor", credits: 4 },
    { name: "Physics", code: "PHY", teacherId: "tch-104", teacherName: "Madam Ayesha Siddiqua", credits: 3 },
    { name: "Chemistry", code: "CHM", teacherId: "tch-105", teacherName: "Sir Usman Ghani", credits: 3 },
    { name: "Computer Science", code: "CSC", teacherId: "tch-103", teacherName: "Sir Khurram Shahzad", credits: 3 },
    { name: "Pakistan Studies", code: "PST", teacherId: "tch-106", teacherName: "Madam Sana Malik", credits: 2 },
    { name: "Islamiat", code: "ISL", teacherId: "tch-107", teacherName: "Qari Abdul Rehman", credits: 2 },
    { name: "Urdu", code: "URD", teacherId: "tch-108", teacherName: "Madam Hina Qureshi", credits: 3 },
  ];

  for (const c of classesData) {
    for (const sub of baseSubjects) {
      const subId = `sub-${c.id}-${sub.code.toLowerCase()}`;
      await db.collection("subjects").doc(subId).set({
        id: subId,
        schoolId: SCHOOL_ID,
        classId: c.id,
        className: `${c.name}-${c.section}`,
        name: sub.name,
        code: `${sub.code}-${c.level}`,
        teacherId: sub.teacherId,
        teacherName: sub.teacherName,
        credits: sub.credits,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 6. Students
  console.log("[6/10] Enrolling Students & Generating Dossiers...");
  const firstNames = ["Zainab", "Muhammad", "Ahmad", "Ayesha", "Ali", "Fatima", "Hamza", "Bilal", "Maryam", "Usman", "Sara", "Hassan", "Khadija", "Omer", "Hiba", "Abdullah", "Ibrahim", "Zoya", "Saad", "Minahil"];
  const lastNames = ["Khan", "Malik", "Ahmed", "Chaudhry", "Raza", "Sheikh", "Siddiqui", "Qureshi", "Butt", "Javed", "Tariq", "Hussain", "Farooq", "Akhtar", "Zubair"];

  const studentsList = [];
  let stdCounter = 1;

  for (const cls of classesData) {
    const studentCount = cls.id === "cls-10a" ? 10 : 4;
    for (let i = 0; i < studentCount; i++) {
      const fName = firstNames[(stdCounter + i) % firstNames.length];
      const lName = lastNames[(stdCounter * 3 + i) % lastNames.length];
      const fullName = `${fName} ${lName}`;
      const admissionNo = `STD-2024-${String(stdCounter).padStart(3, "0")}`;
      const stdId = `std-${stdCounter}`;
      const rollNo = String(i + 1).padStart(2, "0");
      const userUid = stdId === "std-1" ? "student_demo_uid" : `user_${stdId}`;
      const email = stdId === "std-1" ? "student@alliedschool.edu" : `student.${stdCounter}@alliedschool.edu`;

      const stdDoc = {
        id: stdId,
        schoolId: SCHOOL_ID,
        userId: userUid,
        admissionNo,
        fullName,
        fatherName: `Muhammad ${lName}`,
        gender: i % 2 === 0 ? "FEMALE" : "MALE" as const,
        dob: "2009-04-12",
        phone: `+92 300 999${String(stdCounter).padStart(4, "0")}`,
        address: `House #${stdCounter + 12}, Street 4, Islamabad`,
        classId: cls.id,
        className: `${cls.name}-${cls.section}`,
        section: cls.section,
        rollNo,
        status: "ACTIVE" as const,
        guardianName: `Muhammad ${lName}`,
        guardianPhone: `+92 300 999${String(stdCounter).padStart(4, "0")}`,
        guardianRelation: "Father",
        bloodGroup: ["A+", "B+", "O+", "AB+"][i % 4],
        monthlyFee: 6000,
        discount: i % 5 === 0 ? 1000 : 0,
        createdAt: now,
        updatedAt: now,
      };

      await db.collection("students").doc(stdId).set(stdDoc);
      studentsList.push(stdDoc);

      // User account
      await db.collection("users").doc(userUid).set({
        uid: userUid,
        name: fullName,
        email: email,
        role: "STUDENT",
        schoolId: SCHOOL_ID,
        studentId: stdId,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });

      stdCounter++;
    }
  }

  // 7. Attendance Records (Last 15 days)
  console.log("[7/10] Recording Real Attendance Register...");
  const sampleDates = [
    "2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10",
    "2025-01-13", "2025-01-14", "2025-01-15", "2025-01-16", "2025-01-17",
    "2025-01-20", "2025-01-21", "2025-01-22", "2025-01-23", "2025-01-24"
  ];

  for (const s of studentsList.slice(0, 20)) {
    for (let dIdx = 0; dIdx < sampleDates.length; dIdx++) {
      const dt = sampleDates[dIdx];
      const rand = (parseInt(s.id.replace("std-", "")) + dIdx) % 10;
      let status: "PRESENT" | "LATE" | "ABSENT" | "LEAVE" = "PRESENT";
      if (rand === 8) status = "LATE";
      else if (rand === 9) status = dIdx % 2 === 0 ? "ABSENT" : "LEAVE";

      const attId = `${SCHOOL_ID}_${s.classId}_${s.id}_${dt}`;
      await db.collection("attendance").doc(attId).set({
        id: attId,
        schoolId: SCHOOL_ID,
        classId: s.classId,
        studentId: s.id,
        studentName: s.fullName,
        rollNo: s.rollNo,
        date: dt,
        status: status,
        remarks: status === "LEAVE" ? "Medical Leave approved by parent" : "",
        recordedBy: "admin_allied_001",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 8. Fee Challans & Payments
  console.log("[8/10] Generating Fee Challans & Recording Cash Receipts...");
  let challanCounter = 1001;
  for (const s of studentsList) {
    const tuition = s.monthlyFee - s.discount;
    const totalExpected = tuition + 500; // 500 lab/utility
    const isPaid = parseInt(s.id.replace("std-", "")) % 6 !== 0;
    const isPartial = parseInt(s.id.replace("std-", "")) % 6 === 3;
    const paidAmount = isPaid ? totalExpected : isPartial ? 3000 : 0;
    const balanceAmount = totalExpected - paidAmount;
    const status = balanceAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "PENDING";

    const chId = `ch-${challanCounter}`;
    await db.collection("feeChallans").doc(chId).set({
      id: chId,
      schoolId: SCHOOL_ID,
      studentId: s.id,
      studentName: s.fullName,
      admissionNo: s.admissionNo,
      classId: s.classId,
      className: s.className,
      challanNo: `CH-2025-${challanCounter}`,
      month: "January",
      year: 2025,
      issueDate: "2025-01-01",
      dueDate: "2025-01-15",
      tuitionFee: tuition,
      admissionFee: 0,
      examFee: 500,
      otherFee: 0,
      discount: s.discount,
      totalExpected: totalExpected,
      paidAmount: paidAmount,
      balanceAmount: balanceAmount,
      status: status,
      createdAt: now,
      updatedAt: now,
    });

    if (paidAmount > 0) {
      const payId = `pay-${challanCounter}`;
      await db.collection("payments").doc(payId).set({
        id: payId,
        schoolId: SCHOOL_ID,
        challanId: chId,
        studentId: s.id,
        studentName: s.fullName,
        receiptNo: `REC-2025-${challanCounter}`,
        amount: paidAmount,
        paymentDate: "2025-01-10",
        paymentMode: "CASH",
        transactionRef: "CASH-COUNTER-01",
        notes: "Fee paid on time at campus finance desk",
        collectedBy: "admin_allied_001",
        createdAt: now,
      });
    }

    challanCounter++;
  }

  // 9. Exams & Gradebook Results
  console.log("[9/10] Creating Mid-Term Exams & Finalizing Gradebook Marks...");
  const examId = "exam-midterm-2024";
  await db.collection("exams").doc(examId).set({
    id: examId,
    schoolId: SCHOOL_ID,
    name: "Mid-Term Examination 2024-25",
    term: "Mid-Term",
    session: "2024-2025",
    startDate: "2024-12-10",
    endDate: "2024-12-22",
    status: "PUBLISHED",
    createdAt: now,
    updatedAt: now,
  });

  const class10Students = studentsList.filter((s) => s.classId === "cls-10a");
  const subjects10a = baseSubjects.map((sub) => ({
    id: `sub-cls-10a-${sub.code.toLowerCase()}`,
    name: sub.name,
    code: `${sub.code}-10`
  }));

  for (const s of class10Students) {
    for (const sub of subjects10a) {
      const randSeed = (parseInt(s.id.replace("std-", "")) * 7 + sub.name.length * 3) % 40;
      const obtained = 60 + randSeed; // Marks between 60 and 99
      const total = 100;
      const percentage = (obtained / total) * 100;
      let grade = "A";
      let gpa = 3.7;
      if (percentage >= 90) { grade = "A+"; gpa = 4.0; }
      else if (percentage >= 80) { grade = "A"; gpa = 3.7; }
      else if (percentage >= 70) { grade = "B+"; gpa = 3.3; }
      else if (percentage >= 60) { grade = "B"; gpa = 3.0; }

      const resId = `${SCHOOL_ID}_${examId}_${s.id}_${sub.id}`;
      await db.collection("examResults").doc(resId).set({
        id: resId,
        schoolId: SCHOOL_ID,
        examId: examId,
        studentId: s.id,
        studentName: s.fullName,
        rollNo: s.rollNo,
        classId: s.classId,
        subjectId: sub.id,
        subjectName: sub.name,
        obtainedMarks: obtained,
        totalMarks: total,
        percentage: percentage,
        grade: grade,
        gpa: gpa,
        status: "PASS",
        remarks: "Excellent conceptual understanding and analytical presentation.",
        evaluatedBy: "admin_allied_001",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 10. Student Observations, Locked Records & Audit Trail
  console.log("[10/10] Writing Teacher Observations & Audit Logs...");
  const sampleStudent = studentsList[0]; // Zainab Khan
  await db.collection("studentObservations").doc("obs-001").set({
    id: "obs-001",
    schoolId: SCHOOL_ID,
    studentId: sampleStudent.id,
    studentName: sampleStudent.fullName,
    teacherId: "tch-102",
    teacherName: "Madam Fatima Noor",
    category: "ACADEMIC",
    note: "Demonstrates exceptional articulation in English Literature discussions and consistently submits assignments with distinction.",
    sentiment: "POSITIVE",
    createdAt: now,
  });

  await db.collection("studentObservations").doc("obs-002").set({
    id: "obs-002",
    schoolId: SCHOOL_ID,
    studentId: sampleStudent.id,
    studentName: sampleStudent.fullName,
    teacherId: "tch-101",
    teacherName: "Sir Asif Javed",
    category: "LEADERSHIP",
    note: "Elected as Class Representative for Class 10-A. Actively coordinates peer study groups for Mathematics.",
    sentiment: "POSITIVE",
    createdAt: now,
  });

  await db.collection("lockedRecords").doc("rec-cert-001").set({
    id: "rec-cert-001",
    schoolId: SCHOOL_ID,
    studentId: sampleStudent.id,
    studentName: sampleStudent.fullName,
    admissionNo: sampleStudent.admissionNo,
    type: "TRANSCRIPT",
    academicYear: "2024-2025",
    gpa: 3.88,
    percentage: 89.4,
    remarks: "Certified Official Mid-Term 2024-25 Academic Transcript signed by Controller of Examinations.",
    sealedAt: now,
    sealedBy: "Dr. Tariq Mehmood (Principal)",
  });

  const auditEvents = [
    { action: "SCHOOL_SETUP", entity: "SCHOOL", entityId: SCHOOL_ID, details: "Allied School Main Campus profile and academic parameters initialized." },
    { action: "FACULTY_ONBOARD", entity: "TEACHER", entityId: "tch-101", details: "8 senior faculty members registered with department allocations." },
    { action: "COHORTS_CONFIGURED", entity: "CLASS", entityId: "cls-10a", details: "10 Academic cohorts created with assigned incharge teachers." },
    { action: "STUDENT_ENROLLMENT", entity: "STUDENT", entityId: sampleStudent.id, details: `Student ${sampleStudent.fullName} (${sampleStudent.admissionNo}) enrolled in Class 10-A.` },
    { action: "FEE_CHALLANS_ISSUED", entity: "FEE", entityId: "ch-1001", details: "January 2025 billing cycle challans issued across all cohorts." },
    { action: "EXAM_PUBLISHED", entity: "EXAM", entityId: examId, details: "Mid-Term Examination 2024-25 finalized and result gazette published." },
  ];

  for (let i = 0; i < auditEvents.length; i++) {
    const ae = auditEvents[i];
    const logId = `log-${i + 1}`;
    await db.collection("auditLogs").doc(logId).set({
      id: logId,
      schoolId: SCHOOL_ID,
      userId: adminUid,
      userEmail: "admin@alliedschool.edu",
      role: "ADMIN",
      action: ae.action,
      entity: ae.entity,
      entityId: ae.entityId,
      details: ae.details,
      timestamp: new Date(Date.now() - (6 - i) * 3600000).toISOString(),
    });
  }

  console.log("==================================================");
  console.log("  FIRESTORE SEEDING COMPLETED SUCCESSFULLY!       ");
  console.log("==================================================");
}

seed()
  .catch((e) => {
    console.error("Firebase seeding error:", e);
    process.exit(1);
  });
