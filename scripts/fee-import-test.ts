/**
 * Fee import from Excel/CSV (`/api/fees/import`): preview/validate, column-header aliasing,
 * admission-number-only matching (never by name alone), idempotent commit (a repeated upload
 * never doubles a bill), real payment records for any "amount paid" column (never a bare
 * paid flag), validation of negative/inconsistent amounts, and school/role isolation.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { POST as importPost } from "../src/app/api/fees/import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  getFeeChallanByIdServer,
  getFeeChallansServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, StudentDoc } from "../src/lib/firebase/types";
import { FEE_IMPORT_TEMPLATE_HEADERS } from "../src/lib/fee-import";

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

function uploadReq(token: string | null, content: string) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "fees.csv");
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest("http://x/api/fees/import", { method: "POST", headers, body: fd });
}

function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("FEE IMPORT");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-fimp-a";
  const B = "school-fimp-b";
  const YEAR = "2026-2027";

  const cls = (id: string, schoolId: string): ClassDoc => ({
    id, schoolId, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, classTeacherId: null,
    academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const classA = cls("cls-fimp-a", A);
  const classB = cls("cls-fimp-b", B);
  await saveClassServer(classA);
  await saveClassServer(classB);

  const student = (id: string, schoolId: string, classId: string, admissionNo: string, name: string): StudentDoc => ({
    id, schoolId, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now,
  });
  const s1 = student("std-fimp-1", A, classA.id, "STD-2026-001", "Ali Khan");
  const s2 = student("std-fimp-2", A, classA.id, "STD-2026-002", "Sara Khan");
  const sB = student("std-fimp-b", B, classB.id, "STD-2026-900", "Bilal");
  await saveStudentServer(s1);
  await saveStudentServer(s2);
  await saveStudentServer(sB);

  // A challan that already exists for s1/October/2026 — an import row for the same key must be
  // flagged a duplicate, never silently re-created.
  const preexisting: FeeChallanDoc = {
    id: "ch-fimp-existing", schoolId: A, studentId: s1.id, studentName: s1.fullName, admissionNo: s1.admissionNo,
    classId: classA.id, className: "Class 5-A", challanNo: "CHL-PRE", month: "October", year: 2026,
    issueDate: "2026-10-01", dueDate: "2026-10-10", tuitionFee: 3000, admissionFee: 0, examFee: 0, otherFee: 0,
    discount: 0, totalExpected: 3000, paidAmount: 0, balanceAmount: 3000, status: "PENDING", createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(preexisting);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid });
  const ADMIN_A = await session("uid-fimp-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-fimp-admin-b", "ADMIN", B);
  const TEACHER_A = await session("uid-fimp-teacher-a", "TEACHER", A);

  const header = FEE_IMPORT_TEMPLATE_HEADERS;
  const rows = [
    // Row 2: unpaid, valid.
    ["STD-2026-002", "Sara Khan", "November", "2026", "3000", "0", "0", "0", "0", "0", "", "", ""],
    // Row 3: fully paid, valid.
    ["STD-2026-001", "Ali Khan", "November", "2026", "3000", "500", "0", "0", "0", "3500", "", "2026-11-05", "RCT-9001"],
    // Row 4: partially paid, valid.
    ["STD-2026-002", "Sara Khan", "December", "2026", "3000", "0", "0", "0", "0", "1000", "", "", ""],
    // Row 5: duplicate of the pre-existing October/2026 challan for s1.
    ["STD-2026-001", "Ali Khan", "October", "2026", "3000", "0", "0", "0", "0", "0", "", "", ""],
    // Row 6: unmatched admission number.
    ["STD-9999-999", "Ghost Student", "November", "2026", "3000", "0", "0", "0", "0", "0", "", "", ""],
    // Row 7: invalid month.
    ["STD-2026-002", "Sara Khan", "Smarch", "2026", "3000", "0", "0", "0", "0", "0", "", "", ""],
    // Row 8: discount exceeds total.
    ["STD-2026-002", "Sara Khan", "January", "2027", "1000", "0", "0", "0", "5000", "0", "", "", ""],
    // Row 9: amount paid exceeds total.
    ["STD-2026-002", "Sara Khan", "February", "2027", "1000", "0", "0", "0", "0", "5000", "", "", ""],
    // Row 10: duplicate within this very file of row 2 (same student/month/year).
    ["STD-2026-002", "Sara Khan", "November", "2026", "3000", "0", "0", "0", "0", "0", "", "", ""],
    // Row 11: student name given doesn't match the admission number's real student (warning, still importable).
    ["STD-2026-001", "Someone Else Entirely", "January", "2027", "3000", "0", "0", "0", "0", "0", "", "", ""],
  ];
  const csv = csvOf([header, ...rows]);

  // ---------------------------------------------------------------- authorization & access
  assert((await importPost(uploadReq(null, csv))).status === 401, "Preview: unauthenticated request rejected");
  assert((await importPost(uploadReq(TEACHER_A, csv))).status === 403, "Preview: a teacher cannot import fee records");

  // ---------------------------------------------------------------- preview
  const pv = await json(await importPost(uploadReq(ADMIN_A, csv)));
  assert(pv.success === true, "Preview: file parsed");
  assert(pv.summary.total === 10, "Preview: every data row counted");
  const byRow = (n: number) => pv.rows.find((r: any) => r.rowNumber === n);
  assert(byRow(2).status === "VALID", "Preview: unpaid row is VALID");
  assert(byRow(3).status === "VALID" && byRow(3).fee.amountPaid === 3500, "Preview: fully-paid row is VALID with the paid amount carried through");
  // WARNING (not VALID) because no Payment Date was given for a paid amount — still importable.
  assert(byRow(4).status === "WARNING" && byRow(4).fee.totalExpected === 3000, "Preview: partially-paid row with no payment date is a WARNING (still importable)");
  assert(byRow(5).status === "DUPLICATE", "Preview: row matching an existing challan is DUPLICATE");
  assert(byRow(6).status === "INVALID" && byRow(6).errors.some((e: string) => e.includes("No student found")), "Preview: unmatched admission number is INVALID");
  assert(byRow(7).status === "INVALID" && byRow(7).errors.some((e: string) => e.includes("not recognised")), "Preview: invalid month name rejected");
  assert(byRow(8).status === "INVALID" && byRow(8).errors.some((e: string) => e.includes("Discount")), "Preview: discount exceeding total rejected");
  assert(byRow(9).status === "INVALID" && byRow(9).errors.some((e: string) => e.includes("cannot exceed")), "Preview: amount paid exceeding total rejected");
  assert(byRow(10).status === "DUPLICATE" && byRow(10).errors.some((e: string) => e.includes("row 2")), "Preview: in-file duplicate (same student/month/year as an earlier row) flagged");
  assert(byRow(11).status === "WARNING" && byRow(11).warnings.some((w: string) => w.includes("does not match")), "Preview: mismatched student name is a WARNING, not a hard error (admission number still used)");

  // ---------------------------------------------------------------- commit: only the importable rows
  const importableRows = pv.rows.filter((r: any) => r.status === "VALID" || r.status === "WARNING");
  assert(importableRows.length === 4, "Commit input: exactly the 4 VALID/WARNING rows are importable (2, 3, 4, 11)");
  const commitBody = { fileName: "fees.csv", rows: importableRows.map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })) };

  const cm = await json(await importPost(req(ADMIN_A, "http://x/api/fees/import", "POST", commitBody)));
  assert(cm.success === true && cm.summary.imported === 4, "Commit: all 4 importable rows created");
  const outcomeByRow = (n: number) => cm.results.find((r: any) => r.rowNumber === n);

  const unpaidChallanId = outcomeByRow(2).challanId;
  const unpaid = await getFeeChallanByIdServer(A, unpaidChallanId);
  assert(unpaid?.status === "PENDING" && unpaid.paidAmount === 0 && unpaid.totalExpected === 3000, "Commit: unpaid row creates a PENDING challan with paidAmount 0");

  const paidChallanId = outcomeByRow(3).challanId;
  const paid = await getFeeChallanByIdServer(A, paidChallanId);
  assert(paid?.status === "PAID" && paid.paidAmount === 3500 && paid.balanceAmount === 0, "Commit: fully-paid row creates a PAID challan via a real recorded payment, not a bare flag");

  const partialChallanId = outcomeByRow(4).challanId;
  const partial = await getFeeChallanByIdServer(A, partialChallanId);
  assert(partial?.status === "PARTIAL" && partial.paidAmount === 1000 && partial.balanceAmount === 2000, "Commit: partially-paid row creates a PARTIAL challan with the correct balance");

  const mismatchChallanId = outcomeByRow(11).challanId;
  const mismatch = await getFeeChallanByIdServer(A, mismatchChallanId);
  assert(mismatch?.studentId === s1.id && mismatch.studentName === s1.fullName, "Commit: a mismatched-name row still files the challan under the real student the admission number identifies");

  // The pre-existing October/2026 challan is completely untouched by the whole import.
  const stillPre = await getFeeChallanByIdServer(A, preexisting.id);
  assert(stillPre?.paidAmount === 0 && stillPre.status === "PENDING" && stillPre.totalExpected === 3000, "Commit: the pre-existing challan the import correctly skipped was never modified");

  // ---------------------------------------------------------------- idempotent re-upload
  const pv2 = await json(await importPost(uploadReq(ADMIN_A, csv)));
  assert(pv2.rows.find((r: any) => r.rowNumber === 2).status === "DUPLICATE", "Re-upload: a row already imported is now reported DUPLICATE");
  assert(pv2.rows.find((r: any) => r.rowNumber === 3).status === "DUPLICATE", "Re-upload: the paid row is now reported DUPLICATE too");
  const cm2 = await json(await importPost(req(ADMIN_A, "http://x/api/fees/import", "POST", {
    rows: [{ rowNumber: 2, input: importableRows[0].input }],
  })));
  assert(cm2.summary.imported === 0 && cm2.summary.skipped === 1, "Re-upload commit: re-submitting an already-imported row imports nothing (no duplicate challan)");
  const allForStudent = await getFeeChallansServer(A, s2.id, undefined, undefined, undefined, undefined, { allSessions: true });
  assert(allForStudent.filter((c) => c.month === "November" && c.year === 2026).length === 1, "Re-upload commit: exactly one November/2026 challan exists for the student, not two");

  // ---------------------------------------------------------------- cross-school isolation
  const crossCsv = csvOf([header, ["STD-2026-001", "Ali Khan", "March", "2027", "3000", "0", "0", "0", "0", "0", "", "", ""]]);
  const pvCross = await json(await importPost(uploadReq(ADMIN_B, crossCsv)));
  assert(pvCross.rows[0].status === "INVALID" && pvCross.rows[0].errors.some((e: string) => e.includes("No student found")), "Cross-school: school A's admission number does not resolve for school B's admin");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
