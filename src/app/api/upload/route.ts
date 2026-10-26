import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  uploadFileToStorage,
  validateUpload,
  sniffMimeType,
  AllowedFolder,
  MAX_DOCUMENT_SIZE_BYTES,
  StorageUnavailableError,
} from "@/lib/storage";
import { securityLog } from "@/lib/security-log";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

const VALID_FOLDERS: AllowedFolder[] = [
  "profile-photos",
  "documents",
  "fee-receipts",
  "result-cards",
  "school-logo",
];

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: { "Content-Type": "application/json" } });

export async function POST(req: NextRequest) {
  try {
    // Only authenticated school staff (ADMIN or TEACHER) can upload assets
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);

    // Refuse oversized bodies before buffering them (multipart overhead allowance included).
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_DOCUMENT_SIZE_BYTES + 64 * 1024) {
      return json({ error: "File is too large. Documents must not exceed 10MB." }, 413);
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return json({ error: "Invalid upload request." }, 400);
    }
    const file = formData.get("file");
    const folder = (formData.get("folder") || "").toString() as AllowedFolder;

    if (!file || typeof file === "string") {
      return json({ error: "No file provided in the upload request." }, 400);
    }

    if (!VALID_FOLDERS.includes(folder)) {
      return json({ error: `Invalid folder target. Allowed: ${VALID_FOLDERS.join(", ")}` }, 400);
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      return json({ error: "File is too large. Documents must not exceed 10MB." }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // The stored Content-Type is the one detected from the bytes, so a script/HTML/SVG payload
    // can never be stored (or served) as an image or PDF.
    const sniffedType = sniffMimeType(buffer);
    const declaredType = (file.type || "").toLowerCase();
    const filename = (file.name || "upload").slice(0, 200);

    if (!sniffedType || (declaredType && declaredType !== sniffedType && !(declaredType === "image/jpg" && sniffedType === "image/jpeg"))) {
      securityLog("upload.rejected", {
        subject: authUser.uid,
        role: authUser.role,
        schoolId: authUser.schoolId,
        reason: sniffedType ? "type_mismatch" : "unrecognized_content",
      });
      return json({ error: "Invalid file format. Only real PDF, JPG, PNG, and WebP files are allowed." }, 400);
    }

    const validation = validateUpload(folder, sniffedType, buffer.length);
    if (!validation.valid) {
      return json({ error: validation.error || "Invalid file." }, 400);
    }

    const uploadResult = await uploadFileToStorage({
      buffer,
      folder,
      filename,
      contentType: sniffedType,
      // Always the caller's own school from the verified session — never from the request.
      schoolId: authUser.schoolId,
    });

    return json({ success: true, ...uploadResult }, 201);
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/upload");
    if (busy) return busy;
    if (error instanceof StorageUnavailableError) {
      // Not a transient failure the user can fix by retrying — surfaced distinctly so the UI
      // (and support) can tell this apart from "try again" failures. No internal detail leaks:
      // the Google Cloud error itself was already logged inside uploadFileToStorage.
      securityLog("server.error", { route: "/api/upload", status: 503, reason: "storage_unavailable" });
      return json(
        {
          error:
            error.message && error.message !== "Document storage is not set up for this school yet."
              ? error.message
              : "Document storage is not set up for this school yet. Please contact your administrator; the exam cycle can still be saved without this file.",
        },
        503
      );
    }
    console.error("File upload error:", error?.message || "error");
    securityLog("server.error", { route: "/api/upload", status: 500 });
    return json({ error: "Failed to upload file to storage. Please try again." }, 500);
  }
}
