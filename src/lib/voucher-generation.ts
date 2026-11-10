import { getYearlyFeeStructuresServer, getFeeChallansServer, getStudentsServer, getStudentByIdServer } from "@/lib/firebase/server-db";
import { planMonthlyVoucher, monthlyVoucherId, monthIndex, VoucherPlan } from "@/lib/fee-calculations";
import { FeeChallanDoc, StudentDoc, VoucherGenerationRowResult, YearlyFeeStructureDoc } from "@/lib/firebase/types";

export interface GenerationScope {
  scope: "SCHOOL" | "CLASS" | "STUDENT";
  classId?: string;
  studentId?: string;
}

export interface PlannedVoucherRow extends VoucherGenerationRowResult {
  plan?: VoucherPlan;
  structure?: YearlyFeeStructureDoc;
}

export async function planVoucherGeneration(
  schoolId: string,
  academicYear: string,
  month: string,
  year: number,
  scope: GenerationScope
): Promise<PlannedVoucherRow[]> {
  let targetStudents: StudentDoc[];
  if (scope.scope === "STUDENT") {
    if (!scope.studentId) throw new Error("studentId is required for STUDENT scope.");
    const student = await getStudentByIdServer(schoolId, scope.studentId);
    targetStudents = student ? [student] : [];
    if (!student) {
      return [
        {
          studentId: scope.studentId,
          admissionNo: "",
          studentName: "Unknown student",
          action: "ERROR",
          errorReason: "Student not found in this school.",
        },
      ];
    }
  } else if (scope.scope === "CLASS") {
    if (!scope.classId) throw new Error("classId is required for CLASS scope.");
    targetStudents = await getStudentsServer(schoolId, scope.classId, undefined, undefined, "ACTIVE");
  } else {
    targetStudents = await getStudentsServer(schoolId, undefined, undefined, undefined, "ACTIVE");
  }

  const structures = await getYearlyFeeStructuresServer(schoolId, academicYear);
  const structureByAdmissionNo = new Map(structures.map((s) => [s.admissionNo.trim().toUpperCase(), s]));

  const allChallans = await getFeeChallansServer(
    schoolId,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    academicYear
  );
  const challansByStudent = new Map<string, FeeChallanDoc[]>();
  allChallans.forEach((c) => {
    if (!challansByStudent.has(c.studentId)) challansByStudent.set(c.studentId, []);
    challansByStudent.get(c.studentId)!.push(c);
  });

  return targetStudents.map((student): PlannedVoucherRow => {
    const structure = structureByAdmissionNo.get(student.admissionNo.trim().toUpperCase());
    if (!structure) {
      return {
        studentId: student.id,
        admissionNo: student.admissionNo,
        studentName: student.fullName,
        classId: student.classId,
        className: student.className,
        action: "ERROR",
        errorReason: `No yearly fee structure found for ${academicYear}. Import or set it first.`,
      };
    }

    const voucherId = monthlyVoucherId(schoolId, academicYear, student.admissionNo, month, year);
    const existingForStudent = challansByStudent.get(student.id) || [];
    const alreadyExists = existingForStudent.some((c) => c.id === voucherId);

    if (alreadyExists) {
      return {
        studentId: student.id,
        admissionNo: student.admissionNo,
        studentName: student.fullName,
        classId: student.classId,
        className: student.className,
        action: "SKIPPED_EXISTS",
        challanId: voucherId,
      };
    }

    const plan = planMonthlyVoucher(structure, existingForStudent);
    return {
      studentId: student.id,
      admissionNo: student.admissionNo,
      studentName: student.fullName,
      classId: student.classId,
      className: student.className,
      action: "CREATED",
      challanId: voucherId,
      totalExpected: plan.totalExpected,
      plan,
      structure,
    };
  });
}

export function buildChallanDoc(
  schoolId: string,
  academicYear: string,
  month: string,
  year: number,
  row: PlannedVoucherRow,
  batchId: string
): FeeChallanDoc {
  const plan = row.plan!;
  const structure = row.structure!;
  const nowIso = new Date().toISOString();
  const count = Math.random().toString(36).slice(2, 6).toUpperCase();
  const issueDate = nowIso.split("T")[0];
  const dueDate = new Date(year, monthIndex(month), 10).toISOString().split("T")[0];

  return {
    id: row.challanId!,
    schoolId,
    studentId: row.studentId,
    studentName: row.studentName,
    admissionNo: row.admissionNo,
    classId: structure.classId,
    className: structure.className,
    challanNo: `MV-${academicYear}-${month.substring(0, 3).toUpperCase()}-${count}`,
    month,
    year,
    issueDate,
    dueDate,
    tuitionFee: plan.tuitionFee,
    admissionFee: plan.admissionFee,
    examFee: 0,
    otherFee: plan.otherFee,
    discount: plan.discount,
    totalExpected: plan.totalExpected,
    paidAmount: 0,
    balanceAmount: plan.totalExpected,
    status: plan.totalExpected === 0 ? "PAID" : "PENDING",
    createdAt: nowIso,
    updatedAt: nowIso,
    academicYear,
    previousOutstandingDues: plan.previousOutstandingDues,
    annualFeeCharged: plan.annualFeeCharged,
    oneTimeChargesApplied: plan.oneTimeChargesApplied,
    source: "AUTO_MONTHLY",
    yearlyStructureId: structure.id,
    generationBatchId: batchId,
  };
}

export function summarizeRows(rows: VoucherGenerationRowResult[]) {
  return {
    totalRows: rows.length,
    createdCount: rows.filter((r) => r.action === "CREATED").length,
    skippedCount: rows.filter((r) => r.action === "SKIPPED_EXISTS").length,
    errorCount: rows.filter((r) => r.action === "ERROR").length,
  };
}
