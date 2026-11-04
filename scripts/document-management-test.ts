/**
 * Phase 9: teacher document management (PUT /api/teachers/[id]) and bulk student document
 * import (/api/students/documents-import) - Student ID matching (never by name), unmatched/
 * duplicate/ambiguous rejection, file type/size validation, unauthorized access, cross-school
 * isolation, existing document preservation, and dry-run vs commit.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { PUT as teacherPut, GET as teacherGet } from "../src/app/api/teachers/[id]/route";
import { POST as docsImportPost } from "../src/app/api/students/documents-import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveStudentServer, saveTeacherServer, getStudentByIdServer } from "../src/lib/firebase/server-db";
import { ClassDoc, StudentDoc, TeacherDoc } from "../src/lib/firebase/types";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) { console.log(`[PASS] ${name}`); passed++; }
  else { console.error(`[FAIL] ${name}`); failed++; }
}

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => res.json().catch(() => ({}));

const PDF_BYTES = Buffer.from("%PDF-1.4\n%fake pdf content for testing\n");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function docsImportReq(token: string | null, files: { name: string; bytes: Buffer; type?: string }[], extra: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  for (const f of files) fd.append("files", new Blob([f.bytes], { type: f.type || "application/pdf" }), f.name);
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  return new NextRequest("http://x/api/students/documents-import", { method: "POST", headers, body: fd });
}

async function run() {
  console.log("==================================================");
  console.log("DOCUMENT MANAGEMENT (teacher docs + bulk student import)");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-docmgmt-a";
  const B = "school-docmgmt-b";
  const YEAR = "2026-2027";

  const cls: ClassDoc = { id: "cls-docmgmt-a", schoolId: A, name: "Class 6", section: "A", numericLevel: 6, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(cls);

  const student = (id: string, admissionNo: string, name: string, schoolId = A): StudentDoc => ({
    id, schoolId, admissionNo, fullName: name, fatherName: "F", gender: "MALE", classId: cls.id, section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father",
    monthlyFee: 2000, discount: 0, academicYear: YEAR, className: "Class 6-A", createdAt: now, updatedAt: now,
    documents: [{ id: "doc-existing", name: "Prior Doc", type: "OTHER", url: "/api/files/documents/prior.pdf", uploadedAt: now }],
  });
  const s1 = student("std-docmgmt-1", "STD-DM-001", "Ali Raza");
  const s2 = student("std-docmgmt-2", "STD-DM-002", "Sana Malik");
  const inactive = { ...student("std-docmgmt-3", "STD-DM-003", "InactiveKid"), status: "INACTIVE" as const };
  await saveStudentServer(s1);
  await saveStudentServer(s2);
  await saveStudentServer(inactive);

  const teacher: TeacherDoc = {
    id: "tch-docmgmt-1", schoolId: A, employeeId: "EMP-DM-1", fullName: "Faculty One", email: "f1@docmgmt.edu",
    phone: "0300", designation: "Teacher", department: "Science", qualification: "M.Sc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  };
  await saveTeacherServer(teacher);

  const ADMIN = await createSessionCookieServer({ uid: "u-docmgmt-admin", email: "admin@docmgmt.edu", role: "ADMIN", schoolId: A, name: "Admin" });
  const TEACHER = await createSessionCookieServer({ uid: "u-docmgmt-teacher", email: "t@docmgmt.edu", role: "TEACHER", schoolId: A, name: "Teacher", teacherId: teacher.id });
  const ADMIN_B = await createSessionCookieServer({ uid: "u-docmgmt-admin-b", email: "admin@b.edu", role: "ADMIN", schoolId: B, name: "Admin B" });

  // ---------------------------------------------------------------- 1. teacher document management
  {
    const upload = await json(await teacherPut(req(ADMIN, `/api/teachers/${teacher.id}`, "PUT", {
      documents: [{ id: "doc-t1", name: "M.Sc Certificate", type: "CERTIFICATE", url: "/api/files/documents/t1.pdf", uploadedAt: now }],
    }), idParams(teacher.id)));
    assert(upload.success === true && upload.teacher.documents.length === 1, "Admin: can upload a teacher document");

    const unauthorized = await teacherPut(req(TEACHER, `/api/teachers/${teacher.id}`, "PUT", {
      documents: [{ id: "doc-t2", name: "x", type: "OTHER", url: "/api/files/documents/t2.pdf", uploadedAt: now }],
    }), idParams(teacher.id));
    assert(unauthorized.status === 403, "Unauthorized: a TEACHER cannot manage teacher documents (ADMIN only)");

    const crossSchool = await teacherPut(req(ADMIN_B, `/api/teachers/${teacher.id}`, "PUT", { documents: [] }), idParams(teacher.id));
    assert(crossSchool.status === 404, "Unauthorized: another school's admin cannot reach this teacher");

    const invalidType = await teacherPut(req(ADMIN, `/api/teachers/${teacher.id}`, "PUT", {
      documents: [{ id: "doc-bad", name: "x", type: "NOT_A_REAL_TYPE", url: "/api/files/documents/x.pdf", uploadedAt: now }],
    }), idParams(teacher.id));
    assert(invalidType.status === 400, "Validation: an unrecognised document type is rejected");

    const dossier = await json(await teacherGet(req(ADMIN, `/api/teachers/${teacher.id}`), idParams(teacher.id)));
    assert(dossier.teacher.documents.length === 1 && dossier.teacher.documents[0].type === "CERTIFICATE", "GET: uploaded teacher document is returned");

    // Deleting (sending the array without it) removes it, as the existing student-document pattern does.
    const deleted = await json(await teacherPut(req(ADMIN, `/api/teachers/${teacher.id}`, "PUT", { documents: [] }), idParams(teacher.id)));
    assert(deleted.teacher.documents.length === 0, "Admin: can delete a teacher document");
  }

  // ---------------------------------------------------------------- 2. bulk student document import: dry run
  {
    const preview = await json(await docsImportPost(docsImportReq(ADMIN, [
      { name: "STD-DM-001.pdf", bytes: PDF_BYTES },
      { name: "STD-DM-002_certificate.pdf", bytes: PDF_BYTES },
      { name: "STD-DM-999.pdf", bytes: PDF_BYTES }, // unmatched
      { name: "InactiveKid.pdf", bytes: PDF_BYTES }, // real text, not an id -> unmatched
    ], { dryRun: "true" })));
    assert(preview.success === true && preview.dryRun === true, "Dry run: preview mode writes nothing and reports back");
    assert(preview.summary.matched === 2 && preview.summary.unmatched === 2, "Dry run: 2 matched by Student ID, 2 unmatched");
    assert(preview.rows[0].student?.id === s1.id && preview.rows[1].student?.id === s2.id, "Dry run: each file resolves to the correct student by Student ID, not by name");

    const s1Before = await getStudentByIdServer(A, s1.id);
    assert(s1Before?.documents?.length === 1, "Dry run: nothing was actually written to the student record");
  }

  // ---------------------------------------------------------------- 3. duplicate / ambiguous within a batch
  {
    const dup = await json(await docsImportPost(docsImportReq(ADMIN, [
      { name: "STD-DM-001.pdf", bytes: PDF_BYTES },
      { name: "STD-DM-001.pdf", bytes: PDF_BYTES }, // exact same file name for the same student again
    ], { dryRun: "true" })));
    assert(dup.rows[0].status === "MATCHED" && dup.rows[1].status === "DUPLICATE", "Dry run: the second identical file for the same student is flagged a duplicate, not silently assigned");
  }

  // ---------------------------------------------------------------- 4. file type/size validation
  {
    const badType = await json(await docsImportPost(docsImportReq(ADMIN, [
      { name: "STD-DM-001.pdf", bytes: Buffer.from("not a real pdf or image"), type: "application/pdf" },
    ], { dryRun: "true" })));
    assert(badType.rows[0].status === "INVALID", "Validation: a file whose real content isn't a recognised PDF/image is rejected even though the extension says .pdf");

    const okPng = await json(await docsImportPost(docsImportReq(ADMIN, [
      { name: "STD-DM-002.png", bytes: PNG_BYTES, type: "image/png" },
    ], { dryRun: "true" })));
    assert(okPng.rows[0].status === "MATCHED", "Validation: a real PNG is accepted");
  }

  // ---------------------------------------------------------------- 5. unauthorized access
  {
    assert((await docsImportPost(docsImportReq(TEACHER, [{ name: "STD-DM-001.pdf", bytes: PDF_BYTES }], { dryRun: "true" }))).status === 403, "Unauthorized: a TEACHER cannot run the bulk document import (ADMIN only)");
    const crossSchoolImport = await json(await docsImportPost(docsImportReq(ADMIN_B, [{ name: "STD-DM-001.pdf", bytes: PDF_BYTES }], { dryRun: "true" })));
    assert(crossSchoolImport.rows[0].status === "UNMATCHED", "Cross-school: school A's Student ID does not resolve for school B's admin");
  }

  // ---------------------------------------------------------------- 6. commit: real import + existing docs preserved
  {
    const commit = await json(await docsImportPost(docsImportReq(ADMIN, [
      { name: "STD-DM-001_certificate.pdf", bytes: PDF_BYTES },
      { name: "STD-DM-999.pdf", bytes: PDF_BYTES }, // unmatched, skipped
    ])));
    assert(commit.success === true && commit.summary.imported === 1 && commit.summary.skippedOrFailed === 1, "Commit: the matched file is imported, the unmatched one is skipped and reported, not blocking the batch");

    const s1After = await getStudentByIdServer(A, s1.id);
    assert(s1After?.documents?.length === 2, "Commit: the new document was appended - the pre-existing document was preserved, not overwritten");
    assert(s1After?.documents?.some((d) => d.id === "doc-existing"), "Commit: the original pre-existing document is still present by id");
    assert(s1After?.documents?.some((d) => d.name === "STD-DM-001_certificate"), "Commit: the newly imported document is present");
  }

  // ---------------------------------------------------------------- 7. oversized file never blocks the rest of the batch
  {
    const oversized = Buffer.concat([PDF_BYTES, Buffer.alloc(10 * 1024 * 1024 + 1)]);
    const commit = await json(await docsImportPost(docsImportReq(ADMIN, [
      { name: "STD-DM-002_toolarge.pdf", bytes: oversized },
      { name: "STD-DM-001_photo.png", bytes: PNG_BYTES, type: "image/png" },
    ])));
    assert(commit.summary.imported === 1 && commit.summary.skippedOrFailed === 1, "Commit: an oversized file is skipped (never silently dropped - reported) without blocking the other valid file in the same batch");
    const s2After = await getStudentByIdServer(A, s2.id);
    assert(!s2After?.documents?.some((d) => d.name === "STD-DM-002_toolarge"), "Commit: the oversized file was never actually saved");
  }

  // ---------------------------------------------------------------- 8. repeated commit of the same files
  // The API intentionally has no cross-request idempotency key (each commit call is independent,
  // matching "never silently skip failed files" - every call does what it's told); the UI's own
  // guard (disable Import after the first click, require a fresh preview to re-enable) is what
  // prevents a double-click or retry from importing the same files twice. This documents the
  // actual, unmodified backend behavior rather than assuming an idempotency guarantee that was
  // never implemented there.
  {
    const before = (await getStudentByIdServer(A, s2.id))?.documents?.length || 0;
    const first = await json(await docsImportPost(docsImportReq(ADMIN, [{ name: "STD-DM-002_repeat.pdf", bytes: PDF_BYTES }])));
    const second = await json(await docsImportPost(docsImportReq(ADMIN, [{ name: "STD-DM-002_repeat.pdf", bytes: PDF_BYTES }])));
    assert(first.summary.imported === 1 && second.summary.imported === 1, "Repeated commit: the backend has no cross-request dedup - each independent call does import (by design; the client guards against an accidental repeat, see StudentDocumentImportModal)");
    const after = (await getStudentByIdServer(A, s2.id))?.documents?.length || 0;
    assert(after === before + 2, "Repeated commit: confirms there are now two separate document records - the safeguard against this is client-side, not a hidden server dedup that could mask a real re-upload");
  }

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
