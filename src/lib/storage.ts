import crypto from "crypto";
import { adminBucket, hasAdminCredentials } from "./firebase/admin";

export type AllowedFolder =
  | "profile-photos"
  | "documents"
  | "fee-receipts"
  | "result-cards"
  | "school-logo"
  | "timetables";

/** The part of a Cloud Storage bucket this module uses (the Admin SDK's Bucket satisfies it). */
export interface StorageBucketLike {
  name: string;
  file(path: string): {
    save(data: Buffer, options?: Record<string, unknown>): Promise<unknown>;
    delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  };
  exists(): Promise<[boolean]>;
}

let testBucketOverride: StorageBucketLike | null | undefined;

/**
 * Test-only: replaces the storage backend with an in-memory fake (null = credentials present but
 * no bucket configured; undefined = restore the real configuration). Refused in production, so
 * it can never redirect real uploads.
 */
export function __setStorageBucketForTests(bucket: StorageBucketLike | null | undefined): void {
  if (process.env.NODE_ENV === "production") throw new Error("__setStorageBucketForTests is not available in production.");
  testBucketOverride = bucket;
  statusCache = null;
}

/**
 * The bucket uploads go to: a bucket, null when credentials exist but no bucket is configured, or
 * undefined when there is no Firebase backend at all (in-memory development mode).
 */
function activeBucket(): StorageBucketLike | null | undefined {
  if (testBucketOverride !== undefined) return testBucketOverride;
  if (!hasAdminCredentials) return undefined;
  return adminBucket as unknown as StorageBucketLike | null;
}

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
 * Why file storage can't take a write, when retrying can't help:
 *  - NOT_CONFIGURED: no bucket name is configured on the server (FIREBASE_STORAGE_BUCKET /
 *    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).
 *  - BUCKET_MISSING: the configured bucket does not exist — Cloud Storage was never set up for
 *    the Firebase project (Storage → Get started), or the name is wrong.
 *  - PLAN_REQUIRED: Google refused because of the project's pricing plan / billing (HTTP 402, or
 *    a 403 naming billing). Cloud Storage for Firebase needs the Blaze plan.
 *  - PERMISSION_DENIED: the bucket exists but the server's service account may not write to it.
 */
export type StorageFailureReason = "NOT_CONFIGURED" | "BUCKET_MISSING" | "PLAN_REQUIRED" | "PERMISSION_DENIED";

export const STORAGE_FAILURE_MESSAGES: Record<StorageFailureReason, string> = {
  NOT_CONFIGURED:
    "File storage is not configured on the server (no storage bucket is set), so nothing was uploaded. Ask your system administrator to set FIREBASE_STORAGE_BUCKET.",
  BUCKET_MISSING:
    "File storage has not been set up for this school's Firebase project yet, so nothing was uploaded. Your system administrator must enable Cloud Storage in the Firebase console (Build → Storage → Get started).",
  PLAN_REQUIRED:
    "File storage is unavailable because the school's Firebase project is not on a plan that includes Cloud Storage (Firebase requires the Blaze plan), so nothing was uploaded. Ask your system administrator.",
  PERMISSION_DENIED:
    "The server is not permitted to write to the school's file storage, so nothing was uploaded. Your system administrator must grant the server's Firebase service account access to the storage bucket.",
};

/**
 * Thrown when the upload itself was valid (right auth, right type, right size) but the Storage
 * backend could not take the write for a configuration reason retrying won't fix. The reason is
 * reported to the caller with a safe, actionable message; the underlying Google Cloud error only
 * ever goes to the server log.
 */
