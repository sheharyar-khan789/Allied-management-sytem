"use client";

import React, { useMemo, useState } from "react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };
const TEMPLATE_COLUMNS = ["Day", "Period", "Start", "End", "Class", "Subject", "Teacher", "Room", "Friday Start", "Friday End"];

type Issue = { field: string; level: "error" | "warning"; message: string };
type Row = {
  key: string;
  raw: { className: string; subjectName: string; teacherName: string };
  classId: string;
  subjectId: string;
  teacherId: string;
  periodName: string;
  startTime: string;
  endTime: string;
  fridayStartTime: string;
  fridayEndTime: string;
  days: string[];
  roomNo: string;
  issues: Issue[];
};
type Choices = {
  classes: { id: string; label: string }[];
  subjects: { id: string; classId: string; label: string; teacherId: string }[];
  teachers: { id: string; label: string }[];
};
type Preview = {
  mode: "structured" | "image-only";
  source: "csv" | "xlsx" | "image" | "pdf";
  fileName: string;
  title?: string;
  printedDate?: string;
  notes: string[];
  rows: Row[];
  choices: Choices;
  extractionAvailable: boolean;
};

const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Issues recomputed from the row's current values; reader warnings stay until that field is edited. */
function currentIssues(row: Row, choices: Choices, edited: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (!choices.classes.some((c) => c.id === row.classId)) {
    issues.push({ field: "class", level: "error", message: row.raw.className ? `Class "${row.raw.className}" not found — pick the class.` : "Pick the class." });
  }
  if (!choices.subjects.some((s) => s.id === row.subjectId && s.classId === row.classId)) {
    issues.push({ field: "subject", level: "error", message: row.raw.subjectName ? `Subject "${row.raw.subjectName}" not found in this class — pick it.` : "Pick the subject." });
  }
  if (!row.teacherId && row.raw.teacherName) {
    issues.push({ field: "teacher", level: "warning", message: `Teacher "${row.raw.teacherName}" not matched — the subject's teacher will be used unless you pick one.` });
  }
  if (!row.periodName.trim()) issues.push({ field: "period", level: "error", message: "Period name is missing." });
  if (!validTime(row.startTime) || !validTime(row.endTime)) issues.push({ field: "time", level: "error", message: "Start and end time are required." });
  else if (row.endTime <= row.startTime) issues.push({ field: "time", level: "error", message: "End time must be after start time." });
  if (row.fridayStartTime || row.fridayEndTime) {
    if (!validTime(row.fridayStartTime) || !validTime(row.fridayEndTime)) issues.push({ field: "fridayTime", level: "error", message: "Set both Friday times or clear both." });
    else if (row.fridayEndTime <= row.fridayStartTime) issues.push({ field: "fridayTime", level: "error", message: "Friday end must be after Friday start." });
  }
  if (row.days.length === 0) issues.push({ field: "days", level: "error", message: "Choose at least one day." });
  for (const i of row.issues) {
    if (i.level === "warning" && i.field !== "teacher" && !edited.has(i.field)) issues.push(i);
  }
  return issues;
}

