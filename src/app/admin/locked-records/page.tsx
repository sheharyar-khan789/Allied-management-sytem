"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

export default function LockedRecordsPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  useEffect(() => {
    fetch("/api/locked-records")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setRecords(json.records);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Certified Academic Records Vault
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Archived Transcripts
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Archived and certified annual transcripts, official board certificates, and sealed academic records.
          </p>
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading records vault...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">lock</span>
            <p className="text-sm font-semibold text-on-surface">No certified records in vault</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Reference #</th>
                  <th className="py-3 px-4 font-bold">Student Name</th>
                  <th className="py-3 px-4 font-bold">Admission #</th>
                  <th className="py-3 px-4 font-bold">Class & Session</th>
                  <th className="py-3 px-4 font-bold">Certified Date</th>
                  <th className="py-3 px-4 font-bold">Certified By</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-secondary">{r.referenceNo}</td>
                    <td className="py-3 px-4 font-bold text-on-surface">{r.studentName}</td>
                    <td className="py-3 px-4 font-mono text-on-surface-variant">{r.admissionNo}</td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-on-surface">{r.className}</span>
                      <span className="text-[10px] text-on-surface-variant block">{r.sessionName}</span>
                    </td>
                    <td className="py-3 px-4 text-on-surface-variant">{formatDate(r.certifiedDate)}</td>
                    <td className="py-3 px-4 font-medium text-on-surface">{r.certifiedBy}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full bg-tertiary-container/10 text-on-tertiary-container text-[10px] font-bold flex items-center gap-1 w-max">
                        <span className="material-symbols-outlined text-[12px]">lock</span>
                        <span>Sealed</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedRecord(r)}
                        className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-container-high text-secondary font-semibold text-[11px]"
                      >
                        Inspect Summary
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspect Summary Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="locked-record-seal-heading"
            className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[20px]">verified</span>
                <h3 id="locked-record-seal-heading" className="font-headline-md text-sm font-bold text-on-surface">Certified Academic Seal</h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-surface-container-low rounded-lg space-y-1">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Student:</span>
                  <span className="font-bold text-on-surface">{selectedRecord.studentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Reference No:</span>
                  <span className="font-mono font-bold text-secondary">{selectedRecord.referenceNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Class:</span>
                  <span className="font-semibold text-on-surface">{selectedRecord.className}</span>
                </div>
              </div>

              <div>
                <span className="font-bold text-on-surface block mb-1">Stored Academic Record Data:</span>
                <pre className="p-3 rounded bg-primary text-secondary-fixed text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
                  {selectedRecord.summaryJson}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
