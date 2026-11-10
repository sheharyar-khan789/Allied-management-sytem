import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getYearlyFeeStructuresServer,
  saveYearlyFeeStructureServer,
  getYearlyFeeStructureServer,
  getStudentsServer,
  createAuditLogServer,
  saveFeeAdjustmentServer,
} from "@/lib/firebase/server-db";
import { YearlyFeeStructureDoc, FeeAdjustmentDoc, FeeAdjustmentType } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear");
    if (!academicYear) {
      return NextResponse.json({ error: "academicYear is required." }, { status: 400 });
    }
    const classId = searchParams.get("classId") || undefined;
    const search = searchParams.get("search")?.toLowerCase() || "";

    let structures = await getYearlyFeeStructuresServer(authUser.schoolId, academicYear);
    if (classId && classId !== "all" && classId !== "ALL") {
      structures = structures.filter((s) => s.classId === classId);
    }
    if (search) {
      structures = structures.filter(
        (s) => s.admissionNo.toLowerCase().includes(search) || s.studentName.toLowerCase().includes(search)
      );
    }
    structures = structures.sort((a, b) => a.studentName.localeCompare(b.studentName));

    return NextResponse.json({ success: true, academicYear, structures });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Yearly fee structure GET error:", error);
    return NextResponse.json({ error: "Failed to load yearly fee structures." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();
    const {
      studentId,
      academicYear,
      monthlyTuitionFee,
      annualFee = 0,
      admissionFee = 0,
      otherCharges = 0,
      discount = 0,
      notes,
      reason,
      effectiveDate,
    } = body;

    if (!studentId || !academicYear || monthlyTuitionFee === undefined || monthlyTuitionFee === null) {
      return NextResponse.json(
        { error: "studentId, academicYear, and monthlyTuitionFee are required." },
        { status: 400 }
      );
    }
    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: "A reason is required for every fee structure change." }, { status: 400 });
    }
    if (!effectiveDate) {
      return NextResponse.json({ error: "An effective date is required." }, { status: 400 });
    }
    if (
      Number(monthlyTuitionFee) < 0 ||
      Number(annualFee) < 0 ||
      Number(admissionFee) < 0 ||
      Number(otherCharges) < 0 ||
      Number(discount) < 0
    ) {
      return NextResponse.json({ error: "Fee amounts cannot be negative." }, { status: 400 });
    }

    const students = await getStudentsServer(authUser.schoolId);
    const student = students.find((s) => s.id === studentId);
    if (!student) {
      return NextResponse.json({ error: "Student not found in this school." }, { status: 404 });
    }

    const existing = await getYearlyFeeStructureServer(authUser.schoolId, academicYear, student.admissionNo);
    const nowIso = new Date().toISOString();

    const doc: YearlyFeeStructureDoc = {
      id: existing?.id || `${authUser.schoolId}__${academicYear}__${student.admissionNo.trim().toUpperCase()}`,
      schoolId: authUser.schoolId,
      academicYear,
      studentId: student.id,
      admissionNo: student.admissionNo,
      studentName: student.fullName,
      classId: student.classId,
      className: student.className,
      section: student.section,
      monthlyTuitionFee: Number(monthlyTuitionFee),
      annualFee: Number(annualFee),
      admissionFee: Number(admissionFee),
      otherCharges: Number(otherCharges),
      discount: Number(discount),
      notes: notes || undefined,
      source: "MANUAL",
      importBatchId: existing?.importBatchId,
      createdAt: existing?.createdAt || nowIso,
      createdBy: existing?.createdBy || authUser.uid,
      updatedAt: nowIso,
      updatedBy: authUser.uid,
    };

    await saveYearlyFeeStructureServer(doc);

    if (existing) {
      const fieldChanges: { field: keyof YearlyFeeStructureDoc; type: FeeAdjustmentType }[] = [
        { field: "monthlyTuitionFee", type: "MONTHLY_FEE_CHANGE" },
        { field: "annualFee", type: "ANNUAL_FEE_CHANGE" },
        { field: "admissionFee", type: "ADMISSION_FEE_CHANGE" },
        { field: "otherCharges", type: "OTHER_CHARGES_CHANGE" },
        { field: "discount", type: "DISCOUNT_CHANGE" },
      ];
      for (const { field, type } of fieldChanges) {
        const previousValue = Number(existing[field] || 0);
        const newValue = Number(doc[field] || 0);
        if (previousValue === newValue) continue;

        const adjustmentId = `adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const adjustment: FeeAdjustmentDoc = {
          id: adjustmentId,
          schoolId: authUser.schoolId,
          studentId: student.id,
          admissionNo: student.admissionNo,
          studentName: student.fullName,
          academicYear,
          effectiveDate,
          adjustmentType: type,
          previousValue,
          newValue,
          reason,
          adminUserId: authUser.uid,
          adminEmail: authUser.email,
          createdAt: nowIso,
        };
        await saveFeeAdjustmentServer(adjustment);
      }
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      existing ? "UPDATE_YEARLY_FEE_STRUCTURE" : "CREATE_YEARLY_FEE_STRUCTURE",
      "YEARLY_FEE_STRUCTURE",
      doc.id,
      `${existing ? "Updated" : "Created"} ${academicYear} fee structure for ${student.fullName} (${student.admissionNo}): monthly Rs. ${monthlyTuitionFee}.`
    );

    return NextResponse.json({ success: true, structure: doc });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Yearly fee structure PUT error:", error);
    return NextResponse.json({ error: "Failed to save yearly fee structure." }, { status: 500 });
  }
}
