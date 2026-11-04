"use client";

import React, { useState } from "react";

/**
 * Bulk student document import UI. The backend (/api/students/documents-import) already matches
 * each file strictly by Student ID encoded in its file name, validates real file content/size,
 * and re-validates everything fresh on commit (the preview is never trusted blindly) — this
 * component is only the preview -> confirm -> commit workflow around it.
 */

type RowStatus = "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "DUPLICATE" | "INVALID";

interface PreviewRow {
  fileName: string;
  studentId: string;
  status: RowStatus;
  error?: string;
  student?: { id: string; fullName: string; admissionNo: string };
}

interface PreviewResponse {
  dryRun: true;
  summary: { total: number; matched: number; unmatched: number; ambiguous: number; duplicate: number; invalid: number };
  rows: PreviewRow[];
}

interface CommitResult {
  fileName: string;
  status: "IMPORTED" | "SKIPPED" | "FAILED";
  reason?: string;
  studentId?: string;
}

const STATUS_STYLES: Record<RowStatus, string> = {
  MATCHED: "bg-tertiary-container/10 text-on-tertiary-container",
  UNMATCHED: "bg-error-container text-on-error-container",
  AMBIGUOUS: "bg-amber-100 text-amber-800",
  DUPLICATE: "bg-surface-container-high text-on-surface",
  INVALID: "bg-error-container text-on-error-container",
};

const DOC_TYPE_OPTIONS = [
  { value: "ID_CARD", label: "B-Form / ID Card Scan" },
  { value: "CERTIFICATE", label: "Birth / Leaving Certificate" },
  { value: "ADMISSION_FORM", label: "Admission Application Form" },
  { value: "OTHER", label: "Other Educational Record" },
];

