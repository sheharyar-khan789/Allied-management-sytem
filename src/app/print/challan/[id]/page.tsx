"use client";

import React, { useEffect, useState } from "react";
import PrintToolbar from "@/components/PrintToolbar";
import { FeeVoucherPage, VoucherStyles } from "@/components/FeeVoucher";
import type { VoucherData } from "@/lib/fee-voucher";

export default function PrintChallanPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [voucher, setVoucher] = useState<VoucherData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/print/challan/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.success || !d.voucher) {
          setError(d.error || "Unable to load this challan.");
          return;
        }
        setVoucher(d.voucher);
      })
      .catch(() => setError("Unable to load this challan."))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-xs text-on-surface-variant p-8">Loading challan...</p>;
  if (error || !voucher) return <p className="text-sm text-error p-8">{error || "Challan not found."}</p>;

  return (
    <div>
      <VoucherStyles />
      <PrintToolbar title="Fee voucher" />
      <div className="voucher-sheet-screen-frame overflow-x-auto rounded-xl border border-surface-container-high bg-white p-3 shadow-sm">
        <FeeVoucherPage voucher={voucher} />
      </div>
    </div>
  );
}
