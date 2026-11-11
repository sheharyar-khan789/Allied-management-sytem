/**
 * Phase 6.1 — Teacher Observation read-only display: the teacher-facing page
 * (`src/app/teacher/observations/page.tsx`) now shows Author and Submitted By as two separate
 * fields, reusing the existing `/api/teacher-observations` GET response unchanged (no new API,
 * no data-mapping change — `toTeacherObservationView` already produced `authorName`,
 * `submittedByName` and `submittedByDisplay`; this phase only renders them). This suite verifies
 * the TEACHER-role GET response itself carries everything the page needs, and that nothing about
 * the existing read-only/scoping/permission model changed.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";
import { GET as tobsGet, POST as tobsPost, PUT as tobsPut } from "../src/app/api/teacher-observations/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveTeacherServer, saveTeacherObservationServer } from "../src/lib/firebase/server-db";
import { TeacherDoc, TeacherObservationDoc } from "../src/lib/firebase/types";

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
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.91.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("PHASE 6.1 — TEACHER OBSERVATION READ-ONLY DISPLAY");
  console.log("==================================================");

  // Structural check: the teacher-facing page issues no write request at all (GET only) — this
  // phase must not introduce any editing capability.
  const pageSource = readFileSync(
    join(__dirname, "..", "src", "app", "teacher", "observations", "page.tsx"),
    "utf8"
  );
  const fetchCalls = pageSource.match(/fetch\([^)]*\)/g) || [];
  assert(fetchCalls.length === 1, "Read-only: the page makes exactly one fetch call");
  assert(!/method:\s*["'](POST|PUT|DELETE|PATCH)["']/.test(pageSource), "Read-only: no POST/PUT/DELETE/PATCH request exists anywhere in the page source");

  const now = new Date().toISOString();
  const A = "school-p61-a";
  const B = "school-p61-b";

  const teacher = (id: string, schoolId: string, name: string): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@x.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  const tMath = teacher("tch-p61-math", A, "Math Teacher");
  const tEng = teacher("tch-p61-eng", A, "English Teacher");
  const coordinator = teacher("tch-p61-coord", A, "Coordinator Bilal");
  for (const t of [tMath, tEng, coordinator]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: "Principal Admin", ...extra });
  const ADMIN = await session("uid-p61-admin", "ADMIN", A);
  const T_MATH = await session("uid-p61-tmath", "TEACHER", A, { teacherId: tMath.id });
  const T_ENG = await session("uid-p61-teng", "TEACHER", A, { teacherId: tEng.id });

  // An observation with a real Submitted By (staff-selected) for Math Teacher.
  const withSubmitter = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: tMath.id, observationDate: "2026-11-01", category: "TEACHING_QUALITY", rating: "EXCELLENT",
    title: "Observed lesson", note: "Strong pacing.", submittedByStaffId: coordinator.id,
  })));

  // A legacy-style observation (no Submitted By at all) for Math Teacher.
  const legacyDoc: TeacherObservationDoc = {
    id: "tobs-p61-legacy", schoolId: A, teacherId: tMath.id, teacherName: tMath.fullName,
    authorUid: "uid-legacy", authorName: "Old Admin", observationDate: "2025-02-01",
    category: "PUNCTUALITY", rating: "SATISFACTORY", note: "On time all week.", createdAt: "2025-02-01T00:00:00.000Z",
  };
  await saveTeacherObservationServer(legacyDoc);

  // An observation for a DIFFERENT teacher — must never appear in Math Teacher's own view.
  await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: tEng.id, observationDate: "2026-11-02", category: "OTHER", rating: "SATISFACTORY", note: "Someone else's note.",
  }));

  // ---------------------------------------------------------------- the exact GET the page calls
  const ownView = await json(await tobsGet(req(T_MATH, "/api/teacher-observations")));
  assert(ownView.success === true, "Teacher GET: succeeds for the page's own data fetch");
  assert(ownView.observations.length === 2, "Teacher scoping: sees exactly their own two observations, never the other teacher's");

  const withSubmitterView = ownView.observations.find((o: any) => o.id === withSubmitter.observation.id);
  const legacyView = ownView.observations.find((o: any) => o.id === "tobs-p61-legacy");

  // Author displays correctly.
  assert(withSubmitterView.authorName === "Principal Admin", "Author: displays correctly for the page (the admin who wrote it)");
  assert(legacyView.authorName === "Old Admin", "Author: displays correctly for a legacy record too");

  // Submitted By displays correctly, independently of Author.
  assert(withSubmitterView.submittedByDisplay === "Coordinator Bilal", "Submitted By: displays the saved submitter's name");
  assert(withSubmitterView.authorName !== withSubmitterView.submittedByDisplay, "Author and Submitted By display independently as different people");

  // Missing Submitted By displays "Not recorded" — never fabricated.
  assert(legacyView.submittedByDisplay === "Not recorded", 'Missing Submitted By: displays "Not recorded" for a legacy observation');
  assert(legacyView.submittedByName === null, "Missing Submitted By: the raw field is null, never a guessed/fabricated name");

  // ---------------------------------------------------------------- scoping / isolation (unchanged)
  const otherTeacherView = await json(await tobsGet(req(T_ENG, "/api/teacher-observations")));
  assert(otherTeacherView.observations.length === 1 && otherTeacherView.observations[0].note === "Someone else's note.", "Teacher scoping: a different teacher sees only their own, unrelated note");
  assert(!otherTeacherView.observations.some((o: any) => o.id === withSubmitter.observation.id), "Teacher scoping: Math Teacher's observation is never visible to English Teacher");

  // Parameter tampering: a spoofed ?teacherId= is still ignored for a TEACHER caller (server-
  // resolved identity preserved).
  const tampered = await json(await tobsGet(req(T_ENG, `/api/teacher-observations?teacherId=${tMath.id}`)));
  assert(tampered.observations.length === 1 && tampered.observations[0].note === "Someone else's note.", "Scoping tamper-resistance: spoofing ?teacherId= does not leak another teacher's observations");

  // Cross-school isolation on the same GET path.
  const T_OTHER_SCHOOL = await session("uid-p61-tb", "TEACHER", B, { teacherId: "tch-p61-nonexistent-in-b" });
  const crossSchool = await tobsGet(req(T_OTHER_SCHOOL, "/api/teacher-observations"));
  assert(crossSchool.status === 403, "Cross-school: a teacher session with no matching teacher profile in their own school is rejected, never shown another school's data");

  // ---------------------------------------------------------------- no editing capability via the API either
  assert((await tobsPut(req(T_MATH, "/api/teacher-observations", "PUT", { id: withSubmitter.observation.id, submittedByName: "Hacked" }))).status === 403, "No editing: a teacher still cannot edit Submitted By (or anything else) via the API");
  assert((await tobsPut(req(T_MATH, "/api/teacher-observations", "PUT", { id: withSubmitter.observation.id, title: "Hacked title" }))).status === 403, "No editing: a teacher still cannot edit Author-adjacent fields via the API");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
