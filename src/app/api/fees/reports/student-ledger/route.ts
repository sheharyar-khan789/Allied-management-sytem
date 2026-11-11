import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getStudentByIdServer, getFeeChallansServer, getPaymentsByStudentServer, getYearlyFeeStructureForStudentServer } from "@/lib/firebase/server-db";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";
import { idString } from "@/lib/input-validation";

export const dynamic = "force-dynamic";

/** Student Fee Ledger: one student's full statement — structure, every voucher, every payment. */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const studentId = idString.safeParse(searchParams.get("studentId") || "");
    const academicYear = searchParams.get("academicYear") || "";
    if (!studentId.success) return NextResponse.json({ error: "A valid studentId is required." }, { status: 400 });
    if (!/^\d{4}-\d{4}$/.test(academicYear)) return NextResponse.json({ error: 'A valid academicYear (e.g. "2026-2027") is required.' }, { status: 400 });

    const student = await getStudentByIdServer(authUser.schoolId, studentId.data);
    if (!student || student.schoolId !== authUser.schoolId) return NextResponse.json({ error: "Student not found for this school." }, { status: 404 });

    const [structure, challans, payments] = await Promise.all([
      getYearlyFeeStructureForStudentServer(authUser.schoolId, student.id, academicYear),
      getFeeChallansServer(authUser.schoolId, student.id, undefined, undefined, undefined, undefined, { allSessions: true }),
      getPaymentsByStudentServer(authUser.schoolId, student.id),
    ]);
    const yearChallans = challans.filter((c) => c.academicYear === academicYear).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const challanIds = new Set(yearChallans.map((c) => c.id));
    const yearPayments = payments.filter((p) => challanIds.has(p.challanId)).sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

    const lines: (string | number)[][] = [
      ["Student Fee Ledger", student.fullName, student.admissionNo, academicYear],
      [],
      ["Yearly Fee Structure"],
      ["Monthly Tuition", "Annual Fee", "Admission Fee", "Other Charges", "Discount"],
      structure ? [structure.monthlyTuitionFee, structure.annualFee, structure.admissionFee, structure.otherCharges, structure.discount] : ["No structure set for this academic year"],
      [],
      ["Vouchers"],
      ["Voucher No", "Month", "Year", "Total Expected", "Paid", "Balance", "Status"],
      ...yearChallans.map((c) => [c.challanNo, c.month, c.year, c.totalExpected, c.paidAmount, c.balanceAmount, c.status]),
      [],
      ["Payments"],
      ["Receipt No", "Date", "Amount", "Mode", "Status"],
      ...yearPayments.map((p) => [p.receiptNo, p.paymentDate, p.amount, p.paymentMode, p.voucherStatus || "ACTIVE"]),
    ];

    const csv = buildCsv(lines);
    return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`student-ledger-${student.admissionNo}-${academicYear}.csv`) });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student ledger report error:", error?.message || error);
    return NextResponse.json({ error: "Failed to build the student fee ledger." }, { status: 500 });
  }
}
