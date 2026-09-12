import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getFeeChallansServer,
  saveFeeChallanServer,
  recordPaymentServer,
  createAuditLogServer,
  getClassesServer,
  getStudentByIdServer
} from "@/lib/firebase/server-db";
import { FeeChallanDoc, PaymentDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId") || undefined;
    const status = searchParams.get("status") || undefined;
    const month = searchParams.get("month") || undefined;
    const search = searchParams.get("search")?.toLowerCase() || "";
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;

    const [challans, classes] = await Promise.all([
      getFeeChallansServer(authUser.schoolId, classId, month),
      getClassesServer(authUser.schoolId)
    ]);

    let filtered = challans;
    if (status && status !== "ALL" && status !== "all") {
      filtered = filtered.filter((c) => c.status.toUpperCase() === status.toUpperCase());
    }
    if (search) {
      filtered = filtered.filter((c) =>
        c.challanNo.toLowerCase().includes(search) ||
        (c.studentName && c.studentName.toLowerCase().includes(search)) ||
        (c.admissionNo && c.admissionNo.toLowerCase().includes(search))
      );
    }

    const totalExpected = filtered.reduce((s, c) => s + (c.totalExpected || 0), 0);
    const totalCollected = filtered.reduce((s, c) => s + (c.paidAmount || 0), 0);
    const totalOutstanding = filtered.reduce((s, c) => s + Math.max(0, (c.totalExpected || 0) - (c.paidAmount || 0)), 0);
    const paidCount = filtered.filter((c) => c.status === "PAID").length;
    const unpaidCount = filtered.filter((c) => c.status === "PENDING" || c.status === "OVERDUE").length;
    const partialCount = filtered.filter((c) => c.status === "PARTIAL").length;

    const formattedChallans = filtered.map((c) => ({
      id: c.id,
      challanNumber: c.challanNo,
      studentId: c.studentId,
      studentName: c.studentName || "Student",
      admissionNumber: c.admissionNo || "STD-2024",
      rollNumber: "01",
      classId: c.classId,
      className: c.className || "Class",
      month: c.month,
      year: c.year,
      dueDate: c.dueDate,
      tuitionFee: c.tuitionFee,
      admissionFee: c.admissionFee,
      examFee: c.examFee,
      otherFee: c.otherFee,
      discount: c.discount,
      totalExpected: c.totalExpected,
      paidAmount: c.paidAmount,
      balance: Math.max(0, c.totalExpected - c.paidAmount),
      status: c.status,
      paymentDate: c.updatedAt,
      paymentMethod: "Cash Desk",
      receiptNumber: `REC-${c.id}`,
      notes: "School Fee Invoicing",
    }));

    return NextResponse.json({
      success: true,
      stats: {
        totalExpected,
        totalCollected,
        totalOutstanding,
        paidCount,
        unpaidCount,
        partialCount,
        totalChallans: filtered.length,
      },
      challans: parsedLimit && parsedLimit > 0 ? formattedChallans.slice(0, parsedLimit) : formattedChallans,
      classes,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fees GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve fee records." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();

    const {
      studentId,
      classId,
      month,
      year,
      dueDate,
      tuitionFee,
      admissionFee = 0,
      examFee = 0,
      otherFee = 0,
      discount = 0,
      notes,
    } = body;

    if (!studentId || !classId || !month || !year || !dueDate || !tuitionFee) {
      return NextResponse.json(
        { error: "Student, Class, Month, Year, Due Date, and Tuition Fee are required." },
        { status: 400 }
      );
    }

    const student = await getStudentByIdServer(authUser.schoolId, studentId);
    const totalExpected = Number(tuitionFee) + Number(admissionFee) + Number(examFee) + Number(otherFee) - Number(discount);
    const count = Date.now().toString().slice(-4);
    const challanNo = `CHL-${year}-${month.substring(0, 3).toUpperCase()}-${count}`;
    const challanId = `ch-${count}`;

    const challanDoc: FeeChallanDoc = {
      id: challanId,
      schoolId: authUser.schoolId,
      studentId,
      studentName: student?.fullName || "Student",
      admissionNo: student?.admissionNo || "STD-2024",
      classId,
      className: student?.className || "Class",
      challanNo,
      month,
      year: Number(year),
      issueDate: new Date().toISOString().split("T")[0],
      dueDate,
      tuitionFee: Number(tuitionFee),
      admissionFee: Number(admissionFee),
      examFee: Number(examFee),
      otherFee: Number(otherFee),
      discount: Number(discount),
      totalExpected,
      paidAmount: 0,
      balanceAmount: totalExpected,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveFeeChallanServer(challanDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "GENERATE_FEE_CHALLAN",
      "FEE",
      challanId,
      `Generated fee challan ${challanNo} of Rs. ${totalExpected} for ${challanDoc.studentName}.`
    );

    return NextResponse.json({ success: true, challan: challanDoc }, { status: 201 });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fee POST error:", error);
    return NextResponse.json({ error: "Failed to generate fee challan." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const { challanId, amount, paymentMethod, notes } = body;

    if (!challanId || amount === undefined || amount <= 0) {
      return NextResponse.json(
        { error: "Challan ID and a valid payment amount are required." },
        { status: 400 }
      );
    }

    const receiptNo = `RCT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const paymentDoc: PaymentDoc = {
      id: `pay-${Date.now()}`,
      schoolId: authUser.schoolId,
      challanId,
      studentId: "std",
      receiptNo,
      amount: Number(amount),
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMode: "CASH",
      notes: notes || "Counter payment",
      collectedBy: authUser.uid,
      createdAt: new Date().toISOString(),
    };

    await recordPaymentServer(paymentDoc);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "COLLECT_FEE_PAYMENT",
      "FEE",
      challanId,
      `Collected payment of Rs. ${amount} (Receipt: ${receiptNo}).`
    );

    return NextResponse.json({ success: true, receiptNumber: receiptNo });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fee payment recording error:", error);
    return NextResponse.json(
      { error: "Failed to record fee payment." },
      { status: 500 }
    );
  }
}
