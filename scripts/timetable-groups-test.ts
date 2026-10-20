/**
 * Timetable groups and parallel periods, modelled on the school's real timetable (Sept 2026):
 * Pre-9th (Grade 8), 9th and 10th each have a Science and an Arts class, and Science splits into
 * Biology and Computer groups for one period ("Comp/Bio — Ms. Hira/Ms. Mahnoor"). Some lessons are
 * taught to two classes together (a merged cell, e.g. English — Ms. Rida for 9th Sci and 9th Arts).
 *
 * Covers: three simultaneous Grade 9 groups; Grade 8 and Grade 10 splits; shared-teacher, shared-
 * room, same-group and whole-class conflicts; exact duplicates; combined lessons; edits of new and
 * pre-existing (ungrouped, older-rule) records; CSV import with a Group column; the image reader's
 * group output; teacher/student views; school isolation.
 *
 * Runs against the in-memory store through the real API route handlers (no Firebase project).
 */
import { NextRequest } from "next/server";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getTimetableServer,
  saveClassServer,
  saveStudentServer,
  saveSubjectServer,
  saveTeacherServer,
  saveTimetableEntryServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc, TimetableDoc } from "../src/lib/firebase/types";
import { GET as ttGet, POST as ttPost, PUT as ttPut, DELETE as ttDelete } from "../src/app/api/timetable/route";
import { POST as importPost } from "../src/app/api/timetable/import/route";
import { groupsOverlap, normalizeGroup, sheetRowsToInputs } from "../src/lib/timetable-import";
import { extractionToRows } from "../src/lib/timetable-extraction";

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
  const headers = new Headers({ "x-forwarded-for": `10.88.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body instanceof FormData) return new NextRequest(`http://x${url}`, { method, headers, body });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://x${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function run() {
  console.log("==================================================");
  console.log("TIMETABLE GROUPS / PARALLEL PERIODS (Grades 8, 9, 10)");
  console.log("==================================================");
  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const A = "school-tg-a";
  const B = "school-tg-b";
  for (const schoolId of [A, B]) {
    await updateSchoolSettingsServer({
      id: schoolId, schoolId, schoolName: schoolId, campusName: "Main", motto: "", address: "", phone: "",
      email: `a@${schoolId}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    });
  }
  const cls = (id: string, name: string, section: string, level: number, schoolId = A): ClassDoc => ({
    id, schoolId, name, section, numericLevel: level, capacity: 40, roomNo: "", classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const g8sci = cls("cls-tg-8s", "Pre 9th", "Sci", 8);
  const g8arts = cls("cls-tg-8a", "Pre 9th", "Arts", 8);
  const g9sci = cls("cls-tg-9s", "9th", "Sci", 9);
  const g9arts = cls("cls-tg-9a", "9th", "Arts", 9);
  const g10sci = cls("cls-tg-10s", "10th", "Sci", 10);
  const g10arts = cls("cls-tg-10a", "10th", "Arts", 10);
  const other = cls("cls-tg-b9", "9th", "Sci", 9, B);
  for (const c of [g8sci, g8arts, g9sci, g9arts, g10sci, g10arts, other]) await saveClassServer(c);

  const subj = (classId: string, name: string, schoolId = A): SubjectDoc => ({
    id: `sb-${classId}-${name.toLowerCase().replace(/[^a-z]/g, "")}`, schoolId, classId, name, code: name.slice(0, 4).toUpperCase(),
    teacherId: null, credits: 1, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const S: Record<string, SubjectDoc> = {};
  for (const c of [g8sci, g9sci, g10sci]) for (const n of ["Biology", "Computer", "Chemistry", "Physics", "English", "Urdu"]) S[`${c.id}:${n}`] = subj(c.id, n);
  for (const c of [g8arts, g9arts, g10arts]) for (const n of ["Civics", "G. Science", "English", "Urdu", "Islam. Elective"]) S[`${c.id}:${n}`] = subj(c.id, n);
  S[`${other.id}:Biology`] = subj(other.id, "Biology", B);
  for (const s of Object.values(S)) await saveSubjectServer(s);
  const sid = (c: ClassDoc, n: string) => S[`${c.id}:${n}`].id;

  const teacher = (id: string, name: string, schoolId = A): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@x.edu`, phone: "", designation: "Teacher",
    department: "", qualification: "", status: "ACTIVE", assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 1, createdAt: now, updatedAt: now,
  });
  const T = {
    hira: teacher("tch-tg-hira", "Hira Aslam"),
    mahnoor: teacher("tch-tg-mahnoor", "Mahnoor Ali"),
    rida: teacher("tch-tg-rida", "Rida Noor"),
    rubab: teacher("tch-tg-rubab", "Rubab Khan"),
    laraib: teacher("tch-tg-laraib", "Laraib Shah"),
    sadia: teacher("tch-tg-sadia", "Sadia Malik"),
    faiza: teacher("tch-tg-faiza", "Faiza Butt"),
  };
  for (const t of Object.values(T)) await saveTeacherServer(t);
  await saveTeacherServer(teacher("tch-tg-other", "Other School Teacher", B));

  await saveStudentServer({
    id: "std-tg-9s", schoolId: A, admissionNo: "STD-TG-1", fullName: "Ayan Raza", fatherName: "F", gender: "MALE", classId: g9sci.id, section: "Sci",
    rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 0, discount: 0,
    academicYear: YEAR, createdAt: now, updatedAt: now,
  } as any);

  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra } as any);
  const ADMIN = await session("uid-tg-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-tg-admin-b", "ADMIN", B);
  const HIRA = await session("uid-tg-hira", "TEACHER", A, { teacherId: T.hira.id });
  const STUDENT = await session("uid-tg-student", "STUDENT", A, { studentId: "std-tg-9s" });

  const slot = (c: ClassDoc, subject: string, t: TeacherDoc | null, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    classId: c.id, subjectId: sid(c, subject), teacherId: t?.id || "", dayOfWeek: "Monday", periodName: `${start}`, startTime: start, endTime: end, ...extra,
  });
  const add = async (body: Record<string, unknown>) => {
    const res = await ttPost(req(ADMIN, "/api/timetable", "POST", body));
    return { status: res.status, body: await json(res) };
  };
  const monday = async () => (await getTimetableServer(A)).filter((t) => t.dayOfWeek === "Monday");

  // ------------------------------------------------------------ pure rules
  assert(groupsOverlap("", "Biology") && groupsOverlap("Biology", "") && groupsOverlap("", ""), "A whole-class period overlaps every group of the class");
  assert(groupsOverlap("Biology", " biology ") && !groupsOverlap("Biology", "Computer"), "Groups compare case/space-insensitively; different groups don't overlap");
  assert(normalizeGroup("  Bio   Group ") === "Bio Group" && normalizeGroup(undefined) === "", "Group labels are normalised (\"\" = whole class)");

  // ------------------------------------------------------------ Grade 9: three simultaneous groups (11:20–12:00)
  const bio9 = await add(slot(g9sci, "Biology", T.mahnoor, "11:20", "12:00", { group: "Biology", roomNo: "Lab-1" }));
  const comp9 = await add(slot(g9sci, "Computer", T.hira, "11:20", "12:00", { group: "Computer", roomNo: "Lab-2" }));
  const arts9 = await add(slot(g9arts, "Civics", T.rubab, "11:20", "12:00", { roomNo: "R-9A" }));
  assert(bio9.status === 201 && comp9.status === 201 && arts9.status === 201, "Grade 9: Biology group, Computer group and the Arts class run at the same time (201 ×3)");
  assert(bio9.body.timetable?.group === "Biology" && comp9.body.timetable?.group === "Computer" && !arts9.body.timetable?.group, "Each period keeps its group (Arts is a whole-class period)");
  const nine = (await monday()).filter((t) => t.startTime === "11:20" && (t.classId === g9sci.id || t.classId === g9arts.id));
  assert(nine.length === 3 && new Set(nine.map((t) => t.teacherId)).size === 3 && new Set(nine.map((t) => t.subjectName)).size === 3, "All three are stored with their own subject and teacher");

  // Same group twice / whole class over its groups / duplicate
  const sameGroup = await add(slot(g9sci, "Chemistry", T.laraib, "11:30", "12:10", { group: "biology" }));
  assert(sameGroup.status === 409 && /Biology group already has Biology/.test(sameGroup.body.error) && /same group can't have two lessons/.test(sameGroup.body.error), "The same group (any letter case) can't have two lessons at once (409)");
  const wholeClass = await add(slot(g9sci, "Physics", T.laraib, "11:20", "12:00"));
  assert(wholeClass.status === 409 && /9th-Sci, (Biology|Computer) group already has/.test(wholeClass.body.error), "A whole-class lesson can't overlap the class's group lessons (409)");
  const dup = await add(slot(g9sci, "Biology", T.mahnoor, "11:20", "12:00", { group: "Biology" }));
  assert(dup.status === 409 && /duplicate/.test(dup.body.error), "The exact same group lesson again is a duplicate (409)");
  const thirdGroup = await add(slot(g9sci, "Physics", T.laraib, "11:20", "12:00", { group: "Physics" }));
  assert(thirdGroup.status === 201, "A further, different group of the same class can run in parallel");

  // Shared teacher / shared room
  const busyHira = await add(slot(g10sci, "Computer", T.hira, "11:40", "12:20", { group: "Computer" }));
  assert(busyHira.status === 409 && /Hira Aslam is already scheduled/.test(busyHira.body.error), "A teacher can't teach two groups of different classes at overlapping times (409)");
  const busyHiraSameClass = await add(slot(g9sci, "English", T.hira, "11:20", "12:00", { group: "English" }));
  assert(busyHiraSameClass.status === 409 && /Hira Aslam is already scheduled/.test(busyHiraSameClass.body.error), "A teacher can't take two groups of the same class at once either (409)");
  const roomTaken = await add(slot(g10arts, "Civics", T.faiza, "11:20", "12:00", { roomNo: "R-9A" }));
  assert(roomTaken.status === 409 && /Room R-9A is already scheduled/.test(roomTaken.body.error), "Another class can't use a room that is in use (409)");
  const labTaken = await add(slot(g10sci, "Biology", T.sadia, "11:20", "12:00", { group: "Biology", roomNo: "lab-1" }));
  assert(labTaken.status === 409 && /Room lab-1 is already scheduled/.test(labTaken.body.error), "Room names compare case-insensitively (Lab-1 = lab-1)");
  assert((await monday()).filter((t) => t.startTime === "11:20" || t.startTime === "11:40" || t.startTime === "11:30").length === 4, "Refused periods saved nothing");

  // ------------------------------------------------------------ Grade 8 and Grade 10 splits with different teachers
  const g8 = [
    await add(slot(g8sci, "Computer", T.hira, "09:40", "10:20", { group: "Comp" })),
    await add(slot(g8sci, "Biology", T.mahnoor, "09:40", "10:20", { group: "Bio" })),
    await add(slot(g8arts, "G. Science", T.rubab, "09:40", "10:20")),
  ];
  assert(g8.every((r) => r.status === 201), "Grade 8 (Pre-9th): Comp and Bio groups plus the Arts class in parallel (201 ×3)");
  const g10 = [
    await add(slot(g10sci, "Biology", T.rida, "12:40", "13:30", { group: "Bio" })),
    await add(slot(g10sci, "Computer", T.hira, "12:40", "13:30", { group: "Computer" })),
    await add(slot(g10arts, "G. Science", T.rubab, "12:40", "13:30")),
  ];
  assert(g10.every((r) => r.status === 201), "Grade 10: Bio and Computer groups plus the Arts class in parallel (201 ×3)");

  // ------------------------------------------------------------ combined lessons (one teacher, two classes, merged cell)
  const eng9s = await add(slot(g9sci, "English", T.rida, "08:20", "09:00"));
  const eng9a = await add(slot(g9arts, "English", T.rida, "08:20", "09:00"));
  assert(eng9s.status === 201 && eng9a.status === 201, "Combined lesson: Ms. Rida teaches English to 9th Sci and 9th Arts together (same subject, same times)");
  const shifted = await add(slot(g10sci, "English", T.rida, "08:30", "09:10"));
  assert(shifted.status === 409 && /Rida Noor is already scheduled/.test(shifted.body.error) && /exactly the same times/.test(shifted.body.error), "Not a combined lesson when the times differ: refused as a teacher clash (409)");
  const otherSubject = await add(slot(g10arts, "Urdu", T.rida, "08:20", "09:00"));
  assert(otherSubject.status === 409 && /Rida Noor is already scheduled/.test(otherSubject.body.error), "Not a combined lesson when the subject differs (409)");
  const urdu9s = await add(slot(g9sci, "Urdu", T.sadia, "12:00", "12:40", { roomNo: "R-1" }));
  const urdu9aOtherRoom = await add(slot(g9arts, "Urdu", T.sadia, "12:00", "12:40", { roomNo: "R-2" }));
  assert(urdu9s.status === 201 && urdu9aOtherRoom.status === 409, "A combined lesson can't be in two different rooms (409)");
  const urdu9aSameRoom = await add(slot(g9arts, "Urdu", T.sadia, "12:00", "12:40", { roomNo: "R-1" }));
  assert(urdu9aSameRoom.status === 201, "A combined lesson may share its room");
  const intoCombined = await add(slot(g9arts, "Civics", T.rubab, "08:20", "09:00"));
  assert(intoCombined.status === 409 && /9th-Arts already has English/.test(intoCombined.body.error), "A class in a combined lesson can't also have another whole-class lesson (409)");

  // ------------------------------------------------------------ updates of new records
  const compId = comp9.body.timetable.id as string;
  const editTeacher = await ttPut(req(ADMIN, "/api/timetable", "PUT", { ...slot(g9sci, "Computer", T.faiza, "11:20", "12:00", { group: "Computer", roomNo: "Lab-2" }), id: compId }));
  assert(editTeacher.status === 200 && (await json(editTeacher)).timetable?.teacherId === T.faiza.id, "Editing a group lesson (new teacher) succeeds and keeps its group");
  const intoSameGroup = await ttPut(req(ADMIN, "/api/timetable", "PUT", { ...slot(g9sci, "Computer", T.faiza, "11:20", "12:00", { group: "Biology", roomNo: "Lab-2" }), id: compId }));
  assert(intoSameGroup.status === 409, "Editing a lesson into a group that is already busy is refused (409)");
  const dropGroup = await ttPut(req(ADMIN, "/api/timetable", "PUT", { ...slot(g9sci, "Computer", T.faiza, "11:20", "12:00", { roomNo: "Lab-2" }), id: compId }));
  assert(dropGroup.status === 409, "Removing the group (making it whole-class) while other groups are in session is refused (409)");
  const moved = await ttPut(req(ADMIN, "/api/timetable", "PUT", { ...slot(g9sci, "Computer", T.faiza, "13:30", "14:10", { roomNo: "Lab-2" }), id: compId }));
  assert(moved.status === 200, "Moving it to a free time as a whole-class lesson succeeds");
  const stored = (await getTimetableServer(A)).find((t) => t.id === compId);
  assert(stored?.startTime === "13:30" && !stored?.group, "The update is persisted (time changed, group cleared)");

  // ------------------------------------------------------------ records saved under the older rules (ungrouped parallel periods)
  const legacy = (id: string, subject: string, t: TeacherDoc): TimetableDoc => ({
    id, schoolId: A, teacherId: t.id, teacherName: t.fullName, classId: g10arts.id, className: "10th-Arts", subjectId: sid(g10arts, subject),
    subjectName: subject, dayOfWeek: "Tuesday", periodName: "Period 6", startTime: "11:20", endTime: "12:00", roomNo: "", academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  await saveTimetableEntryServer(legacy("tt-tg-legacy-1", "Civics", T.rubab));
  await saveTimetableEntryServer(legacy("tt-tg-legacy-2", "Islam. Elective", T.faiza));
  const legacyPut = (id: string, subject: string, t: TeacherDoc, extra: Record<string, unknown> = {}) =>
    ttPut(req(ADMIN, "/api/timetable", "PUT", { ...slot(g10arts, subject, t, "11:20", "12:00", { dayOfWeek: "Tuesday", periodName: "Period 6", ...extra }), id }));
  assert((await legacyPut("tt-tg-legacy-1", "Civics", T.rubab, { topic: "Constitution" })).status === 200, "An older ungrouped parallel period stays editable (its existing overlap isn't held against it)");
  assert((await legacyPut("tt-tg-legacy-1", "Civics", T.rubab, { group: "Civics" })).status === 200, "…and can be given a group");
  assert((await legacyPut("tt-tg-legacy-2", "Islam. Elective", T.faiza, { group: "Elective" })).status === 200, "…then the other one too");
  assert((await legacyPut("tt-tg-legacy-2", "Islam. Elective", T.faiza, { group: "civics" })).status === 409, "Once grouped, the pair is fully checked (same group refused)");
  const newWhole = await add(slot(g10arts, "English", T.sadia, "11:20", "12:00", { dayOfWeek: "Tuesday" }));
  assert(newWhole.status === 409, "A new whole-class lesson over them is refused (no new overlap is ever introduced)");
  assert((await getTimetableServer(A)).filter((t) => t.classId === g10arts.id && t.dayOfWeek === "Tuesday").length === 2, "Older records were never deleted or rewritten except by the admin's own edits");

  // ------------------------------------------------------------ deletion
  const delBio = await ttDelete(req(ADMIN, `/api/timetable?id=${encodeURIComponent(bio9.body.timetable.id)}`, "DELETE"));
  const after = (await monday()).filter((t) => t.classId === g9sci.id && t.startTime === "11:20");
  assert(delBio.status === 200 && after.length === 1 && after[0].group === "Physics", "Deleting one group lesson leaves the class's other group lessons");

  // ------------------------------------------------------------ CSV import with a Group column
  const sheet = sheetRowsToInputs([
    ["Class", "Group", "Day", "Start", "End", "Subject", "Teacher", "Room"],
    ["9th Sci", "Bio", "Wednesday", "09:00", "09:40", "Biology", "Mahnoor Ali", ""],
    ["9th Sci", "Comp", "Wednesday", "09:00", "09:40", "Computer", "Hira Aslam", ""],
    ["9th Arts", "", "Wednesday", "09:00", "09:40", "Civics", "Rubab Khan", ""],
  ]);
  assert(sheet.map((r) => r.group).join("|") === "Bio|Comp|", "Spreadsheet Group column is read (empty = whole class)");
  const csv = [
    "Class,Group,Day,Start,End,Subject,Teacher",
    "9th Sci,Bio,Wednesday,09:00,09:40,Biology,Mahnoor Ali",
    "9th Sci,Comp,Wednesday,09:00,09:40,Computer,Hira Aslam",
    "9th Arts,,Wednesday,09:00,09:40,Civics,Rubab Khan",
  ].join("\n");
  const preview = await json(await importPost(req(ADMIN, "/api/timetable/import", "POST", form({ action: "preview", file: new File([csv], "g9.csv", { type: "text/csv" }) }))));
  assert(preview.rows?.length === 3 && preview.rows.every((r: any) => r.classId && r.subjectId && r.teacherId && r.issues.length === 0), "Import preview matches all three Grade 9 rows");
  assert(preview.rows.map((r: any) => r.group).join("|") === "Bio|Comp|", "Import preview carries each row's group");
  const commit = (rows: any[]) =>
    importPost(req(ADMIN, "/api/timetable/import", "POST", form({ action: "commit", rows: JSON.stringify(rows), title: "Wed", source: "csv", fileName: "g9.csv" })));
  const ok = await commit(preview.rows);
  const okJson = await json(ok);
  assert(ok.status === 201 && okJson.created === 3, "Committing the three simultaneous Grade 9 rows creates 3 periods");
  const wed = (await getTimetableServer(A)).filter((t) => t.dayOfWeek === "Wednesday");
  assert(wed.length === 3 && wed.filter((t) => t.group === "Bio" || t.group === "Comp").length === 2, "Imported periods keep their groups");
  const clashRows = [{ ...preview.rows[0], key: "c1", days: ["Thursday"] }, { ...preview.rows[1], key: "c2", days: ["Thursday"], group: "bio" }];
  const clash = await commit(clashRows);
  const clashJson = await json(clash);
  assert(clash.status === 409 && clashJson.rowErrors?.some((e: any) => e.key === "c2" && /same group/.test(e.message)) && (await getTimetableServer(A)).filter((t) => t.dayOfWeek === "Thursday").length === 0, "Import rows that put one group in two lessons are reported per row; nothing saved");

  // ------------------------------------------------------------ image/PDF reader output
  const read = extractionToRows({
    periods: [{ label: "4", startTime: "09:40", endTime: "10:20", fridayStartTime: "", fridayEndTime: "" }],
    entries: [
      { className: "Pre 9th Sci", group: "Comp", periodLabel: "4", subjectName: "Comp", teacherName: "Hira", days: [], uncertain: [] },
      { className: "Pre 9th Sci", group: "Bio", periodLabel: "4", subjectName: "Bio", teacherName: "Mahnoor", days: [], uncertain: [] },
    ],
  });
  assert(read.rows.length === 2 && read.rows[0].group === "Comp" && read.rows[1].group === "Bio" && read.rows[0].startTime === "09:40", "The image reader's split cell becomes one row per group with its own subject and teacher");

  // ------------------------------------------------------------ views and isolation
  const hiraView = await json(await ttGet(req(HIRA, "/api/timetable")));
  assert(hiraView.timetable?.some((t: any) => t.group === "Comp") && hiraView.timetable.every((t: any) => t.teacherId === T.hira.id), "A teacher sees their own group lessons with the group label");
  const studentView = await json(await ttGet(req(STUDENT, "/api/timetable")));
  assert(Array.isArray(studentView.timetable) && studentView.timetable.length > 0 && studentView.timetable.every((t: any) => t.classId === g9sci.id) && studentView.timetable.some((t: any) => t.group === "Physics"), "A student sees their class's periods with group labels, only their own class");
  const foreign = await ttPut(req(ADMIN_B, "/api/timetable", "PUT", { ...slot(g9sci, "Biology", T.mahnoor, "11:20", "12:00"), id: after[0].id }));
  assert(foreign.status === 404, "Another school's admin can't edit this school's period (404)");
  const foreignClass = await ttPost(req(ADMIN_B, "/api/timetable", "POST", { classId: g9sci.id, subjectId: sid(g9sci, "Biology"), dayOfWeek: "Monday", periodName: "x", startTime: "07:40", endTime: "08:20" }));
  assert(foreignClass.status === 404, "Another school can't schedule into this school's class (404)");
  assert((await ttPost(req(HIRA, "/api/timetable", "POST", slot(g9sci, "Biology", T.hira, "07:40", "08:20", { group: "Bio" })))).status === 403, "Teachers can't create timetable periods (403)");
  const tooLong = await add(slot(g8sci, "Physics", T.laraib, "07:40", "08:20", { group: "x".repeat(41) }));
  assert(tooLong.status === 400, "Over-long group labels are rejected (400)");

  console.log(`\nTimetable group tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
