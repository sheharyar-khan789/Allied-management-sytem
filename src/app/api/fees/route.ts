import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getFeeChallansServer,
  getFeeChallanByIdServer,
  saveFeeChallanServer,
  recordPaymentServer,
  createAuditLogServer,
  getClassesServer,
  getStudentByIdServer
} from "@/lib/firebase/server-db";
import { FeeChallanDoc, PaymentDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    // School-wide financial data (every challan, every student's balance, collection
    // totals). Only the admin fees console and the admin student dossier call this route;
    // a TEACHER has no legitimate need for the school's finances.
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId") || undefined;
    const studentId = searchParams.get("studentId") || undefined;
    const status = searchParams.get("status") || undefined;
    const month = searchParams.get("month") || undefined;
    const search = searchParams.get("search")?.toLowerCase() || "";
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;

    const [challans, classes] = await Promise.all([
      getFeeChallansServer(authUser.schoolId, studentId, month, undefined, status, parsedLimit),
      getClassesServer(authUser.schoolId)
    ]);

    let filtered = challans;
    if (classId && classId !== "all" && classId !== "ALL") {
      filtered = filtered.filter((c) => c.classId === classId);
    }
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
      studentName: c.studentName || "",
      admissionNumber: c.admissionNo || "",
      rollNumber: "",
      classId: c.classId,
      className: c.className || "",
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
      receiptUrl: c.receiptUrl || undefined,
      // `paymentDate`, `paymentMethod`, `receiptNumber` and `notes` used to be emitted here as
      // fabricated values on a financial record: the receipt number was synthesised from the
      // challan id (`REC-<challanId>`) and matched no real receipt ever issued, the method was
      // always the literal "Cash Desk" regardless of how the money was actually taken, and the
      // date was the challan's last-modified timestamp rather than when payment was received.
      // The real values live on the PaymentDoc records written by recordFeePaymentServer. No
      // caller in src/ ever read any of these four fields, so they are dropped rather than
      // invented — an invoice table must not show a receipt number that cannot be reconciled.
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
    if (isNaN(new Date(dueDate).getTime())) {
      return NextResponse.json({ error: "dueDate is not a valid date." }, { status: 400 });
    }
    const feeFields = { tuitionFee, admissionFee, examFee, otherFee, discount };
    for (const [key, value] of Object.entries(feeFields)) {
      if (Number(value) < 0 || isNaN(Number(value))) {
        return NextResponse.json({ error: `${key} cannot be negative.` }, { status: 400 });
      }
    }
    const computedTotal =
      Number(tuitionFee) + Number(admissionFee) + Number(examFee) + Number(otherFee) - Number(discount);
    if (computedTotal < 0) {
      return NextResponse.json(
        { error: "Discount cannot exceed the total of tuition, admission, exam, and other fees." },
        { status: 400 }
      );
    }

    // The student must genuinely belong to this school. Previously a missing/foreign student
    // fell through silently to fabricated placeholders ("STD-2024" admission no, "Class" name)
    // instead of being rejected — meaning a real financial challan could be created against a
    // non-existent or cross-tenant studentId.
    const student = await getStudentByIdServer(authUser.schoolId, studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found for this school." }, { status: 404 });
    }
    if (student.classId !== classId) {
      return NextResponse.json(
        { error: "The selected class does not match this student's actual class." },
        { status: 400 }
      );
    }

    const totalExpected = Number(tuitionFee) + Number(admissionFee) + Number(examFee) + Number(otherFee) - Number(discount);
    // A timestamp+random suffix (not just the last 4 digits of Date.now(), which repeat every
    // 10 seconds) so bulk/concurrent challan generation can never collide and silently
    // overwrite another student's challan document.
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const challanNo = `CHL-${year}-${month.substring(0, 3).toUpperCase()}-${uniqueSuffix}`;
    const challanId = `ch-${uniqueSuffix}`;

    const challanDoc: FeeChallanDoc = {
      id: challanId,
      schoolId: authUser.schoolId,
      studentId,
      studentName: student.fullName,
      admissionNo: student.admissionNo,
      classId,
      className: student.className || "",
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
    const { challanId, amount, paymentMethod, notes, receiptUrl } = body;

    if (!challanId || amount === undefined || amount <= 0) {
      return NextResponse.json(
        { error: "Challan ID and a valid payment amount are required." },
        { status: 400 }
      );
    }

    // P0-1 & P0-2: Verify target challan exists and belongs strictly to the authenticated tenant
    const targetChallan = await getFeeChallanByIdServer(authUser.schoolId, challanId);
    if (!targetChallan) {
      return NextResponse.json(
        { error: "Challan not found or belongs to another institution." },
        { status: 404 }
      );
    }

    if (targetChallan.schoolId !== authUser.schoolId) {
      return NextResponse.json(
        { error: "Access denied. Cannot process payments across institutions." },
        { status: 403 }
      );
    }
    if (Number(amount) > targetChallan.balanceAmount) {
      return NextResponse.json(
        { error: `Payment amount cannot exceed the outstanding balance of Rs. ${targetChallan.balanceAmount}.` },
        { status: 400 }
      );
    }

    // Cryptographically secure, collision-resistant receipt number and payment id.
    // Previously: receiptNo used only a 4-digit Math.random() suffix (9,000 possible values
    // per year); paymentId used only Date.now() with no randomness at all, so two payments
    // processed in the same millisecond would silently overwrite one another's Firestore
    // document. Same "RCT-<year>-<digits>" / "pay-<...>" formats are preserved.
    const receiptNo = `RCT-${new Date().getFullYear()}-${crypto.randomInt(100000, 999999)}`;
    const paymentDoc: PaymentDoc = {
      id: `pay-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
      schoolId: authUser.schoolId,
      challanId,
      studentId: targetChallan.studentId,
      studentName: targetChallan.studentName,
      receiptNo,
      amount: Number(amount),
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMode: "CASH",
      notes: notes || "Counter payment",
      collectedBy: authUser.uid,
      receiptUrl: receiptUrl ? String(receiptUrl) : undefined,
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
      `Collected payment of Rs. ${amount} for ${targetChallan.studentName} (Receipt: ${receiptNo}).`
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
