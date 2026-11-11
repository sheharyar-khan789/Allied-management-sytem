/**
 * Phase 6 — Teacher Observation: a new, independent "Submitted By" field (the Coordinator/
 * Teacher who actually provided the observation's information), kept separate from the existing
 * "Author" field (always the admin who typed the note into the system — unchanged). Covers:
 * Author preservation, Submitted By create/edit/persist/clear, staff-selection vs free-text,
 * backward compatibility with older records that have neither field, and permissions/security
 * (unchanged from the existing admin-only-write model).
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
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
  const headers = new Headers({ "x-forwarded-for": `10.90.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("PHASE 6 — TEACHER OBSERVATION: AUTHOR + SUBMITTED BY");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-p6-a";
  const B = "school-p6-b";

  const teacher = (id: string, schoolId: string, name: string): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@x.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  const observedTeacher = teacher("tch-p6-observed", A, "Observed Teacher");
  const coordinator = teacher("tch-p6-coord", A, "Coordinator Asma");
  const otherSchoolTeacher = teacher("tch-p6-b", B, "Teacher of B");
  for (const t of [observedTeacher, coordinator, otherSchoolTeacher]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: "Principal Admin", ...extra });
  const ADMIN = await session("uid-p6-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-p6-admin-b", "ADMIN", B);
  const TEACHER_TOKEN = await session("uid-p6-teacher", "TEACHER", A, { teacherId: observedTeacher.id });

  // =========================================================================
  // AUTHOR — unchanged behavior
  // =========================================================================

  // Author automatically identifies the actual entry creator (the logged-in admin), never the
  // teacher the note is about, and never Submitted By.
  const created = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-05", category: "TEACHING_QUALITY", rating: "EXCELLENT",
    title: "Observed lesson", note: "Clear explanation of fractions.",
    submittedByStaffId: coordinator.id,
  })));
  assert(created.success, "Author: observation created successfully");
  assert(created.observation.authorName === "Principal Admin", "Author: automatically identifies the actual logged-in entry creator");
  const OBS = created.observation.id as string;
  assert(created.observation.authorName !== created.observation.submittedByDisplay, "Author and Submitted By are correctly recorded as different people");

  // Author remains unchanged after editing (including after a Submitted By correction).
  const afterEdit1 = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", {
    id: OBS, note: "Clear explanation of fractions. Added a follow-up worksheet.",
  })));
  assert(afterEdit1.observation.authorName === "Principal Admin", "Author: remains unchanged after editing the note text");

  // Existing (pre-Phase-6) Author records remain compatible — a record saved with no
  // Submitted By fields at all must load and display correctly.
  const legacyDoc: TeacherObservationDoc = {
    id: "tobs-p6-legacy", schoolId: A, teacherId: observedTeacher.id, teacherName: observedTeacher.fullName,
    authorUid: "uid-legacy-admin", authorName: "Old Admin", observationDate: "2025-01-10",
    category: "PUNCTUALITY", rating: "SATISFACTORY", note: "Arrived on time all week.", createdAt: "2025-01-10T00:00:00.000Z",
  };
  await saveTeacherObservationServer(legacyDoc);
  const legacyList = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${observedTeacher.id}`)));
  const legacyView = legacyList.observations.find((o: any) => o.id === "tobs-p6-legacy");
  assert(legacyView?.authorName === "Old Admin", "Backward compatibility: a legacy record's Author is intact and unaffected by this phase's changes");
  assert(legacyView?.submittedByDisplay === "Not recorded", 'Backward compatibility: a legacy record with no Submitted By shows "Not recorded", never a guessed name');
  assert(legacyView?.submittedByName === null && legacyView?.submittedByStaffId === null, "Backward compatibility: raw Submitted By fields are null, not fabricated");

  // =========================================================================
  // SUBMITTED BY — selection from staff records
  // =========================================================================

  const obsView = (await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${observedTeacher.id}`)))).observations.find((o: any) => o.id === OBS);
  assert(obsView.submittedByStaffId === coordinator.id, "Submitted By: selecting an existing staff member saves their staff id");
  assert(obsView.submittedByName === "Coordinator Asma", "Submitted By: the selected staff member's name is saved (server-resolved, not client-trusted)");
  assert(obsView.submittedByDisplay === "Coordinator Asma", "Submitted By: displays the saved name in observation details");

  // Submitted By persists after reopening (a fresh GET, not just the POST's own response).
  const reopened = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${observedTeacher.id}`)));
  const reopenedObs = reopened.observations.find((o: any) => o.id === OBS);
  assert(reopenedObs.submittedByName === "Coordinator Asma", "Submitted By: persists correctly when the observation is reopened");

  // A client sending a mismatched name alongside a real staffId is ignored — the server always
  // snapshots the real staff record's name, so identities can never be spoofed or inconsistent.
  const spoofAttempt = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-07", category: "OTHER", rating: "SATISFACTORY", note: "x",
    submittedByStaffId: coordinator.id, submittedByName: "Someone Else Entirely",
  })));
  assert(spoofAttempt.observation.submittedByName === "Coordinator Asma", "Submitted By: a staffId always wins over a mismatched client-sent name — identity cannot be spoofed");

  // Invalid staff selection (a staffId that doesn't exist, or belongs to another school) is
  // handled appropriately — rejected, never silently guessed or dropped.
  const badStaff = await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-08", category: "OTHER", rating: "SATISFACTORY", note: "x",
    submittedByStaffId: "tch-does-not-exist",
  }));
  assert(badStaff.status === 400, "Submitted By: a non-existent staffId is rejected (400), not silently ignored or guessed");
  const crossSchoolStaff = await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-08", category: "OTHER", rating: "SATISFACTORY", note: "x",
    submittedByStaffId: otherSchoolTeacher.id,
  }));
  assert(crossSchoolStaff.status === 400, "Submitted By: a staffId belonging to another school is rejected, never cross-tenant resolved");

  // =========================================================================
  // SUBMITTED BY — free-text entry (no matching staff record)
  // =========================================================================

  const freeTextObs = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-09", category: "COLLABORATION", rating: "SATISFACTORY",
    note: "Reported by a visiting inspector.", submittedByName: "  Visiting Inspector Khan  ",
  })));
  assert(freeTextObs.observation.submittedByName === "Visiting Inspector Khan", "Submitted By: a free-text name (no staff record) is saved, trimmed");
  assert(freeTextObs.observation.submittedByStaffId === null, "Submitted By: free-text entries carry no staffId");

  // Not auto-populated with the logged-in admin's name, and never assumed equal to Author, when
  // nothing is specified at all.
  const unspecified = await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-10", category: "OTHER", rating: "SATISFACTORY", note: "No submitter specified.",
  })));
  assert(unspecified.observation.submittedByName === null, "Submitted By: never auto-populated with the logged-in admin's name when left unspecified");
  assert(unspecified.observation.submittedByDisplay === "Not recorded", 'Submitted By: an unspecified value displays as "Not recorded"');

  // =========================================================================
  // SUBMITTED BY — editing / correcting
  // =========================================================================

  // Admin can update Submitted By on an existing observation, independent of Author and of the
  // note's own text (no edit-history entry is created for a Submitted-By-only change).
  const beforeCorrection = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${observedTeacher.id}`)));
  const historyLenBefore = beforeCorrection.observations.find((o: any) => o.id === OBS).editHistory.length;
  const corrected = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", {
    id: OBS, submittedByStaffId: "", submittedByName: "Corrected Submitter Name",
  })));
  assert(corrected.observation.submittedByName === "Corrected Submitter Name", "Submitted By: admin can correct it when editing");
  assert(corrected.observation.authorName === "Principal Admin", "Submitted By correction does not overwrite Author");
  assert(corrected.observation.editHistory.length === historyLenBefore, "Submitted By: a Submitted-By-only correction does not add a spurious text edit-history entry");

  // Sending neither Submitted By field on an edit leaves the existing value untouched (e.g. an
  // admin editing only the rating).
  await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", { id: OBS, rating: "SATISFACTORY" }));
  const afterRatingOnlyEdit = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?teacherId=${observedTeacher.id}`)));
  const stillCorrect = afterRatingOnlyEdit.observations.find((o: any) => o.id === OBS);
  assert(stillCorrect.submittedByName === "Corrected Submitter Name", "Submitted By: untouched by an edit that doesn't mention it at all");
  assert(stillCorrect.rating === "SATISFACTORY", "Sanity: the rating-only edit itself did apply");

  // Admin can explicitly clear a previously-saved Submitted By.
  const cleared = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", {
    id: OBS, submittedByStaffId: "", submittedByName: "",
  })));
  assert(cleared.observation.submittedByName === null && cleared.observation.submittedByDisplay === "Not recorded", "Submitted By: can be explicitly cleared back to Not recorded");

  // Switching from a free-text entry to a real staff selection replaces it cleanly (no leftover
  // free-text name lingering alongside the new staffId).
  const switched = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", {
    id: freeTextObs.observation.id, submittedByStaffId: coordinator.id,
  })));
  assert(switched.observation.submittedByStaffId === coordinator.id && switched.observation.submittedByName === "Coordinator Asma", "Submitted By: switching from free text to a real staff selection resolves cleanly, no stale name left over");

  // =========================================================================
  // PERMISSIONS AND SECURITY — unchanged from the existing admin-only-write model
  // =========================================================================

  // A TEACHER can never write or edit an observation (about themself or anyone), including the
  // new Submitted By field — the existing write restriction is not weakened.
  const teacherPostAttempt = await tobsPost(req(TEACHER_TOKEN, "/api/teacher-observations", "POST", {
    teacherId: observedTeacher.id, observationDate: "2026-10-11", category: "OTHER", rating: "SATISFACTORY", note: "x",
    submittedByStaffId: coordinator.id,
  }));
  assert(teacherPostAttempt.status === 403, "Permissions: a teacher cannot create an observation, even one naming a Submitted By");

  const teacherPutAttempt = await tobsPut(req(TEACHER_TOKEN, "/api/teacher-observations", "PUT", { id: OBS, submittedByStaffId: coordinator.id }));
  assert(teacherPutAttempt.status === 403, "Permissions: a teacher cannot modify Submitted By on their own observation record");

  // Another school's admin cannot edit this school's observation or inject a Submitted By into it.
  const crossSchoolPut = await tobsPut(req(ADMIN_B, "/api/teacher-observations", "PUT", { id: OBS, submittedByName: "Intruder" }));
  assert(crossSchoolPut.status === 404, "Permissions: another school's admin cannot modify this observation's Submitted By — tenant isolation intact");

  // Existing teacher read-only access is unaffected: a teacher reading their own file still sees
  // the (read-only) Submitted By value, correctly scoped to only their own records.
  const teacherOwnView = await json(await tobsGet(req(TEACHER_TOKEN, "/api/teacher-observations")));
  assert(teacherOwnView.observations.some((o: any) => o.id === OBS && o.submittedByDisplay === "Not recorded"), "Permissions: a teacher can still view (read-only) the Submitted By field on their own records");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
