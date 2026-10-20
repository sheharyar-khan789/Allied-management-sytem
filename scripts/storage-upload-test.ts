/**
 * File uploads (school logo and every other /api/upload consumer): who may upload what, where a
 * file is stored, what is persisted, and what the caller is told when Cloud Storage can't take
 * the write (bucket missing, plan/billing refusal, permission denied, not configured, transient).
 *
 * The Cloud Storage bucket is an IN-MEMORY FAKE (see __setStorageBucketForTests) and the database
 * is the in-memory store — no real Firebase project is contacted. Error objects are shaped like
 * the ones @google-cloud/storage throws (numeric `code`, message text); a real upload against
 * Firebase is NOT exercised here.
 */
import { NextRequest } from "next/server";
import { GET as uploadGet, POST as uploadPost } from "../src/app/api/upload/route";
import { GET as settingsGet, PUT as settingsPut } from "../src/app/api/settings/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { updateSchoolSettingsServer } from "../src/lib/firebase/server-db";
import { DEFAULT_GRADING_SCALE } from "../src/lib/exam-results";
import {
  __setStorageBucketForTests,
  classifyStorageError,
  deleteReplacedFiles,
  getStorageStatus,
  saveOrDiscardUpload,
  StorageBucketLike,
  uploadFileToStorage,
} from "../src/lib/storage";

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

