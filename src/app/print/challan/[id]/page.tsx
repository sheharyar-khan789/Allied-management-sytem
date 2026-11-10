"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";
import VoucherSheet from "@/components/fees/VoucherSheet";

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
    return <p className="text-xs text-on-surface-variant p-8">Loading voucher...</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-error p-8">{error || "Voucher not found."}</p>;
  }

  return (
    <div>
      <PrintToolbar title="Fee voucher" />
      <VoucherSheet school={data.school} student={data.student} challan={data.challan} />
    </div>
  );
}
