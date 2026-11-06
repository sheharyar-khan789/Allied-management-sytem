import { FeeChallanDoc, StudentDoc } from "@/lib/firebase/types";
import { SchoolPrintIdentity } from "@/lib/school-display";
import { VoucherData, computeVoucherAmounts } from "@/lib/fee-voucher";

/** Assemble one voucher from records already loaded (no database access; the callers batch the reads). */
export function buildVoucher(
  school: SchoolPrintIdentity,
  student: StudentDoc,
  challan: FeeChallanDoc,
  studentChallans: FeeChallanDoc[]
): VoucherData {
  return {
    school: { name: school.name, campusName: school.campusName, address: school.address, phone: school.phone },
    student: {
      id: student.id,
      fullName: student.fullName || challan.studentName || "",
      fatherName: student.fatherName || "",
      admissionNo: student.admissionNo || challan.admissionNo || "",
      className: student.className || challan.className || "",
      section: student.section || "",
    },
    challan: {
      id: challan.id,
      challanNo: challan.challanNo,
      month: challan.month,
      year: challan.year,
      issueDate: challan.issueDate,
      dueDate: challan.dueDate,
    },
    amounts: computeVoucherAmounts(challan, studentChallans),
  };
}
