import React from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

export interface VoucherSheetSchool {
  name: string;
  campusName?: string;
  address: string;
  phone: string;
  email: string;
}

export interface VoucherSheetStudent {
  fullName: string;
  admissionNo: string;
  className?: string;
  section?: string;
}

export interface VoucherSheetChallan {
  challanNo: string;
  month: string;
  year: number;
  issueDate: string;
  dueDate: string;
  tuitionFee: number;
  admissionFee: number;
  examFee: number;
  otherFee: number;
  annualFeeCharged?: number;
  previousOutstandingDues?: number;
  discount: number;
  totalExpected: number;
  paidAmount: number;
  outstanding: number;
  status: string;
}

export default function VoucherSheet({
  school,
  student,
  challan,
  pageBreakAfter = false,
}: {
  school: VoucherSheetSchool;
  student: VoucherSheetStudent;
  challan: VoucherSheetChallan;
  pageBreakAfter?: boolean;
}) {
  const items = [
    { label: "Tuition fee", amount: challan.tuitionFee },
    { label: "Previous outstanding dues", amount: challan.previousOutstandingDues },
    { label: "Admission fee", amount: challan.admissionFee },
    { label: "Annual fee", amount: challan.annualFeeCharged },
    { label: "Exam fee", amount: challan.examFee },
    { label: "Other fee", amount: challan.otherFee },
  ].filter((i) => Number(i.amount) > 0);

  return (
    <article
      className={`print-sheet p-6 sm:p-8 rounded-xl bg-white border border-surface-container-high shadow-sm print:border-0 print:shadow-none print:rounded-none ${
        pageBreakAfter ? "print-page-break" : ""
      }`}
    >
      <header className="text-center border-b-2 border-on-surface pb-4 mb-4">
        <h2 className="text-xl font-bold tracking-tight">{school.name}</h2>
        {school.campusName ? <p className="text-xs mt-1">{school.campusName}</p> : null}
        <p className="text-[11px] text-on-surface-variant mt-1">{school.address}</p>
        <p className="text-[11px] text-on-surface-variant">
          Phone: {school.phone} • Email: {school.email}
        </p>
        <p className="mt-3 text-sm font-bold uppercase tracking-wide">Fee Voucher</p>
      </header>

      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <p><span className="text-on-surface-variant">Student:</span> <strong>{student.fullName}</strong></p>
        <p><span className="text-on-surface-variant">Admission #:</span> <strong>{student.admissionNo}</strong></p>
        <p><span className="text-on-surface-variant">Class:</span> <strong>{student.className}{student.section ? `-${student.section}` : ""}</strong></p>
        <p><span className="text-on-surface-variant">Voucher / Ref:</span> <strong className="font-mono">{challan.challanNo}</strong></p>
        <p><span className="text-on-surface-variant">Issue date:</span> {formatDate(challan.issueDate)}</p>
        <p><span className="text-on-surface-variant">Due date:</span> {formatDate(challan.dueDate)}</p>
        <p><span className="text-on-surface-variant">Period:</span> {challan.month} {challan.year}</p>
        <p><span className="text-on-surface-variant">Status:</span> <strong>{challan.status}</strong></p>
      </div>

      <table className="w-full text-xs border border-outline-variant">
        <thead>
          <tr className="bg-surface-container-low">
            <th className="text-left py-2 px-3">Fee item</th>
            <th className="text-right py-2 px-3">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td className="py-2 px-3">Total billed</td>
              <td className="py-2 px-3 text-right">{formatCurrency(challan.totalExpected)}</td>
            </tr>
          ) : (
            items.map((i) => (
              <tr key={i.label} className="border-t border-outline-variant/40">
                <td className="py-2 px-3">{i.label}</td>
                <td className="py-2 px-3 text-right">{formatCurrency(i.amount)}</td>
              </tr>
            ))
          )}
          {Number(challan.discount) > 0 && (
            <tr className="border-t border-outline-variant/40">
              <td className="py-2 px-3">Discount</td>
              <td className="py-2 px-3 text-right">-{formatCurrency(challan.discount)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-on-surface font-bold">
            <td className="py-2 px-3">Total amount</td>
            <td className="py-2 px-3 text-right">{formatCurrency(challan.totalExpected)}</td>
          </tr>
          <tr>
            <td className="py-2 px-3">Paid amount</td>
            <td className="py-2 px-3 text-right">{formatCurrency(challan.paidAmount)}</td>
          </tr>
          <tr>
            <td className="py-2 px-3">Outstanding</td>
            <td className="py-2 px-3 text-right">{formatCurrency(challan.outstanding)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-[10px] text-on-surface-variant mt-6">
        This is a recording/view voucher. Do not treat this document as proof of an online payment.
      </p>
    </article>
  );
}
