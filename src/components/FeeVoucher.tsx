"use client";

import React from "react";
import { voucherDate, type VoucherData } from "@/lib/fee-voucher";

const COPIES = ["Admin Office Copy", "Student Copy"] as const;

/** Whole rupees as plain digits, exactly as the school's template prints them (e.g. 10500). */
const amount = (v: number) => String(Math.round(v));

/**
 * Print stylesheet for the fee voucher. One voucher = one A4 landscape page holding the school's two
 * copies side by side (Admin Office Copy | Student Copy). Sizes are in mm/pt so the on-screen
 * preview and the printout match. Screen-only chrome carries `no-print`.
 */
export const VOUCHER_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  html, body { background: #fff !important; }
}
.voucher-page { width: 277mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; display: flex; gap: 6mm; align-items: flex-start; }
.voucher-page + .voucher-page { margin-top: 8mm; }
/* On screen the 277mm sheet is shown scaled down so both copies fit the page; print is always 1:1. */
@media screen { .voucher-page { zoom: 0.62; } }
@media print { .voucher-page { zoom: 1; } }
.voucher-copy { flex: 1 1 0; min-width: 0; border: 0.35mm solid #000; }
.v-head { display: flex; border-bottom: 0.35mm solid #000; min-height: 24mm; }
.v-school { flex: 1.25 1 0; min-width: 0; padding: 1.2mm 1.8mm; display: flex; flex-direction: column; justify-content: center; }
.v-name { font-size: 11.5pt; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.v-sub { font-size: 5.5pt; margin: 0.3mm 0 0.8mm; }
.v-campus { font-size: 8pt; font-weight: 700; text-decoration: underline; }
.v-addr { font-size: 7.5pt; line-height: 1.3; overflow-wrap: anywhere; }
.v-logo-box { flex: 0 0 22mm; display: flex; align-items: center; justify-content: center; }
.v-logo { width: 21mm; height: auto; max-height: 22mm; object-fit: contain; }
.v-info { flex: 1.1 1 0; min-width: 0; border-left: 0.35mm solid #000; padding: 1mm 1.8mm; font-size: 7.5pt; font-weight: 700; line-height: 1.5; display: flex; flex-direction: column; justify-content: center; }
.v-info div { overflow-wrap: anywhere; line-height: 1.35; }
.v-due { font-size: 9pt; }
.v-title { text-align: center; font-size: 7.5pt; font-weight: 700; text-decoration: underline; line-height: 1.5; }
.v-table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: center; font-size: 9pt; }
.v-table th, .v-table td { border: 0.35mm solid #000; padding: 0.9mm 1mm; }
.v-table th { font-size: 9pt; font-weight: 700; }
.v-table td:nth-child(2) { font-weight: 700; }
.v-total td { background: #d9d9d9 !important; font-weight: 700; }
.voucher-page, .voucher-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.v-copy { text-align: center; font-size: 6.5pt; font-weight: 700; padding: 1mm 0 2mm; }
.voucher-page { break-inside: avoid; page-break-inside: avoid; }
@media print {
  .voucher-page { margin: 0 !important; }
  .voucher-page:not(:last-child) { break-after: page; page-break-after: always; }
  .voucher-sheet-screen-frame { overflow: visible !important; box-shadow: none !important; border: 0 !important; padding: 0 !important; }
}
`;

function VoucherCopy({ v, label }: { v: VoucherData; label: string }) {
  const a = v.amounts;
  const rows: [string, number][] = [
    ["Tuition Fee", a.tuitionFee],
    ["Annual subscription", a.annualSubscription],
    ["Pending Fees", a.pendingFees],
    ["Book Dues", a.bookDues],
    ["Total", a.total],
    ["Paid Dues", a.paidDues],
    ["After Due Date", a.afterDueDate],
  ];
  const className = `${v.student.className}${v.student.section && !v.student.className.endsWith(v.student.section) ? `-${v.student.section}` : ""}`;
  return (
    <div className="voucher-copy">
      <div className="v-head">
        <div className="v-school">
          <div className="v-name">{v.school.name}</div>
          <div className="v-sub">Project of Punjab Group of Colleges</div>
          {v.school.campusName ? <div className="v-campus">{v.school.campusName}</div> : null}
          <div className="v-addr">{v.school.address}</div>
          <div className="v-addr"><b>Ph no:</b> {v.school.phone}</div>
        </div>
        <div className="v-logo-box">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/allied-schools-logo.jpeg" alt="Allied Schools" className="v-logo" />
        </div>
        <div className="v-info">
          <div>Issue Date: {voucherDate(v.challan.issueDate)}</div>
          <div className="v-due">Due Date: {voucherDate(v.challan.dueDate)}</div>
          <div>Student Name: {v.student.fullName}</div>
          <div>Father Name: {v.student.fatherName}</div>
          <div>Class: {className}</div>
        </div>
      </div>
      <div className="v-title">Fee Receipt</div>
      <table className="v-table">
        <thead>
          <tr>
            <th style={{ width: "15%" }}>Sr. No.</th>
            <th>DESCRIPTION</th>
            <th style={{ width: "24%" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, value], i) => (
            <tr key={name} className={name === "Total" ? "v-total" : undefined}>
              <td>{i + 1}.</td>
              <td>{name}</td>
              <td>{amount(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="v-copy">{label}</div>
    </div>
  );
}

/** One A4 landscape page: this student's voucher twice (Admin Office Copy, Student Copy). */
export function FeeVoucherPage({ voucher }: { voucher: VoucherData }) {
  return (
    <section className="voucher-page" data-voucher-challan={voucher.challan.id}>
      {COPIES.map((label) => (
        <VoucherCopy key={label} v={voucher} label={label} />
      ))}
    </section>
  );
}

/** Stylesheet; render once next to the voucher pages. */
export function VoucherStyles() {
  return <style dangerouslySetInnerHTML={{ __html: VOUCHER_CSS }} />;
}
