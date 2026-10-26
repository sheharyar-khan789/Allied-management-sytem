/**
 * Built-in file store (files kept in Firestore when the project has no Cloud Storage bucket):
 * save/read/delete round trip, chunking, tenant isolation, access control of /api/files, size
 * cap, and URL validation. Runs against the in-memory store; it does NOT touch Firestore.
 */
import { NextRequest } from "next/server";
import { GET as filesGet } from "../src/app/api/files/[folder]/[name]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  deleteStoredFile,
  getStoredFile,
  isStoredFileUrl,
  MAX_STORED_FILE_BYTES,
  parseStoredFileUrl,
  saveStoredFile,
} from "../src/lib/stored-files";
import { deleteFileFromStorage, storagePathFromDownloadUrl } from "../src/lib/storage";
import { isSafeStoredUrl } from "../src/lib/input-validation";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

let ip = 1;
const req = (token: string | null, url: string) => {
  const headers = new Headers({ "x-forwarded-for": `10.99.0.${ip++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest(`http://x${url}`, { headers });
};
const ctx = (folder: string, name: string) => ({ params: Promise.resolve({ folder, name }) });

async function run() {
  console.log("==================================================");
  console.log("BUILT-IN FILE STORE (no Cloud Storage bucket)");
  console.log("==================================================");

  const A = "school-sf-a";
  const B = "school-sf-b";
  // A real PNG header + padding so it spans several chunks (1.6 MB -> 3 chunks of 700 KB).
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1_600_000, 7)]);

  const saved = await saveStoredFile({ schoolId: A, folder: "profile-photos", name: "ali-123-abc.png", contentType: "image/png", buffer: png });
  assert(saved.url === "/api/files/profile-photos/ali-123-abc.png" && saved.size === png.length, "Save: returns the /api/files URL and size");
  assert(saved.storagePath === `schools/${A}/profile-photos/ali-123-abc.png`, "Save: storagePath keeps the school-scoped layout");

  const back = await getStoredFile(A, "profile-photos", "ali-123-abc.png");
  assert(back?.data.equals(png) && back.meta.chunks === 3 && back.meta.contentType === "image/png", "Read: bytes identical after round trip, stored in 3 chunks");
  assert((await getStoredFile(B, "profile-photos", "ali-123-abc.png")) === null, "Read: another school gets nothing");
  assert((await getStoredFile(A, "documents", "ali-123-abc.png")) === null, "Read: wrong folder gets nothing");
  assert((await getStoredFile(A, "profile-photos", "../etc/passwd")) === null, "Read: path traversal name rejected");

  let tooBig = "";
  try {
    await saveStoredFile({ schoolId: A, folder: "documents", name: "big.pdf", contentType: "application/pdf", buffer: Buffer.alloc(MAX_STORED_FILE_BYTES + 1) });
  } catch (e) { tooBig = (e as Error).message; }
  assert(tooBig.includes("too large"), "Save: a file over the size cap is refused");
  let badName = false;
  try { await saveStoredFile({ schoolId: A, folder: "documents", name: "../x.pdf", contentType: "application/pdf", buffer: Buffer.alloc(10) }); } catch { badName = true; }
  assert(badName, "Save: an unsafe file name is refused");

  // --- /api/files route
  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT", schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid });
  const adminA = await session("uid-sf-a", "ADMIN", A);
  const studentA = await session("uid-sf-s", "STUDENT", A);
  const adminB = await session("uid-sf-b", "ADMIN", B);

  const ok = await filesGet(req(adminA, "/api/files/profile-photos/ali-123-abc.png"), ctx("profile-photos", "ali-123-abc.png"));
  const okBytes = Buffer.from(await ok.arrayBuffer());
  assert(ok.status === 200 && ok.headers.get("content-type") === "image/png" && okBytes.equals(png), "Route: signed-in user of the same school gets the file with its stored type");
  assert(ok.headers.get("x-content-type-options") === "nosniff" && (ok.headers.get("cache-control") || "").includes("private"), "Route: nosniff and private caching");
  assert((await filesGet(req(studentA, "/api/files/profile-photos/ali-123-abc.png"), ctx("profile-photos", "ali-123-abc.png"))).status === 200, "Route: a student of the same school can see it (same rule as the Storage rules)");
  assert((await filesGet(req(adminB, "/api/files/profile-photos/ali-123-abc.png"), ctx("profile-photos", "ali-123-abc.png"))).status === 404, "Route: another school's admin gets 404");
  assert((await filesGet(req(null, "/api/files/profile-photos/ali-123-abc.png"), ctx("profile-photos", "ali-123-abc.png"))).status === 401, "Route: no session gets 401");
  assert((await filesGet(req(adminA, "/api/files/profile-photos/missing.png"), ctx("profile-photos", "missing.png"))).status === 404, "Route: unknown file is 404");

  // --- URL helpers / validation
  assert(isSafeStoredUrl("/api/files/result-cards/sheet-1.pdf"), "Validation: our own /api/files URL is accepted");
  assert(!isSafeStoredUrl("/api/files/../auth/me") && !isSafeStoredUrl("/api/files/other/x.png") && !isSafeStoredUrl("/api/files/documents/X.PDF") && !isSafeStoredUrl("/etc/passwd"), "Validation: traversal, unknown folder, upper-case and other relative paths are rejected");
  assert(!isSafeStoredUrl("javascript:alert(1)") && isSafeStoredUrl("https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media"), "Validation: existing https/javascript rules unchanged");
  assert(isStoredFileUrl("/api/files/documents/a.pdf") && !isStoredFileUrl("https://x/api/files/documents/a.pdf"), "isStoredFileUrl: only the relative form");
  assert(parseStoredFileUrl("/api/files/documents/a.pdf")?.name === "a.pdf", "parseStoredFileUrl reads folder and name");
  assert(storagePathFromDownloadUrl("/api/files/result-cards/sheet-1.pdf", A) === `schools/${A}/result-cards/sheet-1.pdf`, "storagePathFromDownloadUrl maps the file-store URL to its school-scoped path");

  // --- delete through the existing helper (used when an exam sheet / timetable is replaced)
  assert((await deleteFileFromStorage(`schools/${B}/profile-photos/ali-123-abc.png`, A)) === false, "Delete: another school's path is never touched");
  assert((await getStoredFile(A, "profile-photos", "ali-123-abc.png")) !== null, "Delete: the file survived the foreign delete");
  assert(await deleteFileFromStorage(saved.storagePath, A), "Delete: removes the stored file via deleteFileFromStorage");
  assert((await getStoredFile(A, "profile-photos", "ali-123-abc.png")) === null, "Delete: file is gone");
  assert((await deleteStoredFile(A, "profile-photos", "ali-123-abc.png")) === false, "Delete: repeating it is harmless");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