export default function StudentDocumentImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "committing" | "done">("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [docType, setDocType] = useState("OTHER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [filter, setFilter] = useState<RowStatus | "ALL">("ALL");
  const [result, setResult] = useState<{ summary: { imported: number; skippedOrFailed: number }; results: CommitResult[] } | null>(null);
  // Guards against a double-click (or a slow network causing a second tap) firing the commit
  // twice — once a commit is in flight or done, the button is disabled until a fresh preview.
  const [committed, setCommitted] = useState(false);

  // preview.rows is index-aligned with the exact `files` array that was sent for preview (the
  // backend maps files -> rows 1:1 in order) — matching by index, not by file name, so two
  // selected files that happen to share the same name are never confused with each other.
  const matchedIndexes = (preview?.rows || [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "MATCHED")
    .map(({ i }) => i);
  const matchedRows = (preview?.rows || []).filter((r) => r.status === "MATCHED");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    setFiles(list);
    setError("");
  };

  const handlePreview = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("dryRun", "true");
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/students/documents-import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Could not read the files.");
      setPreview(json);
      setCommitted(false);
      setStep("preview");
    } catch (e: any) {
      setError(e.message || "Could not read the files.");
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (committed || matchedRows.length === 0) return;
    // Lock immediately — the actual files, not the preview's description of them, go to the
    // server; re-sending the same FormData twice would re-import every file a second time.
    setCommitted(true);
    setStep("committing");
    setBusy(true);
    setError("");
    try {
      const matchedFiles = matchedIndexes.map((i) => files[i]);
      const fd = new FormData();
      fd.append("docType", docType);
      for (const f of matchedFiles) fd.append("files", f);
      const res = await fetch("/api/students/documents-import", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Import failed. No files were saved.");
      setResult({ summary: json.summary, results: json.results });
      setStep("done");
      if (json.summary.imported > 0) onImported();
    } catch (e: any) {
      setError(e.message || "Import failed. Check your connection and try again — nothing already imported is affected.");
      setStep("preview");
      setCommitted(false);
    } finally {
      setBusy(false);
    }
  };

  const visibleRows = (preview?.rows || []).filter((r) => filter === "ALL" || r.status === filter);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-student-docs-heading"
        className="bg-surface-container-lowest rounded-xl max-w-5xl w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
      >
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 id="import-student-docs-heading" className="font-headline-md text-sm font-bold text-on-surface">
            Bulk Import Student Documents
          </h3>
          <button type="button" onClick={onClose} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{error}</span>
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/40">
              <p className="font-semibold text-on-surface mb-1">File naming convention (required)</p>
              <p className="text-on-surface-variant">
                Name each file starting with the student&apos;s exact <strong>Student ID</strong> (Admission No),
                optionally followed by <code>_</code> and a description — e.g.{" "}
                <code className="font-mono">STD-2026-001.pdf</code> or{" "}
                <code className="font-mono">STD-2026-001_certificate.pdf</code>. Matching is by this ID only —
                never by the student&apos;s name. A file whose ID doesn&apos;t match exactly one active student is
                never guessed; it is reported so you can fix the file name and re-upload it.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-on-surface mb-1">Document Category *</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full sm:w-auto h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              >
                {DOC_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-on-surface-variant mt-0.5">Applied to every file in this batch.</p>
            </div>

            <div>
              <label htmlFor="student-doc-import-files" className="block font-semibold text-on-surface mb-1">
                Select files
              </label>
              <input
                id="student-doc-import-files"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={handleFileSelect}
                className="block w-full text-xs text-on-surface"
              />
              {files.length > 0 && (
                <p className="text-[11px] text-on-surface-variant mt-1">{files.length} file(s) selected.</p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={files.length === 0 || busy}
                className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
              >
                {busy ? "Reading files..." : "Preview Import"}
              </button>
            </div>
          </div>
        )}

        {(step === "preview" || step === "committing") && preview && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {(["ALL", "MATCHED", "UNMATCHED", "AMBIGUOUS", "DUPLICATE", "INVALID"] as const).map((f) => {
                const count =
                  f === "ALL" ? preview.summary.total
                  : f === "MATCHED" ? preview.summary.matched
                  : f === "UNMATCHED" ? preview.summary.unmatched
                  : f === "AMBIGUOUS" ? preview.summary.ambiguous
                  : f === "DUPLICATE" ? preview.summary.duplicate
                  : preview.summary.invalid;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-2.5 py-1 rounded-full font-bold ${filter === f ? "ring-2 ring-secondary" : ""} ${f === "ALL" ? "bg-surface-container text-on-surface" : STATUS_STYLES[f]}`}
                  >
                    {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()} {count}
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto border border-surface-container-high/40 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant uppercase text-[10px] tracking-wider">
                    <th className="py-2 px-3">File</th>
                    <th className="py-2 px-3">Student ID</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Matched Student</th>
                    <th className="py-2 px-3">Issue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {visibleRows.map((r) => (
                    <tr key={r.fileName}>
                      <td className="py-2 px-3 font-mono">{r.fileName}</td>
                      <td className="py-2 px-3 font-mono">{r.studentId || "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded font-bold ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-on-surface">
                        {r.student ? `${r.student.fullName} (${r.student.admissionNo})` : "—"}
                      </td>
                      <td className="py-2 px-3 text-error">{r.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-on-surface-variant">
                {matchedRows.length} of {preview.summary.total} file(s) will be imported. Unmatched, ambiguous,
                duplicate and invalid files are never imported.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setStep("upload"); setPreview(null); setCommitted(false); }}
                  disabled={step === "committing"}
                  className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold disabled:opacity-50"
                >
                  Choose different files
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={busy || committed || matchedRows.length === 0}
                  className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {step === "committing" ? "Importing..." : `Import ${matchedRows.length} Document${matchedRows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1.5 rounded-lg bg-tertiary-container/10 text-on-tertiary-container font-bold">Imported: {result.summary.imported}</span>
              <span className="px-3 py-1.5 rounded-lg bg-error-container text-on-error-container font-bold">Skipped/Failed: {result.summary.skippedOrFailed}</span>
            </div>
            <div className="border border-surface-container-high/40 rounded-lg p-3 space-y-1 max-h-64 overflow-y-auto">
              {result.results.map((r) => (
                <div key={r.fileName}>
                  <span className="font-mono font-bold">{r.fileName}</span> —{" "}
                  <span className={r.status === "IMPORTED" ? "text-on-tertiary-container font-bold" : "text-error font-bold"}>{r.status}</span>
                  {r.reason ? `: ${r.reason}` : ""}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
