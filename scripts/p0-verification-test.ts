import {
  recordFeePaymentServer,
  saveFeeChallanServer,
  getFeeChallanByIdServer,
  saveStudentServer,
  getStudentByIdServer,
  createUserServer,
  getAnnouncementsServer,
  saveAnnouncementServer,
  saveTeacherServer,
  getTeacherByIdServer,
  saveClassServer,
  getClassByIdServer,
  getClassesServer,
  saveSubjectServer,
  getSubjectByIdServer,
  getSubjectsServer,
  deleteSubjectServer,
  deleteClassServer,
  getUserByEmailServer,
  updateUserServer,
} from "../src/lib/firebase/server-db";
import { FeeChallanDoc, StudentDoc, PaymentDoc, AnnouncementDoc, UserProfile, TeacherDoc, ClassDoc, SubjectDoc } from "../src/lib/firebase/types";
import { assertParentOwnsStudent, getLinkedChildrenForParent } from "../src/lib/parent-access";
import { announcementVisibleToRole } from "../src/lib/announcements-visibility";
import { validateDateString, isDateBefore } from "../src/lib/date-utils";
import {
  createPasswordResetTokenServer,
  verifyPasswordResetTokenServer,
} from "../src/lib/firebase/server-auth";

async function runVerification() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: P0 PRODUCTION FIXES");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${testName}`);
      process.exitCode = 1;
    }
  }

  // ----------------------------------------------------
  // TEST 1: Cross-School Fee Isolation (P0-1)
  // ----------------------------------------------------
  const schoolA = "school-alpha-001";
  const schoolB = "school-beta-002";
  const challanSchoolB: FeeChallanDoc = {
    id: "ch-school-b-999",
    schoolId: schoolB,
    studentId: "std-beta-1",
    studentName: "Beta Student",
    admissionNo: "STD-B-001",
    classId: "cls-1",
    className: "Class 10-A",
    challanNo: "CH-B-999",
    month: "September",
    year: 2024,
    issueDate: "2024-09-01",
    dueDate: "2024-09-15",
    tuitionFee: 5000,
    admissionFee: 0,
    examFee: 0,
    otherFee: 0,
    discount: 0,
    totalExpected: 5000,
    paidAmount: 0,
    balanceAmount: 5000,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveFeeChallanServer(challanSchoolB);

  // Attempt to retrieve School B's challan from School A context
  const retrievedCrossSchool = await getFeeChallanByIdServer(schoolA, "ch-school-b-999");
  assert(retrievedCrossSchool === null, "Cross-school challan lookup returns null (P0-1 Isolation)");

  // Attempt to pay School B's challan using School A's context
  let crossSchoolPaymentBlocked = false;
  try {
    await recordFeePaymentServer({
      id: `pmt-${Date.now()}-test1`,
      schoolId: schoolA,
      challanId: "ch-school-b-999",
      studentId: "placeholder",
      receiptNo: "REC-TEST1",
      amount: 2500,
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMode: "CASH",
      notes: "Hacker try",
      collectedBy: "Admin A",
      createdAt: new Date().toISOString(),
    } as PaymentDoc);
  } catch (err: any) {
    if (err.message.includes("different institution") || err.message.includes("Unauthorized")) {
      crossSchoolPaymentBlocked = true;
    }
  }
  assert(crossSchoolPaymentBlocked, "Cross-school fee payment transaction blocked with tenant isolation error (P0-1)");

  // ----------------------------------------------------
  // TEST 2: Payment studentId Derived from Challan (P0-2)
  // ----------------------------------------------------
  const paymentRecord = await recordFeePaymentServer({
    id: `pmt-${Date.now()}-test2`,
    schoolId: schoolB,
    challanId: "ch-school-b-999",
    studentId: "placeholder",
    receiptNo: "REC-TEST2",
    amount: 2000,
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMode: "CASH",
    notes: "Valid counter payment",
    collectedBy: "Cashier B",
    createdAt: new Date().toISOString(),
  } as PaymentDoc);
  assert(
    paymentRecord.studentId === "std-beta-1",
    `Payment studentId strictly equals target challan studentId: "${paymentRecord.studentId}" (P0-2)`
  );

  // ----------------------------------------------------
  // TEST 3: Payment Balance and Status Atomicity (P0-7)
  // ----------------------------------------------------
  const updatedChallan = await getFeeChallanByIdServer(schoolB, "ch-school-b-999");
  assert(
    updatedChallan !== null &&
    updatedChallan.paidAmount === 2000 &&
    updatedChallan.balanceAmount === 3000 &&
    updatedChallan.status === "PARTIAL",
    "Partial fee payment updates balance and sets status to PARTIAL (P0-7)"
  );

  // Complete the payment
  await recordFeePaymentServer({
    id: `pmt-${Date.now()}-test3`,
    schoolId: schoolB,
    challanId: "ch-school-b-999",
    studentId: "placeholder",
    receiptNo: "REC-TEST3",
    amount: 3000,
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMode: "CASH",
    notes: "Balance settlement",
    collectedBy: "Cashier B",
    createdAt: new Date().toISOString(),
  } as PaymentDoc);
  const settledChallan = await getFeeChallanByIdServer(schoolB, "ch-school-b-999");
  assert(
    settledChallan !== null &&
    settledChallan.paidAmount === 5000 &&
    settledChallan.balanceAmount === 0 &&
    settledChallan.status === "PAID",
    "Full fee payment clears balance and sets status to PAID (P0-7)"
  );

  // ----------------------------------------------------
  // TEST 4: Student and Teacher Isolation
  // ----------------------------------------------------
  const testStudent: StudentDoc = {
    id: "std-test-isolation-1",
    schoolId: schoolA,
    admissionNo: "STD-A-101",
    fullName: "Alpha Student",
    fatherName: "Father Alpha",
    gender: "MALE",
    classId: "cls-a",
    className: "Class 10",
    section: "A",
    rollNo: "101",
    status: "ACTIVE",
    guardianName: "Father Alpha",
    guardianPhone: "03001234567",
    guardianRelation: "Father",
    monthlyFee: 5000,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStudentServer(testStudent);

  const crossSchoolStudentLookup = await getStudentByIdServer(schoolB, "std-test-isolation-1");
  assert(crossSchoolStudentLookup === null, "Cross-school student lookup returns null (Multi-tenant Student Isolation)");

  // ----------------------------------------------------
  // TEST 5: Parent Student Relationship & Cross-Parent Isolation (Phase 3)
  // ----------------------------------------------------
  const parentAUser: UserProfile = {
    uid: "usr-parent-alpha-1",
    email: "parent.alpha@example.com",
    name: "Guardian Alpha",
    role: "PARENT",
    schoolId: schoolA,
    studentIds: ["std-alpha-child-1"],
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await createUserServer(parentAUser);

  const studentAChild: StudentDoc = {
    ...testStudent,
    id: "std-alpha-child-1",
    guardianEmail: "parent.alpha@example.com",
    parentUserIds: ["usr-parent-alpha-1"],
  };
  await saveStudentServer(studentAChild);

  const studentUnrelated: StudentDoc = {
    ...testStudent,
    id: "std-alpha-other-2",
    guardianEmail: "other.guardian@example.com",
    parentUserIds: ["usr-parent-other-99"],
  };
  await saveStudentServer(studentUnrelated);

  const parentAAuth = {
    uid: "usr-parent-alpha-1",
    email: "parent.alpha@example.com",
    name: "Guardian Alpha",
    role: "PARENT" as const,
    schoolId: schoolA,
  };

  // Parent A accesses linked child
  const verifiedChild = await assertParentOwnsStudent(parentAAuth, "std-alpha-child-1");
  assert(
    verifiedChild.id === "std-alpha-child-1",
    "Parent can successfully access their own linked child (Parent-Child Ownership)"
  );

  // Parent A attempts to access another parent's child
  let blockedCrossParent = false;
  try {
    await assertParentOwnsStudent(parentAAuth, "std-alpha-other-2");
  } catch (err: any) {
    blockedCrossParent = err instanceof Response && err.status === 403;
  }
  assert(
    blockedCrossParent,
    "Parent A attempting to access Parent B's child throws 403 Forbidden (Cross-Parent Security)"
  );

  // ----------------------------------------------------
  // TEST 6: School Announcement Isolation & Audience Filtering (Phase 3)
  // ----------------------------------------------------
  const announcementSchoolA: AnnouncementDoc = {
    id: "ann-sch-a-1",
    schoolId: schoolA,
    title: "School A Notice",
    message: "Welcome parents of School A",
    audience: "PARENTS",
    status: "PUBLISHED",
    publishedAt: new Date().toISOString(),
    createdBy: "usr-admin-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveAnnouncementServer(announcementSchoolA);

  const announcementsSchoolB = await getAnnouncementsServer(schoolB);
  const leakedToSchoolB = announcementsSchoolB.some((a) => a.id === "ann-sch-a-1");
  assert(
    !leakedToSchoolB,
    "Announcements in School A are never visible in School B (School Announcement Isolation)"
  );

  const visibleToParent = announcementVisibleToRole(announcementSchoolA, "PARENT");
  const visibleToStudent = announcementVisibleToRole(announcementSchoolA, "STUDENT");
  assert(
    visibleToParent && !visibleToStudent,
    "Audience filtering ensures PARENTS announcements are visible to parents and blocked for students (RBAC)"
  );

  // ----------------------------------------------------
  // TEST 11: Date Validation Utility
  // ----------------------------------------------------
  const validDate = validateDateString("2024-08-15");
  const invalidDate = validateDateString("2024-02-31");
  const malformedDate = validateDateString("not-a-date");
  assert(
    validDate === "2024-08-15" && invalidDate === null && malformedDate === null,
    "Employment date validation strictly enforces valid calendar dates without rollover"
  );

  // ----------------------------------------------------
  // TEST 12: Prevent Ending Date Earlier than Joining Date
  // ----------------------------------------------------
  const joinDate = "2024-06-01";
  const badEndDate = "2024-05-15";
  const goodEndDate = "2025-06-30";
  assert(
    isDateBefore(badEndDate, joinDate) && !isDateBefore(goodEndDate, joinDate),
    "Validation correctly identifies and blocks Ending Date earlier than Joining Date"
  );

  // ----------------------------------------------------
  // TEST 13: Active Teacher Creation with Joining Date
  // ----------------------------------------------------
  const activeTeacherDoc: TeacherDoc = {
    id: "tch-test-active-1",
    schoolId: schoolA,
    employeeId: "TCH-ACT-01",
    fullName: "Tahir Mahmood",
    email: "tahir.mahmood@schoola.edu",
    phone: "+92 300 1234567",
    designation: "Senior Science Educator",
    department: "Science",
    qualification: "M.Sc Physics",
    status: "ACTIVE",
    joiningDate: "2023-08-15",
    endingDate: null,
    assignedClassIds: ["cls-1"],
    assignedSubjectIds: ["sub-1"],
    weeklyLoad: 18,
    baseSalary: 65000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveTeacherServer(activeTeacherDoc);
  const fetchedActive = await getTeacherByIdServer(schoolA, "tch-test-active-1");
  assert(
    fetchedActive?.joiningDate === "2023-08-15" &&
      (fetchedActive?.endingDate === null || fetchedActive?.endingDate === undefined) &&
      fetchedActive?.status === "ACTIVE",
    "Active teacher record correctly persists required Joining Date, null Ending Date, and ACTIVE status"
  );

  // ----------------------------------------------------
  // TEST 14: Former Teacher Transition & Historical Preservation
  // ----------------------------------------------------
  const formerTeacherDoc: TeacherDoc = {
    ...activeTeacherDoc,
    id: "tch-test-former-1",
    employeeId: "TCH-FRM-01",
    email: "former.teacher@schoola.edu",
    endingDate: "2025-06-30",
    status: "INACTIVE",
    updatedAt: new Date().toISOString(),
  };
  await saveTeacherServer(formerTeacherDoc);
  const fetchedFormer = await getTeacherByIdServer(schoolA, "tch-test-former-1");
  assert(
    fetchedFormer?.status === "INACTIVE" &&
      fetchedFormer?.endingDate === "2025-06-30" &&
      fetchedFormer?.joiningDate === "2023-08-15" &&
      fetchedFormer?.assignedClassIds.length === 1 &&
      fetchedFormer?.assignedSubjectIds.length === 1,
    "Former teacher record correctly sets Ending Date and INACTIVE status while preserving all historical classes, subjects, and assignments"
  );

  // ----------------------------------------------------
  // TEST 15: Backward Compatibility for Existing Records
  // ----------------------------------------------------
  const legacyTeacherDoc: TeacherDoc = {
    id: "tch-test-legacy-1",
    schoolId: schoolA,
    employeeId: "TCH-LEG-01",
    fullName: "Legacy Educator",
    email: "legacy@schoola.edu",
    phone: "+92 300 0000000",
    designation: "Educator",
    department: "General",
    qualification: "B.Ed",
    status: "ACTIVE",
    assignedClassIds: [],
    assignedSubjectIds: [],
    weeklyLoad: 15,
    createdAt: "2022-01-01T00:00:00.000Z",
    updatedAt: "2022-01-01T00:00:00.000Z",
  };
  await saveTeacherServer(legacyTeacherDoc);
  const fetchedLegacy = await getTeacherByIdServer(schoolA, "tch-test-legacy-1");
  assert(
    fetchedLegacy !== null && fetchedLegacy.status === "ACTIVE",
    "Existing teachers without dates continue working without breaking records"
  );

  // ----------------------------------------------------
  // TEST 16: Create Class -> verify it appears (TEST 1)
  // ----------------------------------------------------
  const classDoc1: ClassDoc = {
    id: "cls-verify-101",
    schoolId: schoolA,
    name: "Grade 11-A",
    section: "A",
    numericLevel: 11,
    capacity: 35,
    roomNo: "Room-301",
    academicYear: "2024-2025",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassServer(classDoc1);
  const fetchedClass1 = await getClassByIdServer(schoolA, "cls-verify-101");
  const allSchoolAClasses = await getClassesServer(schoolA);
  assert(
    fetchedClass1?.id === "cls-verify-101" &&
      fetchedClass1?.name === "Grade 11-A" &&
      allSchoolAClasses.some((c) => c.id === "cls-verify-101"),
    "Create Class: Class correctly created and retrievable via getClassByIdServer and getClassesServer"
  );

  // ----------------------------------------------------
  // TEST 17: Create Subject -> assign to Class -> verify it persists (TEST 2)
  // ----------------------------------------------------
  const subjectDoc1: SubjectDoc = {
    id: "sb-verify-201",
    schoolId: schoolA,
    classId: "cls-verify-101",
    className: "Grade 11-A",
    name: "Advanced Physics",
    code: "PHY-301",
    credits: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSubjectServer(subjectDoc1);
  const fetchedSubject1 = await getSubjectByIdServer(schoolA, "sb-verify-201");
  assert(
    fetchedSubject1?.id === "sb-verify-201" &&
      fetchedSubject1?.classId === "cls-verify-101" &&
      fetchedSubject1?.name === "Advanced Physics" &&
      fetchedSubject1?.code === "PHY-301",
    "Create Subject: Subject created and successfully assigned to Class with classId and metadata"
  );

  // ----------------------------------------------------
  // TEST 18: Assign Teacher -> Class -> verify assignment persists (TEST 3)
  // ----------------------------------------------------
  const teacherAssignDoc: TeacherDoc = {
    id: "tch-verify-301",
    schoolId: schoolA,
    employeeId: "TCH-V-301",
    fullName: "Dr. Arshad Khan",
    email: "arshad.khan@schoola.edu",
    phone: "+92 300 7771122",
    designation: "Assistant Professor",
    department: "Physics",
    qualification: "Ph.D Physics",
    status: "ACTIVE",
    joiningDate: "2021-01-10",
    endingDate: null,
    assignedClassIds: ["cls-verify-101"],
    assignedSubjectIds: [],
    weeklyLoad: 16,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveTeacherServer(teacherAssignDoc);
  await saveClassServer({
    ...classDoc1,
    classTeacherId: "tch-verify-301",
    classTeacherName: "Dr. Arshad Khan",
  });
  const fetchedAssignedClass = await getClassByIdServer(schoolA, "cls-verify-101");
  const fetchedAssignedTeacher = await getTeacherByIdServer(schoolA, "tch-verify-301");
  assert(
    fetchedAssignedClass?.classTeacherId === "tch-verify-301" &&
      fetchedAssignedClass?.classTeacherName === "Dr. Arshad Khan" &&
      (fetchedAssignedTeacher?.assignedClassIds || []).includes("cls-verify-101"),
    "Assign Teacher -> Class: Two-way assignment persists on both Class and Teacher records"
  );

  // ----------------------------------------------------
  // TEST 19: Assign Teacher -> Subject -> verify assignment persists (TEST 4)
  // ----------------------------------------------------
  await saveSubjectServer({
    ...subjectDoc1,
    teacherId: "tch-verify-301",
    teacherName: "Dr. Arshad Khan",
  });
  await saveTeacherServer({
    ...teacherAssignDoc,
    assignedSubjectIds: ["sb-verify-201"],
  });
  const fetchedAssignedSubject = await getSubjectByIdServer(schoolA, "sb-verify-201");
  const fetchedTeacherWithSub = await getTeacherByIdServer(schoolA, "tch-verify-301");
  assert(
    fetchedAssignedSubject?.teacherId === "tch-verify-301" &&
      fetchedAssignedSubject?.teacherName === "Dr. Arshad Khan" &&
      (fetchedTeacherWithSub?.assignedSubjectIds || []).includes("sb-verify-201"),
    "Assign Teacher -> Subject: Two-way assignment persists on both Subject and Teacher records"
  );

  // ----------------------------------------------------
  // TEST 20: Verify subjects appear under correct classes (TEST 5)
  // ----------------------------------------------------
  const classDoc2: ClassDoc = {
    id: "cls-verify-102",
    schoolId: schoolA,
    name: "Grade 11-B",
    section: "B",
    numericLevel: 11,
    capacity: 35,
    roomNo: "Room-302",
    academicYear: "2024-2025",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassServer(classDoc2);
  const subjectDoc2: SubjectDoc = {
    id: "sb-verify-202",
    schoolId: schoolA,
    classId: "cls-verify-102",
    className: "Grade 11-B",
    name: "Chemistry 11-B",
    code: "CHM-302",
    credits: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSubjectServer(subjectDoc2);

  const subjectsClass1 = await getSubjectsServer(schoolA, "cls-verify-101");
  const subjectsClass2 = await getSubjectsServer(schoolA, "cls-verify-102");
  assert(
    subjectsClass1.some((s) => s.id === "sb-verify-201") &&
      !subjectsClass1.some((s) => s.id === "sb-verify-202") &&
      subjectsClass2.some((s) => s.id === "sb-verify-202") &&
      !subjectsClass2.some((s) => s.id === "sb-verify-201"),
    "Subjects correctly partitioned and queried by classId without cross-class leakage"
  );

  // ----------------------------------------------------
  // TEST 21: Teacher profile displays assigned class/subject (TEST 6)
  // ----------------------------------------------------
  const teacherForProfile = await getTeacherByIdServer(schoolA, "tch-verify-301");
  const teacherClasses = (teacherForProfile?.assignedClassIds || []).map((cid) =>
    cid === "cls-verify-101" ? fetchedAssignedClass : null
  );
  const teacherSubjects = (teacherForProfile?.assignedSubjectIds || []).map((sid) =>
    sid === "sb-verify-201" ? fetchedAssignedSubject : null
  );
  assert(
    teacherForProfile !== null &&
      teacherClasses.length === 1 &&
      teacherClasses[0]?.name === "Grade 11-A" &&
      teacherSubjects.length === 1 &&
      teacherSubjects[0]?.name === "Advanced Physics",
    "Teacher profile resolution: Assigned classes and subjects resolve to accurate metadata"
  );

  // ----------------------------------------------------
  // TEST 22: Remove / reassign assignment handled correctly (TEST 7)
  // ----------------------------------------------------
  // Unassign teacher from class
  await saveClassServer({
    ...classDoc1,
    classTeacherId: null,
    classTeacherName: null,
  });
  const unassignedClass = await getClassByIdServer(schoolA, "cls-verify-101");
  // Unassign teacher from subject
  await saveSubjectServer({
    ...subjectDoc1,
    teacherId: null,
    teacherName: null,
  });
  const unassignedSubject = await getSubjectByIdServer(schoolA, "sb-verify-201");
  // Update teacher removing assignments
  await saveTeacherServer({
    ...teacherAssignDoc,
    assignedClassIds: [],
    assignedSubjectIds: [],
  });
  const cleanTeacher = await getTeacherByIdServer(schoolA, "tch-verify-301");
  assert(
    (unassignedClass?.classTeacherId === null || unassignedClass?.classTeacherId === undefined) &&
      (unassignedSubject?.teacherId === null || unassignedSubject?.teacherId === undefined) &&
      cleanTeacher?.assignedClassIds.length === 0 &&
      cleanTeacher?.assignedSubjectIds.length === 0,
    "Remove/reassign: Setting null/unassigning cleans associations from class, subject, and teacher records"
  );

  // ----------------------------------------------------
  // TEST 23: Create empty class -> verify empty state (TEST 8)
  // ----------------------------------------------------
  const emptyClassDoc: ClassDoc = {
    id: "cls-verify-empty",
    schoolId: schoolA,
    name: "Grade 12-C Empty",
    section: "C",
    numericLevel: 12,
    capacity: 20,
    roomNo: "Room-Empty",
    academicYear: "2024-2025",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassServer(emptyClassDoc);
  const emptyClassSubjects = await getSubjectsServer(schoolA, "cls-verify-empty");
  assert(
    emptyClassSubjects.length === 0,
    "Empty class has 0 subjects, verifying UI 'No subjects assigned' empty state condition"
  );

  // ----------------------------------------------------
  // TEST 24: Verify existing records are not broken (TEST 9)
  // ----------------------------------------------------
  const legacyClass: ClassDoc = {
    id: "cls-legacy-001",
    schoolId: schoolA,
    name: "Legacy Class",
    section: "X",
    numericLevel: 5,
    capacity: 25,
    academicYear: "2022-2023",
    createdAt: "2022-01-01T00:00:00.000Z",
    updatedAt: "2022-01-01T00:00:00.000Z",
  };
  const legacySubject: SubjectDoc = {
    id: "sb-legacy-001",
    schoolId: schoolA,
    classId: "cls-legacy-001",
    className: "Legacy Class",
    name: "General Science",
    code: "GSC-5",
    credits: 3,
    createdAt: "2022-01-01T00:00:00.000Z",
    updatedAt: "2022-01-01T00:00:00.000Z",
  };
  await saveClassServer(legacyClass);
  await saveSubjectServer(legacySubject);
  const fetchedLegacyClass = await getClassByIdServer(schoolA, "cls-legacy-001");
  const fetchedLegacySubject = await getSubjectByIdServer(schoolA, "sb-legacy-001");
  assert(
    fetchedLegacyClass !== null &&
      fetchedLegacyClass.classTeacherId === undefined &&
      fetchedLegacySubject !== null &&
      fetchedLegacySubject.teacherId === undefined,
    "Existing records without teacherId/classTeacherId persist and retrieve gracefully without breaking"
  );

  // ----------------------------------------------------
  // TEST 25: Tenant Isolation: School A cannot see/access School B (TEST 10)
  // ----------------------------------------------------
  const classSchoolB: ClassDoc = {
    id: "cls-b-isolated",
    schoolId: schoolB,
    name: "School B Class",
    section: "A",
    numericLevel: 10,
    capacity: 30,
    academicYear: "2024-2025",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const subjectSchoolB: SubjectDoc = {
    id: "sb-b-isolated",
    schoolId: schoolB,
    classId: "cls-b-isolated",
    className: "School B Class",
    name: "School B Urdu",
    code: "URD-B",
    credits: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassServer(classSchoolB);
  await saveSubjectServer(subjectSchoolB);

  const crossSchoolClass = await getClassByIdServer(schoolA, "cls-b-isolated");
  const crossSchoolSubject = await getSubjectByIdServer(schoolA, "sb-b-isolated");
  const schoolASubjects = await getSubjectsServer(schoolA);
  const unauthorizedDelete = await deleteSubjectServer(schoolA, "sb-b-isolated");

  assert(
    crossSchoolClass === null &&
      crossSchoolSubject === null &&
      !schoolASubjects.some((s) => s.id === "sb-b-isolated") &&
      unauthorizedDelete === false,
    "Tenant isolation enforced: Cross-school class/subject lookups return null and unauthorized delete fails"
  );

  // ----------------------------------------------------
  // TEST 26: Safe Class Deletion (Empty class)
  // ----------------------------------------------------
  const deletableClass: ClassDoc = {
    id: "cls-to-delete-101",
    schoolId: schoolA,
    name: "Temporary Class",
    section: "T",
    numericLevel: 9,
    capacity: 20,
    academicYear: "2024-2025",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassServer(deletableClass);
  const existsBeforeDelete = await getClassByIdServer(schoolA, "cls-to-delete-101");
  const deleteResult = await deleteClassServer(schoolA, "cls-to-delete-101");
  const existsAfterDelete = await getClassByIdServer(schoolA, "cls-to-delete-101");

  assert(
    existsBeforeDelete !== null && deleteResult === true && existsAfterDelete === null,
    "Safe class deletion removes empty class and subsequent lookup returns null"
  );

  // ----------------------------------------------------
  // TEST 27: Cross-Tenant Class Deletion Protection
  // ----------------------------------------------------
  const schoolBClassToDelete: ClassDoc = {
    id: "cls-school-b-protected",
    schoolId: schoolB,
    name: "Protected B Class",
    section: "B",
    numericLevel: 10,
    capacity: 30,
    academicYear: "2024-2025",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassServer(schoolBClassToDelete);
  const crossDeleteResult = await deleteClassServer(schoolA, "cls-school-b-protected");
  const schoolBStillHasClass = await getClassByIdServer(schoolB, "cls-school-b-protected");

  assert(
    crossDeleteResult === false && schoolBStillHasClass !== null,
    "Cross-tenant class deletion prevented: School A cannot delete School B's class"
  );

  // ----------------------------------------------------
  // TEST 28: Password Reset Token Generation & Verification
  // ----------------------------------------------------
  const testUserEmail = "reset.test@schoola.edu";
  const resetToken = await createPasswordResetTokenServer({
    uid: "usr-reset-test-1",
    email: testUserEmail,
    schoolId: schoolA,
  });
  const verifiedPayload = await verifyPasswordResetTokenServer(resetToken);

  assert(
    typeof resetToken === "string" &&
      resetToken.length > 20 &&
      verifiedPayload !== null &&
      verifiedPayload.uid === "usr-reset-test-1" &&
      verifiedPayload.email === testUserEmail &&
      verifiedPayload.purpose === "pwd_reset",
    "Password reset token is cryptographically signed and verifies with expected payload"
  );

  // ----------------------------------------------------
  // TEST 29: Single-Use Password Reset Token Lifecycle
  // ----------------------------------------------------
  const crypto = await import("crypto");
  const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
  const initialUser: UserProfile = {
    uid: "usr-reset-test-1",
    name: "Reset Tester",
    email: testUserEmail,
    role: "TEACHER",
    schoolId: schoolA,
    status: "ACTIVE",
    passwordHash: "old-hashed-password",
    resetTokenHash: tokenHash,
    resetTokenExpires: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await createUserServer(initialUser);

  const userBeforeReset = await getUserByEmailServer(testUserEmail);
  const tokenMatches = userBeforeReset?.resetTokenHash === tokenHash;

  // Simulate successful reset invalidation
  const { resetTokenHash: _rth, resetTokenExpires: _rte, ...updatedUser } = userBeforeReset!;
  void _rth;
  void _rte;
  await updateUserServer({
    ...updatedUser,
    passwordHash: "new-bcrypt-hash-12345",
  });

  const userAfterReset = await getUserByEmailServer(testUserEmail);
  const tokenInvalidated = userAfterReset?.resetTokenHash === undefined;

  assert(
    tokenMatches === true &&
      tokenInvalidated === true &&
      userAfterReset?.passwordHash === "new-bcrypt-hash-12345",
    "Password reset token single-use lifecycle: token hash is verified and invalidated upon reset"
  );

  // ----------------------------------------------------
  // TEST 30: Tampered / Invalid Password Reset Token Rejection
  // ----------------------------------------------------
  const tamperedToken = resetToken.slice(0, -6) + "xxxxxx";
  const tamperedResult = await verifyPasswordResetTokenServer(tamperedToken);

  assert(
    tamperedResult === null,
    "Tampered or invalid password reset tokens are strictly rejected"
  );

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

runVerification().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
