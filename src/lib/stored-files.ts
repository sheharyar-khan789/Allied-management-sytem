import { adminDb, hasAdminCredentials } from "./firebase/admin";
import { cleanUndefined, FIRESTORE_BATCH_LIMIT, onFirestoreError } from "./firebase/server-db";

/**
 * Firestore-backed file storage, used when the project has no Cloud Storage bucket (Cloud
 * Storage needs a billing-enabled project). Uploads go through the same /api/upload route and
 * validation; only where the bytes are kept differs.
 *
 *   storedFiles/{schoolId}__{folder}__{name}             metadata (school, type, size, chunk count)
 *   storedFiles/{schoolId}__{folder}__{name}/chunks/{n}  the bytes, in chunks below Firestore's 1 MiB doc limit
 *
 * The public path is /api/files/{folder}/{name}. The school is never part of the URL: the read
 * route always resolves it from the caller's session, so another school's file is simply "not
 * found". Firestore security rules deny every client path to these collections (default deny).
 */

export const STORED_FILE_FOLDERS = [
  "profile-photos",
  "documents",
  "fee-receipts",
  "result-cards",
  "school-logo",
  "timetables",
] as const;
export type StoredFileFolder = (typeof STORED_FILE_FOLDERS)[number];

/** Larger files are refused rather than silently burning the Firestore quota. */
export const MAX_STORED_FILE_BYTES = 5 * 1024 * 1024;
const CHUNK_BYTES = 700_000;
const CHUNKS_PER_BATCH = 4;

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const URL_RE = /^\/api\/files\/(profile-photos|documents|fee-receipts|result-cards|school-logo|timetables)\/([a-z0-9][a-z0-9._-]{0,119})$/;

export interface StoredFileMeta {
  id: string;
  schoolId: string;
  folder: StoredFileFolder;
  name: string;
  contentType: string;
  size: number;
  chunks: number;
  createdAt: string;
}

export interface StoredFile {
  meta: StoredFileMeta;
  data: Buffer;
}

const local = new Map<string, StoredFile>();

export const storedFileId = (schoolId: string, folder: string, name: string) => `${schoolId}__${folder}__${name}`;
export const storedFileUrl = (folder: string, name: string) => `/api/files/${folder}/${name}`;

/** {folder, name} of one of our own /api/files/... URLs, or null for anything else. */
export function parseStoredFileUrl(url: string | null | undefined): { folder: StoredFileFolder; name: string } | null {
  const m = typeof url === "string" ? URL_RE.exec(url) : null;
  return m ? { folder: m[1] as StoredFileFolder, name: m[2] } : null;
}

export const isStoredFileUrl = (url: unknown): boolean => typeof url === "string" && URL_RE.test(url);

export function isValidStoredFileName(name: string): boolean {
  return NAME_RE.test(name);
}

export async function saveStoredFile(input: {
  schoolId: string;
  folder: StoredFileFolder;
  name: string;
  contentType: string;
  buffer: Buffer;
}): Promise<{ url: string; storagePath: string; size: number }> {
  const { schoolId, folder, name, contentType, buffer } = input;
  if (!NAME_RE.test(name)) throw new Error("Invalid stored file name.");
  if (buffer.length > MAX_STORED_FILE_BYTES) {
    throw new Error(`File is too large for built-in storage (max ${MAX_STORED_FILE_BYTES / 1024 / 1024}MB).`);
  }
  const id = storedFileId(schoolId, folder, name);
  const chunks = Math.max(1, Math.ceil(buffer.length / CHUNK_BYTES));
  const meta: StoredFileMeta = {
    id, schoolId, folder, name, contentType, size: buffer.length, chunks, createdAt: new Date().toISOString(),
  };

  if (hasAdminCredentials) {
    try {
      const ref = adminDb.collection("storedFiles").doc(id);
      // Chunks first, metadata last: a file is only readable once every chunk is stored.
      for (let start = 0; start < chunks; start += CHUNKS_PER_BATCH) {
        const batch = adminDb.batch();
        for (let n = start; n < Math.min(chunks, start + CHUNKS_PER_BATCH); n++) {
          batch.set(ref.collection("chunks").doc(String(n).padStart(3, "0")), {
            data: buffer.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES),
          });
        }
        await batch.commit();
      }
      await ref.set(cleanUndefined(meta));
    } catch (e) {
      onFirestoreError(`saveStoredFile(${id})`, e);
      throw e;
    }
  } else {
    local.set(id, { meta, data: Buffer.from(buffer) });
  }
  return { url: storedFileUrl(folder, name), storagePath: `schools/${schoolId}/${folder}/${name}`, size: buffer.length };
}

/** The file, only if it belongs to `schoolId`. */
export async function getStoredFile(schoolId: string, folder: string, name: string): Promise<StoredFile | null> {
  if (!NAME_RE.test(name) || !(STORED_FILE_FOLDERS as readonly string[]).includes(folder)) return null;
  const id = storedFileId(schoolId, folder, name);
  if (!hasAdminCredentials) {
    const f = local.get(id);
    return f && f.meta.schoolId === schoolId ? f : null;
  }
  try {
    const ref = adminDb.collection("storedFiles").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const meta = snap.data() as StoredFileMeta;
    if (meta.schoolId !== schoolId) return null;
    const parts = await ref.collection("chunks").orderBy("__name__").get();
    if (parts.size !== meta.chunks) return null; // incomplete upload: never serve a truncated file
    const data = Buffer.concat(parts.docs.map((d) => Buffer.from(d.get("data") as Uint8Array)));
    return { meta: { ...meta, id }, data };
  } catch (e) {
    onFirestoreError(`getStoredFile(${id})`, e);
    throw e;
  }
}

/** Idempotent: removes the metadata and every chunk. Returns whether anything existed. */
export async function deleteStoredFile(schoolId: string, folder: string, name: string): Promise<boolean> {
  if (!NAME_RE.test(name) || !(STORED_FILE_FOLDERS as readonly string[]).includes(folder)) return false;
  const id = storedFileId(schoolId, folder, name);
  if (!hasAdminCredentials) return local.delete(id);
  try {
    const ref = adminDb.collection("storedFiles").doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as StoredFileMeta).schoolId !== schoolId) return false;
    const parts = await ref.collection("chunks").get();
    const batch = adminDb.batch();
    parts.docs.slice(0, FIRESTORE_BATCH_LIMIT).forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
    return true;
  } catch (e) {
    console.error("[storage] stored file delete failed:", (e as Error)?.message || "error");
    return false;
  }
}
