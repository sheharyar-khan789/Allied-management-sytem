"use client";

import React, { useState } from "react";

interface Row {
  studentId: string;
  name?: string;
  loginEmail?: string;
  status: "UPDATED" | "FAILED";
  reason?: string;
  verified?: boolean | null;
  password?: string;
}

const CHUNK = 100;

/**
 * Bulk password reset for the students ticked on the roster. Each account is reported on its own
 * line; failures are listed with their reason and can be retried on their own. Generated passwords
 * exist only in this panel's memory (and the downloadable sheet the admin chooses to save).
 */
export default function StudentBulkPasswordPanel({
  students,
  onClose,
}: {
  students: { id: string; fullName: string }[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"random" | "temporary">("random");
  const [confirmTemporary, setConfirmTemporary] = useState(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const run = async (ids: string[]) => {
    setRunning(true);
    setError("");
    const collected: Row[] = [];
    const notes = new Set<string>();
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const res = await fetch("/api/students/passwords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ students: ids.slice(i, i + CHUNK), mode, confirmTemporary: mode === "temporary" ? confirmTemporary : undefined }),
        });
        const j = await res.json().catch(() => ({}));
        if (!Array.isArray(j.outcomes)) {
          // The whole chunk was refused (permission, validation, session) — nothing was changed.
          for (const id of ids.slice(i, i + CHUNK)) {
            collected.push({ studentId: id, name: students.find((s) => s.id === id)?.fullName, status: "FAILED", reason: j.error || "The request was refused." });
          }
        } else {
          collected.push(...j.outcomes);
          (j.warnings || []).forEach((w: string) => notes.add(w));
        }
      }
    } catch {
      setError("The connection was interrupted. Accounts listed as updated are done; retry the failed ones.");
    } finally {
      // Merge by student so a retry replaces earlier failures.
      setRows((prev) => {
        const map = new Map((prev || []).map((r) => [r.studentId, r]));
        collected.forEach((r) => map.set(r.studentId, r));
        return Array.from(map.values());
      });
      setWarnings(Array.from(notes));
      setRunning(false);
    }
  };

  const failedIds = (rows || []).filter((r) => r.status === "FAILED").map((r) => r.studentId);

  const download = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ["Name,Login email,Password"]
      .concat((rows || []).filter((r) => r.status === "UPDATED" && r.password).map((r) => [esc(r.name || ""), esc(r.loginEmail || ""), esc(r.password || "")].join(",")))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "student-passwords.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-pw-heading"
        className="bg-surface-container-lowest rounded-xl max-w-2xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 id="bulk-pw-heading" className="font-headline-md text-sm font-bold text-on-surface">
            Reset passwords — {students.length} student{students.length === 1 ? "" : "s"}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {rows === null && (
          <div className="space-y-3 text-xs">
            <label className="flex items-start gap-2">
              <input type="radio" checked={mode === "random"} onChange={() => setMode("random")} className="mt-0.5" />
              <span><b>Unique random password for each student</b> (recommended). Shown once here; only a hash is stored.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" checked={mode === "temporary"} onChange={() => setMode("temporary")} className="mt-0.5" />
              <span>Shared temporary password for everyone. Weak, and the system cannot force a change at first login.</span>
            </label>
            {mode === "temporary" && (
              <label className="flex items-start gap-2 text-error font-semibold">
                <input type="checkbox" checked={confirmTemporary} onChange={(e) => setConfirmTemporary(e.target.checked)} className="mt-0.5" />
                <span>I understand every selected student will share the same weak password.</span>
              </label>
            )}
            <p className="text-on-surface-variant">Current passwords stop working immediately and signed-in sessions are ended.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 h-9 rounded-lg bg-surface-container text-on-surface font-semibold">Cancel</button>
              <button type="button" disabled={running || (mode === "temporary" && !confirmTemporary)}
                onClick={() => run(students.map((s) => s.id))}
                className="px-4 h-9 rounded-lg bg-secondary text-on-secondary font-semibold disabled:opacity-50">
                {running ? "Resetting..." : "Reset passwords"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs font-semibold text-error">{error}</p>}
        {warnings.map((w) => <p key={w} className="text-[11px] font-semibold text-error">{w}</p>)}

        {rows !== null && (
          <div className="space-y-3">
            <p className="text-xs text-on-surface">
              <b>{rows.filter((r) => r.status === "UPDATED").length}</b> updated, <b className={failedIds.length ? "text-error" : ""}>{failedIds.length}</b> failed.
              {rows.some((r) => r.password) && " Save the passwords now — they cannot be shown again."}
            </p>
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-surface-container-high rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-container-low text-on-surface-variant sticky top-0">
                  <tr><th className="py-2 px-3">Student</th><th className="py-2 px-3">Login</th><th className="py-2 px-3">Result</th><th className="py-2 px-3">Password</th></tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {rows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="py-1.5 px-3 font-semibold">{r.name || r.studentId}</td>
                      <td className="py-1.5 px-3 font-mono">{r.loginEmail || "—"}</td>
                      <td className={`py-1.5 px-3 ${r.status === "UPDATED" ? "" : "text-error font-semibold"}`}>
                        {r.status === "UPDATED" ? (r.verified === false ? "Updated (not confirmed by provider)" : "Updated") : `Failed: ${r.reason || "unknown"}`}
                      </td>
                      <td className="py-1.5 px-3 font-mono select-all">{r.password || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {failedIds.length > 0 && (
                <button type="button" disabled={running} onClick={() => run(failedIds)}
                  className="px-4 h-9 rounded-lg bg-surface-container text-on-surface font-semibold disabled:opacity-50">
                  {running ? "Retrying..." : `Retry ${failedIds.length} failed`}
                </button>
              )}
              {rows.some((r) => r.password) && (
                <button type="button" onClick={download} className="px-4 h-9 rounded-lg bg-surface-container text-on-surface font-semibold">Download sheet (CSV)</button>
              )}
              <button type="button" onClick={onClose} className="px-4 h-9 rounded-lg bg-secondary text-on-secondary font-semibold">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
