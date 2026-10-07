/**
 * Teacher allocation / attendance / timetable / account activation verification.
 * Runs against the in-memory store (no Firebase credentials are loaded by tsx), like the other
 * suites in this folder.
 */
import { NextRequest } from "next/server";
import { GET as subjectsGet, DELETE as subjectsDelete } from "../src/app/api/subjects/route";
import { GET as classesGet } from "../src/app/api/classes/route";
import { GET as studentsGet } from "../src/app/api/students/route";
import { GET as attendanceGet, POST as attendancePost } from "../src/app/api/attendance/route";
import {
  GET as timetableGet,
  POST as timetablePost,
  PUT as timetablePut,
  DELETE as timetableDelete,
} from "../src/app/api/timetable/route";
import { POST as teachersPost } from "../src/app/api/teachers/route";
import { POST as activationPost } from "../src/app/api/teachers/[id]/activation/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as forgotPost } from "../src/app/api/auth/forgot-password/route";
import { POST as resetPost } from "../src/app/api/auth/reset-password/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  createUserServer,
  getAttendanceServer,
  getPasswordResetTokenServer,
  getStudentAttendanceServer,
  getTimetableServer,
  getUserByEmailServer,
  savePasswordResetTokenServer,
  saveClassServer,
  saveStudentServer,
  saveSubjectServer,
  saveTeacherServer,
  saveTimetableEntryServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { sendViaFirebaseAuth } from "../src/lib/email-service";
