import crypto from "crypto";
import { adminBucket, hasAdminCredentials } from "./firebase/admin";
import {
  deleteStoredFile,
  MAX_STORED_FILE_BYTES,
  parseStoredFileUrl,
  saveStoredFile,
} from "./stored-files";

export type AllowedFolder =
  | "profile-photos"
  | "documents"
  | "fee-receipts"
  | "result-cards"
  | "school-logo"
  | "timetables";

export interface UploadOptions {
  buffer: Buffer;
  folder: AllowedFolder;
  filename: string;
  contentType: string;
  schoolId: string;
}

export interface UploadResult {
  url: string;
  storagePath: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Thrown when the upload itself was valid (right auth, right type, right size) but the Storage
 * backend could not take the write — most commonly because Cloud Storage was never enabled for
 * this Firebase project, so its default bucket doesn't exist yet. Distinguished from any other
 * failure so the API route can tell the caller something actionable instead of a dead-end
 * generic message, without leaking the underlying error detail (that still only goes to the
 * server log).
 */
export class StorageUnavailableError extends Error {
  constructor(message = "Document storage is not set up for this school yet.") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

// 5MB for images, 10MB for documents / receipts / cards
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Detects the real file type from its first bytes. The browser-supplied Content-Type and file
 * name are attacker-controlled (an HTML/SVG page can be sent as "image/png"), so only the
 * content decides. Returns null for anything that is not one of the allowed formats.
 */
export function sniffMimeType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function validateUpload(
  folder: AllowedFolder,
  contentType: string,
  size: number
): { valid: boolean; error?: string } {
  const isImageFolder = folder === "profile-photos" || folder === "school-logo";

  if (isImageFolder) {
    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return {
        valid: false,
        error: "Invalid file format. Only JPG, PNG, and WebP images are allowed.",
      };
    }
    if (size > MAX_IMAGE_SIZE_BYTES) {
      return {
        valid: false,
        error: "File is too large. Image files must not exceed 5MB.",
      };
    }
  } else {
    if (!ALLOWED_DOCUMENT_TYPES.includes(contentType)) {
      return {
        valid: false,
        error: "Invalid file format. Only PDF, JPG, PNG, and WebP files are allowed.",
      };
    }
    if (size > MAX_DOCUMENT_SIZE_BYTES) {
      return {
        valid: false,
        error: "File is too large. Documents must not exceed 10MB.",
      };
    }
  }

  return { valid: true };
}

/**
 * Whether `err` is Google Cloud Storage's "no such bucket" response — the exact failure mode
 * when Cloud Storage was never enabled for a Firebase project, so no default bucket was ever
 * created. Checked by HTTP status first (reliable across @google-cloud/storage versions), with
 * the message text as a fallback for older error shapes.
 */
export function isBucketNotFoundError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown }; message?: string } | null;
  if (!e) return false;
  const status = Number(e.code ?? e.status ?? e.response?.status ?? NaN);
  if (status === 404) return true;
  const message = (e.message || "").toLowerCase();
  return message.includes("bucket does not exist") || message.includes("no such bucket") || message.includes("notfound");
}

/**
 * Uploads a file buffer to the tenant-isolated Firebase Storage directory
 * and returns a download URL.
 */
