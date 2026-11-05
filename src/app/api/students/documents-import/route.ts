import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getStudentsServer, getStudentByIdServer, saveStudentServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { uploadFileToStorage, validateUpload, sniffMimeType, MAX_DOCUMENT_SIZE_BYTES, StorageUnavailableError } from "@/lib/storage";
import { DOC_IMPORT_MAX_FILES, resolveDocImportRows } from "@/lib/student-document-import";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const DOC_TYPES = ["ID_CARD", "CERTIFICATE", "ADMISSION_FORM", "OTHER"] as const;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Bulk student document import. One request, two modes via the `dryRun` form field:
 *  - dryRun=true (preview): resolves every file's Student ID against the real roster and
 *    validates type/size, but writes nothing - safe to call repeatedly while fixing file names.
 *  - dryRun absent/false (commit): does the same resolution again from fresh database state
 *    (the preview is never trusted blindly), then actually uploads and appends to each matched
 *    student's existing documents - never replacing them.
 * Every file name must encode the Student ID (admissionNo) - see src/lib/student-document-import.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("Upload files using multipart/form-data.");
    }
    const dryRun = (form.get("dryRun") || "").toString() === "true";
    const docType = DOC_TYPES.includes((form.get("docType") || "").toString() as any)
      ? ((form.get("docType") || "OTHER").toString() as (typeof DOC_TYPES)[number])
      : "OTHER";
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (files.length === 0) return bad("No files were uploaded.");
    if (files.length > DOC_IMPORT_MAX_FILES) return bad(`Import at most ${DOC_IMPORT_MAX_FILES} files at a time.`);

    const students = await getStudentsServer(authUser.schoolId, undefined, undefined, undefined, undefined, { allSessions: true });
    const rows = resolveDocImportRows(files.map((f) => f.name || "upload"), students);

    if (dryRun) {
      // Preview: validate type/size from the real bytes (never trust declared type/size alone)
      // but write nothing.
      const preview = await Promise.all(
        rows.map(async (row, i) => {
          if (row.status !== "MATCHED") return row;
          const file = files[i];
          if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
            return { ...row, status: "INVALID" as const, error: "File is too large. Documents must not exceed 10MB." };
          }
          const buffer = Buffer.from(await file.arrayBuffer());
          const sniffed = sniffMimeType(buffer);
          if (!sniffed || !validateUpload("documents", sniffed, buffer.length).valid) {
            return { ...row, status: "INVALID" as const, error: "Invalid file format. Only PDF, JPG, JPEG and PNG files are allowed." };
          }
          return row;
        })
      );
      const summary = {
        total: preview.length,
        matched: preview.filter((r) => r.status === "MATCHED").length,
        unmatched: preview.filter((r) => r.status === "UNMATCHED").length,
        ambiguous: preview.filter((r) => r.status === "AMBIGUOUS").length,
        duplicate: preview.filter((r) => r.status === "DUPLICATE").length,
        invalid: preview.filter((r) => r.status === "INVALID").length,
      };
      return NextResponse.json({ success: true, dryRun: true, summary, rows: preview });
    }

    // Commit: re-resolve from fresh state, then actually write. Each file is independent - one
    // failing never blocks the rest.
    const results: { fileName: string; status: "IMPORTED" | "SKIPPED" | "FAILED"; reason?: string; studentId?: string }[] = [];
    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const file = files[i];
      if (row.status !== "MATCHED" || !row.student) {
        results.push({ fileName: row.fileName, status: "SKIPPED", reason: row.error || "Not matched." });
        continue;
      }
      if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
        results.push({ fileName: row.fileName, status: "SKIPPED", reason: "File is too large (max 10MB)." });
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffMimeType(buffer);
      if (!sniffed || !validateUpload("documents", sniffed, buffer.length).valid) {
        results.push({ fileName: row.fileName, status: "SKIPPED", reason: "Invalid file format. Only PDF, JPG, JPEG and PNG files are allowed." });
        continue;
      }

      try {
        // Re-read the student fresh (not the snapshot taken before this loop) so two files for
        // the same student in one batch both land, rather than the second overwriting the first.
        const student = await getStudentByIdServer(authUser.schoolId, row.student.id);
        if (!student) {
          results.push({ fileName: row.fileName, status: "FAILED", reason: "Student record no longer exists.", studentId: row.studentId });
          continue;
        }
        const uploadResult = await uploadFileToStorage({
          buffer,
          folder: "documents",
          filename: file.name || "document",
          contentType: sniffed,
          schoolId: authUser.schoolId,
        });
        const newDoc = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: (file.name || "Document").replace(/\.[^/.]+$/, ""),
          type: docType,
          url: uploadResult.url,
          uploadedAt: new Date().toISOString(),
          size: uploadResult.size,
        };
        await saveStudentServer({
          ...student,
          documents: [...(student.documents || []), newDoc],
          updatedAt: new Date().toISOString(),
        });
        imported++;
        results.push({ fileName: row.fileName, status: "IMPORTED", studentId: row.studentId });
      } catch (e: any) {
        if (e instanceof StorageUnavailableError) {
          results.push({ fileName: row.fileName, status: "FAILED", reason: e.message, studentId: row.studentId });
          continue;
        }
        console.error("Student document import: file failed:", e?.message);
        results.push({ fileName: row.fileName, status: "FAILED", reason: "Could not save this file.", studentId: row.studentId });
      }
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "BULK_IMPORT_STUDENT_DOCUMENTS",
      "STUDENT",
      "bulk-import",
      `Bulk student document import: ${imported} imported, ${results.length - imported} skipped/failed.`
    );

    return NextResponse.json({
      success: true,
      dryRun: false,
      summary: { imported, skippedOrFailed: results.length - imported },
      results,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/students/documents-import");
    if (busy) return busy;
    console.error("Student document import error:", error?.message || error);
    return NextResponse.json({ error: "Document import failed. No further files were processed." }, { status: 500 });
  }
}
