/**
 * Voucher Management (Phase 10): every recorded payment IS a voucher — see
 * src/lib/firebase/server-db.ts's "VOUCHER MANAGEMENT" section for why there is no separate
 * vouchers collection. This exercises the business rules the school approved:
 *
 *  1/9. Daily summaries are computed from actual saved payment/adjustment records, keyed by the
 *       voucher's own paymentDate.
 *  2.   Each voucher counts exactly once in its day's gross count/amount.
 *  3.   A locked voucher stays in daily reports (locked != excluded).
 *  4.   Editing within 24h updates the SAME record and recalculates the challan; never a new row.
 *  5.   Past 24h, direct edit is refused — on the server, regardless of any client claim.
 *  6/7. A reversal/adjustment past the lock preserves the original voucher, is fully audited, and
 *       nets out of daily totals while the original stays visible for audit.
 *  11.  Re-submitting an import never double-counts (covered by fee-import-test.ts; not repeated
 *       here).
 *  12.  Only ADMIN can read or write any of this.
 *
 * Runs against the in-memory store, like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { GET as vouchersGet } from "../src/app/api/vouchers/route";
import { GET as voucherGet, PUT as voucherPut } from "../src/app/api/vouchers/[id]/route";
import { POST as voucherAdjustPost } from "../src/app/api/vouchers/[id]/adjust/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveStudentServer,
  saveFeeChallanServer,
  recordPaymentServer,
  getFeeChallanByIdServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, FeeChallanDoc, PaymentDoc, StudentDoc } from "../src/lib/firebase/types";

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
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  console.log("==================================================");
  console.log("VOUCHER MANAGEMENT");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-vch-a";
  const B = "school-vch-b";
  const YEAR = "2026-2027";
  const today = new Date().toISOString().split("T")[0];

  const classA: ClassDoc = {
    id: "cls-vch-a", schoolId: A, name: "Class 6", section: "A", numericLevel: 6, capacity: 40,
    classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now,
  };
  await saveClassServer(classA);

  const student: StudentDoc = {
    id: "std-vch-1", schoolId: A, admissionNo: "STD-2026-501", fullName: "Hassan Raza", fatherName: "Raza",
    gender: "MALE", classId: classA.id, section: "A", rollNo: "1", status: "ACTIVE", guardianName: "Raza",
    guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 3000, discount: 0, academicYear: YEAR,
    className: "Class 6-A", createdAt: now, updatedAt: now,
  };
  await saveStudentServer(student);

  const challan: FeeChallanDoc = {
    id: "ch-vch-1", schoolId: A, studentId: student.id, studentName: student.fullName, admissionNo: student.admissionNo,
    classId: classA.id, className: "Class 6-A", challanNo: "CH-VCH-1", month: "November", year: 2026,
    issueDate: today, dueDate: today, tuitionFee: 3000, admissionFee: 0, examFee: 0, otherFee: 0, discount: 0,
    totalExpected: 3000, paidAmount: 0, balanceAmount: 3000, status: "PENDING", academicYear: YEAR,
    createdAt: now, updatedAt: now,
  };
  await saveFeeChallanServer(challan);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid });
  const ADMIN_A = await session("uid-vch-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-vch-admin-b", "ADMIN", B);
  const TEACHER_A = await session("uid-vch-teacher-a", "TEACHER", A);

  // Voucher A: just recorded, still inside its 24h edit window.
  const voucherA: PaymentDoc = {
    id: "pay-vch-a", schoolId: A, challanId: challan.id, studentId: student.id, studentName: student.fullName,
    receiptNo: "RCT-VCH-A", amount: 2000, paymentDate: today, paymentMode: "CASH", collectedBy: "uid-vch-admin-a",
    createdAt: now,
  };
  await recordPaymentServer(voucherA);

  // Voucher B: recorded 25 hours ago — past its edit window, locked.
  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const voucherB: PaymentDoc = {
    id: "pay-vch-b", schoolId: A, challanId: challan.id, studentId: student.id, studentName: student.fullName,
    receiptNo: "RCT-VCH-B", amount: 500, paymentDate: today, paymentMode: "CASH", collectedBy: "uid-vch-admin-a",
    createdAt: twentyFiveHoursAgo,
  };
  await recordPaymentServer(voucherB);

  const challanAfterSeed = await getFeeChallanByIdServer(A, challan.id);
  assert(challanAfterSeed?.paidAmount === 2500, "Setup: challan paidAmount reflects both seeded vouchers (2000 + 500)");

  // ---- Access control -------------------------------------------------
  {
    const res = await vouchersGet(req(null, `http://x/api/vouchers?from=${today}&to=${today}`));
    assert(res.status === 401, "1. Unauthenticated GET is rejected (401)");
  }
  {
    const res = await vouchersGet(req(TEACHER_A, `http://x/api/vouchers?from=${today}&to=${today}`));
    assert(res.status === 403, "2. A TEACHER cannot access the voucher register (403)");
  }

  // ---- Daily register, before any edit/reversal ------------------------
  {
    const res = await vouchersGet(req(ADMIN_A, `http://x/api/vouchers?from=${today}&to=${today}`));
    const data = await json(res);
    assert(res.status === 200, "3. ADMIN can load the daily voucher register (200)");
    const day = data.days?.find((d: any) => d.date === today);
    assert(day?.grossCount === 2, "4. Daily gross count is exactly 2 (each voucher counted once)");
    assert(day?.grossAmount === 2500, "5. Daily gross amount is 2000 + 500 = 2500");
    assert(day?.validCount === 2 && day?.reversedCount === 0, "6. Both vouchers are currently valid, none reversed");
    assert(day?.lockedCount === 1, "7. Exactly one voucher (B, 25h old) is locked");
    assert(day?.netAmount === 2500, "8. Net amount equals gross amount before any adjustment");
    const rowA = data.vouchers?.find((v: any) => v.id === voucherA.id);
    const rowB = data.vouchers?.find((v: any) => v.id === voucherB.id);
    assert(rowA?.locked === false, "9. Voucher A (just recorded) is reported unlocked");
    assert(rowB?.locked === true, "10. Voucher B (25h old) is reported locked, and still appears in the register");
    assert(rowA?.admissionNo === student.admissionNo && rowA?.className === "Class 6-A", "11. Voucher rows carry admission number and class from the challan");
  }

  // ---- Rule 4: edit within the window updates the SAME record ----------
  {
    const res = await voucherPut(req(ADMIN_A, `http://x/api/vouchers/${voucherA.id}`, "PUT", { amount: 2200 }), paramsOf(voucherA.id));
    const data = await json(res);
    assert(res.status === 200 && data.voucher?.amount === 2200, "12. Editing an unlocked voucher updates its amount");
    assert(data.voucher?.id === voucherA.id, "13. The edit updates the same voucher id, never creates a new one");
    const challanAfterEdit = await getFeeChallanByIdServer(A, challan.id);
    assert(challanAfterEdit?.paidAmount === 2700, "14. Challan paidAmount recalculated (500 + 2200), not doubled");
    assert(challanAfterEdit?.status === "PARTIAL", "15. Challan status recomputed to PARTIAL (2700 of 3000)");
  }

  // ---- Rule 5: a locked voucher cannot be edited directly, server-side --
  {
    const res = await voucherPut(req(ADMIN_A, `http://x/api/vouchers/${voucherB.id}`, "PUT", { amount: 999 }), paramsOf(voucherB.id));
    const data = await json(res);
    assert(res.status === 409 && /locked/i.test(data.error || ""), "16. Editing a locked voucher is refused (409), with no client-side bypass possible");
  }

  // ---- Cross-school isolation -------------------------------------------
  {
    const res = await voucherGet(req(ADMIN_B, `http://x/api/vouchers/${voucherA.id}`), paramsOf(voucherA.id));
    assert(res.status === 404, "17. School B's admin cannot read school A's voucher (404, not leaked)");
  }

  // ---- Rule 6/7: reversal of a locked voucher, fully audited ------------
  {
    const missingReason = await voucherAdjustPost(
      req(ADMIN_A, `http://x/api/vouchers/${voucherB.id}/adjust`, "POST", { type: "REVERSAL", reason: "no" }),
      paramsOf(voucherB.id)
    );
    assert(missingReason.status === 400, "18. A too-short reason is rejected (400)");

    const res = await voucherAdjustPost(
      req(ADMIN_A, `http://x/api/vouchers/${voucherB.id}/adjust`, "POST", {
        type: "REVERSAL",
        reason: "Duplicate counter entry, refunded to parent in cash.",
      }),
      paramsOf(voucherB.id)
    );
    const data = await json(res);
    assert(res.status === 200 && data.adjustment?.amount === -500, "19. Reversal derives the exact amount that zeroes this voucher's net (-500)");
    assert(data.voucher?.voucherStatus === "REVERSED", "20. The voucher's status is now REVERSED");
    assert(data.voucher?.amount === 500 && data.voucher?.createdAt === twentyFiveHoursAgo, "21. The original amount/createdAt are preserved untouched, not rewritten");

    const challanAfterReversal = await getFeeChallanByIdServer(A, challan.id);
    assert(challanAfterReversal?.paidAmount === 2200, "22. Challan paidAmount reduced by exactly the reversed amount (2700 - 500)");
    assert(challanAfterReversal?.status === "PARTIAL", "23. Challan status recomputed to PARTIAL (2200 of 3000)");

    const again = await voucherAdjustPost(
      req(ADMIN_A, `http://x/api/vouchers/${voucherB.id}/adjust`, "POST", { type: "REVERSAL", reason: "Trying to reverse twice." }),
      paramsOf(voucherB.id)
    );
    assert(again.status === 409, "24. A voucher cannot be reversed twice (409)");
  }

  // ---- Rule 3/7/8: daily report after the reversal -----------------------
  {
    const res = await vouchersGet(req(ADMIN_A, `http://x/api/vouchers?from=${today}&to=${today}`));
    const data = await json(res);
    const day = data.days?.find((d: any) => d.date === today);
    assert(day?.grossCount === 2, "25. Gross count is unchanged by a reversal (the voucher still happened)");
    assert(day?.reversedCount === 1 && day?.validCount === 1, "26. One voucher is now reversed, one remains valid");
    assert(day?.adjustmentCount === 1 && day?.adjustmentAmount === -500, "27. The reversal is reported as adjustment activity for that day");
    assert(day?.netAmount === 2200, "28. Net amount excludes the reversed voucher (2700 - 500 = 2200)");
    const rowB = data.vouchers?.find((v: any) => v.id === voucherB.id);
    assert(rowB?.voucherStatus === "REVERSED", "29. The reversed voucher still appears in the register for audit, clearly marked");
  }

  // ---- Rule 6: a partial correction (ADJUSTMENT) on an unlocked voucher --
  {
    const res = await voucherAdjustPost(
      req(ADMIN_A, `http://x/api/vouchers/${voucherA.id}/adjust`, "POST", {
        type: "ADJUSTMENT",
        amount: -200,
        reason: "Rs. 200 counted twice at the counter, corrected same day.",
      }),
      paramsOf(voucherA.id)
    );
    const data = await json(res);
    assert(res.status === 200 && data.adjustment?.amount === -200, "30. A partial ADJUSTMENT applies the exact signed delta supplied");
    assert(data.voucher?.voucherStatus !== "REVERSED", "31. An ADJUSTMENT (unlike a REVERSAL) leaves the voucher's status ACTIVE");
    assert(data.voucher?.amount === 2200, "32. An ADJUSTMENT never rewrites the original amount field");

    const challanAfterAdjustment = await getFeeChallanByIdServer(A, challan.id);
    assert(challanAfterAdjustment?.paidAmount === 2000, "33. Challan paidAmount reflects the adjustment (2200 - 200)");

    const summary = await json(await vouchersGet(req(ADMIN_A, `http://x/api/vouchers?from=${today}&to=${today}`)));
    const day = summary.days?.find((d: any) => d.date === today);
    // Voucher A's amount is 2200 (the direct edit in step 12 legitimately changed the stored
    // field, as rule 4 intends); the later ADJUSTMENT applies a -200 delta without touching it
    // again. Gross = 2200 (A) + 500 (B) = 2700, unaffected by either the reversal or the
    // adjustment, both of which only ever move the net total.
    assert(day?.grossAmount === 2700, "34. Gross amount reflects the directly-edited voucher A amount, untouched by the later adjustment");
    assert(day?.netAmount === 2000, "35. Net amount reflects both the reversal and the adjustment (2700 - 500 - 200)");
  }

  console.log("==================================================");
  console.log(`VOUCHER MANAGEMENT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
