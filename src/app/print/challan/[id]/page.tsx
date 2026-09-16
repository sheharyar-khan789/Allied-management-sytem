"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";
import { formatCurrency, formatDate } from "@/lib/utils";

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

  if (loading) {
    return <p className="text-xs text-on-surface-variant p-8">Loading challan...</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-error p-8">{error || "Challan not found."}</p>;
  }

  const school = data.school;
  const student = data.student;
  const ch = data.challan;
  const items = [
    { label: "Tuition fee", amount: ch.tuitionFee },
    { label: "Admission fee", amount: ch.admissionFee },
    { label: "Exam fee", amount: ch.examFee },
    { label: "Other fee", amount: ch.otherFee },
  ].filter((i) => Number(i.amount) > 0);

  return (
    <div>
      <PrintToolbar title="Fee challan" />
      <article className="print-sheet p-6 sm:p-8 rounded-xl bg-white border border-surface-container-high shadow-sm print:border-0 print:shadow-none print:rounded-none">
        <header className="text-center border-b-2 border-on-surface pb-4 mb-4">
          <h2 className="text-xl font-bold tracking-tight">{school.name}</h2>
          {school.campusName ? <p className="text-xs mt-1">{school.campusName}</p> : null}
          <p className="text-[11px] text-on-surface-variant mt-1">{school.address}</p>
          <p className="text-[11px] text-on-surface-variant">
            Phone: {school.phone} • Email: {school.email}
          </p>
          <p className="mt-3 text-sm font-bold uppercase tracking-wide">Fee Challan</p>
        </header>

        <div className="grid grid-cols-2 gap-3 text-xs mb-4">
          <p><span className="text-on-surface-variant">Student:</span> <strong>{student.fullName}</strong></p>
          <p><span className="text-on-surface-variant">Student ID:</span> <strong>{student.admissionNo}</strong></p>
          <p><span className="text-on-surface-variant">Class:</span> <strong>{student.className}{student.section ? `-${student.section}` : ""}</strong></p>
          <p><span className="text-on-surface-variant">Challan / Ref:</span> <strong className="font-mono">{ch.challanNo}</strong></p>
          <p><span className="text-on-surface-variant">Issue date:</span> {formatDate(ch.issueDate)}</p>
          <p><span className="text-on-surface-variant">Due date:</span> {formatDate(ch.dueDate)}</p>
          <p><span className="text-on-surface-variant">Period:</span> {ch.month} {ch.year}</p>
          <p><span className="text-on-surface-variant">Status:</span> <strong>{ch.status}</strong></p>
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
                <td className="py-2 px-3 text-right">{formatCurrency(ch.totalExpected)}</td>
              </tr>
            ) : (
              items.map((i) => (
                <tr key={i.label} className="border-t border-outline-variant/40">
                  <td className="py-2 px-3">{i.label}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(i.amount)}</td>
                </tr>
              ))
            )}
            {Number(ch.discount) > 0 && (
              <tr className="border-t border-outline-variant/40">
                <td className="py-2 px-3">Discount</td>
                <td className="py-2 px-3 text-right">-{formatCurrency(ch.discount)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-on-surface font-bold">
              <td className="py-2 px-3">Total amount</td>
              <td className="py-2 px-3 text-right">{formatCurrency(ch.totalExpected)}</td>
            </tr>
            <tr>
              <td className="py-2 px-3">Paid amount</td>
              <td className="py-2 px-3 text-right">{formatCurrency(ch.paidAmount)}</td>
            </tr>
            <tr>
              <td className="py-2 px-3">Outstanding</td>
              <td className="py-2 px-3 text-right">{formatCurrency(ch.outstanding)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="text-[10px] text-on-surface-variant mt-6">
          This is a recording/view challan. Do not treat this document as proof of an online payment.
        </p>
      </article>
    </div>
  );
}