export class StorageUnavailableError extends Error {
  readonly reason: StorageFailureReason;
  constructor(reason: StorageFailureReason = "BUCKET_MISSING", message = STORAGE_FAILURE_MESSAGES[reason]) {
    super(message);
    this.name = "StorageUnavailableError";
    this.reason = reason;
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

function httpStatusOf(err: unknown): number {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return Number(e?.code ?? e?.status ?? e?.response?.status ?? NaN);
}

/**
 * Maps a Google Cloud Storage error to the configuration problem behind it, or null when it is
 * not one (a network blip, timeout or 5xx — those may succeed on retry). The 402/403 plan errors
 * are described in https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024.
 */
export function classifyStorageError(err: unknown): StorageFailureReason | null {
  if (!err) return null;
  const status = httpStatusOf(err);
  const message = String((err as { message?: unknown })?.message || "").toLowerCase();
  if (isBucketNotFoundError(err)) return "BUCKET_MISSING";
  if (status === 402 || /billing|pricing plan|spark plan|blaze/.test(message)) return "PLAN_REQUIRED";
  if (status === 403 || /permission|forbidden/.test(message)) return "PERMISSION_DENIED";
  return null;
}

/** The error a caller should see for a failed write: a StorageUnavailableError, or a generic retryable one. */
function toCallerError(err: unknown): Error {
  const reason = classifyStorageError(err);
  if (reason) return new StorageUnavailableError(reason);
  return new Error("Firebase Storage upload failed. Please try again, and contact support if this continues.");
}

/**
 * Uploads a file buffer to the tenant-isolated Firebase Storage directory and returns a download
 * URL. Only resolves once Storage has confirmed the write; on failure nothing is returned that a
 * caller could save as if it were a stored file.
 */
export async function uploadFileToStorage(options: UploadOptions): Promise<UploadResult> {
  const { buffer, folder, filename, contentType, schoolId } = options;

  // The extension comes from the verified content type, never from the client's file name.
  const ext = EXTENSION_FOR_TYPE[contentType] || "bin";
  const cleanBase = filename
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 50);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const uniqueName = `${cleanBase || "file"}-${Date.now()}-${randomSuffix}.${ext}`;

  // Tenant-isolated storage path
  const storagePath = `schools/${schoolId}/${folder}/${uniqueName}`;
  const downloadToken = crypto.randomUUID();

  const bucket = activeBucket();
  if (bucket !== undefined) {
    if (!bucket) {
      console.error("[storage] No storage bucket configured (FIREBASE_STORAGE_BUCKET / NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).");
      throw new StorageUnavailableError("NOT_CONFIGURED");
    }
    try {
      const file = bucket.file(storagePath);
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
      const bucketName = bucket.name;
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

      return {
        url: downloadUrl,
        storagePath,
        filename: uniqueName,
        contentType,
        size: buffer.length,
      };
    } catch (err) {
      // Full detail (including the Google Cloud error) goes to the server log only; callers get a
      // distinguishing error type plus a safe message. With real credentials the failure is
      // reported in development too: silently swapping in a data URI here used to make uploads
      // look fine locally while the same missing bucket broke them in production.
      console.error(
        `[storage] Firebase Storage upload failed (bucket=${bucket.name}, status=${httpStatusOf(err) || "n/a"}, reason=${classifyStorageError(err) || "transient"}):`,
        (err as Error)?.message || "error"
      );
      throw toCallerError(err);
    }
  }

  // Development-only fallback (data URI) when no Firebase credentials are configured at all
  // (in-memory development mode, where nothing else is persisted to Firebase either).
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
  const bucket = activeBucket();
  if (!bucket) return false;
  try {
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    return true;
  } catch (err) {
    console.error("[storage] delete failed:", (err as Error)?.message || "error");
    return false;
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

/**
 * Runs the database write that records a just-uploaded file. If that write fails, the new file is
 * deleted (it would otherwise be an orphan nothing points at) and the error is rethrown. Only the
 * new upload is ever removed — any previously saved file stays untouched.
 */
export async function saveOrDiscardUpload<T>(
  schoolId: string,
  newStoragePath: string | null | undefined,
  write: () => Promise<T>
): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (newStoragePath) await deleteFileFromStorage(newStoragePath, schoolId);
    throw err;
  }
}

/**
 * After a record that referenced stored files was saved, deletes the files it no longer
 * references (a replaced logo or photo, a removed document). Only this school's own stored files
 * are touched (see storagePathFromDownloadUrl / deleteFileFromStorage), and a URL still referenced
 * after the save is never deleted. Call it only once the database write has succeeded, so a
 * failed save never loses the previously saved file. Failures are logged, never thrown — the save
 * itself already succeeded.
 */
export async function deleteReplacedFiles(
  schoolId: string,
  previousUrls: (string | null | undefined)[],
  currentUrls: (string | null | undefined)[]
): Promise<number> {
  const keep = new Set(currentUrls.filter(Boolean));
  let deleted = 0;
  for (const url of new Set(previousUrls.filter((u): u is string => !!u))) {
    if (keep.has(url)) continue;
    const path = storagePathFromDownloadUrl(url, schoolId);
    if (path && (await deleteFileFromStorage(path, schoolId))) deleted++;
  }
  return deleted;
}

export type StorageStatus =
  | { status: "READY"; bucket: string }
  | { status: "DEV_INLINE"; message: string }
  | { status: StorageFailureReason; bucket?: string; message: string }
  | { status: "UNKNOWN"; bucket?: string; message: string };

let statusCache: { at: number; value: StorageStatus } | null = null;
const STATUS_TTL_MS = 60_000;

/**
 * Whether uploads can work right now, checked against the real bucket (one metadata request,
 * cached for a minute per server instance). Lets Settings warn before an admin picks a file.
 */
export async function getStorageStatus(force = false): Promise<StorageStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  let value: StorageStatus;
  const bucket = activeBucket();
  if (bucket === undefined) {
    value =
      process.env.NODE_ENV === "production"
        ? { status: "NOT_CONFIGURED", message: STORAGE_FAILURE_MESSAGES.NOT_CONFIGURED }
        : { status: "DEV_INLINE", message: "Development mode without Firebase credentials: files are kept inline, not in Cloud Storage." };
  } else if (!bucket) {
    value = { status: "NOT_CONFIGURED", message: STORAGE_FAILURE_MESSAGES.NOT_CONFIGURED };
  } else {
    try {
      const [exists] = await bucket.exists();
      value = exists
        ? { status: "READY", bucket: bucket.name }
        : { status: "BUCKET_MISSING", bucket: bucket.name, message: STORAGE_FAILURE_MESSAGES.BUCKET_MISSING };
    } catch (err) {
      const reason = classifyStorageError(err);
      console.error(`[storage] status check failed (bucket=${bucket.name}):`, (err as Error)?.message || "error");
      value = reason
        ? { status: reason, bucket: bucket.name, message: STORAGE_FAILURE_MESSAGES[reason] }
        : { status: "UNKNOWN", bucket: bucket.name, message: "File storage could not be checked right now. Uploads may still work; try again later." };
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}