export default function TimetableImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [edited, setEdited] = useState<Record<string, Set<string>>>({});
  const [title, setTitle] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState("");

  const choices = useMemo<Choices>(() => preview?.choices || { classes: [], subjects: [], teachers: [] }, [preview]);
  const issuesByRow = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.key, currentIssues(r, choices, edited[r.key] || new Set())])),
    [rows, choices, edited]
  );
  const errorCount = rows.filter((r) => issuesByRow[r.key]?.some((i) => i.level === "error")).length;
  const warningCount = rows.filter((r) => issuesByRow[r.key]?.some((i) => i.level === "warning")).length;

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_COLUMNS.join(",") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "timetable-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const readFile = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setServerErrors({});
    try {
      const form = new FormData();
      form.set("action", "preview");
      form.set("file", file);
      const res = await fetch("/api/timetable/import", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "The file could not be read.");
      setPreview(json);
      setRows(json.rows || []);
      setEdited({});
      setTitle(json.title || file.name.replace(/\.[^.]+$/, ""));
      setAcknowledged(false);
    } catch (e: any) {
      setError(e?.message || "The file could not be read.");
    } finally {
      setLoading(false);
    }
  };

  const update = (key: string, field: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setEdited((prev) => ({ ...prev, [key]: new Set([...(prev[key] || []), field]) }));
    setServerErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setAllDays = (days: string[]) => {
    setRows((prev) => prev.map((r) => ({ ...r, days })));
    setEdited((prev) => Object.fromEntries(rows.map((r) => [r.key, new Set([...(prev[r.key] || []), "days"])])));
  };

  const addRow = () => {
    const key = `n${Date.now().toString(36)}`;
    setRows((prev) => [
      ...prev,
      { key, raw: { className: "", subjectName: "", teacherName: "" }, classId: "", subjectId: "", teacherId: "", periodName: "", startTime: "", endTime: "", fridayStartTime: "", fridayEndTime: "", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], roomNo: "", issues: [] },
    ]);
  };

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    setError("");
    setServerErrors({});
    try {
      const form = new FormData();
      form.set("action", "commit");
      form.set("rows", JSON.stringify(rows));
      form.set("replaceExisting", String(replaceExisting));
      form.set("title", title);
      form.set("printedDate", preview.printedDate || "");
      form.set("source", preview.source);
      form.set("fileName", preview.fileName);
      if (file && (preview.source === "image" || preview.source === "pdf")) form.set("file", file);
      const res = await fetch("/api/timetable/import", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const byRow: Record<string, string[]> = {};
        for (const e of json.rowErrors || []) (byRow[e.key] ||= []).push(e.message);
        setServerErrors(byRow);
        throw new Error(json.error || "The timetable could not be saved.");
      }
      setDone(`Saved ${json.created} periods${json.replaced ? `, replacing ${json.replaced} existing periods` : ""}.`);
      onImported();
    } catch (e: any) {
      setError(e?.message || "The timetable could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveAsImage = async () => {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.set("action", "image");
      form.set("file", file);
      form.set("title", title);
      form.set("printedDate", preview?.printedDate || "");
      const res = await fetch("/api/timetable/import", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "The image could not be saved.");
      setDone("Saved as an image timetable. It is shown on the timetable page; its periods are not editable individually.");
      onImported();
    } catch (e: any) {
      setError(e?.message || "The image could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const cell = "h-8 px-2 rounded bg-surface-container-low text-on-surface border text-xs";
  const fieldClass = (key: string, field: string) => {
    const list = issuesByRow[key] || [];
    if (list.some((i) => i.field === field && i.level === "error")) return `${cell} border-error`;
    if (list.some((i) => i.field === field && i.level === "warning")) return `${cell} border-tertiary bg-tertiary-container/30`;
    return `${cell} border-outline-variant/40`;
  };
  const isFile = preview?.source === "image" || preview?.source === "pdf";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div role="dialog" aria-modal="true" aria-labelledby="tt-import-heading" className="bg-surface-container-lowest rounded-xl w-full max-w-6xl p-5 shadow-2xl border border-surface-container-high space-y-4 my-6">
        <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
          <h3 id="tt-import-heading" className="font-headline-md text-sm font-bold text-on-surface">Import Timetable</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{error}</span>
          </div>
        )}

        {done ? (
          <div className="space-y-3">
            <div className="p-3 rounded bg-secondary-container/30 text-secondary text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              <span>{done}</span>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold">Close</button>
            </div>
          </div>
        ) : !preview ? (
          <div className="space-y-3 text-xs">
            <p className="text-on-surface-variant">
              Upload a photo or scan of the timetable (JPG, PNG, WebP, PDF) or a sheet (.csv / .xlsx with columns {TEMPLATE_COLUMNS.join(", ")}).
              The timetable is read into a preview first — nothing is saved until you confirm.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.xlsx,image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                aria-label="Timetable file"
                className="text-xs"
              />
              <button type="button" onClick={downloadTemplate} className="text-secondary underline">Download CSV template</button>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-container-low">
              <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Cancel</button>
              <button type="button" onClick={readFile} disabled={!file || loading} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold disabled:opacity-50">
                {loading ? "Reading timetable..." : "Read timetable"}
              </button>
            </div>
            {loading && <p className="text-on-surface-variant">Reading an image can take up to a minute.</p>}
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            {preview.notes.length > 0 && (
              <ul className="p-3 rounded bg-surface-container-low text-on-surface-variant space-y-1 list-disc list-inside">
                {preview.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="tt-import-title" className="block font-semibold text-on-surface mb-1">Title</label>
                <input id="tt-import-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`${cell} border-outline-variant/40 w-64`} />
              </div>
              {preview.printedDate && <span className="text-on-surface-variant">Date on timetable: <b>{preview.printedDate}</b></span>}
            </div>

            {preview.mode === "image-only" ? (
              <div className="p-3 rounded border border-outline-variant/40 space-y-2">
                <p className="text-on-surface">
                  This file will be stored and shown as an <b>image timetable</b>. Individual periods of an image timetable can&apos;t be edited — to edit periods, import a sheet or add periods manually.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPreview(null)} className="px-3.5 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Back</button>
                  <button type="button" onClick={saveAsImage} disabled={saving || !isFile} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold disabled:opacity-50">
                    {saving ? "Saving..." : "Save as image timetable"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-on-surface">{rows.length} periods read</span>
                  {errorCount > 0 && <span className="px-2 py-0.5 rounded bg-error-container text-on-error-container font-bold">{errorCount} need correction</span>}
                  {warningCount > 0 && <span className="px-2 py-0.5 rounded bg-tertiary-container/60 text-on-surface font-bold">{warningCount} to check</span>}
                  <span className="ml-auto text-on-surface-variant">Set days for all rows:</span>
                  <button type="button" onClick={() => setAllDays(DAYS.slice(0, 6))} className="px-2 py-1 rounded bg-surface-container font-semibold">Mon–Sat</button>
                  <button type="button" onClick={() => setAllDays(DAYS.slice(0, 5))} className="px-2 py-1 rounded bg-surface-container font-semibold">Mon–Fri</button>
                </div>

                <div className="overflow-x-auto border border-surface-container-high/40 rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low text-on-surface-variant text-[10px] uppercase tracking-wider">
                        <th className="p-2">Class</th>
                        <th className="p-2">Subject</th>
                        <th className="p-2">Teacher</th>
                        <th className="p-2">Period</th>
                        <th className="p-2">Time</th>
                        <th className="p-2">Friday time</th>
                        <th className="p-2">Days</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container-low">
                      {rows.map((r) => {
                        const classSubjects = choices.subjects.filter((s) => s.classId === r.classId);
                        const list = [...(issuesByRow[r.key] || []), ...(serverErrors[r.key] || []).map((m) => ({ field: "", level: "error" as const, message: m }))];
                        return (
                          <React.Fragment key={r.key}>
                            <tr className="align-top">
                              <td className="p-2">
                                <select aria-label="Class" value={r.classId} onChange={(e) => update(r.key, "class", { classId: e.target.value, subjectId: "" })} className={fieldClass(r.key, "class")}>
                                  <option value="">{r.raw.className ? `“${r.raw.className}” → pick` : "Pick class"}</option>
                                  {choices.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                                </select>
                              </td>
                              <td className="p-2">
                                <select
                                  aria-label="Subject"
                                  value={r.subjectId}
                                  onChange={(e) => update(r.key, "subject", { subjectId: e.target.value })}
                                  disabled={!r.classId}
                                  className={fieldClass(r.key, "subject")}
                                >
                                  <option value="">{r.raw.subjectName ? `“${r.raw.subjectName}” → pick` : "Pick subject"}</option>
                                  {classSubjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                </select>
                              </td>
                              <td className="p-2">
                                <select aria-label="Teacher" value={r.teacherId} onChange={(e) => update(r.key, "teacher", { teacherId: e.target.value })} className={fieldClass(r.key, "teacher")}>
                                  <option value="">{r.raw.teacherName && !r.teacherId ? `“${r.raw.teacherName}” → subject's teacher` : "Subject's allocated teacher"}</option>
                                  {choices.teachers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                              </td>
                              <td className="p-2">
                                <input aria-label="Period" value={r.periodName} maxLength={60} onChange={(e) => update(r.key, "period", { periodName: e.target.value })} className={`${fieldClass(r.key, "period")} w-24`} />
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                <input aria-label="Start time" type="time" value={r.startTime} onChange={(e) => update(r.key, "time", { startTime: e.target.value })} className={fieldClass(r.key, "time")} />
                                <span className="px-1">–</span>
                                <input aria-label="End time" type="time" value={r.endTime} onChange={(e) => update(r.key, "time", { endTime: e.target.value })} className={fieldClass(r.key, "time")} />
                              </td>
                              <td className="p-2 whitespace-nowrap">
                                <input aria-label="Friday start time" type="time" value={r.fridayStartTime} onChange={(e) => update(r.key, "fridayTime", { fridayStartTime: e.target.value })} className={fieldClass(r.key, "fridayTime")} />
                                <span className="px-1">–</span>
                                <input aria-label="Friday end time" type="time" value={r.fridayEndTime} onChange={(e) => update(r.key, "fridayTime", { fridayEndTime: e.target.value })} className={fieldClass(r.key, "fridayTime")} />
                              </td>
                              <td className="p-2">
                                <div className="flex flex-wrap gap-0.5" role="group" aria-label="Days">
                                  {DAYS.map((d) => {
                                    const on = r.days.includes(d);
                                    return (
                                      <button
                                        key={d}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => update(r.key, "days", { days: on ? r.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || r.days.includes(x)) })}
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${on ? "bg-secondary text-on-secondary" : "bg-surface-container text-on-surface-variant"}`}
                                      >
                                        {DAY_SHORT[d]}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="p-2">
                                <button
                                  type="button"
                                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                                  className="p-1 rounded hover:bg-error-container text-on-surface-variant hover:text-error"
                                  aria-label="Remove row"
                                  title="Remove row"
                                >
                                  <span className="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                              </td>
                            </tr>
                            {list.length > 0 && (
                              <tr>
                                <td colSpan={8} className="px-2 pb-2">
                                  {list.map((i, n) => (
                                    <div key={n} className={`text-[11px] ${i.level === "error" ? "text-error" : "text-on-surface-variant"}`}>
                                      {i.level === "error" ? "✖" : "⚠"} {i.message}
                                    </div>
                                  ))}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={addRow} className="text-secondary font-semibold">+ Add row</button>

                <div className="space-y-2 pt-2 border-t border-surface-container-low">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                    <span>Replace the existing periods of these classes on the selected days (otherwise any clash with the current timetable is reported and nothing is saved).</span>
                  </label>
                  {warningCount > 0 && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                      <span>I have checked the highlighted values.</span>
                    </label>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setPreview(null)} className="px-3.5 py-2 rounded-lg bg-surface-container text-on-surface font-semibold">Back</button>
                  {isFile && (
                    <button type="button" onClick={saveAsImage} disabled={saving} className="px-3.5 py-2 rounded-lg bg-surface-container text-on-surface font-semibold disabled:opacity-50">
                      Save as image timetable instead
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || rows.length === 0 || errorCount > 0 || (warningCount > 0 && !acknowledged)}
                    className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold disabled:opacity-50"
                  >
                    {saving ? "Saving..." : `Save ${rows.length} periods`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
