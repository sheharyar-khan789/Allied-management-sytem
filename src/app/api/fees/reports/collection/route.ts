import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getFeeChallansServer, getPaymentsServer, getClassesServer } from "@/lib/firebase/server-db";
import { FEE_MONTHS } from "@/lib/firebase/types";
import { buildCsv, csvResponseHeaders } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Monthly / Yearly / Class-wise Fee Collection Report, each a CSV built directly from
 * FeeChallanDoc/PaymentDoc — never a separately maintained report table.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope");
    const schoolId = authUser.schoolId;

    if (scope === "MONTHLY") {
      const month = searchParams.get("month") || "";
      const year = Number(searchParams.get("year"));
      if (!FEE_MONTHS.includes(month as any) || !Number.isInteger(year)) return bad("A valid month and year are required for scope=MONTHLY.");

      const payments = await getPaymentsServer(schoolId, undefined, undefined, { allSessions: true });
      const monthIdx = FEE_MONTHS.indexOf(month as any);
      const ym = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
      const matching = payments.filter((p) => p.paymentDate.startsWith(ym) && (p.voucherStatus || "ACTIVE") === "ACTIVE");

      const byStudent = new Map<string, { studentName: string; total: number; count: number }>();
      for (const p of matching) {
        const entry = byStudent.get(p.studentId) || { studentName: p.studentName || "", total: 0, count: 0 };
        entry.total += p.amount || 0;
        entry.count += 1;
        byStudent.set(p.studentId, entry);
      }
      const rows = Array.from(byStudent.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([studentId, v]) => [studentId, v.studentName, v.count, v.total]);
      const grandTotal = matching.reduce((sum, p) => sum + (p.amount || 0), 0);
      const csv = buildCsv([
        ["Student ID", "Student Name", "Payments", "Total Collected"],
        ...rows,
        ["", "", "GRAND TOTAL", grandTotal],
      ]);
      return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`collection-monthly-${month}-${year}.csv`) });
    }

    if (scope === "YEARLY") {
      const academicYear = searchParams.get("academicYear") || "";
      if (!/^\d{4}-\d{4}$/.test(academicYear)) return bad("A valid academicYear is required for scope=YEARLY.");

      const challans = await getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true });
      const payments = await getPaymentsServer(schoolId, undefined, undefined, { allSessions: true });
      const challanById = new Map(challans.map((c) => [c.id, c]));
      const activePayments = payments.filter((p) => (p.voucherStatus || "ACTIVE") === "ACTIVE");

      const perMonth = new Map<string, number>(FEE_MONTHS.map((m) => [m, 0]));
      for (const p of activePayments) {
        const challan = challanById.get(p.challanId);
        if (!challan || challan.academicYear !== academicYear) continue;
        perMonth.set(challan.month, (perMonth.get(challan.month) || 0) + (p.amount || 0));
      }
      const rows = FEE_MONTHS.map((m) => [m, perMonth.get(m) || 0]);
      const grandTotal = Array.from(perMonth.values()).reduce((a, b) => a + b, 0);
      const csv = buildCsv([["Month", "Total Collected"], ...rows, ["GRAND TOTAL", grandTotal]]);
      return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`collection-yearly-${academicYear}.csv`) });
    }

    if (scope === "CLASS_WISE") {
      const academicYear = searchParams.get("academicYear") || "";
      if (!/^\d{4}-\d{4}$/.test(academicYear)) return bad("A valid academicYear is required for scope=CLASS_WISE.");

      const [challans, classes] = await Promise.all([
        getFeeChallansServer(schoolId, undefined, undefined, undefined, undefined, undefined, { allSessions: true }),
        getClassesServer(schoolId, { allSessions: true }),
      ]);
      const relevant = challans.filter((c) => c.academicYear === academicYear);
      const byClass = new Map<string, { expected: number; collected: number }>();
      for (const c of relevant) {
        const entry = byClass.get(c.classId) || { expected: 0, collected: 0 };
        entry.expected += c.totalExpected || 0;
        entry.collected += c.paidAmount || 0;
        byClass.set(c.classId, entry);
      }
      const classNameById = new Map(classes.map((c) => [c.id, `${c.name}-${c.section}`]));
      const rows = Array.from(byClass.entries()).map(([classId, v]) => [
        classId, classNameById.get(classId) || "", v.expected, v.collected, Math.max(0, v.expected - v.collected),
      ]);
      const csv = buildCsv([["Class ID", "Class", "Total Expected", "Total Collected", "Outstanding"], ...rows]);
      return new NextResponse(csv, { status: 200, headers: csvResponseHeaders(`collection-class-wise-${academicYear}.csv`) });
    }

    return bad('scope must be one of "MONTHLY", "YEARLY", "CLASS_WISE".');
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Collection report error:", error?.message || error);
    return NextResponse.json({ error: "Failed to build the collection report." }, { status: 500 });
  }
}
