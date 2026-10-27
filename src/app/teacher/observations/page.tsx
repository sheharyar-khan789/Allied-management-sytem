"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

/**
 * A teacher's own observation file — strictly read-only. The API (`/api/teacher-observations`)
 * resolves the caller's own `teacherId` server-side for a TEACHER role and ignores any
 * `teacherId` sent by the client, so there is no parameter to change here that would reach
 * another teacher's notes.
 */
export default function TeacherObservationsPage() {
  const [observations, setObservations] = useState<any[]>([]);
  const [teacherName, setTeacherName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/teacher-observations", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          setError(json.error || "Could not load your observations.");
          return;
        }
        setObservations(json.observations || []);
        setTeacherName(json.teacher?.fullName || "");
      } catch {
        setError("Could not load your observations. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openObservation = observations.find((o) => o.id === openId);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">My Observations</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Formal evaluation notes administration has written about you{teacherName ? `, ${teacherName}` : ""}. These are read-only.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading...</p>
          </div>
        ) : observations.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">fact_check</span>
            <p className="text-sm font-semibold text-on-surface">No observations recorded for you yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Date</th>
                  <th className="py-3 px-4 font-bold">Category</th>
                  <th className="py-3 px-4 font-bold">Rating</th>
                  <th className="py-3 px-4 font-bold">Title / Excerpt</th>
                  <th className="py-3 px-4 font-bold">Written by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {observations.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-container-low/40 cursor-pointer" onClick={() => setOpenId(o.id)}>
                    <td className="py-3 px-4 text-on-surface-variant whitespace-nowrap font-mono text-[11px]">{formatDate(o.observationDate)}</td>
                    <td className="py-3 px-4">
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-semibold text-on-surface">{o.categoryLabel}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        o.rating === "EXCELLENT" ? "bg-tertiary-container/30 text-on-tertiary-container" :
                        o.rating === "NEEDS_IMPROVEMENT" ? "bg-error-container/20 text-error" :
                        "bg-surface-container-high text-on-surface"
                      }`}>{o.ratingLabel}</span>
                    </td>
                    <td className="py-3 px-4 font-medium text-on-surface max-w-sm truncate">{o.title || o.note}</td>
                    <td className="py-3 px-4 text-on-surface-variant">{o.authorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openObservation && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpenId("")}>
          <div className="bg-surface-container-lowest rounded-xl shadow-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold text-on-surface-variant uppercase">{openObservation.categoryLabel} • {openObservation.ratingLabel}</p>
                <h2 className="font-headline-md text-base font-bold text-on-surface mt-0.5">{openObservation.title || "Untitled note"}</h2>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  Written by {openObservation.authorName} on {formatDate(openObservation.observationDate)}
                  {openObservation.updatedAt !== openObservation.createdAt ? ` • last edited ${formatDate(openObservation.updatedAt)}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setOpenId("")} className="text-on-surface-variant hover:text-on-surface shrink-0">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <p className="text-sm text-on-surface whitespace-pre-wrap leading-relaxed">{openObservation.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}
