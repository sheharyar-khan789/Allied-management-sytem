"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";
import VoucherSheet from "@/components/fees/VoucherSheet";

export default function PrintBatchVouchersPage({ params }: { params: Promise<{ batchId: string }> }) {
  const [batchId, setBatchId] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setBatchId(p.batchId));
  }, [params]);

  useEffect(() => {
    if (!batchId) return;
    fetch(`/api/print/challan/batch/${encodeURIComponent(batchId)}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load this voucher batch.");
          return;
        }
        setData(d);
      })
      .catch(() => setError("Unable to load this voucher batch."))
      .finally(() => setLoading(false));
  }, [batchId]);

  if (loading) return <p className="text-xs text-on-surface-variant p-8">Loading vouchers...</p>;
  if (error || !data) return <p className="text-sm text-error p-8">{error || "No vouchers found."}</p>;

  return (
    <div>
      <PrintToolbar title={`Generated vouchers (${data.vouchers.length})`} />
      {data.vouchers.length === 0 ? (
        <p className="text-sm text-on-surface-variant p-4">No vouchers were created in this batch.</p>
      ) : (
        <div className="space-y-6">
          {data.vouchers.map((v: any, idx: number) => (
            <VoucherSheet
              key={`${v.student.admissionNo}-${idx}`}
              school={data.school}
              student={v.student}
              challan={v.challan}
              pageBreakAfter={idx < data.vouchers.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
