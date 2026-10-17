"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PrintToolbar from "@/components/PrintToolbar";
import ReportCardView from "@/components/ReportCardView";

function PrintReportCardInner({ params }: { params: Promise<{ studentId: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const examId = searchParams.get("examId") || "";
  const [studentId, setStudentId] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setStudentId(p.studentId));
  }, [params]);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    setError("");
    const qs = examId ? `?examId=${encodeURIComponent(examId)}` : "";
    fetch(`/api/print/report-card/${encodeURIComponent(studentId)}${qs}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.success) {
          setError(d.error || "Unable to load this report card.");
          setData(null);
          return;
        }
        setData(d);
      })
      .catch(() => setError("Unable to load this report card."))
      .finally(() => setLoading(false));
  }, [studentId, examId]);

  if (loading && !data) return <p className="text-xs text-on-surface-variant p-8">Loading report card...</p>;
  if (error || !data) return <p className="text-sm text-error p-8">{error || "Report card not found."}</p>;

  return (
    <div>
      <PrintToolbar title="Report card" />
      <ReportCardView
        data={data}
        onSelectExam={(id) =>
          router.replace(`/print/report-card/${encodeURIComponent(studentId)}${id ? `?examId=${encodeURIComponent(id)}` : ""}`)
        }
      />
    </div>
  );
}

export default function PrintReportCardPage({ params }: { params: Promise<{ studentId: string }> }) {
  return (
    <Suspense fallback={<p className="text-xs text-on-surface-variant p-8">Loading report card...</p>}>
      <PrintReportCardInner params={params} />
    </Suspense>
  );
}
