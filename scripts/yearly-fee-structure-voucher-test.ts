/**
 * Yearly Fee Structure import (`/api/fees/structure-import`) and automatic Monthly Voucher
 * Generation (`/api/fees/vouchers/generate`): admission-number matching, ambiguous/duplicate
 * admission number rejection, idempotent re-import (NEW/UPDATE/UNCHANGED), per-academic-year
 * isolation, one-time admission/annual charges applied exactly once, duplicate-generation
 * protection, no double-counting of previous dues against the existing print-time calculation
 * in fee-voucher.ts, advance-balance auto-application, and role/school isolation.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { POST as structureImportPost, GET as structureListGet } from "../src/app/api/fees/structure-import/route";
import { POST as generatePost } from "../src/app/api/fees/vouchers/generate/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  getFeeChallansServer,
  getFeeChallanByIdServer,
  getYearlyFeeStructuresServer,
  getYearlyFeeStructureForStudentServer,
  getFeeStructureImportBatchesServer,
  adjustAdvanceBalanceServer,
  getAdvanceBalanceServer,
  getPaymentsByStudentServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, StudentDoc } from "../src/lib/firebase/types";
import { FEE_STRUCTURE_IMPORT_TEMPLATE_HEADERS } from "../src/lib/fee-structure-import";
import { pendingFeesFor, computeVoucherAmounts } from "../src/lib/fee-voucher";

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

function uploadReq(token: string | null, url: string, content: string) {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), "structure.csv");
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(url, { method: "POST", headers, body: fd });
}

function csvOf(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\r\n");
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("YEARLY FEE STRUCTURE IMPORT + MONTHLY VOUCHER GENERATION");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-yfs-a";
  const B = "school-yfs-b";
  const YEAR = "2026-2027";
  const NEXT_YEAR = "2027-2028";

  const cls = (id: string, schoolId: string, name = "Class 5"): ClassDoc => ({
    id, schoolId, name, section: "A", numericLevel: 5, capacity: 40, classTeacherId: null,
    academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const classA = cls("cls-yfs-a", A);
  const classB = cls("cls-yfs-b", B);
  await saveClassServer(classA);
  await saveClassServer(classB);

  const student = (id: string, schoolId: string, classId: string, admissionNo: string, name: string): StudentDoc => ({
    id, schoolId, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now,
  });
  const s1 = student("std-yfs-1", A, classA.id, "YFS-001", "Ali Khan");
  const s2 = student("std-yfs-2", A, classA.id, "YFS-002", "Sara Khan");
  const s3 = student("std-yfs-3", A, classA.id, "YFS-003", "Bilal Raza");
  const sNoStructure = student("std-yfs-4", A, classA.id, "YFS-004", "Hina Noor");
  const sB = student("std-yfs-b", B, classB.id, "YFS-900", "Other School Student");
  await saveStudentServer(s1);
  await saveStudentServer(s2);
  await saveStudentServer(s3);
  await saveStudentServer(sNoStructure);
  await saveStudentServer(sB);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid });
  const ADMIN_A = await session("uid-yfs-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-yfs-admin-b", "ADMIN", B);
  const TEACHER_A = await session("uid-yfs-teacher-a", "TEACHER", A);

  const header = FEE_STRUCTURE_IMPORT_TEMPLATE_HEADERS;
  const previewUrl = `http://x/api/fees/structure-import?academicYear=${YEAR}`;

  // -----------------------------------------------------------------------
  // PREVIEW
  // -----------------------------------------------------------------------
  const previewRows = [
    header,
    ["YFS-001", "Ali Khan", "Class 5-A", "3700", "3000", "5000", "200", "0"],
    ["YFS-002", "Sarah Khan", "Class 5-A", "3700", "3000", "0", "200", "500"], // name mismatch -> warning
    ["YFS-999", "Ghost", "Class 5-A", "3700", "0", "0", "0", "0"], // unmatched
    ["YFS-001", "Ali Khan", "Class 5-A", "4000", "3000", "5000", "200", "0"], // duplicate admission no in file
  ];
  const previewRes = await structureImportPost(uploadReq(ADMIN_A, previewUrl, csvOf(previewRows)));
  const preview = await json(previewRes);
  assert(previewRes.status === 200, "Preview: parses a valid file");
  assert(preview.rows?.[0]?.status === "VALID" && preview.rows?.[0]?.action === "NEW", "Preview: row 1 (Ali Khan) is VALID and NEW");
  assert(preview.rows?.[1]?.status === "WARNING" && preview.rows?.[1]?.warnings?.length > 0, "Preview: name mismatch is a WARNING, not blocking");
  assert(preview.rows?.[2]?.status === "INVALID", "Preview: unmatched admission number is INVALID");
  assert(preview.rows?.[3]?.status === "DUPLICATE", "Preview: second row for YFS-001 in the same file is a DUPLICATE");
  assert(preview.summary?.newCount === 2, "Preview: summary counts 2 NEW rows (Ali + Sara)");

  // Ambiguous admission number: two students sharing one (a data problem, never silently
  // resolved) — a dedicated pair, so this never pollutes YFS-001's own assertions below.
  const ambiguous1 = student("std-yfs-amb-1", A, classA.id, "YFS-AMBIG", "Twin One");
  const ambiguous2 = student("std-yfs-amb-2", A, classA.id, "YFS-AMBIG", "Twin Two");
  await saveStudentServer(ambiguous1);
  await saveStudentServer(ambiguous2);
  const ambiguousPreview = await json(
    await structureImportPost(uploadReq(ADMIN_A, previewUrl, csvOf([header, ["YFS-AMBIG", "Twin One", "Class 5-A", "3700", "3000", "5000", "200", "0"]])))
  );
  assert(
    ambiguousPreview.rows?.[0]?.status === "INVALID" && /Ambiguous/i.test(ambiguousPreview.rows[0].errors.join(" ")),
    "Preview: ambiguous admission number shared by two students is rejected, never silently matched"
  );

  // -----------------------------------------------------------------------
  // COMMIT — NEW
  // -----------------------------------------------------------------------
  const commitUrl = "http://x/api/fees/structure-import";
  const commitBody1 = {
    academicYear: YEAR,
    fileName: "structure.csv",
    rows: [preview.rows[0], preview.rows[1]].map((r: any) => ({ rowNumber: r.rowNumber, input: r.input })),
  };
  const commit1 = await json(await structureImportPost(req(ADMIN_A, commitUrl, "POST", commitBody1)));
  assert(commit1.summary?.created === 2, "Commit: 2 structures created (Ali + Sara)");

  const structuresAfterFirst = await getYearlyFeeStructuresServer(A, YEAR);
  assert(structuresAfterFirst.length === 2, "2 YearlyFeeStructureDoc records now exist for this school/year");
  const aliStructure = structuresAfterFirst.find((s) => s.admissionNo === "YFS-001");
  assert(aliStructure?.monthlyTuitionFee === 3700 && aliStructure?.admissionFee === 5000, "Ali's structure stored the imported values correctly");

  // Re-committing the exact same file: idempotent, no duplicates, reported UNCHANGED.
  const commitRepeat = await json(await structureImportPost(req(ADMIN_A, commitUrl, "POST", commitBody1)));
  assert(commitRepeat.summary?.unchanged === 2 && commitRepeat.summary?.created === 0, "Re-commit of identical rows: UNCHANGED, not duplicated");
  assert((await getYearlyFeeStructuresServer(A, YEAR)).length === 2, "Still exactly 2 structure records after re-import");

  // Updated structure: without allowUpdates, skipped (old values preserved).
  const changedPreviewRows = [header, ["YFS-001", "Ali Khan", "Class 5-A", "4200", "3000", "5000", "200", "0"]];
  const changedPreview = await json(await structureImportPost(uploadReq(ADMIN_A, previewUrl, csvOf(changedPreviewRows))));
  assert(changedPreview.rows?.[0]?.action === "UPDATE", "Preview: a changed monthly fee for an existing student is flagged UPDATE");
  const skipUpdateCommit = await json(
    await structureImportPost(req(ADMIN_A, commitUrl, "POST", { academicYear: YEAR, rows: [{ rowNumber: changedPreview.rows[0].rowNumber, input: changedPreview.rows[0].input }] }))
  );
  assert(skipUpdateCommit.summary?.skipped === 1 && skipUpdateCommit.summary?.updated === 0, "Commit without allowUpdates: UPDATE row is skipped, not applied");
  assert((await getYearlyFeeStructureForStudentServer(A, s1.id, YEAR))?.monthlyTuitionFee === 3700, "Ali's structure is unchanged after the skipped update");

  // With allowUpdates=true, the update is applied.
  const allowUpdateCommit = await json(
    await structureImportPost(
      req(ADMIN_A, commitUrl, "POST", { academicYear: YEAR, allowUpdates: true, rows: [{ rowNumber: changedPreview.rows[0].rowNumber, input: changedPreview.rows[0].input }] })
    )
  );
  assert(allowUpdateCommit.summary?.updated === 1, "Commit with allowUpdates=true: UPDATE is applied");
  assert((await getYearlyFeeStructureForStudentServer(A, s1.id, YEAR))?.monthlyTuitionFee === 4200, "Ali's monthly tuition fee is now 4200 after the explicit update");

  // A different academic year is a completely separate structure.
  const nextYearCommit = await json(
    await structureImportPost(
      req(ADMIN_A, commitUrl, "POST", { academicYear: NEXT_YEAR, rows: [{ rowNumber: 2, input: { admissionNo: "YFS-001", monthlyTuitionFee: "5000", annualFee: "0", admissionFee: "0", otherCharges: "0", discount: "0" } }] })
    )
  );
  assert(nextYearCommit.summary?.created === 1, `Commit: a structure for ${NEXT_YEAR} is created independently`);
  assert((await getYearlyFeeStructureForStudentServer(A, s1.id, YEAR))?.monthlyTuitionFee === 4200, `${YEAR}'s structure for Ali is untouched by the ${NEXT_YEAR} import`);
  assert((await getYearlyFeeStructureForStudentServer(A, s1.id, NEXT_YEAR))?.monthlyTuitionFee === 5000, `${NEXT_YEAR}'s structure for Ali was created independently`);

  // Import history.
  const batches = await getFeeStructureImportBatchesServer(A, YEAR);
  assert(batches.length >= 3, "Import history: every commit for this academic year is recorded");

  // Security.
  const teacherPreview = await structureImportPost(uploadReq(TEACHER_A, previewUrl, csvOf([header, ["YFS-001", "", "", "1000", "0", "0", "0", "0"]])));
  assert(teacherPreview.status === 403, "Unauthorized: a TEACHER cannot import the yearly fee structure");

  const crossSchoolPreview = await json(
    await structureImportPost(uploadReq(ADMIN_B, `http://x/api/fees/structure-import?academicYear=${YEAR}`, csvOf([header, ["YFS-001", "Ali Khan", "Class 5-A", "3700", "0", "0", "0", "0"]])))
  );
  assert(crossSchoolPreview.rows?.[0]?.status === "INVALID", "Cross-school: school A's admission number is not matched for school B's admin");

  const listRes = await json(await structureListGet(req(ADMIN_A, `http://x/api/fees/structure-import?academicYear=${YEAR}`)));
  assert(listRes.structures?.length === 2, "GET: the structure list for this school/year returns both records");

  // -----------------------------------------------------------------------
  // MONTHLY VOUCHER GENERATION
  // -----------------------------------------------------------------------
  const genUrl = (commit: boolean) => `http://x/api/fees/vouchers/generate${commit ? "?commit=true" : ""}`;

  // Preview (no commit) — nothing is written.
  const genPreview = await json(
    await generatePost(req(ADMIN_A, genUrl(false), "POST", { academicYear: YEAR, month: "September", year: 2026, scope: "SCHOOL" }))
  );
  assert(genPreview.committed === false, "Generation preview: reports committed=false");
  const aliPreviewRow = genPreview.rows.find((r: any) => r.admissionNo === "YFS-001");
  assert(aliPreviewRow?.action === "GENERATED" && aliPreviewRow?.totalExpected === 4200 + 5000 + 3000 + 200, "Preview: Ali's planned September voucher includes the one-time admission+annual fee");
  const hinaPreviewRow = genPreview.rows.find((r: any) => r.admissionNo === "YFS-004");
  assert(hinaPreviewRow?.action === "SKIPPED_NO_STRUCTURE", "Preview: a student with no yearly fee structure is skipped, not fabricated");
  assert((await getFeeChallansServer(A, s1.id, "September", 2026)).length === 0, "Preview truly wrote nothing — no September challan exists for Ali yet");

  // Commit — SCHOOL scope.
  const genCommit1 = await json(await generatePost(req(ADMIN_A, genUrl(true), "POST", { academicYear: YEAR, month: "September", year: 2026, scope: "SCHOOL" })));
  assert(genCommit1.summary?.generated === 2, "Commit: vouchers generated for Ali and Sara (both have a structure); everyone else in the class is skipped");
  // Bilal, Hina, and the two ambiguous-admission-number twins all lack a structure at this point.
  assert(genCommit1.summary?.skippedNoStructure === 4, "Commit: every structure-less active student in the class is counted as skipped-no-structure");

  const aliSeptChallans = await getFeeChallansServer(A, s1.id, "September", 2026);
  assert(aliSeptChallans.length === 1, "Exactly one September challan now exists for Ali");
  const aliSept = aliSeptChallans[0];
  assert(aliSept.tuitionFee === 4200 && aliSept.admissionFee === 5000 && aliSept.annualFeeCharged === 3000 && aliSept.otherFee === 200, "Ali's generated September challan carries the correct one-time + recurring charges");
  assert(aliSept.totalExpected === 4200 + 5000 + 3000 + 200, "Ali's September totalExpected is tuition+admission+annual+other (no previous-dues baked in)");
  assert(aliSept.oneTimeChargesApplied === true, "Ali's September challan is flagged as having applied the one-time charges");

  // Duplicate-generation protection: running the exact same commit again must not create a second September challan.
  const genCommitDup = await json(await generatePost(req(ADMIN_A, genUrl(true), "POST", { academicYear: YEAR, month: "September", year: 2026, scope: "SCHOOL" })));
  assert(genCommitDup.summary?.skippedExists >= 2, "Re-running generation for the same month: both students are reported as already-generated");
  assert((await getFeeChallansServer(A, s1.id, "September", 2026)).length === 1, "Duplicate-generation protection: still exactly one September challan for Ali");

  // Second month: one-time charges are never applied twice.
  const genCommit2 = await json(await generatePost(req(ADMIN_A, genUrl(true), "POST", { academicYear: YEAR, month: "October", year: 2026, scope: "STUDENT", studentId: s1.id })));
  assert(genCommit2.summary?.generated === 1, "Commit: October voucher generated for Ali via STUDENT scope");
  const aliOct = (await getFeeChallansServer(A, s1.id, "October", 2026))[0];
  assert(aliOct.admissionFee === 0 && aliOct.annualFeeCharged === 0, "Ali's October voucher does NOT re-apply the one-time admission/annual fee");
  assert(aliOct.totalExpected === 4200 + 200, "Ali's October totalExpected is tuition+other only, correctly excluding the one-time charges");

  // No double-counting of previous dues: the September challan's own stored totalExpected never
  // included anything from before it, and the EXISTING print-time calculation (fee-voucher.ts)
  // is what carries September's unpaid balance into October's printed "Pending Fees" — once,
  // not duplicated by generation also baking it into October's totalExpected.
  const allAliChallans = [aliSept, aliOct];
  const pendingForOct = pendingFeesFor(aliOct, allAliChallans);
  assert(pendingForOct === aliSept.totalExpected, "Print-time pendingFees for October equals September's full unpaid balance, counted exactly once");
  const octAmounts = computeVoucherAmounts(aliOct, allAliChallans);
  assert(octAmounts.total === aliOct.totalExpected + pendingForOct, "Printed October total = October's own charges + September's carried-over balance (not pre-baked into totalExpected)");

  // CLASS scope.
  const genClass = await json(await generatePost(req(ADMIN_A, genUrl(true), "POST", { academicYear: YEAR, month: "October", year: 2026, scope: "CLASS", classId: classA.id })));
  assert(genClass.summary?.generated === 1, "CLASS scope: only Sara still needed an October voucher (Ali already has one)");
  assert(genClass.summary?.skippedExists === 1, "CLASS scope: Ali's October voucher is correctly recognised as already existing");

  // Advance balance auto-application.
  await adjustAdvanceBalanceServer(A, s2.id, YEAR, 2000); // Sara has a 2000 advance credit
  const genCommitNov = await json(await generatePost(req(ADMIN_A, genUrl(true), "POST", { academicYear: YEAR, month: "November", year: 2026, scope: "STUDENT", studentId: s2.id })));
  const saraNovRow = genCommitNov.rows[0];
  assert(saraNovRow.advanceApplied === 2000, "Advance balance: Sara's 2000 credit is auto-applied to her November voucher");
  const saraNov = (await getFeeChallansServer(A, s2.id, "November", 2026))[0];
  assert(saraNov.paidAmount === 2000 && saraNov.balanceAmount === saraNov.totalExpected - 2000, "Sara's November voucher correctly shows 2000 already paid from advance");
  assert((await getAdvanceBalanceServer(A, s2.id, YEAR))?.balance === 0, "Sara's advance balance is fully consumed, not left dangling");
  const saraPayments = await getPaymentsByStudentServer(A, s2.id);
  assert(saraPayments.some((p) => p.paymentMode === "ADVANCE_CREDIT" && p.amount === 2000), "A real ADVANCE_CREDIT PaymentDoc records the auto-application, visible in payment history");

  // Advance overshoot: never goes negative, remainder stays as the student's advance balance.
  await structureImportPost(
    req(ADMIN_A, commitUrl, "POST", { academicYear: YEAR, rows: [{ rowNumber: 2, input: { admissionNo: s3.admissionNo, monthlyTuitionFee: "3000", annualFee: "0", admissionFee: "0", otherCharges: "0", discount: "0" } }] })
  );
  await adjustAdvanceBalanceServer(A, s3.id, YEAR, 999999);
  const genCommitS3 = await json(
    await generatePost(req(ADMIN_A, genUrl(true), "POST", { academicYear: YEAR, month: "September", year: 2026, scope: "STUDENT", studentId: s3.id }))
  );
  const s3Sept = (await getFeeChallansServer(A, s3.id, "September", 2026))[0];
  assert(s3Sept.status === "PAID" && s3Sept.balanceAmount === 0, "A huge advance balance fully pays the voucher without overpaying it");
  const s3Balance = await getAdvanceBalanceServer(A, s3.id, YEAR);
  assert((s3Balance?.balance || 0) === 999999 - s3Sept.totalExpected, "Only the voucher's own total is deducted from the advance balance; the remainder is preserved, never negative");

  // Security.
  const teacherGen = await generatePost(req(TEACHER_A, genUrl(true), "POST", { academicYear: YEAR, month: "December", year: 2026, scope: "SCHOOL" }));
  assert(teacherGen.status === 403, "Unauthorized: a TEACHER cannot generate vouchers");

  const crossSchoolGen = await generatePost(req(ADMIN_B, genUrl(true), "POST", { academicYear: YEAR, month: "September", year: 2026, scope: "STUDENT", studentId: s1.id }));
  assert(crossSchoolGen.status === 404, "Cross-school: school B's admin cannot generate a voucher for school A's student");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
