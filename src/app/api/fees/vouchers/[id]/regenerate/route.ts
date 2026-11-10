import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getFeeChallanByIdServer,
  getYearlyFeeStructureServer,
  getFeeChallansServer,
  saveFeeChallanServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { planMonthlyVoucher } from "@/lib/fee-calculations";

// Regeneration is only safe when no payment has ever been recorded against the voucher —
// otherwise it would silently rewrite history a cashier has already relied on. That case
// must go through a fee adjustment (Phase 5) instead, which keeps an explicit before/after trail.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;

    const challan = await getFeeChallanByIdServer(authUser.schoolId, id);
    if (!challan) {
      return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
    }
    if (challan.source !== "AUTO_MONTHLY" || !challan.academicYear) {
      return NextResponse.json({ error: "Only automatically generated monthly vouchers can be regenerated." }, { status: 400 });
    }
    if ((challan.paidAmount || 0) > 0) {
      return NextResponse.json(
        { error: "Cannot regenerate a voucher that already has a payment recorded. Use a fee adjustment instead." },
        { status: 409 }
      );
    }

    const structure = await getYearlyFeeStructureServer(authUser.schoolId, challan.academicYear, challan.admissionNo || "");
    if (!structure) {
      return NextResponse.json({ error: "No yearly fee structure found for this student / academic year." }, { status: 404 });
    }

    const otherVouchers = (
      await getFeeChallansServer(authUser.schoolId, challan.studentId, undefined, undefined, undefined, undefined, challan.academicYear)
    ).filter((c) => c.id !== challan.id);

    const plan = planMonthlyVoucher(structure, otherVouchers);
    const previousTotal = challan.totalExpected;

    const updated = {
      ...challan,
      tuitionFee: plan.tuitionFee,
      admissionFee: plan.admissionFee,
      annualFeeCharged: plan.annualFeeCharged,
      otherFee: plan.otherFee,
      discount: plan.discount,
      previousOutstandingDues: plan.previousOutstandingDues,
      oneTimeChargesApplied: plan.oneTimeChargesApplied,
      totalExpected: plan.totalExpected,
      balanceAmount: plan.totalExpected,
      status: (plan.totalExpected === 0 ? "PAID" : "PENDING") as typeof challan.status,
      updatedAt: new Date().toISOString(),
    };

    await saveFeeChallanServer(updated);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "REGENERATE_VOUCHER",
      "FEE_CHALLAN",
      challan.id,
      `Regenerated voucher ${challan.challanNo} for ${challan.studentName}: total Rs. ${previousTotal} -> Rs. ${plan.totalExpected}.`
    );

    return NextResponse.json({ success: true, challan: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Voucher regeneration error:", error);
    return NextResponse.json({ error: "Failed to regenerate voucher." }, { status: 500 });
  }
}
