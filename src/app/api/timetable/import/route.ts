import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAuth, AuthenticatedUser } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  deleteTimetableEntriesServer,
  deleteTimetableImportServer,
  getClassesServer,
  getSubjectsServer,
  getTeachersServer,
  getTimetableImportByIdServer,
  getTimetableImportsServer,
  getTimetableServer,
  saveTimetableEntriesBulkServer,
  saveTimetableImportServer,
} from "@/lib/firebase/server-db";
import { TimetableDoc, TimetableImportDoc } from "@/lib/firebase/types";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { parseCsv, parseXlsx, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import { deleteFileFromStorage, MAX_DOCUMENT_SIZE_BYTES, sniffMimeType, uploadFileToStorage } from "@/lib/storage";
import {
  buildPreviewRows,
  classLabel,
  expandRow,
  IMPORT_MAX_ROWS,
  ImportContext,
  PreviewRow,
  rowIssues,
  sheetRowsToInputs,
  TIMETABLE_DAYS,
  validateTimetableSlot,
} from "@/lib/timetable-import";
import {
  ExtractionMediaType,
  extractTimetableFromFile,
  isTimetableExtractionAvailable,
  TimetableExtractionError,
} from "@/lib/timetable-extraction";
import { resolveSessionStudent } from "@/lib/academic-access";
import { securityLog } from "@/lib/security-log";

export const dynamic = "force-dynamic";
// Reading an image with the vision model can take a minute or more.
export const maxDuration = 300;

type FileKind = "csv" | "xlsx" | "image" | "pdf";

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

async function loadContext(schoolId: string): Promise<ImportContext> {
  const [classes, subjects, teachers] = await Promise.all([
    getClassesServer(schoolId),
    getSubjectsServer(schoolId),
    getTeachersServer(schoolId),
  ]);
  return { classes, subjects, teachers };
}

/** Reads the uploaded file; the type is decided from its bytes, never from the browser. */
async function readFile(form: FormData): Promise<{ buf: Buffer; name: string; kind: FileKind; mime: string } | NextResponse> {
  const file = form.get("file");
  if (!file || typeof file === "string") return bad("No file was uploaded.");
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) return bad("File is too large (max 10 MB).", 413);
  const buf = Buffer.from(await file.arrayBuffer());
  const name = (file.name || "timetable").slice(0, 200);
  const lower = name.toLowerCase();
  const sniffed = sniffMimeType(buf);
  if (sniffed === "application/pdf") return { buf, name, kind: "pdf", mime: sniffed };
  if (sniffed) return { buf, name, kind: "image", mime: sniffed };
  if (lower.endsWith(".xlsx") && buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    return { buf, name, kind: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }
  if (lower.endsWith(".csv") && !buf.includes(0)) return { buf, name, kind: "csv", mime: "text/csv" };
  return bad("Unsupported file. Upload a JPG, PNG, WebP or PDF timetable, or a .csv / .xlsx sheet.");
}

/** Lightweight lists for the preview's correction dropdowns. */
function choices(ctx: ImportContext) {
  return {
    classes: ctx.classes.map((c) => ({ id: c.id, label: classLabel(c) })),
    subjects: ctx.subjects.map((s) => ({ id: s.id, classId: s.classId, label: s.name, teacherId: s.teacherId || "" })),
    teachers: ctx.teachers
      .filter((t) => t.status === "ACTIVE")
      .map((t) => ({ id: t.id, label: t.fullName })),
  };
}

// ---------------------------------------------------------------------------------------------
// Preview: file → rows matched against this school's records. Nothing is saved.
// ---------------------------------------------------------------------------------------------
async function preview(authUser: AuthenticatedUser, form: FormData) {
  const file = await readFile(form);
  if (file instanceof NextResponse) return file;
  const ctx = await loadContext(authUser.schoolId);
  const base = { fileName: file.name, source: file.kind, choices: choices(ctx), extractionAvailable: isTimetableExtractionAvailable() };

  if (file.kind === "csv" || file.kind === "xlsx") {
    try {
      const sheet = file.kind === "xlsx" ? parseXlsx(file.buf) : parseCsv(file.buf.toString("utf8"));
      const inputs = sheetRowsToInputs(sheet);
      return NextResponse.json({ success: true, ...base, mode: "structured", rows: buildPreviewRows(inputs, ctx), notes: [], title: file.name.replace(/\.[^.]+$/, "") });
    } catch (e) {
      const message = e instanceof SpreadsheetParseError || e instanceof Error ? e.message : "The file could not be read.";
      return bad(message, 422);
    }
  }

  // Image / PDF: read automatically when the vision reader is configured; otherwise offer the
  // image fallback (store and display the original file).
  if (!base.extractionAvailable) {
    return NextResponse.json({
      success: true,
      ...base,
      mode: "image-only",
      rows: [],
      notes: ["Automatic reading of timetable images is not configured on this server, so this file can be saved and shown as an image timetable."],
    });
  }
  try {
    const result = await extractTimetableFromFile(file.buf, file.mime as ExtractionMediaType, {
      classNames: ctx.classes.map(classLabel),
      subjectNames: Array.from(new Set(ctx.subjects.map((s) => s.name))),
      teacherNames: ctx.teachers.map((t) => t.fullName),
    });
    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        ...base,
        mode: "image-only",
        rows: [],
        title: result.title,
        printedDate: result.date,
        notes: ["No lessons could be read from this file. You can still save it as an image timetable.", ...result.notes],
      });
    }
    return NextResponse.json({
      success: true,
      ...base,
      mode: "structured",
      rows: buildPreviewRows(result.rows, ctx),
      title: result.title || file.name.replace(/\.[^.]+$/, ""),
      printedDate: result.date,
      notes: result.notes,
    });
  } catch (e) {
    if (e instanceof TimetableExtractionError) {
      return NextResponse.json({ success: true, ...base, mode: "image-only", rows: [], notes: [e.message, "You can still save the file as an image timetable."] });
    }
    const busy = serviceBusyResponseFor(e, "/api/timetable/import");
    if (busy) return busy;
    console.error("Timetable extraction error:", (e as Error)?.message || "error");
    return NextResponse.json({
      success: true,
      ...base,
      mode: "image-only",
      rows: [],
      notes: ["Automatic reading failed this time. Try again later, or save the file as an image timetable."],
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Commit: re-validates every corrected row against fresh data, then saves all periods or none.
// ---------------------------------------------------------------------------------------------
async function commit(authUser: AuthenticatedUser, form: FormData) {
  let rows: PreviewRow[];
  try {
    rows = JSON.parse(String(form.get("rows") || "[]"));
  } catch {
    return bad("Invalid rows.");
  }
  if (!Array.isArray(rows) || rows.length === 0) return bad("There are no periods to save.");
  if (rows.length > IMPORT_MAX_ROWS) return bad(`Too many rows (max ${IMPORT_MAX_ROWS}).`);
  const replaceExisting = String(form.get("replaceExisting") || "") === "true";
  const title = String(form.get("title") || "Imported timetable").trim().slice(0, 120) || "Imported timetable";
  const printedDate = String(form.get("printedDate") || "").trim().slice(0, 60);
  const sourceRaw = String(form.get("source") || "csv");
  const source: FileKind = (["csv", "xlsx", "image", "pdf"] as const).includes(sourceRaw as FileKind) ? (sourceRaw as FileKind) : "csv";

  const ctx = await loadContext(authUser.schoolId);
  const clean: PreviewRow[] = rows.map((r, i) => ({
    key: String(r?.key || `r${i + 1}`).slice(0, 20),
    raw: {
      className: String(r?.raw?.className || "").slice(0, 120),
      subjectName: String(r?.raw?.subjectName || "").slice(0, 120),
      teacherName: String(r?.raw?.teacherName || "").slice(0, 120),
    },
    classId: String(r?.classId || "").slice(0, 128),
    subjectId: String(r?.subjectId || "").slice(0, 128),
    teacherId: String(r?.teacherId || "").slice(0, 128),
    periodName: String(r?.periodName || "").slice(0, 60),
    startTime: String(r?.startTime || "").slice(0, 10),
    endTime: String(r?.endTime || "").slice(0, 10),
    fridayStartTime: String(r?.fridayStartTime || "").slice(0, 10),
    fridayEndTime: String(r?.fridayEndTime || "").slice(0, 10),
    days: (Array.isArray(r?.days) ? r.days : []).filter((d: string) => TIMETABLE_DAYS.includes(d as TimetableDoc["dayOfWeek"])),
    roomNo: String(r?.roomNo || "").slice(0, 40),
    issues: [],
  }));

  // Rows still missing required values are refused outright (warnings were reviewed by the admin).
  const rowErrors: Array<{ key: string; message: string }> = [];
  for (const r of clean) {
    for (const issue of rowIssues(r, ctx)) if (issue.level === "error") rowErrors.push({ key: r.key, message: issue.message });
  }
  const failedRows = () => new Set(rowErrors.map((e) => e.key)).size;
  if (rowErrors.length > 0) {
    return bad("Some rows still need corrections. Nothing was saved.", 422, { rowErrors, rows: clean.length, failedRows: failedRows(), created: 0 });
  }

  // The active session's timetable, as the manual add/edit form checks against.
  const existing = await getTimetableServer(authUser.schoolId);
  // "Replace": the periods of the imported classes on the imported days are removed first.
  const replacedKeys = new Set(clean.flatMap((r) => r.days.map((d) => `${r.classId}|${d}`)));
  const toReplace = replaceExisting ? existing.filter((t) => replacedKeys.has(`${t.classId}|${t.dayOfWeek}`)) : [];
  const replacedIds = new Set(toReplace.map((t) => t.id));
  const schedule = existing.filter((t) => !replacedIds.has(t.id));

  const importId = `tti-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
  const now = new Date().toISOString();
  const accepted: TimetableDoc[] = [];
  for (const r of clean) {
    for (const input of expandRow(r)) {
      const result = validateTimetableSlot(authUser.schoolId, input, ctx, [...schedule, ...accepted]);
      if (!result.ok) {
        rowErrors.push({ key: r.key, message: `${input.dayOfWeek}: ${result.error}` });
        continue;
      }
      accepted.push({
        ...result.slot,
        id: `tt-${authUser.schoolId}-${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`,
        importId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  if (rowErrors.length > 0) {
    return bad(
      "Some periods clash with each other or with the existing timetable. Nothing was saved — fix them or choose to replace the existing periods.",
      409,
      { rowErrors, rows: clean.length, failedRows: failedRows(), created: 0 }
    );
  }

  // The original image/PDF of an automatically read timetable is kept for reference.
  let stored: { url: string; storagePath: string; contentType: string } | null = null;
  if (source === "image" || source === "pdf") {
    const file = await readFile(form);
    if (!(file instanceof NextResponse) && (file.kind === "image" || file.kind === "pdf")) {
      stored = await uploadFileToStorage({ buffer: file.buf, folder: "timetables", filename: file.name, contentType: file.mime, schoolId: authUser.schoolId });
    }
  }

  if (toReplace.length > 0) await deleteTimetableEntriesServer(authUser.schoolId, toReplace.map((t) => t.id));
  await saveTimetableEntriesBulkServer(accepted);
  const record: TimetableImportDoc = {
    id: importId,
    schoolId: authUser.schoolId,
    kind: "STRUCTURED",
    title,
    source,
    fileName: String(form.get("fileName") || "").slice(0, 200) || undefined,
    fileUrl: stored?.url,
    storagePath: stored?.storagePath,
    contentType: stored?.contentType,
    printedDate: printedDate || undefined,
    slotCount: accepted.length,
    createdBy: authUser.uid,
    createdByName: authUser.name,
    createdAt: now,
    updatedAt: now,
  };
  await saveTimetableImportServer(record);
  await createAuditLogServer(
    authUser.schoolId, authUser.uid, authUser.email, authUser.role,
    "IMPORT_TIMETABLE", "TIMETABLE", importId,
    `Imported ${accepted.length} timetable periods ("${title}", ${source})${toReplace.length ? `, replacing ${toReplace.length} existing periods` : ""}.`
  );
  return NextResponse.json(
    { success: true, importId, rows: clean.length, created: accepted.length, skipped: 0, failedRows: 0, replaced: toReplace.length },
    { status: 201 }
  );
}

// ---------------------------------------------------------------------------------------------
// Image fallback: the file itself is the timetable.
// ---------------------------------------------------------------------------------------------
async function saveImage(authUser: AuthenticatedUser, form: FormData) {
  const file = await readFile(form);
  if (file instanceof NextResponse) return file;
  if (file.kind !== "image" && file.kind !== "pdf") return bad("Only an image (JPG, PNG, WebP) or PDF can be saved as an image timetable.");
  const title = String(form.get("title") || "").trim().slice(0, 120) || file.name.replace(/\.[^.]+$/, "") || "Timetable";
  const replaceId = String(form.get("replaceId") || "").trim();
  const previous = replaceId ? await getTimetableImportByIdServer(authUser.schoolId, replaceId) : null;
  if (replaceId && (!previous || previous.kind !== "IMAGE")) return bad("Image timetable not found.", 404);

  const stored = await uploadFileToStorage({ buffer: file.buf, folder: "timetables", filename: file.name, contentType: file.mime, schoolId: authUser.schoolId });
  const now = new Date().toISOString();
  const record: TimetableImportDoc = {
    ...(previous || {}),
    id: previous?.id || `tti-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`,
    schoolId: authUser.schoolId,
    kind: "IMAGE",
    title: replaceId && !String(form.get("title") || "").trim() ? previous!.title : title,
    source: file.kind,
    fileName: file.name,
    fileUrl: stored.url,
    storagePath: stored.storagePath,
    contentType: stored.contentType,
    printedDate: String(form.get("printedDate") || previous?.printedDate || "").trim().slice(0, 60) || undefined,
    slotCount: 0,
    createdBy: previous?.createdBy || authUser.uid,
    createdByName: previous?.createdByName || authUser.name,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  await saveTimetableImportServer(record);
  if (previous?.storagePath && previous.storagePath !== stored.storagePath) {
    await deleteFileFromStorage(previous.storagePath, authUser.schoolId);
  }
  await createAuditLogServer(
    authUser.schoolId, authUser.uid, authUser.email, authUser.role,
    previous ? "REPLACE_TIMETABLE_IMAGE" : "UPLOAD_TIMETABLE_IMAGE", "TIMETABLE", record.id,
    `${previous ? "Replaced" : "Uploaded"} image timetable "${record.title}".`
  );
  return NextResponse.json({ success: true, import: record }, { status: previous ? 200 : 201 });
}

/** Admin: every import. Teacher / student: the image timetables of their own school (read-only). */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT"]);
    if (authUser.role === "STUDENT" && !(await resolveSessionStudent(authUser))) {
      return bad("Student profile not found.", 404);
    }
    const imports = await getTimetableImportsServer(authUser.schoolId);
    if (authUser.role === "ADMIN") return NextResponse.json({ success: true, imports });
    return NextResponse.json({
      success: true,
      imports: imports
        .filter((i) => i.kind === "IMAGE" && i.fileUrl)
        .map((i) => ({ id: i.id, kind: i.kind, title: i.title, fileUrl: i.fileUrl, contentType: i.contentType, printedDate: i.printedDate, updatedAt: i.updatedAt })),
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable/import");
    if (busy) return busy;
    console.error("Timetable imports GET error:", error);
    return bad("Failed to load timetable imports.", 500);
  }
}

/** multipart: action = preview | commit | image. ADMIN only. */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MAX_DOCUMENT_SIZE_BYTES + 2 * 1024 * 1024) return bad("File is too large (max 10 MB).", 413);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("Invalid upload request.");
    }
    const action = String(form.get("action") || "");
    if (action === "preview") return await preview(authUser, form);
    if (action === "commit") return await commit(authUser, form);
    if (action === "image") return await saveImage(authUser, form);
    return bad("Unknown action.");
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable/import");
    if (busy) return busy;
    console.error("Timetable import error:", (error as Error)?.message || error);
    securityLog("server.error", { route: "/api/timetable/import", status: 500 });
    return bad("Failed to process the timetable import.", 500);
  }
}

/** Deletes an import: its periods (structured) and/or its stored file. ADMIN only. */
export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const id = (new URL(req.url).searchParams.get("id") || "").trim();
    if (!id) return bad("Import id is required.");
    const rec = await getTimetableImportByIdServer(authUser.schoolId, id);
    if (!rec) return bad("Timetable import not found.", 404);

    let removedPeriods = 0;
    if (rec.kind === "STRUCTURED") {
      const all = await getTimetableServer(authUser.schoolId, undefined, undefined, undefined, { allSessions: true });
      removedPeriods = await deleteTimetableEntriesServer(authUser.schoolId, all.filter((t) => t.importId === id).map((t) => t.id));
    }
    await deleteTimetableImportServer(authUser.schoolId, id);
    if (rec.storagePath) await deleteFileFromStorage(rec.storagePath, authUser.schoolId);
    await createAuditLogServer(
      authUser.schoolId, authUser.uid, authUser.email, authUser.role,
      "DELETE_TIMETABLE_IMPORT", "TIMETABLE", id,
      `Deleted ${rec.kind === "IMAGE" ? "image timetable" : "timetable import"} "${rec.title}"${removedPeriods ? ` and its ${removedPeriods} periods` : ""}.`
    );
    return NextResponse.json({ success: true, removedPeriods });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/timetable/import");
    if (busy) return busy;
    console.error("Timetable import DELETE error:", error);
    return bad("Failed to delete the timetable import.", 500);
  }
}
