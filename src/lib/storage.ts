import crypto from "crypto";
import { adminBucket, hasAdminCredentials } from "./firebase/admin";

export type AllowedFolder =
  | "profile-photos"
  | "documents"
  | "fee-receipts"
  | "result-cards"
  | "school-logo";

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
      if (process.env.NODE_ENV === "production") {
        // Details go to the server log only; the API returns a generic message.
        console.error("[storage] Firebase Storage upload failed:", (err as Error)?.message || "error");
        throw new Error("Firebase Storage upload failed. Ensure Firebase Storage is enabled in the Firebase Console.");
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
