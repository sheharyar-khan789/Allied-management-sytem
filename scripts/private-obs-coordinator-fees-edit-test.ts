/**
 * Covers the three features added in this change:
 *  1. Private Admin Observation — `isPrivate` on teacherObservations, hidden from the subject
 *     teacher's own GET, visible to admin.
 *  2. Coordinator Observation Submission — a flagged TEACHER drafts an observation for admin
 *     review; it never reaches the subject teacher until an admin approves it; rejection never
 *     publishes anything.
 *  3. Fees & Payments edit/delete — student-charge delete/void, expense edit/delete keeping its
 *     linked transaction in sync, and fee-challan edit/void.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { GET as tobsGet, POST as tobsPost, PUT as tobsPut } from "../src/app/api/teacher-observations/route";
import { PUT as teacherPut } from "../src/app/api/teachers/[id]/route";
import { GET as subGet, POST as subPost } from "../src/app/api/teacher-observation-submissions/route";
import { GET as subAdminGet } from "../src/app/api/teacher-observation-submissions/admin/route";
import { POST as subApprove } from "../src/app/api/teacher-observation-submissions/[id]/approve/route";
import { POST as subReject } from "../src/app/api/teacher-observation-submissions/[id]/reject/route";
import { POST as chargesPost, PUT as chargesPut, DELETE as chargesDelete } from "../src/app/api/fees/charges/route";
import { POST as expensesPost, PUT as expensesPut, DELETE as expensesDelete } from "../src/app/api/fees/expenses/route";
import { PUT as challanPut, DELETE as challanDelete } from "../src/app/api/fees/challans/[id]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveTeacherServer,
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  getFeeChallanByIdServer,
  getStudentChargeByIdServer,
  getTeacherObservationByIdServer,
} from "../src/lib/firebase/server-db";
import { getExpenseByIdServer, getTransactionByIdServer } from "../src/lib/firebase/transaction-db";
import { ClassDoc, FeeChallanDoc, StudentDoc, TeacherDoc } from "../src/lib/firebase/types";

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

let ipCounter = 1;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  const now = new Date().toISOString();
  const A = "school-pocf-a";
  const YEAR = "2026-2027";
  const today = new Date().toISOString().split("T")[0];

  const teacher = (id: string, name: string): TeacherDoc => ({
    id, schoolId: A, employeeId: id.toUpperCase(), fullName: name, email: `${id}@x.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  const tMath = teacher("tch-pocf-math", "Math Teacher");
  const tEng = teacher("tch-pocf-eng", "English Teacher");
  const tCoord = teacher("tch-pocf-coord", "Coordinator Teacher");
  for (const t of [tMath, tEng, tCoord]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER", extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId: A, name: uid, ...extra });
  const ADMIN = await session("uid-pocf-admin", "ADMIN");
  const T_MATH = await session("uid-pocf-tmath", "TEACHER", { teacherId: tMath.id });
  const T_COORD = await session("uid-pocf-tcoord", "TEACHER", { teacherId: tCoord.id });
  const T_ENG = await session("uid-pocf-teng", "TEACHER", { teacherId: tEng.id });

  // ================================================================
  // FEATURE 1 — PRIVATE ADMIN OBSERVATION
  // ================================================================
  console.log("==================================================");
  console.log("FEATURE 1 — PRIVATE ADMIN OBSERVATION");
  console.log("==================================================");

  const privCreated = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: tMath.id, observationDate: "2026-10-01", category: "TEACHING_QUALITY", rating: "SATISFACTORY",
    note: "Confidential performance concern.", isPrivate: true,
  })));
  const PRIV_OBS = privCreated.observation?.id as string;
  assert(privCreated.success && privCreated.observation?.isPrivate === true, "Admin create: isPrivate persisted and echoed in the response");

  const openCreated = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: tMath.id, observationDate: "2026-10-02", category: "PUNCTUALITY", rating: "EXCELLENT", note: "Great timing.",
  })));
  const OPEN_OBS = openCreated.observation?.id as string;
  assert(openCreated.observation?.isPrivate === false, "Admin create: no isPrivate sent -> defaults to false, never required");

  const teacherList = await json(await tobsGet(req(T_MATH, "/api/teacher-observations")));
  assert(teacherList.success && teacherList.observations.length === 1, "Teacher GET: private note is absent from the raw response (not just UI-hidden)");
  assert(teacherList.observations[0]?.id === OPEN_OBS, "Teacher GET: the one visible note is the non-private one");
  assert(teacherList.observations.every((o: any) => o.id !== PRIV_OBS), "Teacher GET: the private note's id never appears anywhere in the response");

  const adminSearch = await json(await tobsGet(req(ADMIN, "/api/teacher-observations")));
  assert(adminSearch.observations.some((o: any) => o.id === PRIV_OBS), "Admin GET: still sees the private note in the review screen");

  // Toggling privacy is content-neutral: no note/title changed, so no editHistory entry.
  const toggled = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", { id: OPEN_OBS, isPrivate: true })));
  assert(toggled.success && toggled.observation?.isPrivate === true, "Admin PUT: can toggle an existing note to private");
  assert((toggled.observation?.editHistory || []).length === 0, "Admin PUT: toggling isPrivate alone does not push a spurious editHistory entry");
  const nowHiddenList = await json(await tobsGet(req(T_MATH, "/api/teacher-observations")));
  assert(nowHiddenList.observations.length === 0, "Teacher GET: the just-toggled note is now hidden too");

  const rawPriv = await getTeacherObservationByIdServer(A, PRIV_OBS);
  assert(rawPriv?.isPrivate === true, "Storage: isPrivate persisted on the document itself");

  // ================================================================
  // FEATURE 2 — COORDINATOR OBSERVATION SUBMISSION
  // ================================================================
  console.log("==================================================");
  console.log("FEATURE 2 — COORDINATOR OBSERVATION SUBMISSION");
  console.log("==================================================");

  assert((await subPost(req(T_ENG, "/api/teacher-observation-submissions", "POST", {
    teacherId: tMath.id, observationDate: "2026-10-10", category: "TEACHING_QUALITY", rating: "SATISFACTORY", note: "x",
  }))).status === 403, "POST: a TEACHER without the permission flag is rejected");

  const grant = await json(await teacherPut(req(ADMIN, `/api/teachers/${tCoord.id}`, "PUT", { canSubmitObservations: true }), paramsOf(tCoord.id)));
  assert(grant.success && grant.teacher?.canSubmitObservations === true, "Admin grants canSubmitObservations via the existing teacher editor");

  const subCreated = await json(await subPost(req(T_COORD, "/api/teacher-observation-submissions", "POST", {
    teacherId: tMath.id, observationDate: "2026-10-11", category: "COLLABORATION", rating: "SATISFACTORY",
    title: "Coordinator note", note: "Observed during a team meeting.",
    // Attempted widening fields — must all be ignored/overridden server-side.
    status: "APPROVED", submittedByTeacherId: tEng.id,
  })));
  const SUB_ID = subCreated.submission?.id as string;
  assert(subCreated.success && subCreated.submission?.status === "PENDING", "POST: a coordinator's submission is always saved PENDING, never trusting a client-sent status");
  assert(subCreated.submission?.submittedByTeacherId === tCoord.id, "POST: submittedByTeacherId is always server-resolved, never the client-sent value");

  const coordOwn = await json(await subGet(req(T_COORD, "/api/teacher-observation-submissions")));
  assert(coordOwn.coordinator === true && coordOwn.submissions.length === 1 && coordOwn.submissions[0].id === SUB_ID, "GET: coordinator sees exactly their own submission");

  const engOwn = await json(await subGet(req(T_ENG, "/api/teacher-observation-submissions")));
  assert(engOwn.coordinator === false && engOwn.submissions.length === 0, "GET: a non-coordinator (and non-submitter) sees none of it — this is the subject's own read path, and it's empty");

  assert((await subAdminGet(req(T_COORD, "/api/teacher-observation-submissions/admin"))).status === 403, "Admin review list: rejected for a non-admin, even the submitting coordinator");
  const adminPending = await json(await subAdminGet(req(ADMIN, "/api/teacher-observation-submissions/admin")));
  assert(adminPending.success && adminPending.submissions.some((s: any) => s.id === SUB_ID), "Admin review list: sees the pending submission with submitter + subject");

  assert((await subApprove(req(T_COORD, `/api/teacher-observation-submissions/${SUB_ID}/approve`, "POST", {}), paramsOf(SUB_ID))).status === 403, "Approve: rejected for a non-admin — a coordinator can never self-publish");

  const approved = await json(await subApprove(req(ADMIN, `/api/teacher-observation-submissions/${SUB_ID}/approve`, "POST", { title: "Edited before publish" }), paramsOf(SUB_ID)));
  assert(approved.success && approved.submission?.status === "APPROVED", "Approve: submission flips to APPROVED");
  assert(approved.observation?.authorName === "uid-pocf-admin" || approved.observation != null, "Approve: a real observation is created");
  const NEW_OBS_ID = approved.observation?.id as string;
  const rawApproved = await getTeacherObservationByIdServer(A, NEW_OBS_ID);
  assert(rawApproved?.authorUid === "uid-pocf-admin", "Approve: the published observation is authored by the APPROVING ADMIN, never the coordinator");
  assert(rawApproved?.title === "Edited before publish", "Approve: admin's field overrides are applied before publishing");
  assert(rawApproved?.submittedByStaffId === tCoord.id, "Approve: the coordinator is recorded via the existing Submitted By field");

  const mathSeesIt = await json(await tobsGet(req(T_MATH, "/api/teacher-observations")));
  assert(mathSeesIt.observations.some((o: any) => o.id === NEW_OBS_ID), "After approval: the subject teacher can now see the published note through the normal path");

  assert((await subApprove(req(ADMIN, `/api/teacher-observation-submissions/${SUB_ID}/approve`, "POST", {}), paramsOf(SUB_ID))).status === 409, "Approve: cannot approve the same submission twice");

  // A second submission, this time rejected — must never become an observation.
  const sub2 = await json(await subPost(req(T_COORD, "/api/teacher-observation-submissions", "POST", {
    teacherId: tEng.id, observationDate: "2026-10-12", category: "OTHER", rating: "NEEDS_IMPROVEMENT", note: "Draft note about English teacher.",
  })));
  const SUB2_ID = sub2.submission?.id as string;

  assert((await subReject(req(ADMIN, `/api/teacher-observation-submissions/${SUB2_ID}/reject`, "POST", {}), paramsOf(SUB2_ID))).status === 400, "Reject: an empty reason is rejected");
  const rejected = await json(await subReject(req(ADMIN, `/api/teacher-observation-submissions/${SUB2_ID}/reject`, "POST", { reviewNote: "Not enough detail." }), paramsOf(SUB2_ID)));
  assert(rejected.success && rejected.submission?.status === "REJECTED", "Reject: submission flips to REJECTED with the reason stored");

  const engAfterRejection = await json(await tobsGet(req(T_ENG, "/api/teacher-observations")));
  assert(engAfterRejection.observations.length === 0, "After rejection: the subject teacher still sees nothing — a rejected submission never publishes");

  // ================================================================
  // FEATURE 3 — FEES & PAYMENTS EDIT/DELETE
  // ================================================================
  console.log("==================================================");
  console.log("FEATURE 3 — FEES & PAYMENTS EDIT/DELETE");
  console.log("==================================================");

  const classA: ClassDoc = {
    id: "cls-pocf-a", schoolId: A, name: "Class 7", section: "A", numericLevel: 7, capacity: 40,
    classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveClassServer(classA);
  const student: StudentDoc = {
    id: "std-pocf-1", schoolId: A, admissionNo: "STD-2026-901", fullName: "Zara Khan", fatherName: "Khan",
    gender: "FEMALE", classId: classA.id, section: "A", rollNo: "1", status: "ACTIVE", guardianName: "Khan",
    guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 3000, discount: 0, academicYear: YEAR,
    className: "Class 7-A", createdAt: now, updatedAt: now,
  };
  await saveStudentServer(student);

  // ---- 3a. Student charges: hard-delete UNPAID, void PAID ----
  const unpaidCharge = await json(await chargesPost(req(ADMIN, "/api/fees/charges", "POST", {
    studentId: student.id, type: "EVENT", description: "Sports day", amount: 500, date: today, status: "UNPAID",
  })));
  const UNPAID_ID = unpaidCharge.charge?.id as string;
  assert((await chargesDelete(req(ADMIN, `/api/fees/charges?id=${UNPAID_ID}`, "DELETE"))).status === 200, "Charge DELETE: an UNPAID charge is accepted");
  assert((await getStudentChargeByIdServer(A, UNPAID_ID)) === null, "Charge DELETE: UNPAID charge is genuinely hard-deleted");

  const paidCharge = await json(await chargesPost(req(ADMIN, "/api/fees/charges", "POST", {
    studentId: student.id, type: "TRIP", description: "Field trip", amount: 1200, date: today, status: "PAID",
  })));
  const PAID_ID = paidCharge.charge?.id as string;
  assert((await chargesDelete(req(ADMIN, `/api/fees/charges?id=${PAID_ID}`, "DELETE"))).status === 400, "Charge DELETE: a PAID charge without a reason is rejected");
  const voided = await json(await chargesDelete(req(ADMIN, `/api/fees/charges?id=${PAID_ID}`, "DELETE", { reason: "Trip cancelled, refunded in cash." })));
  assert(voided.success && voided.charge?.status === "VOID", "Charge DELETE: a PAID charge with a reason is voided, not deleted");
  const rawVoidedCharge = await getStudentChargeByIdServer(A, PAID_ID);
  assert(rawVoidedCharge !== null && rawVoidedCharge.amount === 1200, "Charge DELETE: the voided record itself survives with its original amount intact");

  // ---- 3b. Expenses: edit keeps the linked transaction in sync; delete voids both ----
  const expCreated = await json(await expensesPost(req(ADMIN, "/api/fees/expenses", "POST", {
    date: today, description: "Office supplies", amount: 2000,
  })));
  const EXP_ID = expCreated.expense?.id as string;
  const originalTxId = expCreated.expense?.transactionRef as string;
  assert(!!originalTxId, "Expense POST: a companion transaction is created and linked");

  const expEdited = await json(await expensesPut(req(ADMIN, "/api/fees/expenses", "PUT", { id: EXP_ID, amount: 2500 })));
  assert(expEdited.success && expEdited.expense?.amount === 2500, "Expense PUT: amount updated");
  const newTxId = expEdited.expense?.transactionRef as string;
  assert(newTxId !== originalTxId, "Expense PUT: the linked transaction is re-pointed to a new id after a content change");
  const oldTx = await getTransactionByIdServer(A, originalTxId);
  assert(oldTx?.voided === true, "Expense PUT: the OLD transaction is voided, never deleted (dedup-id must stay occupied)");
  const newTx = await getTransactionByIdServer(A, newTxId);
  assert(newTx?.amount === 2500 && !newTx?.voided, "Expense PUT: the NEW transaction carries the corrected amount and is active");

  assert((await expensesDelete(req(ADMIN, `/api/fees/expenses?id=${EXP_ID}`, "DELETE"))).status === 400, "Expense DELETE: a reason is required");
  const expVoided = await json(await expensesDelete(req(ADMIN, `/api/fees/expenses?id=${EXP_ID}`, "DELETE", { reason: "Duplicate entry." })));
  assert(expVoided.success && expVoided.expense?.voided === true, "Expense DELETE: the expense is voided (never hard-deleted)");
  const txAfterExpenseDelete = await getTransactionByIdServer(A, newTxId);
  assert(txAfterExpenseDelete?.voided === true, "Expense DELETE: the linked transaction is voided too, keeping both totals in sync");

  // ---- 3c. Fee challan: edit guard-rails, void-only delete ----
  const challan: FeeChallanDoc = {
    id: "ch-pocf-1", schoolId: A, studentId: student.id, studentName: student.fullName, admissionNo: student.admissionNo,
    classId: classA.id, className: "Class 7-A", challanNo: "CH-POCF-1", month: "November", year: 2026,
    issueDate: today, dueDate: today, tuitionFee: 3000, admissionFee: 0, examFee: 0, otherFee: 0, discount: 0,
    totalExpected: 3000, paidAmount: 1000, balanceAmount: 2000, status: "PARTIAL", academicYear: YEAR,
    createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(challan);

  const dropBelowPaid = await challanPut(req(ADMIN, `/api/fees/challans/${challan.id}`, "PUT", { tuitionFee: 500 }), paramsOf(challan.id));
  assert(dropBelowPaid.status === 409, "Challan PUT: rejected when the new total would drop below what's already paid");

  const validEdit = await json(await challanPut(req(ADMIN, `/api/fees/challans/${challan.id}`, "PUT", { tuitionFee: 4000 }), paramsOf(challan.id)));
  assert(validEdit.success && validEdit.challan?.totalExpected === 4000, "Challan PUT: a valid edit updates the billed total");
  assert(validEdit.challan?.balanceAmount === 3000, "Challan PUT: balance recomputed from the new total and the existing paidAmount");
  assert(validEdit.challan?.status === "PARTIAL", "Challan PUT: status recomputed via statusFromPaidAmount, stays PARTIAL");

  assert((await challanDelete(req(ADMIN, `/api/fees/challans/${challan.id}`, "DELETE", { reason: "test" }), paramsOf(challan.id))).status === 409, "Challan DELETE: blocked outright — this challan has a real payment history (paidAmount > 0)");

  const challan2: FeeChallanDoc = {
    id: "ch-pocf-2", schoolId: A, studentId: student.id, studentName: student.fullName, admissionNo: student.admissionNo,
    classId: classA.id, className: "Class 7-A", challanNo: "CH-POCF-2", month: "December", year: 2026,
    issueDate: today, dueDate: today, tuitionFee: 3000, admissionFee: 0, examFee: 0, otherFee: 0, discount: 0,
    totalExpected: 3000, paidAmount: 0, balanceAmount: 3000, status: "PENDING", academicYear: YEAR,
    createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(challan2);
  assert((await challanDelete(req(ADMIN, `/api/fees/challans/${challan2.id}`, "DELETE"), paramsOf(challan2.id))).status === 400, "Challan DELETE: a reason is required");
  const voidedChallan = await json(await challanDelete(req(ADMIN, `/api/fees/challans/${challan2.id}`, "DELETE", { reason: "Issued in error." }), paramsOf(challan2.id)));
  assert(voidedChallan.success && voidedChallan.challan?.status === "VOID", "Challan DELETE: a zero-payment challan is voided, never hard-deleted");
  const rawVoidedChallan = await getFeeChallanByIdServer(A, challan2.id);
  assert(rawVoidedChallan?.totalExpected === 0, "Challan DELETE: totalExpected is zeroed on void, so every existing totalExpected-summing total naturally excludes it");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