export async function uploadFileToStorage(options: UploadOptions): Promise<UploadResult> {
  const { buffer, folder, filename, contentType, schoolId } = options;

  // The extension comes from the verified content type, never from the client's file name.
  const ext = EXTENSION_FOR_TYPE[contentType] || "bin";
  const cleanBase = filename
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 50);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const uniqueName = `${cleanBase || "file"}-${Date.now()}-${randomSuffix}.${ext}`;

  // Tenant-isolated storage path
  const storagePath = `schools/${schoolId}/${folder}/${uniqueName}`;
  const downloadToken = crypto.randomUUID();

  if (hasAdminCredentials) {
    try {
      const file = adminBucket.file(storagePath);
      await file.save(buffer, {
        metadata: {
          contentType,
          // Served as a download-safe inline image/PDF with a fixed, server-generated name.
          contentDisposition: `inline; filename="${uniqueName}"`,
          cacheControl: "private, max-age=0",
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            schoolId,
            uploadedAt: new Date().toISOString(),
            originalFilename: filename.slice(0, 120),
          },
        },
        resumable: false,
      });

      // Generate Firebase Storage persistent download URL using download token
      const encodedPath = encodeURIComponent(storagePath);
      const bucketName = adminBucket.name;
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

      return {
        url: downloadUrl,
        storagePath,
        filename: uniqueName,
        contentType,
        size: buffer.length,
      };
    } catch (err) {
      // Full detail (including the Google Cloud error) goes to the server log only; callers
      // only ever get a distinguishing error type plus a safe, generic message.
      console.error("[storage] Firebase Storage upload failed:", (err as Error)?.message || "error");
      if (process.env.NODE_ENV === "production") {
        if (isBucketNotFoundError(err)) {
          // Cloud Storage was never enabled for this Firebase project (it needs a billing-enabled
          // project), so its default bucket doesn't exist. Files are kept in Firestore instead,
          // behind the same upload route and validation, and served from /api/files/. As soon as
          // a bucket exists, uploads go there again with no change.
          if (buffer.length > MAX_STORED_FILE_BYTES) {
            throw new StorageUnavailableError(
              `This file is too large for the built-in storage (max ${MAX_STORED_FILE_BYTES / 1024 / 1024}MB). Please upload a smaller file.`
            );
          }
          const saved = await saveStoredFile({ schoolId, folder, name: uniqueName, contentType, buffer });
          return { url: saved.url, storagePath: saved.storagePath, filename: uniqueName, contentType, size: buffer.length };
        }
        throw new Error("Firebase Storage upload failed. Please try again, and contact support if this continues.");
      }
      // In development, fall through to data URI fallback
      console.warn("[storage] Firebase Storage upload failed, falling back to data URI:", (err as Error).message);
    }
  }

  // Development-only fallback (data URI) when Firebase Storage is unavailable or credentials are missing
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "File upload is not available: Firebase Admin credentials are not configured. " +
      "Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY environment variables."
    );
  }

  const base64 = buffer.toString("base64");
  const dataUri = `data:${contentType};base64,${base64}`;

  return {
    url: dataUri,
    storagePath,
    filename: uniqueName,
    contentType,
    size: buffer.length,
  };
}

/**
 * Deletes a stored file. Only paths inside the caller's own school folder are ever touched, so a
 * stored path from another tenant (or a crafted one) can't be removed.
 */
export async function deleteFileFromStorage(storagePath: string | undefined, schoolId: string): Promise<boolean> {
  if (!storagePath || !storagePath.startsWith(`schools/${schoolId}/`) || storagePath.includes("..")) return false;
  // Files kept in Firestore (see stored-files.ts) live at the same logical path.
  const [, , folder, name] = storagePath.split("/");
  const removedStored = folder && name ? await deleteStoredFile(schoolId, folder, name) : false;
  if (!hasAdminCredentials) return removedStored;
  try {
    await adminBucket.file(storagePath).delete({ ignoreNotFound: true });
    return true;
  } catch (err) {
    console.error("[storage] delete failed:", (err as Error)?.message || "error");
    return removedStored;
  }
}

/**
 * Recovers the `schools/{schoolId}/...` storage path from one of our own download URLs (the
 * `.../o/{encodedPath}?alt=media&token=...` shape `uploadFileToStorage` returns), for callers
 * that only persisted the URL and now need to clean up the file it points to — e.g. an exam
 * document being replaced. Lets that cleanup reuse the existing `storagePath`-based
 * `deleteFileFromStorage` without adding a second persisted field everywhere a URL is stored.
 * Returns null for anything that isn't really one of our own stored-file URLs (a dev-fallback
 * data URI, a foreign URL, or a path outside this school) so nothing is ever deleted on a guess.
 */
export function storagePathFromDownloadUrl(url: string | undefined | null, schoolId: string): string | null {
  if (!url) return null;
  const stored = parseStoredFileUrl(url);
  if (stored) return `schools/${schoolId}/${stored.folder}/${stored.name}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "firebasestorage.googleapis.com") return null;
  const match = parsed.pathname.match(/\/v0\/b\/[^/]+\/o\/([^/]+)$/);
  if (!match) return null;
  let storagePath: string;
  try {
    storagePath = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!storagePath.startsWith(`schools/${schoolId}/`) || storagePath.includes("..")) return null;
  return storagePath;
}
