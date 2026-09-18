import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getTeachersServer,
  getTeacherByIdServer,
  getPayrollRecordsServer,
  savePayrollRecordServer,
  createAuditLogServer,
} from "@/lib/firebase/server-db";
import { PayrollRecordDoc, PayrollStatus } from "@/lib/firebase/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);

    const now = new Date();
    const month = searchParams.get("month") || MONTH_NAMES[now.getMonth()];
    const yearParam = searchParams.get("year");
    const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
    const search = searchParams.get("search")?.toLowerCase() || "";

    const [teachers, records] = await Promise.all([
      getTeachersServer(authUser.schoolId, 500),
      getPayrollRecordsServer(authUser.schoolId, month, year),
    ]);

    const recordsByTeacher = new Map<string, PayrollRecordDoc>();
    for (const r of records) {
      recordsByTeacher.set(r.teacherId, r);
    }

    let list = teachers.map((t) => {
      const rec = recordsByTeacher.get(t.id);
      const baseSalary = rec?.amount !== undefined ? rec.amount : (t.baseSalary ?? t.salary ?? 0);
      const status: PayrollStatus = rec?.status === "PAID" ? "PAID" : "UNPAID";
      const paidDate = rec?.paidDate || null;

      return {
        recordId: rec?.id || `payrec_${authUser.schoolId}_${t.id}_${year}_${month.toLowerCase()}`,
        teacherId: t.id,
        teacherName: t.fullName,
        employeeId: t.employeeId,
        designation: t.designation,
        department: t.department,
        photoUrl: t.photoUrl || "",
        month,
        year,
        baseSalary,
        status,
        paidDate,
        notes: rec?.notes || "",
      };
    });

    if (search) {
      list = list.filter((item) =>
        item.teacherName.toLowerCase().includes(search) ||
        item.employeeId.toLowerCase().includes(search) ||
        item.department.toLowerCase().includes(search) ||
        item.designation.toLowerCase().includes(search)
      );
    }

    const totalTeachers = list.length;
    const paidRecords = list.filter((r) => r.status === "PAID");
    const unpaidRecords = list.filter((r) => r.status === "UNPAID");

    const totalPaid = paidRecords.length;
    const totalUnpaid = unpaidRecords.length;
    const totalSalaryDue = list.reduce((sum, r) => sum + (r.baseSalary || 0), 0);
    const totalSalaryPaid = paidRecords.reduce((sum, r) => sum + (r.baseSalary || 0), 0);
    const totalSalaryPending = totalSalaryDue - totalSalaryPaid;

    return NextResponse.json({
      success: true,
      month,
      year,
      stats: {
        totalTeachers,
        totalPaid,
        totalUnpaid,
        totalSalaryDue,
        totalSalaryPaid,
        totalSalaryPending,
      },
      records: list,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Payroll GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve payroll records." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleSavePayroll(req);
}

export async function PUT(req: NextRequest) {
  return handleSavePayroll(req);
}

async function handleSavePayroll(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();

    const { teacherId, month, year, status, paidDate, amount, notes } = body;

    if (!teacherId || !month || !year) {
      return NextResponse.json(
        { error: "teacherId, month, and year are required." },
        { status: 400 }
      );
    }

    // Verify teacher belongs strictly to the caller's school
    const teacher = await getTeacherByIdServer(authUser.schoolId, teacherId);
    if (!teacher) {
      return NextResponse.json(
        { error: "Teacher not found for this institution." },
        { status: 404 }
      );
    }

    const resolvedStatus: PayrollStatus =
      String(status).toUpperCase() === "PAID" ? "PAID" : "UNPAID";

    const resolvedAmount =
      amount !== undefined && amount !== null && !isNaN(Number(amount))
        ? Number(amount)
        : teacher.baseSalary ?? teacher.salary ?? 0;

    const resolvedPaidDate =
      resolvedStatus === "PAID"
        ? (paidDate ? String(paidDate) : new Date().toISOString().split("T")[0])
        : undefined;

    const recordId = `payrec_${authUser.schoolId}_${teacherId}_${year}_${String(month).toLowerCase()}`;

    const payrollDoc: PayrollRecordDoc = {
      id: recordId,
      schoolId: authUser.schoolId,
      teacherId,
      teacherName: teacher.fullName,
      employeeId: teacher.employeeId,
      month: String(month),
      year: Number(year),
      amount: resolvedAmount,
      status: resolvedStatus,
      paidDate: resolvedPaidDate,
      notes: notes ? String(notes) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await savePayrollRecordServer(payrollDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      resolvedStatus === "PAID" ? "MARK_PAYROLL_PAID" : "MARK_PAYROLL_UNPAID",
      "PAYROLL",
      recordId,
      `Marked salary for ${teacher.fullName} (${teacher.employeeId}) as ${resolvedStatus} for ${month} ${year} (Rs. ${resolvedAmount}).`
    );

    return NextResponse.json({
      success: true,
      record: payrollDoc,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Payroll update error:", error);
    return NextResponse.json(
      { error: "Failed to update payroll record." },
      { status: 500 }
    );
  }
}
