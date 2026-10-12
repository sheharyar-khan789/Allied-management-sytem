"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type ImportItem = {
  id: string;
  kind: "STRUCTURED" | "IMAGE";
  title: string;
  source?: string;
  fileUrl?: string;
  contentType?: string;
  printedDate?: string;
  slotCount?: number;
  createdByName?: string;
  updatedAt?: string;
  createdAt?: string;
};

const isPdf = (i: ImportItem) => i.contentType === "application/pdf";
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "");

/**
 * Image timetables (the uploaded file IS the timetable) and, for admins, the history of
 * structured imports with a way to remove an import and all of its periods.
 */
export default function TimetableImages({ admin = false, refreshKey = 0, onChanged }: { admin?: boolean; refreshKey?: number; onChanged?: () => void }) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ImportItem | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<ImportItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/timetable/import", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load timetable images.");
      setItems(json.imports || []);
      setError("");
    } catch (e: any) {
      setError(e?.message || "Failed to load timetable images.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const remove = async (item: ImportItem) => {
    const what =
      item.kind === "IMAGE"
        ? `Delete the image timetable "${item.title}"?`
        : `Delete the import "${item.title}" and its ${item.slotCount || 0} periods from the timetable?`;
    if (!confirm(what)) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/timetable/import?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Delete failed.");
      await load();
      onChanged?.();
    } catch (e: any) {
      alert(e?.message || "Delete failed.");
    } finally {
      setBusyId(null);
    }
  };

  const replace = async (file: File | undefined) => {
    const item = replacing;
    setReplacing(null);
    if (!file || !item) return;
    setBusyId(item.id);
    try {
      const form = new FormData();
      form.set("action", "image");
      form.set("replaceId", item.id);
      form.set("file", file);
      const res = await fetch("/api/timetable/import", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Replace failed.");
      await load();
    } catch (e: any) {
      alert(e?.message || "Replace failed.");
    } finally {
      setBusyId(null);
    }
  };

  const images = items.filter((i) => i.kind === "IMAGE" && i.fileUrl);
  const structured = admin ? items.filter((i) => i.kind === "STRUCTURED") : [];
  if (!error && images.length === 0 && structured.length === 0) return null;

  return (
    <section className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 p-4 space-y-3">
      {error && <p className="text-xs text-error">{error}</p>}

      {images.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">Image timetables</h2>
            <p className="text-[11px] text-on-surface-variant">
              Uploaded as pictures/PDFs — shown as they are. {admin ? "To edit individual periods, add or import them as structured periods." : ""}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((i) => (
              <div key={i.id} className="rounded-lg border border-outline-variant/40 overflow-hidden">
                <button type="button" onClick={() => setViewing(i)} className="block w-full bg-surface-container-low" aria-label={`Open ${i.title}`}>
                  {isPdf(i) ? (
                    <div className="h-40 flex flex-col items-center justify-center text-on-surface-variant">
                      <span className="material-symbols-outlined text-4xl">picture_as_pdf</span>
                      <span className="text-[11px]">PDF timetable</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.fileUrl} alt={i.title} className="h-40 w-full object-contain" />
                  )}
                </button>
                <div className="p-2 text-xs space-y-1">
                  <div className="font-semibold text-on-surface truncate">{i.title}</div>
                  <div className="text-[11px] text-on-surface-variant">
                    {i.printedDate ? `${i.printedDate} • ` : ""}Updated {when(i.updatedAt)}
                  </div>
                  <div className="flex gap-1 pt-1">
                    <a href={i.fileUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-surface-container font-semibold">Open</a>
                    {admin && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === i.id}
                          onClick={() => {
                            setReplacing(i);
                            replaceInput.current?.click();
                          }}
                          className="px-2 py-1 rounded bg-surface-container font-semibold disabled:opacity-50"
                        >
                          Replace
                        </button>
                        <button type="button" disabled={busyId === i.id} onClick={() => remove(i)} className="px-2 py-1 rounded bg-surface-container text-error font-semibold disabled:opacity-50">
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {structured.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-headline-md text-sm font-bold text-on-surface">Imported timetables</h2>
          <ul className="divide-y divide-surface-container-low text-xs">
            {structured.map((i) => (
              <li key={i.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-on-surface">{i.title}</span>
                <span className="text-on-surface-variant">
                  {i.slotCount || 0} periods • {i.source?.toUpperCase()} • {when(i.createdAt)}
                  {i.createdByName ? ` • ${i.createdByName}` : ""}
                </span>
                <span className="ml-auto flex gap-1">
                  {i.fileUrl && (
                    <a href={i.fileUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-surface-container font-semibold">Original file</a>
                  )}
                  <button type="button" disabled={busyId === i.id} onClick={() => remove(i)} className="px-2 py-1 rounded bg-surface-container text-error font-semibold disabled:opacity-50">
                    Delete import
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {admin && (
        <input
          ref={replaceInput}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            replace(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-surface-container-lowest rounded-xl max-w-6xl w-full max-h-[92vh] overflow-auto p-3 space-y-2" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={viewing.title}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-on-surface">{viewing.title}</span>
              <button onClick={() => setViewing(null)} aria-label="Close" className="text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {isPdf(viewing) ? (
              <a href={viewing.fileUrl} target="_blank" rel="noopener noreferrer" className="text-secondary underline text-xs">Open the PDF</a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewing.fileUrl} alt={viewing.title} className="w-full h-auto" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
