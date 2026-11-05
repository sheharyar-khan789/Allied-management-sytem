import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getClassesServer, getSubjectsServer } from "@/lib/firebase/server-db";
import { readSpreadsheetUpload, SpreadsheetParseError } from "@/lib/spreadsheet-parser";
import {
  EXAM_SCHEDULE_IMPORT_MAX_FILE_BYTES,
  EXAM_SCHEDULE_IMPORT_MAX_ROWS,
  missingRequiredScheduleColumns,
  scheduleRowsToInputs,
  validateScheduleImportRows,
} from "@/lib/exam-schedule-import";
import { validateDateString } from "@/lib/date-utils";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Preview only — parses and validates the uploaded sheet against the school's real classes and
 * subjects, writes nothing. The confirmed rows are turned into exam schedules by the caller
 * through the existing POST /api/exams (its own `schedules` array), which does the actual writes
 * and audit log; this route only resolves class/subject names to real ids and reports row-level
 * problems so the admin can fix the sheet before anything is created.
 */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);

    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > EXAM_SCHEDULE_IMPORT_MAX_FILE_BYTES + 64 * 1024) {
      return bad(`The upload is too large (max ${EXAM_SCHEDULE_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("Upload a file using multipart/form-data.");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") return bad("No file was uploaded.");
    if (file.size === 0) return bad("The uploaded file is empty.");
    if (file.size > EXAM_SCHEDULE_IMPORT_MAX_FILE_BYTES) {
      return bad(`The file is too large (max ${EXAM_SCHEDULE_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB).`, 413);
    }

    // Exam date window (optional): lets a row scheduled outside it be flagged as a warning.
    const examStartDate = validateDateString(form.get("examStartDate")?.toString() || "") || undefined;
    const examEndDate = validateDateString(form.get("examEndDate")?.toString() || "") || undefined;

    let rows;
    try {
      rows = readSpreadsheetUpload(file.name || "", Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof SpreadsheetParseError) return bad(e.message, 415);
      throw e;
    }

    if (rows.length < 2) return bad("The file has no schedule rows (the first row must be the column headers).");
    if (rows.length - 1 > EXAM_SCHEDULE_IMPORT_MAX_ROWS) {
      return bad(`The file has ${rows.length - 1} rows; import at most ${EXAM_SCHEDULE_IMPORT_MAX_ROWS} schedule rows per file.`);
    }

    const { inputs, mapping } = scheduleRowsToInputs(rows);
    const missing = missingRequiredScheduleColumns(mapping);
    if (missing.length > 0) {
      return bad(`Required column(s) not found: ${missing.join(", ")}. Download the template to see the expected headers.`);
    }

    const [classes, subjects] = await Promise.all([
      getClassesServer(authUser.schoolId),
      getSubjectsServer(authUser.schoolId),
    ]);

    const result = validateScheduleImportRows(inputs, { classes, subjects, examStartDate, examEndDate });

    return NextResponse.json({
      success: true,
      fileName: file.name,
      mappedColumns: Array.from(mapping.columns.values()),
      ignoredColumns: mapping.ignored,
      summary: result.summary,
      rows: result.rows,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/exams/schedule-import");
    if (busy) return busy;
    console.error("Exam schedule import preview error:", error?.message || error);
    return NextResponse.json({ error: "Could not read the schedule file." }, { status: 500 });
  }
}