import { generateResetToken, hashResetToken } from "../src/lib/password-reset";
import { ClassDoc, StudentDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";

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
  const headers = new Headers({ "x-forwarded-for": `10.9.0.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

/** Runs `fn` while capturing console.warn, returning the dev-console link it printed (if any). */
async function captureDevLink(fn: () => Promise<Response>): Promise<{ res: Response; link: string | null }> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    const res = await fn();
    const line = lines.find((l) => l.includes("/reset-password?token="));
    return { res, link: line ? /(https?:\/\/\S+)/.exec(line)![1] : null };
  } finally {
    console.warn = orig;
  }
}
const tokenFromLink = (link: string | null) => (link ? new URL(link).searchParams.get("token") || "" : "");

async function run() {
  console.log("==================================================");
  console.log("TEACHER ALLOCATION / ATTENDANCE / TIMETABLE / ACTIVATION");
  console.log("==================================================");

  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const YEAR = "2026-2027";
  const A = "school-alloc-a";
  const B = "school-alloc-b";
  for (const schoolId of [A, B]) {
    await updateSchoolSettingsServer({
      id: schoolId, schoolId, schoolName: `School ${schoolId}`, campusName: "Main", motto: "", address: "",
      phone: "", email: `admin@${schoolId}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    });
  }

  // --- Fixture: School A — Class 8 and Class 9; Teacher T teaches Math in both and is incharge of
  // Class 9; Teacher E teaches English in Class 8. School B has its own class/subject. ---
  const cls = (id: string, schoolId: string, name: string, classTeacherId: string | null = null): ClassDoc => ({
    id, schoolId, name, section: "A", numericLevel: 8, capacity: 30, roomNo: `R-${id}`,
    classTeacherId, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const c8 = cls("cls-al-8", A, "Class 8");
  const c9 = cls("cls-al-9", A, "Class 9", "tch-al-t");
  const c7 = cls("cls-al-7", A, "Class 7");
  const cB = cls("cls-al-b8", B, "Class 8");
  for (const c of [c8, c9, c7, cB]) await saveClassServer(c);

  const subj = (id: string, schoolId: string, classId: string, name: string, teacherId: string | null): SubjectDoc => ({
    id, schoolId, classId, name, code: id.toUpperCase(), teacherId, credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const math8 = subj("sb-al-math8", A, c8.id, "Mathematics", "tch-al-t");
  const eng8 = subj("sb-al-eng8", A, c8.id, "English", "tch-al-e");
  const math9 = subj("sb-al-math9", A, c9.id, "Mathematics", "tch-al-t");
  const chem9 = subj("sb-al-chem9", A, c9.id, "Chemistry", null);
  const sci7 = subj("sb-al-sci7", A, c7.id, "Science", "tch-al-e");
  // A School B subject that (maliciously or by id collision) names School A's teacher id.
  const bSubj = subj("sb-al-bmath", B, cB.id, "Mathematics", "tch-al-t");
  for (const s of [math8, eng8, math9, chem9, sci7, bSubj]) await saveSubjectServer(s);

  const teacher = (id: string, schoolId: string, name: string, subjectIds: string[], classIds: string[]): TeacherDoc => ({
    id, schoolId, employeeId: id.toUpperCase(), fullName: name, email: `${id}@${schoolId}.edu`, phone: "0300",
    designation: "Teacher", department: "Science", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: classIds, assignedSubjectIds: subjectIds, weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  const tT = teacher("tch-al-t", A, "Teacher T", [math8.id, math9.id], [c8.id, c9.id]);
  const tE = teacher("tch-al-e", A, "Teacher E", [eng8.id, sci7.id], [c8.id, c7.id]);
  const tIdle = teacher("tch-al-idle", A, "Teacher Idle", [], []);
  const tB = teacher("tch-al-tb", B, "Teacher B", [], [cB.id]);
  for (const t of [tT, tE, tIdle, tB]) await saveTeacherServer(t);

  const student = (id: string, schoolId: string, classId: string): StudentDoc => ({
    id, schoolId, classId, admissionNo: id.toUpperCase(), rollNo: "1", fullName: `Student ${id}`, fatherName: "F",
    gender: "MALE", status: "ACTIVE", guardianName: "G", guardianRelation: "Father", guardianPhone: "0300",
    section: "A", monthlyFee: 0, discount: 0, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const s8 = student("std-al-8", A, c8.id);
  const s9 = student("std-al-9", A, c9.id);
  const s7 = student("std-al-7", A, c7.id);
  const sB = student("std-al-b", B, cB.id);
  for (const s of [s8, s9, s7, sB]) await saveStudentServer(s);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string, teacherId?: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, teacherId, name: uid });
  // Teacher T's session token deliberately carries NO teacherId: the server must resolve it from
  // the login profile (the session/profile relationship), not trust or require the token.
  await createUserServer({ uid: "uid-al-t", email: tT.email, name: tT.fullName, role: "TEACHER", schoolId: A, teacherId: tT.id, status: "ACTIVE", createdAt: now, updatedAt: now });
  const T = await session("uid-al-t", "TEACHER", A);
  const E = await session("uid-al-e", "TEACHER", A, tE.id);
  const IDLE = await session("uid-al-idle", "TEACHER", A, tIdle.id);
  const ORPHAN = await session("uid-al-orphan", "TEACHER", A); // no profile, no teacher record
  const ADMIN_A = await session("uid-al-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-al-admin-b", "ADMIN", B);
  const TB = await session("uid-al-tb", "TEACHER", B, tB.id);

  // ======================================================================
  // 1. TEACHER SUBJECTS
  // ======================================================================
  const tSubjects = await json(await subjectsGet(req(T, "http://x/api/subjects")));
  const tSubjectIds = (tSubjects.subjects || []).map((s: any) => s.id).sort();
  assert(tSubjectIds.join() === [math8.id, math9.id].sort().join(), "Teacher sees exactly their allocated subjects (Math 8, Math 9) — resolved without teacherId in the session");
  assert(!tSubjectIds.includes(eng8.id) && !tSubjectIds.includes(chem9.id), "Teacher does not see unallocated subjects (English 8, Chemistry 9)");
  assert(!tSubjectIds.includes(bSubj.id), "Teacher from School A never sees a School B subject, even one naming their teacher id");
  const tOverride = await json(await subjectsGet(req(T, `http://x/api/subjects?teacherId=${tE.id}`)));
  assert((tOverride.subjects || []).every((s: any) => s.teacherId === tT.id), "?teacherId= cannot be used by a teacher to list another teacher's subjects");
  const idleSubjects = await subjectsGet(req(IDLE, "http://x/api/subjects"));
  assert(idleSubjects.status === 200 && (await json(idleSubjects)).subjects.length === 0, "Teacher with no allocation gets an empty subject list, not the whole school");
  assert((await subjectsGet(req(ORPHAN, "http://x/api/subjects"))).status === 403, "Teacher session with no teacher record is rejected (fail closed)");
  const adminSubjects = await json(await subjectsGet(req(ADMIN_A, "http://x/api/subjects")));
  assert(adminSubjects.subjects.length === 5 && !adminSubjects.subjects.some((s: any) => s.schoolId === B), "Admin sees all 5 of their own school's subjects, none of School B's");

  const tClasses = await json(await classesGet(req(T, "http://x/api/classes")));
  const c8View = tClasses.classes.find((c: any) => c.id === c8.id);
  const c9View = tClasses.classes.find((c: any) => c.id === c9.id);
  assert(tClasses.classes.length === 2 && !tClasses.classes.some((c: any) => c.id === c7.id), "Teacher's class list holds only their allocated classes (8, 9), not Class 7");
  assert(c8View?.subjects.map((s: any) => s.id).join() === math8.id && c8View.isIncharge === false, "Class 8 lists only the teacher's own subject (Math), not English; not incharge");
  assert(c9View?.isIncharge === true && c9View.subjects.map((s: any) => s.id).join() === math9.id, "Class 9 marks the teacher as incharge and lists only Math");
  const idleClasses = await json(await classesGet(req(IDLE, "http://x/api/classes")));
  assert(idleClasses.classes.length === 0, "Teacher with no allocation sees no classes (previously: every class in the school)");
  const idleStudents = await json(await studentsGet(req(IDLE, "http://x/api/students")));
  assert(idleStudents.students.length === 0, "Teacher with no allocation sees no students (previously: the whole school roster)");

  // ======================================================================
  // 2. ATTENDANCE — class + subject registers
  // ======================================================================
  const att = (token: string, classId: string, subjectId?: string) =>
    attendanceGet(req(token, `http://x/api/attendance?classId=${classId}&date=${today}${subjectId ? `&subjectId=${subjectId}` : ""}`));
  const mark = (token: string, classId: string, studentId: string, status: string, subjectId?: string) =>
    attendancePost(req(token, "http://x/api/attendance", "POST", {
      classId, date: today, ...(subjectId ? { subjectId } : {}), records: [{ studentId, status }],
    }));

  // Attendance is class-incharge-only: teaching a subject in a class grants no attendance access
  // (not even to that subject's register). T is incharge of Class 9 only.
  assert((await att(T, c8.id, math8.id)).status === 403, "Subject teacher cannot open their own Class 8 Mathematics register (not the incharge)");
  assert((await att(T, c7.id, sci7.id)).status === 403, "Teacher cannot open another class's register (Class 7)");
  assert((await att(T, c8.id, eng8.id)).status === 403, "Teacher cannot open another subject's register in their own class (Class 8 English)");
  const inchargeChem = await att(T, c9.id, chem9.id);
  assert(inchargeChem.status === 200 && (await json(inchargeChem)).subjectId === chem9.id, "Class incharge may open any subject register of their own class (Class 9 Chemistry)");
  assert((await att(T, c8.id, math9.id)).status === 403, "Teacher cannot pair their own subject with a different class (Math 9 id on Class 8)");
  assert((await att(T, c8.id)).status === 403, "Non-incharge teacher cannot open Class 8's daily register");
  assert((await att(T, c9.id)).status === 200, "Class incharge opens Class 9's daily register");
  assert((await att(T, cB.id, bSubj.id)).status === 403, "Cross-school register request is rejected");
  assert((await att(IDLE, c8.id, math8.id)).status === 403, "Teacher with no allocation is rejected for any register");
  assert((await att(ORPHAN, c8.id, math8.id)).status === 403, "Teacher session without a teacher record is rejected for attendance");

  assert((await mark(T, c8.id, s8.id, "PRESENT", math8.id)).status === 403, "Subject teacher's direct POST to their Class 8 Mathematics register is rejected");
  assert((await mark(T, c7.id, s7.id, "PRESENT", sci7.id)).status === 403, "Direct API POST with another classId is rejected");
  assert((await mark(T, c8.id, s8.id, "PRESENT", eng8.id)).status === 403, "Direct API POST with another subjectId is rejected");
  assert((await mark(T, c8.id, s8.id, "PRESENT")).status === 403, "Direct API POST to a daily register they are not incharge of is rejected");
  const crossPost = await mark(T, cB.id, sB.id, "PRESENT", bSubj.id);
  assert(crossPost.status === 404 || crossPost.status === 403, "Cross-school attendance POST is rejected");
  assert((await mark(E, c8.id, s8.id, "ABSENT", eng8.id)).status === 403, "English subject teacher's direct POST to Class 8 English register is rejected");
  assert((await mark(T, c9.id, s9.id, "LATE")).status === 200, "Class incharge marks Class 9's daily register");
  assert((await mark(T, c9.id, s9.id, "PRESENT", math9.id)).status === 200, "Class incharge marks a subject register of their class (Class 9 Mathematics)");
  assert((await mark(ADMIN_A, c9.id, s9.id, "ABSENT", chem9.id)).status === 200, "Admin marks another subject register (Class 9 Chemistry)");
  assert((await getAttendanceServer(A, today, c8.id, undefined, undefined, undefined, "ALL")).length === 0, "No Class 8 attendance was written by any subject teacher");

  const mathRecords = await getAttendanceServer(A, today, c9.id, undefined, undefined, undefined, { subjectId: math9.id });
  const chemRecords = await getAttendanceServer(A, today, c9.id, undefined, undefined, undefined, { subjectId: chem9.id });
  assert(mathRecords.length === 1 && mathRecords[0].status === "PRESENT" && mathRecords[0].subjectId === math9.id, "Math register stores its own record, tagged with the subject");
  assert(chemRecords.length === 1 && chemRecords[0].status === "ABSENT" && chemRecords[0].id !== mathRecords[0].id, "Chemistry register is a separate record for the same student/day");
  const tMathView = await json(await att(T, c9.id, math9.id));
  assert(tMathView.roster[0].status === "PRESENT" && tMathView.savedCount === 1, "Math register response contains only Math data (not the Chemistry ABSENT)");
  const dailyC9 = await getAttendanceServer(A, today, c9.id);
  assert(dailyC9.length === 1 && dailyC9[0].status === "LATE", "Class 9 daily register holds only its own record, untouched by subject registers");
  assert((await getStudentAttendanceServer(A, s9.id)).length === 1, "Student/parent attendance figures (daily register) don't double-count subject registers");
  const adminChem = await json(await att(ADMIN_A, c9.id, chem9.id));
  assert(adminChem.success && adminChem.roster[0].status === "ABSENT", "Admin can view any subject register of their school");
  assert((await att(ADMIN_A, c8.id, math9.id)).status === 404, "Admin request pairing a subject with the wrong class is rejected");
  assert((await att(ADMIN_B, c8.id, math8.id)).status === 404, "Other school's admin cannot open this school's subject register");
  const delWithHistory = await subjectsDelete(req(ADMIN_A, `http://x/api/subjects?id=${math9.id}`, "DELETE"));
  assert(delWithHistory.status === 409, "Subject with subject-attendance history cannot be deleted");

  // ======================================================================
  // 3. TIMETABLE — admin CRUD + teacher visibility
  // ======================================================================
  const slotBody = { classId: c8.id, subjectId: math8.id, dayOfWeek: "Monday", periodName: "Period 1", startTime: "08:00", endTime: "08:45", roomNo: "R-1" };
  const created = await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", slotBody));
  const createdJson = await json(created);
  const slotId = createdJson.id;
  assert(created.status === 201 && createdJson.timetable.teacherId === tT.id && createdJson.timetable.className === "Class 8-A", "Admin creates a slot; teacher defaults to the subject's allocated teacher; names come from records");
  const engSlot = await json(await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, subjectId: eng8.id, startTime: "09:00", endTime: "09:45", roomNo: "R-2" })));
  const sci7Slot = await json(await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, classId: c7.id, subjectId: sci7.id, dayOfWeek: "Tuesday", roomNo: "R-3" })));
  assert(engSlot.id && sci7Slot.id, "Admin creates more slots for other teachers");
  assert((await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, roomNo: "R-9" }))).status === 409, "Clash: the same class/teacher can't be double-booked at the same time");
  assert((await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, classId: c9.id, subjectId: math9.id, roomNo: "R-9", startTime: "08:30", endTime: "09:15" }))).status === 409, "Clash: a teacher can't be in two classes at overlapping times");
  assert((await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, startTime: "10:00", endTime: "09:00" }))).status === 400, "End time before start time is rejected");
  assert((await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, subjectId: math9.id, startTime: "11:00", endTime: "11:45" }))).status === 404, "A subject from another class is rejected");
  assert((await timetablePost(req(ADMIN_A, "http://x/api/timetable", "POST", { ...slotBody, classId: cB.id, subjectId: bSubj.id }))).status === 404, "Admin cannot create a slot for another school's class");
  assert((await timetablePost(req(T, "http://x/api/timetable", "POST", { ...slotBody, startTime: "12:00", endTime: "12:45" }))).status === 403, "Teacher cannot create timetable slots");

  const adminView = await json(await timetableGet(req(ADMIN_A, "http://x/api/timetable")));
  assert(adminView.success && adminView.timetable.length === 3, "Admin views the full school timetable");
  const edited = await timetablePut(req(ADMIN_A, "http://x/api/timetable", "PUT", { ...slotBody, id: slotId, periodName: "Period 2", startTime: "10:00", endTime: "10:45", topic: "Fractions" }));
  const editedJson = await json(edited);
  assert(edited.status === 200 && editedJson.timetable.startTime === "10:00" && editedJson.timetable.topic === "Fractions", "Admin edits a slot");
  assert((await timetablePut(req(ADMIN_B, "http://x/api/timetable", "PUT", { ...slotBody, id: slotId }))).status === 404, "Another school's admin cannot edit this slot");
  assert((await timetablePut(req(T, "http://x/api/timetable", "PUT", { ...slotBody, id: slotId }))).status === 403, "Teacher cannot edit timetable slots");

  const tTimetable = await json(await timetableGet(req(T, "http://x/api/timetable")));
  assert(tTimetable.timetable.length === 1 && tTimetable.timetable[0].id === slotId && tTimetable.timetable[0].periodName === "Period 2", "Teacher sees their own (edited) timetable slot");
  const tSpoof = await json(await timetableGet(req(T, `http://x/api/timetable?teacherId=${tE.id}`)));
  assert(tSpoof.timetable.every((t: any) => t.teacherId === tT.id), "Teacher cannot see another teacher's timetable via ?teacherId=");
  assert((await timetableGet(req(T, `http://x/api/timetable?classId=${c7.id}`))).status === 403, "Teacher cannot filter the timetable by a class they don't teach");
  assert((await timetableGet(req(ORPHAN, "http://x/api/timetable"))).status === 403, "Teacher session without a teacher record gets 403 (previously: the whole school's timetable)");
  const eTimetable = await json(await timetableGet(req(E, "http://x/api/timetable")));
  assert(eTimetable.timetable.length === 2 && eTimetable.timetable.every((t: any) => t.teacherId === tE.id), "Second teacher sees only their own two slots");
  const bTimetable = await json(await timetableGet(req(TB, "http://x/api/timetable")));
  const bAdminTimetable = await json(await timetableGet(req(ADMIN_B, "http://x/api/timetable")));
  assert(bTimetable.timetable.length === 0 && bAdminTimetable.timetable.length === 0, "Cross-school: School B teacher/admin see none of School A's timetable");

  assert((await timetableDelete(req(ADMIN_B, `http://x/api/timetable?id=${slotId}`, "DELETE"))).status === 404, "Another school's admin cannot delete this slot");
  assert((await timetableDelete(req(T, `http://x/api/timetable?id=${slotId}`, "DELETE"))).status === 403, "Teacher cannot delete timetable slots");
  const deleted = await timetableDelete(req(ADMIN_A, `http://x/api/timetable?id=${slotId}`, "DELETE"));
  assert(deleted.status === 200 && !(await getTimetableServer(A)).some((t) => t.id === slotId), "Admin deletes a slot");
  assert((await json(await timetableGet(req(T, "http://x/api/timetable")))).timetable.length === 0, "Deleted slot disappears from the teacher's timetable");

  // ======================================================================
  // 4. ACCOUNT ACTIVATION + PASSWORD RESET
  // ======================================================================
  const newEmail = "new.teacher@school-alloc-a.edu";
  const { res: createRes, link: activationLink } = await captureDevLink(() =>
    teachersPost(new NextRequest("http://x/api/teachers", {
      method: "POST",
      headers: { cookie: `allied_session=${ADMIN_A}`, "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ firstName: "Nadia", lastName: "Akhtar", email: newEmail, phone: "03001112222", joiningDate: "2026-09-01" }),
    }))
  );
  const createJson = await json(createRes);
  assert(createRes.status === 201 && createJson.activation?.email === newEmail, "Admin creates a teacher; response reports the activation email");
  assert(!("temporaryPassword" in createJson) && !JSON.stringify(createJson).toLowerCase().includes("password\":"), "No password is generated or returned to the admin");
  const activationToken = tokenFromLink(activationLink);
  assert(activationLink?.includes("purpose=activate") && /^[A-Za-z0-9_-]{43}$/.test(activationToken), "Activation email carries a single-use 256-bit set-password link");
  const tokenRecord = await getPasswordResetTokenServer(hashResetToken(activationToken));
  assert(tokenRecord?.purpose === "ACTIVATION" && tokenRecord.id !== activationToken && Date.parse(tokenRecord.expiresAt) - Date.now() > 70 * 3600 * 1000, "Only the token hash is stored, marked ACTIVATION with a ~72h lifetime");
  const newProfile = await getUserByEmailServer(newEmail);
  assert(newProfile && !newProfile.passwordHash && !JSON.stringify(newProfile).includes("Teacher@"), "Teacher profile holds no password (plaintext or hash) before activation");

  const loginBefore = await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: newEmail, password: "Whatever#123" }));
  assert(loginBefore.status === 401, "Teacher cannot sign in before setting a password");
  const activated = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: activationToken, newPassword: "MyOwnPass#2026" }));
  const activatedJson = await json(activated);
  assert(activated.status === 200 && /active/i.test(activatedJson.message), "Teacher sets their own password through the activation link");
  const activatedProfile = await getUserByEmailServer(newEmail);
  assert(activatedProfile?.passwordHash?.startsWith("$2") && !JSON.stringify(activatedProfile).includes("MyOwnPass#2026"), "Only a bcrypt hash of the chosen password is stored");
  const loginAfter = await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: newEmail, password: "MyOwnPass#2026" }));
  assert(loginAfter.status === 200 && (await json(loginAfter)).redirectUrl === "/teacher", "Activated teacher signs in and lands on the teacher portal");
  const reuse = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: activationToken, newPassword: "Again#Pass99" }));
  assert(reuse.status === 400 && (await json(reuse)).code === "USED", "Activation link cannot be used twice");

  const newTeacherId = createJson.teacher.id;
  const { res: resendRes, link: resendLink } = await captureDevLink(() =>
    activationPost(req(ADMIN_A, `http://x/api/teachers/${newTeacherId}/activation`, "POST"), { params: Promise.resolve({ id: newTeacherId }) })
  );
  assert(resendRes.status === 200 && tokenFromLink(resendLink).length === 43, "Admin can re-send the activation email");
  assert((await activationPost(req(ADMIN_B, `http://x/api/teachers/${newTeacherId}/activation`, "POST"), { params: Promise.resolve({ id: newTeacherId }) })).status === 404, "Another school's admin cannot send this teacher's activation email");
  assert((await activationPost(req(T, `http://x/api/teachers/${newTeacherId}/activation`, "POST"), { params: Promise.resolve({ id: newTeacherId }) })).status === 403, "A teacher cannot trigger activation emails");

  const expired = generateResetToken();
  await savePasswordResetTokenServer({ id: expired.tokenHash, purpose: "ACTIVATION", uid: newProfile!.uid, email: newEmail, schoolId: A, expiresAt: new Date(Date.now() - 1000).toISOString(), usedAt: null, createdAt: now });
  const expiredRes = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: expired.token, newPassword: "Expired#Pass1" }));
  assert(expiredRes.status === 400 && (await json(expiredRes)).code === "EXPIRED", "Expired activation/reset link is rejected safely");
  const invalidRes = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: "not-a-real-token", newPassword: "Invalid#Pass1" }));
  assert(invalidRes.status === 400 && (await json(invalidRes)).code === "INVALID", "Malformed reset link is rejected safely");
  const badOob = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { oobCode: "bogus-code-123456", newPassword: "Invalid#Pass1" }));
  assert(badOob.status === 400 && (await json(badOob)).code === "INVALID", "Firebase action code that can't be verified is rejected safely");

  const { res: forgotRes, link: resetLink } = await captureDevLink(() =>
    forgotPost(new NextRequest("http://x/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.1", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: newEmail }),
    }))
  );
  const resetToken = tokenFromLink(resetLink);
  assert(forgotRes.status === 200 && resetToken.length === 43 && !resetLink!.includes("purpose="), "Forgot Password issues a reset link for the account's email");
  assert((await getPasswordResetTokenServer(hashResetToken(resendLink ? tokenFromLink(resendLink) : ""))) === null, "Issuing a reset link invalidates the earlier activation link");
  const resetRes = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: resetToken, newPassword: "Reset#Pass2026" }));
  assert(resetRes.status === 200, "Reset link changes the password");
  assert((await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: newEmail, password: "Reset#Pass2026" }))).status === 200, "Teacher signs in with the new password");
  assert((await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: newEmail, password: "MyOwnPass#2026" }))).status === 401, "Old password no longer works");

  // Firebase built-in email fallback (used when no Resend/SMTP is configured): request shape.
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const first = calls.length === 1;
    return new Response(JSON.stringify(first ? { error: { message: "UNAUTHORIZED_DOMAIN : Domain not allowlisted" } } : { email: "x" }), { status: first ? 400 : 200 });
  }) as typeof fetch;
  try {
    const err = await sendViaFirebaseAuth("teacher@x.edu", "https://school.example.com/login", { NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaTestKey" });
    assert(
      err === null && calls.length === 2 && calls[0].url.includes("accounts:sendOobCode") &&
        calls[0].body.requestType === "PASSWORD_RESET" && calls[0].body.email === "teacher@x.edu" &&
        calls[0].body.continueUrl === "https://school.example.com/login" && !("continueUrl" in calls[1].body),
      "Firebase fallback sends PASSWORD_RESET via sendOobCode, retrying without continueUrl when the domain isn't authorized"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert((await sendViaFirebaseAuth("t@x.edu", null, {})) !== null, "Firebase fallback reports failure (not success) when no API key is configured");

  console.log("==================================================");
  console.log(`ALLOCATION/TIMETABLE/AUTH SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