let ipCounter = 1;
const nextIp = () => `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
function jsonReq(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": nextIp() });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
function uploadReq(token: string | null, folder: string, bytes: Buffer, type: string, name = "file", extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  form.append("folder", folder);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const headers = new Headers({ "x-forwarded-for": nextIp() });
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest("http://x/api/upload", { method: "POST", headers, body: form });
}
const json = async (res: Response) => res.json().catch(() => ({}));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 2)]);

/** In-memory stand-in for a Cloud Storage bucket. `saveError` / `existsError` simulate failures. */
function fakeBucket(name = "fake-project.firebasestorage.app") {
  const files = new Map<string, { size: number; options?: Record<string, any> }>();
  const b = {
    name,
    files,
    present: true,
    saveError: null as unknown,
    existsError: null as unknown,
  };
  const bucket: StorageBucketLike & typeof b = Object.assign(b, {
    file(path: string) {
      return {
        async save(data: Buffer, options?: Record<string, unknown>) {
          if (b.saveError) throw b.saveError;
          files.set(path, { size: data.length, options });
        },
        async delete() {
          files.delete(path);
        },
      };
    },
    async exists(): Promise<[boolean]> {
      if (b.existsError) throw b.existsError;
      return [b.present];
    },
  }) as any;
  return bucket;
}

async function run() {
  console.log("==================================================");
  console.log("FILE UPLOADS / STORAGE CONFIGURATION (fake bucket, in-memory DB)");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-upl-a";
  const B = "school-upl-b";
  for (const id of [A, B]) {
    await updateSchoolSettingsServer({
      id, schoolId: id, schoolName: id, campusName: "Main", motto: "", address: "1 Road", phone: "0300",
      email: `admin@${id}.edu`, principalName: "Head", academicYear: "2026-2027", gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
    } as any);
  }
  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT", schoolId: string, extra: Record<string, unknown> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra } as any);
  const ADMIN = await session("uid-upl-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-upl-admin-b", "ADMIN", B);
  const TEACHER = await session("uid-upl-t", "TEACHER", A, { teacherId: "tch-upl" });
  const STUDENT = await session("uid-upl-s", "STUDENT", A, { studentId: "std-upl" });

  // ------------------------------------------------------------ error classification
  assert(classifyStorageError({ code: 404, message: "The specified bucket does not exist." }) === "BUCKET_MISSING", "404 / no such bucket → BUCKET_MISSING");
  assert(classifyStorageError({ code: 402, message: "Cloud Storage for Firebase no longer supports Firebase projects that are on the no-cost Spark pricing plan." }) === "PLAN_REQUIRED", "402 Spark-plan refusal → PLAN_REQUIRED");
  assert(classifyStorageError({ code: 403, message: "The billing account for the owning project is disabled in state absent" }) === "PLAN_REQUIRED", "403 naming billing → PLAN_REQUIRED");
  assert(classifyStorageError({ code: 403, message: "firebase-adminsdk@x.iam.gserviceaccount.com does not have storage.objects.create access" }) === "PERMISSION_DENIED", "403 without billing → PERMISSION_DENIED");
  assert(classifyStorageError({ code: "ECONNRESET", message: "socket hang up" }) === null && classifyStorageError({ code: 503 }) === null, "Network errors and 5xx are not misreported as configuration problems");

  // ------------------------------------------------------------ valid upload + persistence
  const bucket = fakeBucket();
  __setStorageBucketForTests(bucket);

  const up = await uploadPost(uploadReq(ADMIN, "school-logo", PNG, "image/png", "Crest.png", { schoolId: B }));
  const upJson = await json(up);
  assert(up.status === 201 && upJson.success, "Admin uploads a PNG logo (201)");
  assert(typeof upJson.storagePath === "string" && upJson.storagePath.startsWith(`schools/${A}/school-logo/`), "Stored under the caller's own school, even when the form names another school");
  assert(bucket.files.has(upJson.storagePath), "The file really reached the (fake) bucket before success was reported");
  assert(upJson.url.startsWith(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`) && upJson.url.includes(encodeURIComponent(upJson.storagePath)), "Returned URL points at the stored object in the configured bucket");
  const meta = bucket.files.get(upJson.storagePath)?.options?.metadata;
  assert(meta?.contentType === "image/png" && meta?.metadata?.schoolId === A, "Stored with the sniffed content type and the school id");

  const put1 = await settingsPut(jsonReq(ADMIN, "/api/settings", "PUT", { logoUrl: upJson.url }));
  assert(put1.status === 200, "Settings save keeps the uploaded logo URL");
  const reopened = await json(await settingsGet(jsonReq(ADMIN, "/api/settings")));
  assert(reopened.settings?.logoUrl === upJson.url, "Reopening Settings shows the saved logo (persisted, not just in page state)");
  const otherSchool = await json(await settingsGet(jsonReq(ADMIN_B, "/api/settings")));
  assert(otherSchool.settings?.logoUrl !== upJson.url, "Another school's settings never show this school's logo");

  // Replace: the old file is removed only after the save succeeded; the new one is kept.
  const up2 = await json(await uploadPost(uploadReq(ADMIN, "school-logo", PNG, "image/png", "Crest v2.png")));
  assert(bucket.files.has(upJson.storagePath) && bucket.files.has(up2.storagePath), "Uploading a replacement does not touch the saved logo before Save");
  await settingsPut(jsonReq(ADMIN, "/api/settings", "PUT", { logoUrl: up2.url }));
  assert(!bucket.files.has(upJson.storagePath) && bucket.files.has(up2.storagePath), "After saving, the replaced logo is deleted and the new one kept");
  await settingsPut(jsonReq(ADMIN, "/api/settings", "PUT", { schoolName: "Renamed" }));
  assert(bucket.files.has(up2.storagePath), "Saving other settings never deletes the current logo");

  // Cross-school: B points its logo at A's file, then clears it — A's file must survive.
  await settingsPut(jsonReq(ADMIN_B, "/api/settings", "PUT", { logoUrl: up2.url }));
  await settingsPut(jsonReq(ADMIN_B, "/api/settings", "PUT", { logoUrl: "" }));
  assert(bucket.files.has(up2.storagePath), "Another school can never delete this school's file by referencing and then removing it");
  assert((await deleteReplacedFiles(B, [up2.url], [])) === 0 && bucket.files.has(up2.storagePath), "deleteReplacedFiles ignores other schools' paths");

  // Remove the logo: the file goes once the record no longer references it.
  await settingsPut(jsonReq(ADMIN, "/api/settings", "PUT", { logoUrl: "" }));
  assert(!bucket.files.has(up2.storagePath), "Removing the logo and saving deletes the stored file");

  // Other document workflows keep working.
  const doc = await uploadPost(uploadReq(ADMIN, "result-cards", PDF, "application/pdf", "Results.pdf"));
  assert(doc.status === 201 && (await json(doc)).storagePath.startsWith(`schools/${A}/result-cards/`), "Result documents (PDF) upload to the school's result-cards folder");

  // ------------------------------------------------------------ authorization
  assert((await uploadPost(uploadReq(null, "school-logo", PNG, "image/png"))).status === 401, "Signed-out upload refused (401)");
  assert((await uploadPost(uploadReq(STUDENT, "documents", PDF, "application/pdf"))).status === 403, "Students cannot upload (403)");
  assert((await uploadPost(uploadReq(TEACHER, "school-logo", PNG, "image/png"))).status === 403, "Teachers cannot upload a school logo (403)");
  assert((await uploadPost(uploadReq(TEACHER, "fee-receipts", PDF, "application/pdf"))).status === 403, "Teachers cannot upload fee receipts (403)");
  assert((await uploadPost(uploadReq(TEACHER, "documents", PDF, "application/pdf"))).status === 201, "Teachers can still upload documents");
  assert((await uploadPost(uploadReq(ADMIN, "../../schools/" + B, PNG, "image/png"))).status === 400, "A path-like folder is rejected (no writing outside the school folder)");

  // ------------------------------------------------------------ type and size
  const before = bucket.files.size;
  assert((await uploadPost(uploadReq(ADMIN, "documents", Buffer.from("hello world"), "text/plain", "a.txt"))).status === 400, "Plain text rejected");
  assert((await uploadPost(uploadReq(ADMIN, "school-logo", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/png", "logo.png"))).status === 400, "SVG/script disguised as PNG rejected (content sniffed)");
  assert((await uploadPost(uploadReq(ADMIN, "school-logo", PDF, "application/pdf", "logo.pdf"))).status === 400, "A PDF is rejected as a logo (images only)");
  assert((await uploadPost(uploadReq(ADMIN, "school-logo", PNG, "application/pdf", "x.pdf"))).status === 400, "Declared type that contradicts the bytes is rejected");
  const bigImage = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
  assert((await uploadPost(uploadReq(ADMIN, "school-logo", bigImage, "image/png", "big.png"))).status === 400, "Logo over 5MB rejected");
  const hugeDoc = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]);
  assert((await uploadPost(uploadReq(ADMIN, "documents", hugeDoc, "application/pdf", "huge.pdf"))).status === 413, "Document over 10MB rejected (413)");
  assert(bucket.files.size === before, "Rejected uploads store nothing");

  // ------------------------------------------------------------ storage failures → specific, safe errors
  const failWith = async (err: unknown) => {
    bucket.saveError = err;
    const res = await uploadPost(uploadReq(ADMIN, "school-logo", PNG, "image/png"));
    bucket.saveError = null;
    return { status: res.status, body: await json(res) };
  };
  const count = bucket.files.size;
  const missing = await failWith({ code: 404, message: "The specified bucket does not exist. INTERNAL-DETAIL-xyz" });
  assert(missing.status === 503 && missing.body.storageStatus === "BUCKET_MISSING" && missing.body.retryable === false, "Missing bucket → 503 BUCKET_MISSING, not retryable");
  assert(/Get started/.test(missing.body.error) && !/exam cycle/i.test(missing.body.error), "Missing-bucket message names the console step and no longer talks about the exam cycle on a logo upload");
  assert(!JSON.stringify(missing.body).includes("INTERNAL-DETAIL") && !JSON.stringify(missing.body).includes(bucket.name), "Google's error detail and the bucket name never reach the uploader");
  const plan = await failWith({ code: 402, message: "Cloud Storage for Firebase no longer supports Firebase projects that are on the no-cost Spark pricing plan." });
  assert(plan.status === 503 && plan.body.storageStatus === "PLAN_REQUIRED" && /Blaze/.test(plan.body.error), "Plan refusal (402) → 503 PLAN_REQUIRED naming the Blaze requirement (previously a generic 'Failed to upload')");
  const perm = await failWith({ code: 403, message: "does not have storage.objects.create access" });
  assert(perm.status === 503 && perm.body.storageStatus === "PERMISSION_DENIED", "Permission failure (403) → 503 PERMISSION_DENIED");
  const blip = await failWith({ code: "ECONNRESET", message: "socket hang up" });
  assert(blip.status === 500 && blip.body.retryable === true && /try again/i.test(blip.body.error), "Transient failure → 500, retryable, 'try again'");
  assert(bucket.files.size === count, "No failed upload left a file behind or returned a URL");

  __setStorageBucketForTests(null);
  const notConfigured = await uploadPost(uploadReq(ADMIN, "school-logo", PNG, "image/png"));
  const ncBody = await json(notConfigured);
  assert(notConfigured.status === 503 && ncBody.storageStatus === "NOT_CONFIGURED" && !ncBody.url, "No bucket configured → 503 NOT_CONFIGURED, no URL");
  let threw: unknown = null;
  try {
    await uploadFileToStorage({ buffer: PNG, folder: "school-logo", filename: "x.png", contentType: "image/png", schoolId: A });
  } catch (e) {
    threw = e;
  }
  assert((threw as any)?.reason === "NOT_CONFIGURED", "uploadFileToStorage throws instead of returning a fake result when storage is not configured");

  // ------------------------------------------------------------ storage status endpoint
  const statusBucket = fakeBucket("status-bucket.firebasestorage.app");
  __setStorageBucketForTests(statusBucket);
  assert((await json(await uploadGet(jsonReq(ADMIN, "/api/upload")))).storage?.status === "READY", "Status: an existing bucket is READY");
  statusBucket.present = false;
  const st = (await json(await uploadGet(jsonReq(ADMIN, "/api/upload?refresh=1")))).storage;
  assert(st?.status === "BUCKET_MISSING" && /Get started/.test(st.message), "Status: a bucket that doesn't exist is reported before anyone uploads");
  statusBucket.existsError = { code: 402, message: "Spark pricing plan" };
  assert((await getStorageStatus(true)).status === "PLAN_REQUIRED", "Status: a plan refusal is reported as PLAN_REQUIRED");
  assert((await uploadGet(jsonReq(TEACHER, "/api/upload"))).status === 403, "Status: teachers cannot query storage configuration");
  assert((await uploadGet(jsonReq(null, "/api/upload"))).status === 401, "Status: signed-out callers refused");

  // ------------------------------------------------------------ storage success, then database failure
  const tx = fakeBucket();
  __setStorageBucketForTests(tx);
  const previous = await uploadFileToStorage({ buffer: PNG, folder: "timetables", filename: "old.png", contentType: "image/png", schoolId: A });
  const fresh = await uploadFileToStorage({ buffer: PNG, folder: "timetables", filename: "new.png", contentType: "image/png", schoolId: A });
  let dbErr: unknown = null;
  try {
    await saveOrDiscardUpload(A, fresh.storagePath, async () => {
      throw new Error("Database write failed");
    });
  } catch (e) {
    dbErr = e;
  }
  assert((dbErr as Error)?.message === "Database write failed", "A failed database write is still reported to the caller");
  assert(!tx.files.has(fresh.storagePath), "The new file is deleted when its record could not be saved (no orphan)");
  assert(tx.files.has(previous.storagePath), "The previously saved file is untouched");
  const ok = await uploadFileToStorage({ buffer: PNG, folder: "timetables", filename: "ok.png", contentType: "image/png", schoolId: A });
  assert((await saveOrDiscardUpload(A, ok.storagePath, async () => "saved")) === "saved" && tx.files.has(ok.storagePath), "A successful write keeps the new file");

  // ------------------------------------------------------------ the test hook cannot redirect production uploads
  __setStorageBucketForTests(undefined);
  const env = process.env as Record<string, string | undefined>;
  const prevEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  let refused = false;
  try {
    __setStorageBucketForTests(fakeBucket());
  } catch {
    refused = true;
  }
  env.NODE_ENV = prevEnv;
  assert(refused, "The test storage hook is refused in production");

  console.log(`\nStorage upload tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
