/**
 * Timetable import (preview → corrections → commit, image fallback, edit/delete), student phone
 * numbers (save/clear, teacher visibility within allocation), and the admin display name.
 * Runs against the in-memory store like the other suites (no Firebase project is touched; the
 * image reader is tested with a fake client, never the real API).
 */
import { NextRequest } from "next/server";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  createUserServer,
  getTimetableServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
  updateUserServer,
  getUserByIdServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";
import { GET as importGet, POST as importPost, DELETE as importDelete } from "../src/app/api/timetable/import/route";
import { GET as timetableGet, PUT as timetablePut, DELETE as timetableDelete } from "../src/app/api/timetable/route";
import { POST as studentsPost, GET as studentsGet } from "../src/app/api/students/route";
import { GET as studentGet, PUT as studentPut } from "../src/app/api/students/[id]/route";
import { GET as dashboardGet } from "../src/app/api/dashboard/route";
import { loadAdminShellData } from "../src/lib/layout-data";
import {
  buildPreviewRows,
  matchClass,
  matchSubject,
  matchTeacher,
  normalizeTime,
  parseDays,
  sheetRowsToInputs,
} from "../src/lib/timetable-import";
import { extractTimetableFromFile, isTimetableExtractionAvailable, MAX_EXTRACTION_IMAGE_BYTES } from "../src/lib/timetable-extraction";

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
  if (body instanceof FormData) return new NextRequest(url, { method, headers, body });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
// Smallest valid PNG (1x1).
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6300010000050001" + "0d0a2db40000000049454e44ae426082", "hex");

