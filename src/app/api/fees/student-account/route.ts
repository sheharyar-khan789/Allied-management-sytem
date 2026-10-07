import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getFeeChallansServer,
  getStudentByIdServer,
  getStudentChargesServer,
  getStudentFeeLedgerServer,
  updateStudentFeeLedgerServer,
} from "@/lib/firebase/server-db";
import { FEE_MONTHS, FeeChallanDoc, FeeMonth, StudentDoc, StudentFeeLedgerDoc } from "@/lib/firebase/types";
import { idString, parseJsonBody, year as yearSchema } from "@/lib/input-validation";
import { feeMonthOf } from "@/lib/fee-ledger";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const ledgerUpdateSchema = z
  .object({
    studentId: idString,
    year: yearSchema,
    month: z.enum(FEE_MONTHS).optional(),
    paid: z.boolean().optional(),
    annualFeePaid: z.boolean().optional(),
  })
  .strict();

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function buildAccount(student: StudentDoc, year: number, ledger: StudentFeeLedgerDoc | null, challans: FeeChallanDoc[]) {
  const months = FEE_MONTHS.map((month) => {
    const monthChallans = challans.filter((c) => c.year === year && feeMonthOf(c.month) === month);
    const challanPaid = monthChallans.length > 0 && monthChallans.every((c) => c.status === "PAID");
    const explicit = ledger?.months?.[month];
    return {
      month,
      // An admin's explicit tick/untick wins; otherwise a fully paid challan for the month counts.
      paid: explicit ? explicit.paid : challanPaid,
      paidAt: explicit ? explicit.paidAt || null : null,
      source: explicit ? "LEDGER" : challanPaid ? "CHALLAN" : "NONE",
      challans: monthChallans.map((c) => ({ id: c.id, challanNo: c.challanNo, status: c.status, balance: c.balanceAmount })),
    };
  });
  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      admissionNo: student.admissionNo,
      className: student.className || "",
      classId: student.classId,
      monthlyFee: Number(student.monthlyFee) || 0,
      annualFee: Number(student.annualFee) || 0,
      discount: Number(student.discount) || 0,
    },
    year,
    months,
    paidMonths: months.filter((m) => m.paid).length,
    annualFee: {
      amount: Number(student.annualFee) || 0,
      paid: Boolean(ledger?.annualFeePaid),
      paidAt: ledger?.annualFeePaidAt || null,
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const studentId = idString.safeParse(searchParams.get("studentId") || "");
    const year = yearSchema.safeParse(searchParams.get("year") || new Date().getFullYear());
    if (!studentId.success) return jsonError("A valid studentId is required.", 400);
    if (!year.success) return jsonError("A valid year is required.", 400);

    // Resolved inside the caller's school: another school's student is simply not found.
    const student = await getStudentByIdServer(authUser.schoolId, studentId.data);
    if (!student || student.schoolId !== authUser.schoolId) return jsonError("Student not found for this school.", 404);

    const [ledger, challans, charges] = await Promise.all([
      getStudentFeeLedgerServer(authUser.schoolId, student.id, year.data),
      // All sessions: a calendar year spans two academic sessions.
      getFeeChallansServer(authUser.schoolId, student.id, undefined, undefined, undefined, undefined, { allSessions: true }),
      getStudentChargesServer(authUser.schoolId, student.id),
    ]);

    return NextResponse.json(
      { success: true, ...buildAccount(student, year.data, ledger, challans), charges },
      { headers: NO_STORE }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student fee account GET error:", error);
    return jsonError("Failed to load the student's fee account.", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, ledgerUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const { studentId, year, month, paid, annualFeePaid } = parsed.data;

    const hasMonth = month !== undefined && paid !== undefined;
    if (!hasMonth && annualFeePaid === undefined) {
      return jsonError("Provide month + paid, or annualFeePaid.", 400);
    }
    if ((month === undefined) !== (paid === undefined)) {
      return jsonError("month and paid must be sent together.", 400);
    }

    const student = await getStudentByIdServer(authUser.schoolId, studentId);
    if (!student || student.schoolId !== authUser.schoolId) return jsonError("Student not found for this school.", 404);

    await updateStudentFeeLedgerServer(
      { schoolId: authUser.schoolId, studentId: student.id, studentName: student.fullName, year },
      { ...(hasMonth ? { month: { name: month!, paid: paid! } } : {}), ...(annualFeePaid !== undefined ? { annualFeePaid } : {}) },
      authUser.uid
    );

    const changes = [
      hasMonth ? `${month} ${year} marked ${paid ? "PAID" : "UNPAID"}` : "",
      annualFeePaid !== undefined ? `annual fee ${year} marked ${annualFeePaid ? "PAID" : "UNPAID"}` : "",
    ].filter(Boolean).join("; ");
    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "UPDATE_FEE_STATUS", "FEE", student.id,
      `Fee status for ${student.fullName} (${student.admissionNo}): ${changes}.`
    );

    // Read back what is now persisted so the page renders stored state, not its own guess.
    const [ledger, challans, charges] = await Promise.all([
      getStudentFeeLedgerServer(authUser.schoolId, student.id, year),
      getFeeChallansServer(authUser.schoolId, student.id, undefined, undefined, undefined, undefined, { allSessions: true }),
      getStudentChargesServer(authUser.schoolId, student.id),
    ]);
    return NextResponse.json(
      { success: true, ...buildAccount(student, year, ledger, challans), charges },
      { headers: NO_STORE }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Student fee account PUT error:", error);
    return jsonError("Failed to update the fee status.", 500);
  }
}
