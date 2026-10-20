/**
 * Admin-only teacher observations: only an ADMIN creates/edits/deletes; each observation is
 * readable by that school's admins and the teacher it is about, never by another teacher (by
 * list, by id, or by passing someone else's teacherId), a student, a parent, or another school.
 * Full text, teacher reference, author, category, timestamps, edit history and audit logs are
 * stored; student observations are unaffected.
 *
 * Runs against the in-memory store (tsx does not load .env.local), like the other suites here.
 */
import { NextRequest } from "next/server";
import { GET as tobsGet, POST as tobsPost, PUT as tobsPut, DELETE as tobsDelete } from "../src/app/api/teacher-observations/route";
import { GET as obsGet, POST as obsPost } from "../src/app/api/observations/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getAuditLogsServer,
  getTeacherObservationByIdServer,
  saveClassServer,
  saveStudentServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { TeacherDoc } from "../src/lib/firebase/types";
import { DEFAULT_GRADING_SCALE } from "../src/lib/exam-results";

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
  const headers = new Headers({ "x-forwarded-for": `10.66.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("TEACHER OBSERVATIONS (ADMIN-ONLY)");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-tobs-a";
  const B = "school-tobs-b";
  for (const id of [A, B]) {
    await updateSchoolSettingsServer({
      id, schoolId: id, schoolName: id, campusName: "Main", motto: "", address: "1 Road", phone: "0300",
      email: `admin@${id}.edu`, principalName: "Head", academicYear: "2026-2027", gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
    } as any);
  }
  const teacher = (id: string, schoolId: string, fullName: string, classIds: string[] = []): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName, email: `${id}@x.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: classIds, assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  await saveClassServer({ id: "cls-tobs-1", schoolId: A, name: "Class 6", section: "A", numericLevel: 6, capacity: 30, classTeacherId: "tch-tobs-1", academicYear: "2026-2027", createdAt: now, updatedAt: now });
  await saveTeacherServer(teacher("tch-tobs-1", A, "Ayesha Siddiqui", ["cls-tobs-1"]));
  await saveTeacherServer(teacher("tch-tobs-2", A, "Kamran Shah"));
  await saveTeacherServer(teacher("tch-tobs-b", B, "Other School Teacher"));
  await saveStudentServer({
    id: "std-tobs-1", schoolId: A, admissionNo: "ADM-T1", fullName: "Zara Malik", fatherName: "F", gender: "FEMALE", classId: "cls-tobs-1", section: "A",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 0, discount: 0,
    academicYear: "2026-2027", createdAt: now, updatedAt: now,
  });

  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT", schoolId: string, extra: Record<string, unknown> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra } as any);
  const ADMIN = await session("uid-tobs-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-tobs-admin-b", "ADMIN", B);
  const T1 = await session("uid-tobs-t1", "TEACHER", A, { teacherId: "tch-tobs-1" });
  const T2 = await session("uid-tobs-t2", "TEACHER", A, { teacherId: "tch-tobs-2" });
  const T_UNLINKED = await session("uid-tobs-tx", "TEACHER", A);
  const STUDENT = await session("uid-tobs-s", "STUDENT", A, { studentId: "std-tobs-1" });
  const PARENT = await session("uid-tobs-p", "PARENT", A, { studentIds: ["std-tobs-1"] });

  // ------------------------------------------------------------ create: admin only
  const text = "Observed Grade 6 science. Clear objectives, strong questioning; pacing slipped in the last ten minutes.";
  const createRes = await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", {
    teacherId: "tch-tobs-1", title: "Science lesson visit", content: text, category: "CLASSROOM_PRACTICE",
  }));
  const created = (await json(createRes)).observation;
  assert(createRes.status === 201 && created?.id, "POST: admin creates a teacher observation");
  assert(created.note === text && created.title === "Science lesson visit", "POST: full text and title stored");
  assert(created.teacherId === "tch-tobs-1" && created.teacherName === "Ayesha Siddiqui", "POST: teacher reference and name stored");
  assert(created.category === "CLASSROOM_PRACTICE" && created.categoryLabel === "Classroom Practice", "POST: category stored");
  assert(created.authorName === "uid-tobs-admin" && created.date && created.updatedAt, "POST: author and timestamps stored");
  const stored = await getTeacherObservationByIdServer(A, created.id);
  assert(stored?.authorUid === "uid-tobs-admin" && stored.schoolId === A, "Stored record carries the author's uid and the school");

  const otherNote = (await json(await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-2", content: "Late to assembly twice this week.", category: "PUNCTUALITY" })))).observation;
  assert(otherNote?.teacherId === "tch-tobs-2", "POST: admin writes an observation about a second teacher");

  assert((await tobsPost(req(T1, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "Self-praise" }))).status === 403, "POST: a teacher cannot create observations (even about themself)");
  assert((await tobsPost(req(T1, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-2", content: "x" }))).status === 403, "POST: a teacher cannot write about another teacher");
  assert((await tobsPost(req(STUDENT, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "x" }))).status === 403, "POST: students cannot create");
  assert((await tobsPost(req(PARENT, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "x" }))).status === 403, "POST: parents cannot create");
  assert((await tobsPost(req(null, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "x" }))).status === 401, "POST: signed-out requests are refused");
  assert((await tobsPost(req(ADMIN_B, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "x" }))).status === 404, "POST: another school's admin cannot write about this school's teacher");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-b", content: "x" }))).status === 404, "POST: an admin cannot write about another school's teacher");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "" }))).status === 400, "POST: empty text rejected");
  assert((await tobsPost(req(ADMIN, "/api/teacher-observations", "POST", { teacherId: "tch-tobs-1", content: "x", category: "NOPE" }))).status === 400, "POST: unknown category rejected");

  // ------------------------------------------------------------ read: intended teacher + admins only
  const t1List = await json(await tobsGet(req(T1, "/api/teacher-observations")));
  assert(t1List.observations?.length === 1 && t1List.observations[0].id === created.id, "GET: the teacher sees exactly the observations about them");
  assert(t1List.observations[0].note === text, "GET: the teacher sees the full text");
  const t2List = await json(await tobsGet(req(T2, "/api/teacher-observations")));
  assert(t2List.observations?.length === 1 && t2List.observations[0].id === otherNote.id, "GET: another teacher sees only their own, never T1's");
  assert((await tobsGet(req(T2, `/api/teacher-observations?teacherId=tch-tobs-1`))).status === 403, "GET: a teacher passing another teacherId is refused");
  assert((await tobsGet(req(T2, `/api/teacher-observations?id=${created.id}`))).status === 404, "GET by id: a teacher cannot read another teacher's observation by changing the id");
  assert((await tobsGet(req(T1, `/api/teacher-observations?id=${created.id}`))).status === 200, "GET by id: the intended teacher can open it");
  assert((await tobsGet(req(T_UNLINKED, "/api/teacher-observations"))).status === 403, "GET: a teacher account with no teacher profile is refused (not given everything)");
  assert((await tobsGet(req(STUDENT, "/api/teacher-observations"))).status === 403, "GET: students are refused");
  assert((await tobsGet(req(PARENT, `/api/teacher-observations?id=${created.id}`))).status === 403, "GET: parents are refused");
  assert((await tobsGet(req(null, "/api/teacher-observations"))).status === 401, "GET: signed-out requests are refused");

  const adminAll = await json(await tobsGet(req(ADMIN, "/api/teacher-observations")));
  assert(adminAll.observations?.length === 2, "GET: admin sees every teacher observation of the school");
  const adminOne = await json(await tobsGet(req(ADMIN, "/api/teacher-observations?teacherId=tch-tobs-1")));
  assert(adminOne.observations?.length === 1 && adminOne.observations[0].id === created.id, "GET: admin can filter to one teacher");
  const crossAdmin = await json(await tobsGet(req(ADMIN_B, "/api/teacher-observations")));
  assert(crossAdmin.observations?.length === 0, "GET: another school's admin sees none of this school's observations");
  assert((await tobsGet(req(ADMIN_B, `/api/teacher-observations?id=${created.id}`))).status === 404, "GET by id: another school's admin cannot open it");

  // ------------------------------------------------------------ edit / delete: admin only, with history and audit
  assert((await tobsPut(req(T1, "/api/teacher-observations", "PUT", { id: created.id, content: "Edited by teacher" }))).status === 403, "PUT: the observed teacher cannot edit it");
  assert((await tobsPut(req(ADMIN_B, "/api/teacher-observations", "PUT", { id: created.id, content: "x" }))).status === 404, "PUT: another school cannot edit");
  const edited = await json(await tobsPut(req(ADMIN, "/api/teacher-observations", "PUT", { id: created.id, content: text + " Follow-up agreed." })));
  assert(edited.observation?.note.endsWith("Follow-up agreed.") && edited.observation.editHistory.length === 1 && edited.observation.editHistory[0].previousNote === text, "PUT: admin edit keeps the previous text in edit history");
  const t1After = await json(await tobsGet(req(T1, `/api/teacher-observations?id=${created.id}`)));
  assert(t1After.observation.note.endsWith("Follow-up agreed.") && t1After.observation.editHistory.length === 0, "Teacher view shows the current text only, never earlier drafts (history is admin-only)");
  const t1ListAfter = await json(await tobsGet(req(T1, "/api/teacher-observations")));
  assert(t1ListAfter.observations.every((o: any) => o.editHistory.length === 0 && !("authorUid" in o)), "Teacher list view carries no edit history and no author account id");
  const adminAfter = await json(await tobsGet(req(ADMIN, `/api/teacher-observations?id=${created.id}`)));
  assert(adminAfter.observation.editHistory.length === 1 && adminAfter.observation.editHistory[0].previousNote === text, "Admin view still has the full edit history");

  assert((await tobsDelete(req(T2, `/api/teacher-observations?id=${otherNote.id}`, "DELETE"))).status === 403, "DELETE: a teacher cannot delete, even an observation about themself");
  assert((await tobsDelete(req(ADMIN_B, `/api/teacher-observations?id=${otherNote.id}`, "DELETE"))).status === 404, "DELETE: another school cannot delete");
  assert((await tobsDelete(req(ADMIN, `/api/teacher-observations?id=${otherNote.id}`, "DELETE"))).status === 200, "DELETE: admin soft-deletes");
  assert((await json(await tobsGet(req(T2, "/api/teacher-observations")))).observations.length === 0, "DELETE: the deleted observation disappears for the teacher");
  assert((await tobsGet(req(ADMIN, `/api/teacher-observations?id=${otherNote.id}`))).status === 404, "DELETE: and for admin reads");
  assert((await getTeacherObservationByIdServer(A, otherNote.id))?.deletedBy === "uid-tobs-admin", "DELETE: the record is kept for the audit trail (soft delete)");
  assert((await tobsDelete(req(ADMIN, `/api/teacher-observations?id=${otherNote.id}`, "DELETE"))).status === 404, "DELETE: repeating a delete reports not found");

  const logs = await getAuditLogsServer(A);
  const actions = (logs as any[]).filter((l) => l.entity === "TEACHER_OBSERVATION").map((l) => l.action);
  assert(actions.includes("ADD_TEACHER_OBSERVATION") && actions.includes("UPDATE_TEACHER_OBSERVATION") && actions.includes("DELETE_TEACHER_OBSERVATION"), "Audit log records create, edit and delete");
  assert(!(await getAuditLogsServer(B) as any[]).some((l) => l.entity === "TEACHER_OBSERVATION"), "Audit entries stay in the acting school");

  // ------------------------------------------------------------ student observations unaffected
  const sObs = await obsPost(req(T1, "/api/observations", "POST", { studentId: "std-tobs-1", content: "Great participation." }));
  assert(sObs.status === 201, "Student observations: the class teacher can still write one");
  const sList = await json(await obsGet(req(T1, "/api/observations?studentId=std-tobs-1")));
  assert(sList.observations?.length === 1 && !sList.observations.some((o: any) => o.id === created.id), "Student observations and teacher observations stay separate");
  assert((await json(await tobsGet(req(ADMIN, "/api/teacher-observations")))).observations.every((o: any) => o.id.startsWith("tobs-")), "Teacher observation list never includes student notes");

  console.log(`\nTeacher observation tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Teacher observation test suite crashed:", e);
  process.exit(1);
});
