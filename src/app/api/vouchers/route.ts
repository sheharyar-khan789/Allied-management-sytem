import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getVoucherDailySummaryServer,
  getFeeChallansByIdsServer,
  isVoucherLocked,
  getSchoolSettingsServer,
} from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { DEFAULT_SCHOOL_TIMEZONE, zonedDateParts } from "@/lib/lesson-plan-schedule";

/** Longest range an admin can pull in one request — a register, not an unbounded export. */
const MAX_RANGE_DAYS = 92;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/vouchers — the daily voucher register (Phase 10): per-day counts/totals plus the
 * individual voucher rows for [from, to], Asia/Karachi calendar dates. Admin-only: this is the
 * school's fee collection ledger. See getVoucherDailySummaryServer for why there is no separate
 * "vouchers" collection — every payment already IS the voucher.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);

    const settings = await getSchoolSettingsServer(authUser.schoolId);
    const timezone = settings?.timezone || DEFAULT_SCHOOL_TIMEZONE;
    const today = zonedDateParts(timezone).date;

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const from = fromParam && DATE_RE.test(fromParam) ? fromParam : toParam && DATE_RE.test(toParam) ? toParam : today;
    const to = toParam && DATE_RE.test(toParam) ? toParam : from;
    if (from > to) {
      return NextResponse.json({ error: "`from` must not be after `to`." }, { status: 400 });
    }
    const rangeDays = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days.` }, { status: 400 });
    }

    const search = (searchParams.get("search") || "").trim().toLowerCase();

    const { days, payments } = await getVoucherDailySummaryServer(authUser.schoolId, from, to);
    const challans = await getFeeChallansByIdsServer(authUser.schoolId, payments.map((p) => p.challanId));

    const vouchers = payments
      .map((p) => {
        const challan = challans.get(p.challanId);
        return {
          id: p.id,
          receiptNo: p.receiptNo,
          studentId: p.studentId,
          studentName: p.studentName || challan?.studentName || "",
          admissionNo: challan?.admissionNo || "",
          classId: challan?.classId || "",
          className: challan?.className || "",
          challanId: p.challanId,
          challanNo: challan?.challanNo || "",
          feeMonth: challan?.month || "",
          feeYear: challan?.year ?? null,
          academicYear: p.academicYear || challan?.academicYear || "",
          amount: p.amount,
          paymentDate: p.paymentDate,
          paymentMode: p.paymentMode,
          transactionRef: p.transactionRef || "",
          notes: p.notes || "",
          collectedBy: p.collectedBy,
          createdAt: p.createdAt,
          lastEditedAt: p.lastEditedAt || null,
          voucherStatus: p.voucherStatus || "ACTIVE",
          locked: isVoucherLocked(p),
        };
      })
      .filter(
        (v) =>
          !search ||
          v.studentName.toLowerCase().includes(search) ||
          v.admissionNo.toLowerCase().includes(search) ||
          v.receiptNo.toLowerCase().includes(search)
      );

    return NextResponse.json({ success: true, from, to, timezone, today, days, vouchers });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/vouchers");
    if (busy) return busy;
    console.error("Vouchers GET error:", error);
    return NextResponse.json({ error: "Failed to load the voucher register." }, { status: 500 });
  }
}
