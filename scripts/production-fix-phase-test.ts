/**
 * Targeted regression tests for the consolidated production fix phase:
 * password reset, session sliding/revocation, attendance, teacher delete/recreate, subjects,
 * date validation and bulk student import. Runs the real route handlers against the in-memory
 * data store (no Firebase credentials are loaded by tsx).
 */
import zlib from "zlib";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { POST as forgotPost } from "../src/app/api/auth/forgot-password/route";
import { POST as resetPost } from "../src/app/api/auth/reset-password/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as changePasswordPost } from "../src/app/api/auth/change-password/route";
import { GET as attendanceGet, POST as attendancePost } from "../src/app/api/attendance/route";
import { GET as subjectsGet, POST as subjectsPost } from "../src/app/api/subjects/route";
import { POST as teachersPost } from "../src/app/api/teachers/route";
import { DELETE as teacherDelete } from "../src/app/api/teachers/[id]/route";
import { POST as studentsPost } from "../src/app/api/students/route";
import { POST as feesPost } from "../src/app/api/fees/route";
import { POST as importPost } from "../src/app/api/students/import/route";
import { middleware } from "../src/middleware";
import { createSessionCookieServer, getAuthenticatedUser } from "../src/lib/firebase/server-auth";
import {
  createUserServer,
  deleteTeacherServer,
  getAttendanceServer,
  getClassByIdServer,
  getStudentsServer,
  getSubjectByIdServer,
  getTeacherByIdServer,
  getTeachersServer,
  getUserByEmailServer,
  getUserByIdServer,
  saveAttendanceRecordServer,
  saveClassServer,
  savePasswordResetTokenServer,
  saveStudentServer,
  saveTimetableEntryServer,
  getTimetableServer,
  STUDENT_IMPORT_BATCH_SIZE,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { generateResetToken, resolveAppBaseUrl } from "../src/lib/password-reset";
import { getEmailConfigStatus } from "../src/lib/email-service";
import { formatDisplayDate, todayLocalISO, validateStudentDates } from "../src/lib/date-utils";
import { parseImportDate, normalizePhone } from "../src/lib/student-import";
import { parseCsv, parseXlsx } from "../src/lib/spreadsheet-parser";
import bcrypt from "bcryptjs";
import type { ClassDoc, SchoolSettingsDoc, StudentDoc, TeacherDoc } from "../src/lib/firebase/types";

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

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

function uploadReq(token: string, name: string, content: Buffer | string, type: string) {
  const fd = new FormData();
  fd.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type }), name);
  // Request derives the multipart content-type (with boundary) from the FormData body.
  return new NextRequest("http://x/api/students/import", { method: "POST", headers: { cookie: `allied_session=${token}` }, body: fd });
}

