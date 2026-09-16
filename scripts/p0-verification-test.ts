import {
  recordFeePaymentServer,
  saveFeeChallanServer,
  getFeeChallanByIdServer,
  saveStudentServer,
  getStudentByIdServer,
  createUserServer,
  getAnnouncementsServer,
  saveAnnouncementServer,
} from "../src/lib/firebase/server-db";
import { FeeChallanDoc, StudentDoc, PaymentDoc, AnnouncementDoc, UserProfile } from "../src/lib/firebase/types";
import { assertParentOwnsStudent, getLinkedChildrenForParent } from "../src/lib/parent-access";
import { announcementVisibleToRole } from "../src/lib/announcements-visibility";

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

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

runVerification().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
