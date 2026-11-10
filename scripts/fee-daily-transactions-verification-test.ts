import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { POST as previewHandler } from "../src/app/api/fees/transactions/import/preview/route";
import { POST as commitHandler } from "../src/app/api/fees/transactions/import/commit/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveStudentServer,
  saveFeeChallanServer,
  getFeeChallanByIdServer,
  getAdvanceBalanceServer,
  getPaymentsServer,
} from "../src/lib/firebase/server-db";
import { StudentDoc, FeeChallanDoc } from "../src/lib/firebase/types";

function buildWorkbookBuffer(headers: string[], rows: any[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function fileFromBuffer(buf: Buffer, name: string): File {
  return new File([new Uint8Array(buf)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const HEADERS = ["PaymentDate", "AdmissionNumber", "StudentName", "Class", "Amount", "PaymentCategory", "TransactionDetails", "PaymentMethod", "ReferenceNumber"];

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: DAILY FEE TRANSACTIONS (PHASE 4)");
  console.log("==================================================");

  let passed = 0;
  let total = 0;
  function assert(condition: boolean, name: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${name}`);
      process.exitCode = 1;
    }
  }

  const schoolId = "school-daily-txn-test-001";
  const academicYear = "2025-2026";

  const student: StudentDoc = {
    id: "std-dtt-1",
    schoolId,
    admissionNo: "DT-001",
    fullName: "Noor Fatima",
    fatherName: "Shahid Iqbal",
    gender: "FEMALE",
    classId: "cls-dtt-7a",
    className: "Grade 7",
    section: "A",
    rollNo: "9",
    status: "ACTIVE",
    guardianName: "Shahid Iqbal",
    guardianPhone: "03009998888",
    guardianRelation: "Father",
    monthlyFee: 0,
    discount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStudentServer(student);

  const sepChallan: FeeChallanDoc = {
    id: "ch-dtt-sep",
    schoolId,
    studentId: student.id,
    studentName: student.fullName,
    admissionNo: student.admissionNo,
    classId: student.classId,
    className: student.className,
    challanNo: "MV-SEP-DTT",
    month: "September",
    year: 2025,
    issueDate: "2025-09-01",
    dueDate: "2025-09-10",
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
    academicYear,
    source: "AUTO_MONTHLY",
  };
  const octChallan: FeeChallanDoc = { ...sepChallan, id: "ch-dtt-oct", challanNo: "MV-OCT-DTT", month: "October", issueDate: "2025-10-01", dueDate: "2025-10-10", totalExpected: 5000, balanceAmount: 5000 };
  await saveFeeChallanServer(sepChallan);
  await saveFeeChallanServer(octChallan);

  const adminToken = await createSessionCookieServer({ uid: "usr-admin-dtt", email: "admin-dtt@example.com", role: "ADMIN", schoolId, name: "Admin" });
  const teacherToken = await createSessionCookieServer({ uid: "usr-teacher-dtt", email: "teacher-dtt@example.com", role: "TEACHER", schoolId, name: "Teacher" });

  function multipartReq(path: string, file: File, academicYearValue: string, cookie: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("academicYear", academicYearValue);
    return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: { cookie }, body: form as any });
  }

  // ----------------------------------------------------
  // TEST: Teachers cannot import payments
  // ----------------------------------------------------
  const buf0 = buildWorkbookBuffer(HEADERS, [["2025-09-05", "DT-001", "Noor Fatima", "Grade 7", 1000, "Tuition Fee", "", "CASH", ""]]);
  const teacherRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(buf0, "t.xlsx"), academicYear, `allied_session=${teacherToken}`));
  assert(teacherRes.status === 403, "Teacher is forbidden from previewing transaction import (admin-only)");

  // ----------------------------------------------------
  // TEST: Partial payment allocates to oldest unpaid voucher (September) first
  // ----------------------------------------------------
  const bufPartial = buildWorkbookBuffer(HEADERS, [["2025-09-05", "DT-001", "Noor Fatima", "Grade 7", 3000, "Tuition Fee", "Counter payment", "CASH", ""]]);
  const partialPreviewRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(bufPartial, "p.xlsx"), academicYear, `allied_session=${adminToken}`));
  const partialPreview = await partialPreviewRes.json();
  assert(
    partialPreview.rows[0].action === "ALLOCATED" && partialPreview.rows[0].allocation.lines[0].challanId === "ch-dtt-sep" && partialPreview.rows[0].allocation.lines[0].amountApplied === 3000,
    "Preview allocates partial payment to September voucher (oldest unpaid first)"
  );

  const partialCommitRes = await commitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufPartial, "p.xlsx"), academicYear, `allied_session=${adminToken}`));
  const partialCommit = await partialCommitRes.json();
  assert(partialCommit.success && partialCommit.summary.allocatedCount === 1, "Commit allocates the partial payment");

  const sepAfterPartial = await getFeeChallanByIdServer(schoolId, "ch-dtt-sep");
  assert(sepAfterPartial?.paidAmount === 3000 && sepAfterPartial?.status === "PARTIAL", "September voucher shows PARTIAL status with correct paid amount");

  // ----------------------------------------------------
  // TEST: Re-importing the identical file is a no-op (duplicate protection)
  // ----------------------------------------------------
  const repeatPreviewRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(bufPartial, "p.xlsx"), academicYear, `allied_session=${adminToken}`));
  const repeatPreview = await repeatPreviewRes.json();
  assert(repeatPreview.rows[0].action === "DUPLICATE_EXISTS", "Re-uploading the identical file is detected as a duplicate against prior history");

  const repeatCommitRes = await commitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufPartial, "p.xlsx"), academicYear, `allied_session=${adminToken}`));
  const repeatCommit = await repeatCommitRes.json();
  assert(repeatCommit.summary.allocatedCount === 0, "Committing a duplicate file allocates nothing (no double counting)");
  const sepAfterRepeat = await getFeeChallanByIdServer(schoolId, "ch-dtt-sep");
  assert(sepAfterRepeat?.paidAmount === 3000, "September voucher's paid amount is unchanged after the duplicate re-import");

  // ----------------------------------------------------
  // TEST: Two rows for the same student in one file are allocated sequentially
  // (second row sees the first row's effect, not the stale pre-file balance)
  // ----------------------------------------------------
  const bufSequential = buildWorkbookBuffer(HEADERS, [
    ["2025-09-06", "DT-001", "Noor Fatima", "Grade 7", 2000, "Tuition Fee", "Settle September balance", "CASH", "RCPT-SEQ-1"],
    ["2025-09-07", "DT-001", "Noor Fatima", "Grade 7", 4000, "Tuition Fee", "Pay towards October", "CASH", "RCPT-SEQ-2"],
  ]);
  const seqPreviewRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(bufSequential, "seq.xlsx"), academicYear, `allied_session=${adminToken}`));
  const seqPreview = await seqPreviewRes.json();
  assert(
    seqPreview.rows[0].allocation.lines[0].challanId === "ch-dtt-sep" && seqPreview.rows[0].allocation.lines[0].amountApplied === 2000,
    "First row in sequence settles the remaining September balance (2000)"
  );
  assert(
    seqPreview.rows[1].allocation.lines[0].challanId === "ch-dtt-oct" && seqPreview.rows[1].allocation.lines[0].amountApplied === 4000,
    "Second row in the same file correctly sees September as already settled and applies to October"
  );

  await commitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufSequential, "seq.xlsx"), academicYear, `allied_session=${adminToken}`));
  const sepFinal = await getFeeChallanByIdServer(schoolId, "ch-dtt-sep");
  const octFinal = await getFeeChallanByIdServer(schoolId, "ch-dtt-oct");
  assert(sepFinal?.status === "PAID" && sepFinal?.balanceAmount === 0, "September voucher fully settled after sequential import");
  assert(octFinal?.paidAmount === 4000 && octFinal?.status === "PARTIAL", "October voucher receives the remainder from the second row");

  // ----------------------------------------------------
  // TEST: Overpayment beyond all outstanding dues becomes an advance credit
  // ----------------------------------------------------
  const bufAdvance = buildWorkbookBuffer(HEADERS, [["2025-09-08", "DT-001", "Noor Fatima", "Grade 7", 5000, "Tuition Fee", "Advance payment", "BANK_TRANSFER", "RCPT-ADV-1"]]);
  const advPreviewRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(bufAdvance, "adv.xlsx"), academicYear, `allied_session=${adminToken}`));
  const advPreview = await advPreviewRes.json();
  assert(
    advPreview.rows[0].allocation.lines[0].amountApplied === 1000 && advPreview.rows[0].allocation.advanceAmount === 4000,
    "Payment beyond October's remaining balance (1000) becomes a 4000 advance credit"
  );

  await commitHandler(multipartReq("/api/fees/transactions/import/commit", fileFromBuffer(bufAdvance, "adv.xlsx"), academicYear, `allied_session=${adminToken}`));
  const advanceBalance = await getAdvanceBalanceServer(schoolId, student.id, academicYear);
  assert(advanceBalance?.balance === 4000, "Advance balance correctly credited after commit");

  // ----------------------------------------------------
  // TEST: Unmatched admission number is rejected, not matched by name alone
  // ----------------------------------------------------
  const bufUnmatched = buildWorkbookBuffer(HEADERS, [["2025-09-09", "DT-999", "Noor Fatima", "Grade 7", 1000, "Tuition Fee", "", "CASH", ""]]);
  const unmatchedRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(bufUnmatched, "u.xlsx"), academicYear, `allied_session=${adminToken}`));
  const unmatchedPreview = await unmatchedRes.json();
  assert(unmatchedPreview.rows[0].action === "ERROR" && !unmatchedPreview.rows[0].studentId, "Unmatched Admission Number is rejected, never matched by name alone");

  // ----------------------------------------------------
  // TEST: Invalid amount (zero / negative / missing) rejected
  // ----------------------------------------------------
  const bufInvalid = buildWorkbookBuffer(HEADERS, [["2025-09-09", "DT-001", "Noor Fatima", "Grade 7", 0, "Tuition Fee", "", "CASH", ""]]);
  const invalidRes = await previewHandler(multipartReq("/api/fees/transactions/import/preview", fileFromBuffer(bufInvalid, "inv.xlsx"), academicYear, `allied_session=${adminToken}`));
  const invalidPreview = await invalidRes.json();
  assert(invalidPreview.rows[0].action === "ERROR", "Zero/invalid payment amount is rejected");

  // ----------------------------------------------------
  // TEST: Payment history is never overwritten — two allocations against the same
  // voucher both remain as separate permanent PaymentDoc records.
  // ----------------------------------------------------
  const allPayments = await getPaymentsServer(schoolId, student.id);
  const sepPayments = allPayments.filter((p) => p.challanId === "ch-dtt-sep");
  assert(sepPayments.length === 2, "September voucher has two separate permanent payment records (3000 + 2000), neither overwritten");

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