/** Minimal STORED+DEFLATE zip writer for building a real .xlsx in-memory (CRC not checked by the reader). */
function buildXlsx(rows: (string | number)[][]): Buffer {
  const shared: string[] = [];
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sheetRows = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          shared.push(v);
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

async function run() {
  console.log("==================================================");
  console.log("PRODUCTION FIX PHASE — TARGETED TESTS");
  console.log("==================================================");

  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const YEAR = "2026-2027";
  const schoolA = "school-fix-a";
  const schoolB = "school-fix-b";

  for (const schoolId of [schoolA, schoolB]) {
    const settings: SchoolSettingsDoc = {
      id: schoolId, schoolId, schoolName: `Fix School ${schoolId}`, campusName: "Main", motto: "", address: "",
      phone: "", email: `office@${schoolId}.edu`, principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
    };
    await updateSchoolSettingsServer(settings);
  }

  const classA5: ClassDoc = { id: "cls-fix-a-5a", schoolId: schoolA, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now };
  const classA5b: ClassDoc = { ...classA5, id: "cls-fix-a-5b", section: "B" };
  const classA6: ClassDoc = { ...classA5, id: "cls-fix-a-6a", name: "Class 6", numericLevel: 6 };
  const classB5: ClassDoc = { ...classA5, id: "cls-fix-b-5a", schoolId: schoolB };
  for (const c of [classA5, classA5b, classA6, classB5]) await saveClassServer(c);

  const adminA = await createSessionCookieServer({ uid: "uid-fix-admin-a", email: "admin@school-fix-a.edu", role: "ADMIN", schoolId: schoolA, name: "Admin A" });
  const adminB = await createSessionCookieServer({ uid: "uid-fix-admin-b", email: "admin@school-fix-b.edu", role: "ADMIN", schoolId: schoolB, name: "Admin B" });

  // ===========================================================================
  // 4. SESSION / SUBJECT AUTHORIZATION
  // ===========================================================================
  const apiReq = new NextRequest("http://x/api/subjects", { method: "POST", headers: { cookie: `allied_session=${adminA}` } });
  const mwApi = await middleware(apiReq);
  assert(/allied_session=/.test(mwApi.headers.get("set-cookie") || ""), "Middleware refreshes the idle session on authenticated API calls");
  const mwLogout = await middleware(new NextRequest("http://x/api/auth/logout", { method: "POST", headers: { cookie: `allied_session=${adminA}` } }));
  assert(!/allied_session=/.test(mwLogout.headers.get("set-cookie") || ""), "Middleware leaves /api/auth/* cookies to the route handlers");
  const mwAnon = await middleware(new NextRequest("http://x/api/subjects", { method: "POST" }));
  assert(!/allied_session=/.test(mwAnon.headers.get("set-cookie") || ""), "Middleware never issues a session to an unauthenticated API call");

  const teacherA: TeacherDoc = {
    id: "tch-fix-a-1", schoolId: schoolA, employeeId: "TCH-101", fullName: "Sana Teacher", email: "sana@school-fix-a.edu",
    phone: "03001234567", designation: "Teacher", department: "Math", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [classA5.id], assignedSubjectIds: [], weeklyLoad: 20, joiningDate: "2024-08-01", createdAt: now, updatedAt: now,
  };
  const { saveTeacherServer } = await import("../src/lib/firebase/server-db");
  await saveTeacherServer(teacherA);
  await createUserServer({ uid: "uid-fix-teacher-a", email: teacherA.email, name: teacherA.fullName, role: "TEACHER", schoolId: schoolA, teacherId: teacherA.id, status: "ACTIVE", createdAt: now, updatedAt: now });
  const teacherTokenA = await createSessionCookieServer({ uid: "uid-fix-teacher-a", email: teacherA.email, role: "TEACHER", schoolId: schoolA, teacherId: teacherA.id, name: teacherA.fullName });

  const mathBody = { name: "Math", code: "MATH-01", classId: classA5.id, teacherId: teacherA.id };
  const subjRes = await subjectsPost(req(adminA, "http://x/api/subjects", "POST", mathBody));
  const subjJson = await subjRes.json();
  assert(subjRes.status === 201 && subjJson.subject?.code === "MATH-01", "Authenticated admin creates subject Math / MATH-01");
  const listed = await (await subjectsGet(req(adminA, `http://x/api/subjects?classId=${classA5.id}`))).json();
  assert(listed.subjects?.some((s: any) => s.code === "MATH-01" && s.teacherId === teacherA.id), "Subject persists after refresh (GET) with its target class and teacher");
  const syncedTeacher = await getTeacherByIdServer(schoolA, teacherA.id);
  assert(syncedTeacher?.assignedSubjectIds.includes(subjJson.subject.id), "Subject assignment synced to the teacher record");

  const anon = await subjectsPost(req(null, "http://x/api/subjects", "POST", { ...mathBody, name: "Physics" }));
  assert(anon.status === 401, "Unauthenticated subject creation is blocked (401)");
  const asTeacher = await subjectsPost(req(teacherTokenA, "http://x/api/subjects", "POST", { ...mathBody, name: "Physics" }));
  assert(asTeacher.status === 403, "Teacher cannot create subjects (403)");
  const expired = await new SignJWT({ uid: "uid-fix-admin-a", role: "ADMIN", schoolId: schoolA, email: "a", name: "A" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300)
    .sign(new TextEncoder().encode("allied-school-dev-only-local-secret-key-32-chars-min"));
  const expiredRes = await subjectsPost(req(expired, "http://x/api/subjects", "POST", { ...mathBody, name: "Physics" }));
  assert(expiredRes.status === 401 && (await expiredRes.json()).sessionExpired === true, "Expired session is rejected with a clear session-expired 401");
  const crossSchool = await subjectsPost(req(adminB, "http://x/api/subjects", "POST", { ...mathBody, name: "Chemistry" }));
  assert(crossSchool.status === 404, "School B admin cannot add a subject to School A's class");

  // ===========================================================================
  // 2. ATTENDANCE
  // ===========================================================================
  const stuA1 = { id: "std-fix-a-1", schoolId: schoolA, classId: classA5.id, className: "Class 5-A", admissionNo: "STD-2026-901", rollNo: "1", fullName: "Ayesha Noor", fatherName: "Noor Ahmed", gender: "FEMALE", status: "ACTIVE", guardianName: "Noor Ahmed", guardianRelation: "Father", guardianPhone: "03001112223", section: "A", monthlyFee: 0, discount: 0, academicYear: YEAR, createdAt: now, updatedAt: now } as StudentDoc;
  const stuA2 = { ...stuA1, id: "std-fix-a-2", admissionNo: "STD-2026-902", rollNo: "2", fullName: "Bilal Khan", fatherName: "Imran Khan", gender: "MALE" } as StudentDoc;
  const stuA6 = { ...stuA1, id: "std-fix-a-6", classId: classA6.id, className: "Class 6-A", admissionNo: "STD-2026-903" } as StudentDoc;
  for (const s of [stuA1, stuA2, stuA6]) await saveStudentServer(s);

  const before = await (await attendanceGet(req(teacherTokenA, `http://x/api/attendance?classId=${classA5.id}&date=${today}`))).json();
  assert(before.success && before.savedCount === 0 && before.roster.every((r: any) => r.saved === false), "Unsaved register is reported as not saved (defaults are not mistaken for saved data)");

  const markRes = await attendancePost(req(teacherTokenA, "http://x/api/attendance", "POST", {
    classId: classA5.id, date: today, records: [{ studentId: stuA1.id, status: "PRESENT" }, { studentId: stuA2.id, status: "ABSENT" }],
  }));
  assert(markRes.status === 200 && (await markRes.json()).saved === 2, "Teacher marks attendance for assigned class (create)");
  const refreshed = await (await attendanceGet(req(teacherTokenA, `http://x/api/attendance?classId=${classA5.id}&date=${today}`))).json();
  const r2 = refreshed.roster.find((r: any) => r.studentId === stuA2.id);
  assert(refreshed.savedCount === 2 && r2.status === "ABSENT", "Attendance persists after refresh with the correct status");

  const updRes = await attendancePost(req(teacherTokenA, "http://x/api/attendance", "POST", {
    classId: classA5.id, date: today, records: [{ studentId: stuA2.id, status: "LATE" }],
  }));
  const recordsAfterUpdate = await getAttendanceServer(schoolA, today, classA5.id);
  assert(
    updRes.status === 200 && recordsAfterUpdate.filter((r) => r.studentId === stuA2.id).length === 1 &&
      recordsAfterUpdate.find((r) => r.studentId === stuA2.id)?.status === "LATE",
    "Re-saving the same date/class updates the existing record (no duplicate)"
  );
  assert(recordsAfterUpdate.every((r) => r.date === today), "Stored attendance date is exactly the selected date");

  const otherClass = await attendancePost(req(teacherTokenA, "http://x/api/attendance", "POST", {
    classId: classA6.id, date: today, records: [{ studentId: stuA6.id, status: "PRESENT" }],
  }));
  assert(otherClass.status === 403, "Teacher cannot mark attendance for a class not assigned to them");

  const badDate = await attendancePost(req(teacherTokenA, "http://x/api/attendance", "POST", {
    classId: classA5.id, date: "2026-02-31", records: [{ studentId: stuA1.id, status: "PRESENT" }],
  }));
  assert(badDate.status === 400, "Impossible attendance date (2026-02-31) is rejected");

  const rec = recordsAfterUpdate.find((r) => r.studentId === stuA1.id)!;
  await saveAttendanceRecordServer({ ...rec, createdAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  const lockedEdit = await attendancePost(req(teacherTokenA, "http://x/api/attendance", "POST", {
    classId: classA5.id, date: today, records: [{ studentId: stuA1.id, status: "ABSENT" }],
  }));
  assert(lockedEdit.status === 403, "Teacher edit window (24h) is still enforced");
  const override = await attendancePost(req(adminA, "http://x/api/attendance", "POST", {
    classId: classA5.id, date: today, records: [{ studentId: stuA1.id, status: "ABSENT" }],
  }));
  const overridden = (await getAttendanceServer(schoolA, today, classA5.id)).find((r) => r.studentId === stuA1.id);
  assert(override.status === 200 && overridden?.status === "ABSENT", "Admin override of a locked record still works");
  assert(todayLocalISO(new Date(2026, 9, 2, 1, 30)) === "2026-10-02", "Attendance page default date uses the local calendar day");

  // ===========================================================================
  // 3. TEACHER DELETE -> RECREATE
  // ===========================================================================
  const teacherBody = { firstName: "Hina", lastName: "Riaz", email: "hina.riaz@school-fix-a.edu", phone: "03005556667", joiningDate: "2025-01-10" };
  const created = await teachersPost(req(adminA, "http://x/api/teachers", "POST", teacherBody));
  const createdJson = await created.json();
  const hinaId = createdJson.teacher?.id;
  assert(created.status === 201 && hinaId, "Create teacher");
  const dup = await teachersPost(req(adminA, "http://x/api/teachers", "POST", teacherBody));
  assert(dup.status === 409, "Creating an active duplicate teacher (same email) is still blocked");

  await saveClassServer({ ...classA6, classTeacherId: hinaId, classTeacherName: "Hina Riaz" });
  await subjectsPost(req(adminA, "http://x/api/subjects", "POST", { name: "English", code: "ENG-6", classId: classA6.id, teacherId: hinaId }));
  await saveTimetableEntryServer({ id: "tt-fix-hina", schoolId: schoolA, teacherId: hinaId, classId: classA6.id, className: "Class 6-A", subjectName: "English", dayOfWeek: "Monday", periodName: "P1", startTime: "08:00 AM", endTime: "08:45 AM", academicYear: YEAR });

  const del = await teacherDelete(req(adminA, `http://x/api/teachers/${hinaId}`, "DELETE"), { params: Promise.resolve({ id: hinaId }) });
  const delJson = await del.json();
  assert(del.status === 200 && delJson.loginRemoved === true, "Delete teacher removes the teacher's login profile");
  assert(!(await getTeacherByIdServer(schoolA, hinaId)) && !(await getUserByEmailServer(teacherBody.email)), "Database state after delete: teacher record and users profile are gone");
  const cls6 = await getClassByIdServer(schoolA, classA6.id);
  const engSubject = await getSubjectByIdServer(schoolA, "sb-schoolfixa-clsfixa6a-english");
  const slots = await getTimetableServer(schoolA, undefined, classA6.id, undefined, { allSessions: true });
  assert(!cls6?.classTeacherId && engSubject?.teacherId === null && slots.every((t) => t.teacherId !== hinaId), "Dangling class-teacher, subject-teacher and timetable references are cleared");

  const recreated = await teachersPost(req(adminA, "http://x/api/teachers", "POST", teacherBody));
  const recreatedJson = await recreated.json();
  assert(recreated.status === 201 && recreatedJson.teacher.id !== hinaId, "Recreate the same teacher after deletion succeeds with a new record");
  const newProfile = await getUserByEmailServer(teacherBody.email);
  assert(newProfile?.teacherId === recreatedJson.teacher.id, "Recreated teacher's login points at the new teacher record");

  // Orphaned identity left by a deletion made BEFORE this fix (teacher doc gone, login kept).
  const orphanBody = { firstName: "Old", lastName: "Orphan", email: "orphan@school-fix-a.edu", phone: "03007778889", joiningDate: "2023-03-01" };
  const orphanCreated = await (await teachersPost(req(adminA, "http://x/api/teachers", "POST", orphanBody))).json();
  await deleteTeacherServer(schoolA, orphanCreated.teacher.id); // old behaviour: only the teacher doc
  const orphanRecreate = await teachersPost(req(adminA, "http://x/api/teachers", "POST", orphanBody));
  assert(orphanRecreate.status === 201, "An orphaned login left by an earlier deletion no longer blocks recreating the teacher");
  const otherSchoolUser = await teachersPost(req(adminB, "http://x/api/teachers", "POST", { ...orphanBody }));
  assert(otherSchoolUser.status === 409, "A live account in another school still blocks the email (no cross-school takeover)");
  const ids = (await getTeachersServer(schoolA)).map((t) => t.employeeId);
  assert(new Set(ids).size === ids.length, "Employee IDs stay unique after deletions (no reused TCH number)");

  // ===========================================================================
  // 1. PASSWORD RESET
  // ===========================================================================
  const resetEmail = "reset.user@school-fix-a.edu";
  await createUserServer({ uid: "uid-fix-reset", email: resetEmail, name: "Reset User", role: "TEACHER", schoolId: schoolA, status: "ACTIVE", passwordHash: bcrypt.hashSync("OldPassword#1", 10), createdAt: now, updatedAt: now });
  const oldSession = await createSessionCookieServer({ uid: "uid-fix-reset", email: resetEmail, role: "TEACHER", schoolId: schoolA, name: "Reset User", authAt: Math.floor(Date.now() / 1000) - 120 });

  const loginOld = await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: resetEmail, password: "OldPassword#1" }));
  assert(loginOld.status === 200, "Login works with the original password");

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  const forgot = await forgotPost(new NextRequest("http://x/api/auth/forgot-password", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: resetEmail.toUpperCase() }),
  }));
  console.warn = origWarn;
  const linkLine = warnings.find((w) => w.includes("/reset-password?token="));
  const token = linkLine ? decodeURIComponent(/token=([^\s]+)/.exec(linkLine)![1]) : "";
  assert(forgot.status === 200 && linkLine?.includes(`for ${resetEmail}:`), "Forgot password issues a link addressed to the registered email (dev console, no provider configured)");
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), "Reset token is a 256-bit random URL-safe token");

  const unknown = await forgotPost(new NextRequest("http://x/api/auth/forgot-password", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.10" },
    body: JSON.stringify({ email: "nobody@nowhere.test" }),
  }));
  assert(unknown.status === 200 && (await unknown.json()).success === true, "Unknown email gets the same generic response (no account enumeration)");

  const weak = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token, newPassword: "short" }));
  assert(weak.status === 400, "Reset rejects a too-short new password without consuming the token");
  const resetOk = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token, newPassword: "NewPassword#2" }));
  assert(resetOk.status === 200, "Reset link + new password updates the password");
  const reused = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token, newPassword: "Another#Pass3" }));
  assert(reused.status === 400 && (await reused.json()).code === "USED", "Used reset token is rejected");

  const loginNew = await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: resetEmail, password: "NewPassword#2" }));
  assert(loginNew.status === 200, "Login with the new password succeeds");
  const loginOldAfter = await loginPost(req(null, "http://x/api/auth/login", "POST", { identifier: resetEmail, password: "OldPassword#1" }));
  assert(loginOldAfter.status === 401, "Old password is rejected after reset");
  assert((await getAuthenticatedUser(req(oldSession, "http://x/api/subjects"))) === null, "Sessions signed in before the reset are invalidated");

  const expiredTok = generateResetToken();
  await savePasswordResetTokenServer({ id: expiredTok.tokenHash, uid: "uid-fix-reset", email: resetEmail, schoolId: schoolA, expiresAt: new Date(Date.now() - 1000).toISOString(), usedAt: null, createdAt: now });
  const expRes = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: expiredTok.token, newPassword: "Expired#Pass4" }));
  assert(expRes.status === 400 && (await expRes.json()).code === "EXPIRED", "Expired reset token is rejected");
  const forged = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: "x".repeat(43), newPassword: "Forged#Pass5" }));
  assert(forged.status === 400 && (await forged.json()).code === "INVALID", "Unknown/forged reset token is rejected");

  const t1 = generateResetToken();
  const t2 = generateResetToken();
  const tokRec = (h: string) => ({ id: h, uid: "uid-fix-reset", email: resetEmail, schoolId: schoolA, expiresAt: new Date(Date.now() + 600000).toISOString(), usedAt: null, createdAt: now });
  await savePasswordResetTokenServer(tokRec(t1.tokenHash));
  await savePasswordResetTokenServer(tokRec(t2.tokenHash));
  const olderLink = await resetPost(req(null, "http://x/api/auth/reset-password", "POST", { token: t1.token, newPassword: "Older#Link6" }));
  assert(olderLink.status === 400, "Requesting a new link invalidates the previous one");

  const prodNoUrl = resolveAppBaseUrl({ origin: "https://evil.example", host: "evil.example" }, { NODE_ENV: "production" });
  const prodLocal = resolveAppBaseUrl({}, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
  const prodOk = resolveAppBaseUrl({ origin: "https://evil.example" }, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://school.example.com/" });
  assert(!prodNoUrl.ok && !prodLocal.ok && prodOk.ok && prodOk.baseUrl === "https://school.example.com", "Production reset URL comes only from configuration, never Host/Origin, never localhost");
  const cfg = getEmailConfigStatus({ SMTP_HOST: "h", SMTP_USER: "u" });
  assert(cfg.providers.length === 0 && cfg.missingForSmtp.join() === "SMTP_PASS", "Email config status reports exactly which variable names are missing");

  const sessionNow = await createSessionCookieServer({ uid: "uid-fix-reset", email: resetEmail, role: "TEACHER", schoolId: schoolA, name: "Reset User" });
  await new Promise((r) => setTimeout(r, 1100));
  const changeRes = await changePasswordPost(req(sessionNow, "http://x/api/auth/change-password", "POST", { currentPassword: "NewPassword#2", newPassword: "Changed#Pass7" }));
  const reissued = /allied_session=([^;]+)/.exec(changeRes.headers.get("set-cookie") || "")?.[1];
  assert(changeRes.status === 200 && reissued && (await getAuthenticatedUser(req(reissued, "http://x/api/subjects"))) !== null, "Change password keeps the caller signed in with a re-issued session");
  assert((await getAuthenticatedUser(req(sessionNow, "http://x/api/subjects"))) === null, "Change password signs out other existing sessions");
  const profile = await getUserByIdServer("uid-fix-reset");
  assert(profile && bcrypt.compareSync("Changed#Pass7", profile.passwordHash!), "Change password stores the new password hash");

  // ===========================================================================
  // 5. DATES
  // ===========================================================================
  assert(!validateStudentDates({ dob: "2026-02-30" }).ok, "Impossible DOB (Feb 30) is rejected");
  assert(!validateStudentDates({ dob: "2099-01-01" }).ok, "Future DOB is rejected");
  assert(!validateStudentDates({ dob: "2015-05-01", admissionDate: "2014-01-01" }).ok, "Admission before birth is rejected");
  assert(validateStudentDates({}).ok, "Records without optional dates still validate");
  assert(formatDisplayDate("2009-04-12") === "12 Apr 2009", "Dates display in a clean admin-friendly format without timezone shift");

  const manual = await studentsPost(req(adminA, "http://x/api/students", "POST", {
    firstName: "Zara", lastName: "Ali", gender: "Female", dob: "2014-06-01", admissionDate: "2026-04-01",
    classId: classA5.id, guardianName: "Ali Raza", guardianPhone: "03009998887",
  }));
  const manualJson = await manual.json();
  assert(manual.status === 201 && manualJson.student.dob === "2014-06-01" && manualJson.student.admissionDate === "2026-04-01", "Manual student entry stores DOB and admission date");
  const manualBad = await studentsPost(req(adminA, "http://x/api/students", "POST", {
    firstName: "Bad", lastName: "Date", gender: "Male", dob: "2014-13-01", classId: classA5.id, guardianName: "G", guardianPhone: "03001231231",
  }));
  assert(manualBad.status === 400, "Manual student entry rejects an invalid DOB server-side");
  const feeBad = await feesPost(req(adminA, "http://x/api/fees", "POST", {
    studentId: stuA1.id, classId: classA5.id, month: "October", year: 2026, dueDate: "2026-02-31", tuitionFee: 1000,
  }));
  assert(feeBad.status === 400, "Fee challan with an impossible due date is rejected");

  // ===========================================================================
  // 6-11. BULK STUDENT IMPORT
  // ===========================================================================
  assert(parseImportDate("15/04/2012") === "2012-04-15" && parseImportDate("31/02/2012") === null && parseImportDate("41000") === "2012-04-01" && parseImportDate("12-Apr-2012") === "2012-04-12", "Import date parsing: DD/MM/YYYY, Excel serials, month names; impossible dates rejected");
  assert(normalizePhone("3001234567") === "03001234567" && normalizePhone("+92 300 1234567") === "+923001234567" && normalizePhone("12ab") === null, "Import phone normalization/validation");
  assert(parseCsv('Name,Note\r\n"Khan, Ali","said ""hi"""\r\n').join("|") === "Name,Note|Khan, Ali,said \"hi\"", "CSV parser handles quoted commas and escaped quotes");

  const csv = [
    "Student Name,Father Name,Gender,Date of Birth,Admission Date,Class,Section,Roll No,Admission No,Guardian Phone,Mother Name",
    "Hamza Tariq,Tariq Mehmood,Male,12/05/2015,2026-04-01,Class 5,A,11,,0300-1112233,Sadia",
    "Fatima Zahra,Zahid Iqbal,Female,,,Class 5,B,12,,03004445566,",
    "Bad Class,Someone,Male,2015-01-01,,Class 9,A,1,,03001110000,",
    "No Gender,Someone,,2015-01-01,,Class 5,A,2,,03001110001,",
    "Bad Date,Someone,Male,31/02/2015,,Class 5,A,3,,03001110002,",
    "Bad Phone,Someone,Male,2015-01-01,,Class 5,A,4,,12,",
    "Ayesha Noor,Noor Ahmed,Female,,,Class 5,A,5,,03001112223,",
    "Dup Admission,Someone,Male,2015-01-01,,Class 5,A,6,STD-2026-901,03001110003,",
    "Hamza Tariq,Tariq Mehmood,Male,12/05/2015,,Class 5,A,13,,03001112233,",
    "Sec Missing,Someone,Female,2015-02-02,,Class 5,,7,,03001110004,",
  ].join("\n");

  const pv = await importPost(uploadReq(adminA, "students.csv", csv, "text/csv"));
  const pvJson = await pv.json();
  const byRow = (n: number) => pvJson.rows?.find((r: any) => r.rowNumber === n);
  assert(pv.status === 200 && pvJson.summary.total === 10, "CSV upload is parsed into a preview without writing anything");
  assert(byRow(2).status === "VALID" && byRow(3).status === "WARNING", "Valid rows (and rows with only warnings) are importable");
  assert(byRow(4).status === "INVALID" && /does not exist/.test(byRow(4).errors.join()), "Unknown class is reported (no fake class created)");
  assert(byRow(5).status === "INVALID" && byRow(6).status === "INVALID" && byRow(7).status === "INVALID", "Missing gender, impossible date and bad phone are reported per row");
  assert(byRow(8).status === "DUPLICATE" && byRow(9).status === "DUPLICATE" && byRow(10).status === "DUPLICATE", "Existing student, existing admission number and in-file repeat are duplicates");
  assert(byRow(11).status === "INVALID" && /Section is required/.test(byRow(11).errors.join()), "Ambiguous class without section is rejected");
  assert(pvJson.ignoredColumns.includes("Mother Name"), "Columns with no matching student field are reported, not stored");
  const studentsBeforeCommit = (await getStudentsServer(schoolA, undefined, undefined, undefined, undefined, { allSessions: true })).length;
  assert(studentsBeforeCommit === 4, "Preview creates no students");

  const commitRows = pvJson.rows.map((r: any) => ({ rowNumber: r.rowNumber, input: { ...r.input } }));
  const cm = await importPost(req(adminA, "http://x/api/students/import", "POST", { fileName: "students.csv", rows: commitRows, schoolId: schoolB }));
  const cmJson = await cm.json();
  assert(cm.status === 200 && cmJson.summary.imported === 2 && cmJson.summary.skipped === 8 && cmJson.summary.failed === 0, "Confirm imports only valid rows (Imported 2, Skipped 8, Failed 0)");
  const all = await getStudentsServer(schoolA, undefined, undefined, undefined, undefined, { allSessions: true });
  const hamza = all.find((s) => s.fullName === "Hamza Tariq");
  const fatima = all.find((s) => s.fullName === "Fatima Zahra");
  assert(hamza?.classId === classA5.id && hamza.section === "A" && fatima?.classId === classA5b.id && fatima.section === "B", "Imported students have the correct Class/Section (resolved from real classes)");
  assert(hamza?.dob === "2015-05-12" && hamza.admissionDate === "2026-04-01" && hamza.guardianPhone === "03001112233" && hamza.gender === "MALE", "Imported fields are mapped onto the existing student schema");
  assert(hamza?.schoolId === schoolA && fatima?.schoolId === schoolA && hamza.academicYear === YEAR, "Imported students use the admin's own schoolId (body schoolId ignored)");
  const hamzaLogin = await getUserByEmailServer(hamza!.email!);
  assert(hamzaLogin?.role === "STUDENT" && hamzaLogin.studentId === hamza!.id && hamzaLogin.schoolId === schoolA, "Each imported student gets a login profile linked to the student");
  const admNos = all.map((s) => s.admissionNo);
  assert(new Set(admNos).size === admNos.length, "Generated admission numbers are unique");

  const again = await (await importPost(req(adminA, "http://x/api/students/import", "POST", { rows: commitRows }))).json();
  assert(again.summary.imported === 0, "Re-importing the same file creates no duplicates (re-validated on confirm)");

  const crossRows = [{ rowNumber: 2, input: { fullName: "Cross Kid", fatherName: "Dad", gender: "Male", className: "Class 6", section: "A", guardianPhone: "03001234000" } }];
  const cross = await (await importPost(req(adminB, "http://x/api/students/import", "POST", { rows: crossRows }))).json();
  const schoolAAfterCross = await getStudentsServer(schoolA, undefined, undefined, undefined, undefined, { allSessions: true });
  assert(cross.summary.imported === 0 && !schoolAAfterCross.some((s) => s.fullName === "Cross Kid"), "School B cannot import into School A's classes");
  const crossOwn = await (await importPost(req(adminB, "http://x/api/students/import", "POST", { rows: [{ rowNumber: 2, input: { ...crossRows[0].input, className: "Class 5" } }] }))).json();
  const bStudents = await getStudentsServer(schoolB, undefined, undefined, undefined, undefined, { allSessions: true });
  assert(crossOwn.summary.imported === 1 && bStudents.find((s) => s.fullName === "Cross Kid")?.classId === classB5.id, "Same class name resolves to the importing school's own class");

  const teacherImport = await importPost(uploadReq(teacherTokenA, "students.csv", csv, "text/csv"));
  assert(teacherImport.status === 403, "Non-admin users cannot import students");
  const anonImport = await importPost(new NextRequest("http://x/api/students/import", { method: "POST", body: "{}" }));
  assert(anonImport.status === 401, "Unauthenticated import is blocked");

  const xlsx = buildXlsx([
    ["Name", "Father's Name", "Gender", "DOB", "Class", "Section", "Parent Phone"],
    ["Usman Ghani", "Ghani Khan", "M", 42005, "5", "B", 3001239876],
  ]);
  assert(parseXlsx(xlsx)[1][0] === "Usman Ghani", "XLSX reader extracts shared-string cells");
  const xpv = await (await importPost(uploadReq(adminA, "list.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).json();
  const xr = xpv.rows?.[0];
  assert(xr?.status === "VALID" && xr.student.className === "Class 5-B" && xr.student.dob === "2015-01-01" && xr.student.guardianPhone === "03001239876", "XLSX import: aliases, Excel date serial and numeric phone are handled");

  const pdf = await importPost(uploadReq(adminA, "list.pdf", "%PDF-1.4 fake", "application/pdf"));
  assert(pdf.status === 415 && /PDF/.test((await pdf.json()).error), "PDF upload is refused with a clear message (no silent corrupted import)");
  const big = await importPost(uploadReq(adminA, "big.csv", "a".repeat(2 * 1024 * 1024 + 10), "text/csv"));
  assert(big.status === 413, "Files over the size limit are rejected");
  const exe = await importPost(uploadReq(adminA, "evil.exe", "MZ", "application/octet-stream"));
  assert(exe.status === 415, "Disallowed file types are rejected");
  assert(STUDENT_IMPORT_BATCH_SIZE * 2 <= 500, "Import batches stay within Firestore's 500-write limit");

  console.log("==================================================");
  console.log(`PRODUCTION FIX SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
