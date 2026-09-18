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

  // Sanitize filename and create unique storage path
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
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
    const file = adminBucket.file(storagePath);
    await file.save(buffer, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          schoolId,
          uploadedAt: new Date().toISOString(),
          originalFilename: filename,
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
  }

  // Local development / mock fallback (data URI) when live GCP credentials are not present
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
