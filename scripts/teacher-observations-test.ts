/**
 * Teacher observations (`/api/teacher-observations`): admin-authored evaluation notes about a
 * TEACHER, kept entirely separate from `studentObservations` (a teacher's note about a student,
 * covered in exams-results-observations-test.ts). Covers: admin create/edit/delete, teacher
 * read-only access to their own file only, rejection of a teacher writing/editing/deleting,
 * cross-teacher and cross-school isolation, and validation.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { GET as tobsGet, POST as tobsPost, PUT as tobsPut, DELETE as tobsDelete } from "../src/app/api/teacher-observations/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveTeacherServer } from "../src/lib/firebase/server-db";
import { TeacherDoc } from "../src/lib/firebase/types";

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
  const headers = new Headers({ "x-forwarded-for": `10.89.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("TEACHER OBSERVATIONS");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-tobs-a";
  const B = "school-tobs-b";

  const teacher = (id: string, schoolId: string, name: string): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@x.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  const tMath = teacher("tch-tobs-math", A, "Math Teacher");
  const tEng = teacher("tch-tobs-eng", A, "English Teacher");
  const tB = teacher("tch-tobs-b", B, "Teacher of B");
  for (const t of [tMath, tEng, tB]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra });
  const ADMIN = await session("uid-tobs-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-tobs-admin-b", "ADMIN", B);
  const T_MATH = await session("uid-tobs-tmath", "TEACHER", A, { teacherId: tMath.id });
  const T_ENG = await session("uid-tobs-teng", "TEACHER", A, { teacherId: tEng.id });
  // A TEACHER session with no linked teacher profile at all.
  const T_ORPHAN = await session("uid-tobs-orphan", "TEACHER", A);

  // ---------------------------------------------------------------- 1. validation & authorization on create
  assert((await tobsPost(req(T_MATH, "/api/teacher-observations", "POST", { teacherId: tEng.id, observationDate: "2026-10-01", category: "TEACHING_QUALITY", rating: "SATISFACTORY", note: "x" }))).status === 403, "POST: a teacher can never write an observation, even about a colleague");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: tMath.id, observationDate: "2026-10-01", category: "TEACHING_QUALITY", rating: "SATISFACTORY", note: "" }))).status === 400, "POST: empty note text rejected");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: tMath.id, observationDate: "2026-10-01", category: "NOPE", rating: "SATISFACTORY", note: "x" }))).status === 400, "POST: unknown category rejected");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: tMath.id, observationDate: "10/01/2026", category: "TEACHING_QUALITY", rating: "SATISFACTORY", note: "x" }))).status === 400, "POST: non-ISO date rejected");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: "tch-missing", observationDate: "2026-10-01", category: "TEACHING_QUALITY", rating: "SATISFACTORY", note: "x" }))).status === 404, "POST: unknown teacher rejected");
  assert((await tobsPost(req(ADMIN_B, "/api/teacher-observations", "POST", { teacherId: tMath.id, observationDate: "2026-10-01", category: "TEACHING_QUALITY", rating: "SATISFACTORY", note: "x" }))).status === 404, "POST: another school's admin cannot write about this teacher");

  // ---------------------------------------------------------------- 2. admin creates real notes
  const created = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: tMath.id, observationDate: "2026-10-05", category: "TEACHING_QUALITY", rating: "EXCELLENT",
    title: "Observed lesson", note: "Clear explanation of fractions; strong pacing.",
  })));
  assert(created.success && created.observation?.teacherName === "Math Teacher", "POST: note saved with the teacher's name snapshot");
  const OBS = created.observation.id as string;

  await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: tEng.id, observationDate: "2026-10-06", category: "PUNCTUALITY", rating: "NEEDS_IMPROVEMENT",
    note: "Arrived 10 minutes late to period 2.",
  }));

  // ---------------------------------------------------------------- 3. teacher reads only their own file
  const ownList = await json(await tobsGet(req(T_MATH, "/api/teacher-observations")));
  assert(ownList.success && ownList.observations.length === 1 && ownList.observations[0].id === OBS, "GET (teacher): sees exactly their own note");
  assert(ownList.teacher?.fullName === "Math Teacher", "GET (teacher): teacher identity resolved server-side");

  const otherList = await json(await tobsGet(req(T_ENG, "/api/teacher-observations")));
  assert(otherList.observations.length === 1 && otherList.observations[0].note.includes("late"), "GET (teacher): a different teacher sees only their own, different note");

  // Parameter tampering: a TEACHER sending another teacher's id must still only get their own.
  const tampered = await json(await tobsGet(req(T_MATH, `/api/teacher-observations?teacherId=${tEng.id}`)));
  assert(tampered.observations.length === 1 && tampered.observations[0].id === OBS, "GET (teacher): a spoofed ?teacherId= is ignored; still only their own note");

  assert((await tobsGet(req(T_ORPHAN, "/api/teacher-observations"))).status === 403, "GET (teacher): no linked teacher profile is rejected, not given the whole school");

  // ---------------------------------------------------------------- 4. admin search & scoped views
  const byTeacher = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${tMath.id}`)));
  assert(byTeacher.observations.length === 1 && byTeacher.teacher?.id === tMath.id, "GET (admin): scoped to one teacher");

  const byCategory = await json(await tobsGet(req(ADMIN, "/api/teacher-observations?category=PUNCTUALITY")));
  assert(byCategory.observations.length === 1 && byCategory.observations[0].category === "PUNCTUALITY", "GET (admin): filtered by category");

  // Combining teacherId with another filter must still apply both (not silently drop one).
  const combined = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${tMath.id}&category=PUNCTUALITY`)));
  assert(combined.observations.length === 0, "GET (admin): teacherId + category filters compose (no match here) instead of one overriding the other");

  const byText = await json(await tobsGet(req(ADMIN, "/api/teacher-observations?q=fractions")));
  assert(byText.observations.length === 1 && byText.observations[0].id === OBS, "GET (admin): free-text search over note/title");

  const wholeSchool = await json(await tobsGet(req(ADMIN, "/api/teacher-observations")));
  assert(wholeSchool.observations.length === 2, "GET (admin): unscoped search returns every teacher's notes for this school");
  assert((await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${tB.id}`))).status === 404, "GET (admin): another school's teacher id rejected");

  const crossSchool = await json(await tobsGet(req(ADMIN_B, "/api/teacher-observations")));
  assert(crossSchool.observations.length === 0, "GET (admin): cross-school isolation on the unscoped search too");

  // ---------------------------------------------------------------- 5. edit (admin-only) + history
  assert((await tobsPut(req(T_MATH, "/api/teacher-observations", "PUT", { id: OBS, note: "changed" }))).status === 403, "PUT: a teacher cannot edit a note written about them");
  assert((await tobsPut(req(ADMIN_B, "/api/teacher-observations", "PUT", { id: OBS, note: "changed" }))).status === 404, "PUT: another school's admin cannot edit");

  const edited = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", { id: OBS, note: "Clear explanation of fractions; strong pacing. Added a worksheet follow-up." })));
  assert(edited.success && edited.observation.editHistory.length === 1, "PUT: text change recorded in edit history");
  assert(edited.observation.editHistory[0].previousNote === "Clear explanation of fractions; strong pacing.", "PUT: edit history preserves the original text verbatim");

  await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", { id: OBS, rating: "SATISFACTORY" }));
  const afterNonTextEdit = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${tMath.id}`)));
  assert(afterNonTextEdit.observations[0].editHistory.length === 1 && afterNonTextEdit.observations[0].rating === "SATISFACTORY", "PUT: a rating-only change updates the record without adding a spurious history entry");

  // ---------------------------------------------------------------- 6. delete (admin-only, soft)
  assert((await tobsDelete(req(T_MATH, `/api/teacher-observations?id=${OBS}`, "DELETE"))).status === 403, "DELETE: a teacher cannot delete a note about them");
  assert((await tobsDelete(req(ADMIN_B, `/api/teacher-observations?id=${OBS}`, "DELETE"))).status === 404, "DELETE: another school's admin cannot delete");

  const del = await tobsDelete(req(ADMIN, `/api/teacher-observations?id=${OBS}`, "DELETE"));
  assert(del.status === 200, "DELETE: admin removes their own school's note");
  const afterDelete = await json(await tobsGet(req(T_MATH, "/api/teacher-observations")));
  assert(afterDelete.observations.length === 0, "DELETE: soft-deleted note no longer shown to the teacher it was about");
  assert((await tobsDelete(req(ADMIN, `/api/teacher-observations?id=${OBS}`, "DELETE"))).status === 404, "DELETE: deleting an already-deleted note 404s rather than double-soft-deleting");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
