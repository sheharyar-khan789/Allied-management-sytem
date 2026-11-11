/**
 * Individual Student Fee Update completion: the audited single-student Yearly Fee Structure
 * adjustment (`/api/fees/student-structure`) and the extended student-account response
 * (`/api/fees/student-account`) that now also surfaces the student's yearly structure,
 * generated vouchers, and payment history for that one admin screen.
 */
import { NextRequest } from "next/server";
import { GET as structureGet, PUT as structurePut } from "../src/app/api/fees/student-structure/route";
import { GET as accountGet } from "../src/app/api/fees/student-account/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  recordPaymentServer,
  saveYearlyFeeStructureServer,
  getAuditLogsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, PaymentDoc, StudentDoc } from "../src/lib/firebase/types";
import { getDefaultAcademicYear } from "../src/lib/school-display";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("STUDENT FEE STRUCTURE ADJUSTMENT + EXTENDED STUDENT ACCOUNT");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-sfa-a";
  const B = "school-sfa-b";
  const YEAR = getDefaultAcademicYear();

  const classA: ClassDoc = { id: "cls-sfa-a", schoolId: A, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(classA);

  const s1: StudentDoc = {
    id: "std-sfa-1", schoolId: A, admissionNo: "SFA-001", fullName: "Ali Khan", fatherName: "F", gender: "MALE",
    classId: classA.id, section: "A", rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300",
    guardianRelation: "Father", monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now,
  };
  await saveStudentServer(s1);

  const sB: StudentDoc = { ...s1, id: "std-sfa-b", schoolId: B, admissionNo: "SFA-900" };
  await saveStudentServer(sB);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid });
  const ADMIN_A = await session("uid-sfa-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-sfa-admin-b", "ADMIN", B);
  const TEACHER_A = await session("uid-sfa-teacher-a", "TEACHER", A);

  // ---- GET: no structure yet ----
  const getNone = await json(await structureGet(req(ADMIN_A, `http://x/api/fees/student-structure?studentId=${s1.id}&academicYear=${YEAR}`)));
  assert(getNone.success && getNone.structure === null, "GET: no structure yet for this student/year");

  // ---- PUT: missing reason is rejected ----
  const noReason = await structurePut(req(ADMIN_A, "http://x/api/fees/student-structure", "PUT", { studentId: s1.id, academicYear: YEAR, monthlyTuitionFee: 3700 }));
  assert(noReason.status === 400, "PUT: an adjustment without a reason is rejected");

  // ---- PUT: first adjustment creates the structure ----
  const create = await json(
    await structurePut(req(ADMIN_A, "http://x/api/fees/student-structure", "PUT", {
      studentId: s1.id, academicYear: YEAR, monthlyTuitionFee: 3700, annualFee: 3000, admissionFee: 5000, otherCharges: 200, discount: 0,
      reason: "Initial structure set by admin",
    }))
  );
  assert(create.success && create.structure?.monthlyTuitionFee === 3700, "PUT: first adjustment creates the structure with all given fields");

  const auditAfterCreate = await getAuditLogsServer(A, 50);
  assert(
    auditAfterCreate.some((l) => l.action === "ADJUST_FEE_STRUCTURE" && l.details.includes("Monthly Tuition Fee: 0 -> 3700")),
    "Audit log: the structure creation is recorded with its before/after value and reason"
  );

  // ---- PUT: partial adjustment (discount only) preserves other fields and is reasoned ----
  const discountAdjust = await json(
    await structurePut(req(ADMIN_A, "http://x/api/fees/student-structure", "PUT", {
      studentId: s1.id, academicYear: YEAR, discount: 500, reason: "Sibling discount approved by principal",
    }))
  );
  assert(discountAdjust.success && discountAdjust.structure?.discount === 500, "PUT: partial adjustment applies only the given field");
  assert(discountAdjust.structure?.monthlyTuitionFee === 3700, "PUT: partial adjustment preserves the untouched monthlyTuitionFee");

  // ---- PUT: no actual fields given ----
  const noFields = await structurePut(req(ADMIN_A, "http://x/api/fees/student-structure", "PUT", { studentId: s1.id, academicYear: YEAR, reason: "no-op" }));
  assert(noFields.status === 400, "PUT: an adjustment with no changed fields is rejected");

  // ---- Security ----
  const teacherAdjust = await structurePut(req(TEACHER_A, "http://x/api/fees/student-structure", "PUT", { studentId: s1.id, academicYear: YEAR, discount: 100, reason: "role test" }));
  assert(teacherAdjust.status === 403, "Unauthorized: a TEACHER cannot adjust a fee structure");

  const crossSchool = await structurePut(req(ADMIN_B, "http://x/api/fees/student-structure", "PUT", { studentId: s1.id, academicYear: YEAR, discount: 100, reason: "cross-school test" }));
  assert(crossSchool.status === 404, "Cross-school: school B's admin cannot adjust school A's student");

  // ---- Extended /api/fees/student-account: yearlyStructure + vouchers + payments ----
  const voucher: FeeChallanDoc = {
    id: "ch-sfa-1", schoolId: A, studentId: s1.id, studentName: s1.fullName, admissionNo: s1.admissionNo,
    classId: classA.id, className: "Class 5-A", challanNo: "CHL-SFA-1", month: "September", year: Number(YEAR.split("-")[0]),
    issueDate: now.split("T")[0], dueDate: "2026-09-10", tuitionFee: 3700, admissionFee: 5000, examFee: 0, otherFee: 200,
    discount: 500, totalExpected: 8400, paidAmount: 0, balanceAmount: 8400, status: "PENDING", academicYear: YEAR,
    createdAt: now, updatedAt: now, annualFeeCharged: 3000, oneTimeChargesApplied: true, generatedFromStructure: true,
  };
  await saveFeeChallanServer(voucher);
  const payment: PaymentDoc = {
    id: "pay-sfa-1", schoolId: A, challanId: voucher.id, studentId: s1.id, studentName: s1.fullName,
    receiptNo: "RCT-SFA-1", amount: 3000, paymentDate: now.split("T")[0], paymentMode: "CASH", collectedBy: "uid-sfa-admin-a", createdAt: now,
  };
  await recordPaymentServer(payment);

  const account = await json(
    await accountGet(req(ADMIN_A, `http://x/api/fees/student-account?studentId=${s1.id}&year=${voucher.year}`))
  );
  assert(account.success, "Student account GET succeeds");
  assert(account.yearlyStructure?.monthlyTuitionFee === 3700 && account.yearlyStructure?.discount === 500, "Student account: yearlyStructure reflects the latest adjustment");
  assert(account.vouchers?.some((v: any) => v.id === voucher.id && v.totalExpected === 8400), "Student account: the generated voucher appears in the vouchers list");
  assert(account.payments?.some((p: any) => p.id === payment.id && p.amount === 3000), "Student account: the recorded payment appears in the payment history");
  assert(typeof account.academicYear === "string" && account.academicYear === YEAR, "Student account: academicYear is reported at the top level");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