async function run() {
  console.log("==================================================");
  console.log("TIMETABLE IMPORT / STUDENT PHONE / ADMIN NAME");
  console.log("==================================================");
  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const A = "school-ti-a";
  const B = "school-ti-b";
  for (const schoolId of [A, B]) {
    await updateSchoolSettingsServer({
      id: schoolId, schoolId, schoolName: schoolId, campusName: "Main", motto: "", address: "", phone: "",
      email: `a@${schoolId}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    });
  }
  const cls = (id: string, schoolId: string, name: string, section: string, classTeacherId: string | null): ClassDoc => ({
    id, schoolId, name, section, numericLevel: 1, capacity: 30, roomNo: "", classTeacherId, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const oneA = cls("cls-ti-1a", A, "Grade 1", "A", "tch-ti-esha");
  const oneB = cls("cls-ti-1b", A, "Grade 1", "B", "tch-ti-bano");
  const otherSchool = cls("cls-ti-b1", B, "Grade 1", "A", null);
  for (const c of [oneA, oneB, otherSchool]) await saveClassServer(c);
  const subj = (id: string, classId: string, name: string, teacherId: string | null, schoolId = A): SubjectDoc => ({
    id, schoolId, classId, name, code: id.toUpperCase(), teacherId, credits: 1, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const maths1a = subj("sb-ti-m1a", oneA.id, "Maths", "tch-ti-esha");
  const quran1a = subj("sb-ti-q1a", oneA.id, "Al-Quran", "tch-ti-tehreem");
  const maths1b = subj("sb-ti-m1b", oneB.id, "Maths", "tch-ti-bano");
  const comp1b = subj("sb-ti-c1b", oneB.id, "Computer", "tch-ti-bano");
  for (const s of [maths1a, quran1a, maths1b, comp1b]) await saveSubjectServer(s);
  const teacher = (id: string, name: string, classIds: string[]): TeacherDoc => ({
    id, schoolId: A, employeeId: id.toUpperCase(), fullName: name, email: `${id}@a.edu`, phone: "", designation: "Teacher",
    department: "", qualification: "", status: "ACTIVE", assignedClassIds: classIds, assignedSubjectIds: [], weeklyLoad: 1, createdAt: now, updatedAt: now,
  });
  for (const t of [teacher("tch-ti-esha", "Esha Khan", [oneA.id]), teacher("tch-ti-tehreem", "Tehreem Fatima", []), teacher("tch-ti-bano", "Shehr Bano", [oneB.id])]) {
    await saveTeacherServer(t);
  }
  const session = (uid: string, role: "ADMIN" | "TEACHER" | "STUDENT", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra });
  const ADMIN = await session("uid-ti-admin", "ADMIN", A);
  const ADMIN_B = await session("uid-ti-admin-b", "ADMIN", B);
  const T_ESHA = await session("uid-ti-esha", "TEACHER", A, { teacherId: "tch-ti-esha" });
  const ctx = { classes: [oneA, oneB], subjects: [maths1a, quran1a, maths1b, comp1b], teachers: [] as TeacherDoc[] };
  ctx.teachers = [teacher("tch-ti-esha", "Esha Khan", []), teacher("tch-ti-tehreem", "Tehreem Fatima", []), teacher("tch-ti-bano", "Shehr Bano", [])];

  // ======================================================================
  // 1. Matching / parsing helpers
  // ======================================================================
  assert(normalizeTime("07:40").value === "07:40" && normalizeTime("01:30").value === "13:30" && normalizeTime("01:30").assumedPm, "Times: 24h kept; '01:30' without AM/PM read as 13:30 and flagged");
  assert(normalizeTime("2:15 PM").value === "14:15" && normalizeTime("abc").value === "", "Times: AM/PM converted; non-times rejected");
  assert(parseDays("Mon-Thu, Sat").join(",") === "Monday,Tuesday,Wednesday,Thursday,Saturday" && parseDays("All").length === 6, "Days: ranges, lists and 'All'");
  assert(matchClass("One A", ctx.classes)?.id === oneA.id && matchClass("1-B", ctx.classes)?.id === oneB.id, "Class 'One A' / '1-B' matched to the real Grade 1-A / 1-B records");
  assert(matchClass("Two A", ctx.classes) === null && matchClass("Grade 1", ctx.classes) === null, "Unknown or ambiguous class names are not guessed");
  assert(matchSubject("maths", oneB.id, ctx.subjects)?.id === maths1b.id && matchSubject("Urdu T", oneA.id, ctx.subjects) === null, "Subject matched within its class only; unknown subject stays unmatched");
  assert(matchTeacher("Ms. Esha", ctx.teachers)?.id === "tch-ti-esha" && matchTeacher("Ms. Sehar", ctx.teachers) === null, "Teacher 'Ms. Esha' → Esha Khan; unknown teacher not guessed");

  // ======================================================================
  // 2. Image reader (fake client — the real API is never called in tests)
  // ======================================================================
  assert(!isTimetableExtractionAvailable({}) && isTimetableExtractionAvailable({ ANTHROPIC_API_KEY: "x" }), "Automatic reading is only enabled when ANTHROPIC_API_KEY is configured");
  let sentParams: any = null;
  const fake = {
    beta: {
      messages: {
        create: async (params: any) => {
          sentParams = params;
          return {
            stop_reason: "end_turn",
            content: [{
              type: "text",
              text: JSON.stringify({
                title: "Time Table", date: "September 23, 2026",
                periods: [{ label: "1", startTime: "07:40", endTime: "08:20", fridayStartTime: "07:30", fridayEndTime: "08:00" }],
                entries: [
                  { className: "One A", periodLabel: "1", subjectName: "Maths", teacherName: "Ms. Esha", days: [], uncertain: [] },
                  { className: "One B", periodLabel: "1", subjectName: "Comp/Bio", teacherName: "Hira/Mahnoor", days: [], uncertain: ["subject", "teacher"] },
                ],
                notes: [],
              }),
            }],
          } as any;
        },
      },
    },
  };
  const extracted = await extractTimetableFromFile(PNG, "image/png", { classNames: ["Grade 1-A"], subjectNames: [], teacherNames: [] }, { client: fake as any });
  assert(sentParams?.model === "claude-sonnet-5-5" && sentParams?.output_config?.format?.type === "json_schema" && sentParams?.messages?.[0]?.content?.[0]?.type === "image", "Reader sends the image with a JSON schema to claude-sonnet-5-5");
  assert(extracted.rows.length === 2 && extracted.rows[0].startTime === "07:40" && extracted.rows[0].fridayStartTime === "07:30" && extracted.date === "September 23, 2026", "Reader output joined with period times (incl. Friday timings) and printed date");
  const extractedPreview = buildPreviewRows(extracted.rows.map((r) => ({ ...r, days: ["Mon-Sat"] })), ctx);
  assert(extractedPreview[0].classId === oneA.id && extractedPreview[0].subjectId === maths1a.id && extractedPreview[0].teacherId === "tch-ti-esha" && extractedPreview[0].issues.length === 0, "Confident row is matched to real class/subject/teacher with no issues");
  const unsure = extractedPreview[1];
  assert(unsure.classId === oneB.id && !unsure.subjectId && unsure.issues.some((i) => i.field === "subject" && i.level === "error") && unsure.issues.some((i) => i.field === "teacher"), "Uncertain 'Comp/Bio' cell is not guessed: subject left empty and flagged, teacher flagged");
  let oversized = false;
  try {
    await extractTimetableFromFile(Buffer.alloc(MAX_EXTRACTION_IMAGE_BYTES + 1), "image/jpeg", { classNames: [], subjectNames: [], teacherNames: [] }, { client: fake as any });
  } catch {
    oversized = true;
  }
  assert(oversized, "Images over the API's 5 MB limit are refused with a clear error");

  // ======================================================================
  // 3. CSV import: preview → commit → visible in the timetable
  // ======================================================================
  const csv = [
    "Day,Period,Start,End,Class,Subject,Teacher,Room,Friday Start,Friday End",
    "Mon-Thu,1,07:40,08:20,One A,Maths,Ms. Esha,,,",
    "Mon-Thu,1,07:40,08:20,One B,Computer,Ms. Shehr Bano,,,",
    "Mon-Thu,2,08:20,09:00,One A,Al-Quran,Ms. Tehreem,,,",
  ].join("\n");
  const csvFile = () => new File([csv], "week.csv", { type: "text/csv" });
  const sheet = sheetRowsToInputs([["class name", "SUBJECT", "Start Time", "end", "Days", "Period"], ["One A", "Maths", "7:40", "8:20", "Mon-Fri", "3"]]);
  assert(sheet.length === 1 && sheet[0].className === "One A" && sheet[0].periodName === "Period 3" && sheet[0].days[0] === "Mon-Fri", "Spreadsheet headers are matched case-insensitively (class name / SUBJECT / Start Time / Days)");
  let missingCol = "";
  try {
    sheetRowsToInputs([["Teacher"], ["x"]]);
  } catch (e: any) {
    missingCol = e.message;
  }
  assert(/Missing column/.test(missingCol), "A sheet without Class/Subject/Start/End columns is refused with the expected columns listed");

  const teacherImport = await importPost(req(T_ESHA, "http://x/api/timetable/import", "POST", form({ action: "preview", file: csvFile() })));
  assert(teacherImport.status === 403, "A teacher cannot use the timetable import (403)");
  const pv = await importPost(req(ADMIN, "http://x/api/timetable/import", "POST", form({ action: "preview", file: csvFile() })));
  const pvJson = await json(pv);
  assert(pv.status === 200 && pvJson.mode === "structured" && pvJson.rows.length === 3, "Admin preview reads 3 rows from the CSV");
  assert(pvJson.rows.every((r: any) => r.classId && r.subjectId && r.teacherId && r.days.length === 4 && r.issues.length === 0), "All CSV rows matched to real records, Mon–Thu, no issues");
  assert((await getTimetableServer(A)).length === 0, "Preview saves nothing");

  const commit = (rows: any[], extra: Record<string, string> = {}) =>
    importPost(req(ADMIN, "http://x/api/timetable/import", "POST", form({ action: "commit", rows: JSON.stringify(rows), title: "Week plan", source: "csv", fileName: "week.csv", ...extra })));
  const badRows = pvJson.rows.map((r: any, i: number) => (i === 0 ? { ...r, endTime: "07:00" } : r));
  const badRes = await commit(badRows);
  const badJson = await json(badRes);
  assert(badRes.status === 422 && badJson.rowErrors?.[0]?.key === pvJson.rows[0].key, "An invalid time range is refused (422) with the row identified; nothing saved");
  assert((await getTimetableServer(A)).length === 0, "No partial import after a refused commit");

  const clashRows = pvJson.rows.map((r: any, i: number) => (i === 2 ? { ...r, startTime: "07:50", endTime: "08:30" } : r));
  const clashRes = await commit(clashRows);
  assert(clashRes.status === 409 && /already scheduled/.test(JSON.stringify(await json(clashRes))), "Two imported periods of the same class that overlap are reported as a clash (409)");

  const okRes = await commit(pvJson.rows);
  const okJson = await json(okRes);
  assert(okRes.status === 201 && okJson.created === 12, "Commit saves 12 periods (3 rows × Mon–Thu)");
  const listed = await json(await timetableGet(req(ADMIN, "http://x/api/timetable")));
  assert(listed.timetable?.length === 12 && listed.timetable.every((t: any) => t.importId === okJson.importId), "Imported periods appear in the existing timetable view, tagged with the import");
  const eshaView = await json(await timetableGet(req(T_ESHA, "http://x/api/timetable")));
  assert(eshaView.timetable?.length === 4 && eshaView.timetable.every((t: any) => t.subjectName === "Maths"), "The teacher's own timetable shows her imported periods");

  const again = await commit(pvJson.rows);
  assert(again.status === 409, "Importing the same timetable again clashes with the saved one (409) unless replace is chosen");
  const replaced = await commit(pvJson.rows, { replaceExisting: "true" });
  const replacedJson = await json(replaced);
  assert(replaced.status === 201 && replacedJson.replaced === 12 && (await getTimetableServer(A)).length === 12, "'Replace existing' swaps the periods of those classes/days without duplicates");

  // ======================================================================
  // 4. Edit and delete individual periods; delete an import
  // ======================================================================
  const slot = (await getTimetableServer(A)).find((t) => t.classId === oneA.id && t.subjectId === maths1a.id && t.dayOfWeek === "Monday")!;
  const edit = await timetablePut(req(ADMIN, "http://x/api/timetable", "PUT", {
    id: slot.id, classId: oneA.id, subjectId: maths1a.id, teacherId: "tch-ti-tehreem", dayOfWeek: "Monday", periodName: "Period 1", startTime: "07:45", endTime: "08:20",
  }));
  assert(edit.status === 200, "Admin edits an imported period (teacher + start time)");
  const reloaded = (await getTimetableServer(A)).find((t) => t.id === slot.id)!;
  assert(reloaded.teacherId === "tch-ti-tehreem" && reloaded.startTime === "07:45", "The edit persists (teacher and time changed after reload)");
  const badEdit = await timetablePut(req(ADMIN, "http://x/api/timetable", "PUT", { ...reloaded, startTime: "09:00", endTime: "08:00" }));
  assert(badEdit.status === 400, "Editing to an invalid time range is refused");
  assert((await timetablePut(req(T_ESHA, "http://x/api/timetable", "PUT", { ...reloaded }))).status === 403, "A teacher cannot edit timetable periods");
  const del = await timetableDelete(req(ADMIN, `http://x/api/timetable?id=${encodeURIComponent(slot.id)}`, "DELETE"));
  assert(del.status === 200 && (await getTimetableServer(A)).length === 11, "Admin deletes a single period");

  const delImport = await importDelete(req(ADMIN, `http://x/api/timetable/import?id=${replacedJson.importId}`, "DELETE"));
  const delImportJson = await json(delImport);
  assert(delImport.status === 200 && delImportJson.removedPeriods === 11 && (await getTimetableServer(A)).length === 0, "Deleting an import removes exactly its periods");
  assert((await importDelete(req(ADMIN_B, `http://x/api/timetable/import?id=${okJson.importId}`, "DELETE"))).status === 404, "Another school's admin cannot see or delete this school's imports");

  // ======================================================================
  // 5. Image fallback (no reader configured)
  // ======================================================================
  delete process.env.ANTHROPIC_API_KEY;
  const pngFile = () => new File([PNG], "timetable.png", { type: "image/png" });
  const imgPreview = await json(await importPost(req(ADMIN, "http://x/api/timetable/import", "POST", form({ action: "preview", file: pngFile() }))));
  assert(imgPreview.mode === "image-only" && imgPreview.rows.length === 0 && imgPreview.extractionAvailable === false, "Without the reader, an image preview offers the image fallback (no invented periods)");
  const saved = await importPost(req(ADMIN, "http://x/api/timetable/import", "POST", form({ action: "image", file: pngFile(), title: "Term 1 timetable" })));
  const savedJson = await json(saved);
  assert(saved.status === 201 && savedJson.import?.kind === "IMAGE" && savedJson.import?.fileUrl && savedJson.import?.slotCount === 0, "Image saved as an IMAGE timetable with its file reference");
  const fake1 = new File([Buffer.from("<svg onload=alert(1)>")], "x.png", { type: "image/png" });
  assert((await importPost(req(ADMIN, "http://x/api/timetable/import", "POST", form({ action: "image", file: fake1 })))).status === 400, "A non-image disguised as .png is refused (content sniffing)");
  const adminList = await json(await importGet(req(ADMIN, "http://x/api/timetable/import")));
  assert(adminList.imports?.some((i: any) => i.id === savedJson.import.id && i.kind === "IMAGE"), "Admin sees the image timetable");
  const teacherList = await json(await importGet(req(T_ESHA, "http://x/api/timetable/import")));
  assert(teacherList.imports?.length === 1 && teacherList.imports[0].kind === "IMAGE" && teacherList.imports[0].createdBy === undefined, "Teacher sees only image timetables, with minimal fields");
  assert((await json(await importGet(req(ADMIN_B, "http://x/api/timetable/import")))).imports.length === 0, "Image timetables stay inside their school");
  const replacedImg = await importPost(req(ADMIN, "http://x/api/timetable/import", "POST", form({ action: "image", file: pngFile(), replaceId: savedJson.import.id })));
  const replacedImgJson = await json(replacedImg);
  assert(replacedImg.status === 200 && replacedImgJson.import.id === savedJson.import.id && replacedImgJson.import.title === "Term 1 timetable" && replacedImgJson.import.storagePath !== undefined, "Replacing the image keeps the same timetable record and title");
  assert((await importDelete(req(T_ESHA, `http://x/api/timetable/import?id=${savedJson.import.id}`, "DELETE"))).status === 403, "A teacher cannot delete an image timetable");
  assert((await importDelete(req(ADMIN, `http://x/api/timetable/import?id=${savedJson.import.id}`, "DELETE"))).status === 200, "Admin deletes the image timetable");
  assert((await json(await importGet(req(ADMIN, "http://x/api/timetable/import")))).imports.every((i: any) => i.id !== savedJson.import.id), "Deleted image timetable is gone");

  // ======================================================================
  // 6. Student phone numbers
  // ======================================================================
  const enrol = (body: Record<string, unknown>) => studentsPost(req(ADMIN, "http://x/api/students", "POST", body));
  const base = { gender: "Male", guardianName: "Guardian", guardianPhone: "03001112222", guardianRelation: "Father" };
  const withPhone = await json(await enrol({ ...base, classId: oneA.id, firstName: "Ali", lastName: "Raza", contactNumber: "0345 1234567" }));
  const noPhone = await json(await enrol({ ...base, classId: oneA.id, firstName: "Omar", lastName: "Tariq" }));
  const otherClass = await json(await enrol({ ...base, classId: oneB.id, firstName: "Zain", lastName: "Ali", contactNumber: "0300 9999999" }));
  const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
  const view = async (token: string, id: string) => (await json(await studentGet(req(token, `http://x/api/students/${id}`), idParams(id)))).student;
  assert((await view(ADMIN, withPhone.student.id))?.contactNumber === "0345 1234567", "A real student phone number is saved at enrolment and returned");
  assert(!(await view(ADMIN, noPhone.student.id))?.contactNumber, "No phone given → none stored (the guardian's number is no longer copied in as the student's)");
  await studentPut(req(ADMIN, `http://x/api/students/${noPhone.student.id}`, "PUT", { contactNumber: "0333 7654321" }), idParams(noPhone.student.id));
  assert((await view(ADMIN, noPhone.student.id))?.contactNumber === "0333 7654321", "Phone added later persists after reload");
  await studentPut(req(ADMIN, `http://x/api/students/${noPhone.student.id}`, "PUT", { address: "House 2" }), idParams(noPhone.student.id));
  assert((await view(ADMIN, noPhone.student.id))?.contactNumber === "0333 7654321", "Editing other fields keeps the phone");
  await studentPut(req(ADMIN, `http://x/api/students/${noPhone.student.id}`, "PUT", { contactNumber: "" }), idParams(noPhone.student.id));
  assert(!(await view(ADMIN, noPhone.student.id))?.contactNumber, "Clearing the phone removes it (shows 'Not provided')");

  const eshaList = await json(await studentsGet(req(T_ESHA, `http://x/api/students?classId=${oneA.id}`)));
  assert(eshaList.students?.some((s: any) => s.id === withPhone.student.id && s.contactNumber === "0345 1234567"), "Class incharge sees the phone numbers of her class's students");
  const eshaAll = await json(await studentsGet(req(T_ESHA, "http://x/api/students")));
  assert(eshaAll.students?.every((s: any) => s.classId === oneA.id) && !eshaAll.students.some((s: any) => s.id === otherClass.student.id), "Without a class filter the teacher still only gets her own classes' students");
  assert((await studentsGet(req(T_ESHA, `http://x/api/students?classId=${oneB.id}`))).status === 403, "A teacher cannot list another class's students (and their phone numbers)");
  assert((await studentGet(req(T_ESHA, `http://x/api/students/${otherClass.student.id}`), idParams(otherClass.student.id))).status === 403, "A teacher cannot open an unrelated student's record");
  assert((await studentsGet(req(null, "http://x/api/students"))).status === 401, "Student contact details are never served without a session");

  // ======================================================================
  // 7. Admin display name
  // ======================================================================
  await createUserServer({ uid: "uid-ti-admin", email: "uid-ti-admin@x.edu", name: "Old Name", role: "ADMIN", schoolId: A, status: "ACTIVE", createdAt: now, updatedAt: now });
  const before = await loadAdminShellData(A, "uid-ti-admin");
  assert(before.userName === "Old Name", "Admin shell reads the display name from the stored profile");
  const profile = await getUserByIdServer("uid-ti-admin");
  await updateUserServer({ ...profile!, name: "Chaudhary Umar Rafique" });
  const after = await loadAdminShellData(A, "uid-ti-admin");
  const afterProfile = await getUserByIdServer("uid-ti-admin");
  assert(after.userName === "Chaudhary Umar Rafique", "After the rename the sidebar shows 'Chaudhary Umar Rafique' (no re-login needed)");
  assert(afterProfile?.uid === "uid-ti-admin" && afterProfile?.email === "uid-ti-admin@x.edu" && afterProfile?.role === "ADMIN" && afterProfile?.schoolId === A, "UID, email, role and school are unchanged by the rename");
  const dash = await json(await dashboardGet(req(ADMIN, "http://x/api/dashboard")));
  assert(dash.viewer?.name === "Chaudhary Umar Rafique", "Dashboard greeting uses the stored name");

  console.log(`\nTimetable import / phone / admin name: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
