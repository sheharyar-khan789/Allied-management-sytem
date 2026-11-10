import { getAdvanceBalanceServer, adjustAdvanceBalanceServer } from "@/lib/firebase/server-db";
import { FeeChallanDoc } from "@/lib/firebase/types";

// Called right after a batch of new monthly vouchers is planned (before they're written),
// so any credit the student already has on account automatically pre-pays the new voucher
// instead of sitting idle while the voucher shows an outstanding balance.
// Runs sequentially (one student's advance doc at a time) to keep each adjustment's
// read-modify-write transaction simple and race-free.
export async function applyAdvanceCreditsToNewVouchers(
  schoolId: string,
  academicYear: string,
  docs: FeeChallanDoc[]
): Promise<void> {
  for (const doc of docs) {
    if (doc.totalExpected <= 0) continue;
    const advance = await getAdvanceBalanceServer(schoolId, doc.studentId, academicYear);
    const available = advance?.balance || 0;
    if (available <= 0) continue;

    const applied = Math.min(available, doc.totalExpected);
    doc.paidAmount = applied;
    doc.balanceAmount = doc.totalExpected - applied;
    doc.status = doc.balanceAmount === 0 ? "PAID" : "PARTIAL";

    await adjustAdvanceBalanceServer(
      schoolId,
      doc.studentId,
      academicYear,
      -applied,
      "Applied to newly generated voucher",
      doc.id
    );
  }
}
