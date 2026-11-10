"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PrintToolbar from "@/components/PrintToolbar";
import VoucherSheet from "@/components/fees/VoucherSheet";

export default function PrintClassVouchersPage({ params }: { params: Promise<{ classId: string }> }) {
  const [classId, setClassId] = useState("");
  const searchParams = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setClassId(p.classId));
  }, [params]);

  useEffect(() => {
    if (!classId) return;
    const qs = searchParams.toString();
    fetch(`/api/print/challan/class/${encodeURIComponent(classId)}${qs ? `?${qs}` : ""}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load vouchers for this class.");
          return;
        }
        setData(d);
      })
      .catch(() => setError("Unable to load vouchers for this class."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  if (loading) return <p className="text-xs text-on-surface-variant p-8">Loading vouchers...</p>;
  if (error || !data) return <p className="text-sm text-error p-8">{error || "No vouchers found."}</p>;

  return (
    <div>
      <PrintToolbar title={`Class vouchers (${data.vouchers.length})`} />
      {data.vouchers.length === 0 ? (
        <p className="text-sm text-on-surface-variant p-4">No vouchers match these filters.</p>
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
