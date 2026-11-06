"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";
import { formatDate } from "@/lib/utils";

/** Late-payment surcharge printed on every voucher ("After Due Date"). */
const AFTER_DUE_DATE_FEE = 200;
const COPIES = ["Admin Office Copy", "Student Copy"];

const num = (v: unknown) => Number(v) || 0;

function VoucherCopy({ data, copyLabel }: { data: any; copyLabel: string }) {
  const { school, student, challan: ch } = data;
  const tuition = num(ch.tuitionFee);
  const annual = num(ch.admissionFee) + num(ch.examFee); // annual subscription / admission charges
  const bookDues = num(ch.otherFee);
  const pending = num(ch.pendingFees);
  const total = Math.max(0, tuition + annual + bookDues - num(ch.discount)) + pending;
  const rows: [string, number][] = [
    ["Tuition Fee", tuition],
    ["Annual subscription", annual],
    ["Pending Fees", pending],
    ["Book Dues", bookDues],
    ["Total", total],
    ["Paid Dues", num(ch.paidAmount)],
    ["After Due Date", AFTER_DUE_FEE],
  ];

  return (
    <div className="voucher-copy">
      <div className="v-head">
        <div className="v-school">
          <div className="v-name">{school.name || "Allied School"}</div>
          <div className="v-small">Project of Punjab Group of Colleges</div>
          {school.campusName ? <div className="v-campus">{school.campusName}</div> : null}
          <div className="v-addr">{school.address}</div>
          <div className="v-addr"><b>Ph no:</b> {school.phone}</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/allied-schools-logo.jpeg" alt="" className="v-logo" />
        <div className="v-info">
          <div>Issue Date: {formatDate(ch.issueDate)}</div>
          <div className="v-due">Due Date: {formatDate(ch.dueDate)}</div>
          <div>Student Name: {student.fullName}</div>
          <div>Father Name: {student.fatherName}</div>
          <div>Class: {student.className}{student.section ? `-${student.section}` : ""}</div>
        </div>
      </div>
      <div className="v-title">Fee Receipt</div>
      <table className="v-table">
        <thead>
          <tr><th style={{ width: "14%" }}>Sr. No.</th><th>DESCRIPTION</th><th style={{ width: "22%" }}>Amount</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, amount], i) => (
            <tr key={label} className={label === "Total" ? "v-total" : ""}>
              <td>{i + 1}.</td>
              <td>{label}</td>
              <td>{amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="v-copy">{copyLabel}</div>
    </div>
  );
}

export default function PrintChallanPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/print/challan/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load this challan.");
          return;
        }
        setData(d);
      })
      .catch(() => setError("Unable to load this challan."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-xs text-on-surface-variant p-8">Loading challan...</p>;
  if (error || !data) return <p className="text-sm text-error p-8">{error || "Challan not found."}</p>;

  return (
    <div>
      <style>{`
        @media print { @page { size: A4 landscape; margin: 10mm; } }
        .voucher-sheet { display: flex; gap: 14px; width: 100%; background: #fff; color: #000; }
        .voucher-copy { flex: 1; border: 1.5px solid #000; font-family: Arial, sans-serif; break-inside: avoid; }
        .v-head { display: flex; border-bottom: 1.5px solid #000; }
        .v-school { flex: 1.3; padding: 4px 6px; }
        .v-name { font-size: 15px; font-weight: 700; }
        .v-small { font-size: 8px; }
        .v-campus { font-size: 11px; font-weight: 700; text-decoration: underline; }
        .v-addr { font-size: 10px; }
        .v-logo { width: 62px; height: 62px; object-fit: contain; align-self: center; }
        .v-info { flex: 1.1; border-left: 1.5px solid #000; padding: 3px 6px; font-size: 10px; font-weight: 700; line-height: 1.5; }
        .v-due { font-size: 12px; }
        .v-title { text-align: center; font-size: 10px; font-weight: 700; text-decoration: underline; padding: 1px 0; }
        .v-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: center; }
        .v-table th, .v-table td { border: 1.5px solid #000; padding: 3px 4px; }
        .v-table td:nth-child(2), .v-table th { font-weight: 700; }
        .v-total td { background: #d9d9d9; font-weight: 700; }
        .v-copy { text-align: center; font-size: 9px; font-weight: 700; padding: 3px 0 14px; }
        @media print { .voucher-sheet { gap: 0; } .voucher-copy { border-width: 1px; } }
      `}</style>
      <PrintToolbar title="Fee voucher" />
      <article className="voucher-sheet">
        {COPIES.map((c) => (
          <VoucherCopy key={c} data={data} copyLabel={c} />
        ))}
      </article>
    </div>
  );
}
