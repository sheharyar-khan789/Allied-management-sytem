/**
 * Teacher Attendance (Phase 11): the pure calculation engine (weekly leave cap, holidays/working
 * days, biometric-present precedence, Asia/Karachi timezone, month boundaries, determinism), the
 * biometric compatibility layer (duplicate detection, device-user mapping, admin-correction
 * precedence — simulated events only, never written to production data by this file), and the
 * /api/teacher-attendance + /api/settings (holidays) routes (admin/teacher authorization,
 * cross-school isolation, historical record preservation).
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder.
 */
import { NextRequest } from "next/server";
import { GET as teacherAttendanceGet, PUT as teacherAttendancePut } from "../src/app/api/teacher-attendance/route";
import { GET as settingsGet, PUT as settingsPut } from "../src/app/api/settings/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveTeacherServer, updateSchoolSettingsServer, getAuditLogsServer } from "../src/lib/firebase/server-db";
import { TeacherDoc, TeacherAttendanceDoc } from "../src/lib/firebase/types";
import {
  classifyTeacherDays,
  summarizeTeacherDays,
  workingDaysInRange,
  isWorkingDay,
  monthRange,
  teacherAttendanceIdFor,
} from "../src/lib/teacher-attendance";
import { resolveBiometricEvent, buildBiometricAttendanceDoc, DeviceUserDirectory } from "../src/lib/biometric-attendance";

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
const json = async (res: Response) => res.json().catch(() => ({}));

function rec(schoolId: string, teacherId: string, date: string, status: "PRESENT" | "ABSENT" | "LEAVE", source: "BIOMETRIC" | "MANUAL" | "ADMIN_CORRECTION" = "MANUAL"): TeacherAttendanceDoc {
  return {
    id: teacherAttendanceIdFor(schoolId, teacherId, date), schoolId, teacherId, date, status, source,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function run() {
  console.log("==================================================");
  console.log("TEACHER ATTENDANCE (Phase 11)");
  console.log("==================================================");

  // ---------------------------------------------------------------- 1. working days / holidays
  {
    assert(isWorkingDay("2026-11-02") === true, "isWorkingDay: an ordinary weekday (Monday) is working");
    assert(isWorkingDay("2026-11-08") === false, "isWorkingDay: a Sunday is never a working day"); // 2026-11-08 is a Sunday
    assert(isWorkingDay("2026-12-25", ["2026-12-25"]) === false, "isWorkingDay: a configured holiday is excluded even on a weekday");
    const days = workingDaysInRange("2026-11-02", "2026-11-08"); // Mon..Sun
    assert(days.length === 6 && !days.includes("2026-11-08"), "workingDaysInRange: a Mon-Sun range has 6 working days, Sunday excluded");
  }

  // ---------------------------------------------------------------- 2. weekly leave cap + holidays + absence defaults
  {
    const schoolId = "school-tatt-calc";
    const teacherId = "tch-tatt-calc";
    // Week of Mon 2026-11-02 .. Sun 2026-11-08. Monday=LEAVE, Wednesday=LEAVE (2nd this week),
    // Thursday=ABSENT (explicit), Friday=no record at all, Saturday=PRESENT.
    const records: TeacherAttendanceDoc[] = [
      rec(schoolId, teacherId, "2026-11-02", "LEAVE"),
      rec(schoolId, teacherId, "2026-11-04", "LEAVE"),
      rec(schoolId, teacherId, "2026-11-05", "ABSENT"),
      rec(schoolId, teacherId, "2026-11-07", "PRESENT", "BIOMETRIC"),
    ];
    const days = classifyTeacherDays("2026-11-02", "2026-11-08", records, []);
    const byDate = new Map(days.map((d) => [d.date, d]));
    assert(byDate.get("2026-11-02")?.status === "LEAVE", "Weekly leave: first leave day of the week counts as leave");
    assert(byDate.get("2026-11-04")?.status === "ABSENT" && byDate.get("2026-11-04")?.weeklyLeaveCapApplied === true, "Weekly leave: a second leave day in the same week counts as absent, flagged");
    assert(byDate.get("2026-11-05")?.status === "ABSENT", "Explicit absent record counts as absent");
    assert(byDate.get("2026-11-03")?.status === "ABSENT" && byDate.get("2026-11-03")?.recorded === false, "No record at all on a working day defaults to absent, never fabricated as present/leave");
    assert(byDate.get("2026-11-07")?.status === "PRESENT", "Biometric present record counts as present");
    assert(!byDate.has("2026-11-08"), "Sunday never appears in the classified days at all");
    const summary = summarizeTeacherDays(days);
    assert(summary.workingDays === 6 && summary.present === 1 && summary.leave === 1 && summary.absent === 4 && summary.weeklyLeaveCapApplied === 1, "Monthly-style summary totals are internally consistent (present+leave+absent = workingDays)");

    // Determinism: running it again with the same inputs gives the identical result.
    const days2 = classifyTeacherDays("2026-11-02", "2026-11-08", records, []);
    assert(JSON.stringify(days.map((d) => ({ date: d.date, status: d.status }))) === JSON.stringify(days2.map((d) => ({ date: d.date, status: d.status }))), "Deterministic: identical input always produces identical output");
  }

  // ---------------------------------------------------------------- 3. biometric present precedence over the weekly cap
  {
    const schoolId = "school-tatt-calc2";
    const teacherId = "tch-tatt-calc2";
    // Monday LEAVE (uses the week's allowance), Wednesday PRESENT (biometric) — must stay PRESENT,
    // never downgraded by the weekly cap logic that only applies to LEAVE-status days.
    const records: TeacherAttendanceDoc[] = [
      rec(schoolId, teacherId, "2026-11-02", "LEAVE"),
      rec(schoolId, teacherId, "2026-11-04", "PRESENT", "BIOMETRIC"),
    ];
    const days = classifyTeacherDays("2026-11-02", "2026-11-08", records, []);
    const wed = days.find((d) => d.date === "2026-11-04");
    assert(wed?.status === "PRESENT" && !wed?.weeklyLeaveCapApplied, "Biometric present takes precedence and is never subject to the weekly leave cap");
  }

  // ---------------------------------------------------------------- 4. month/year boundaries
  {
    assert(JSON.stringify(monthRange(2026, 2)) === JSON.stringify({ start: "2026-02-01", end: "2026-02-28" }), "monthRange: February 2026 (non-leap) has 28 days");
    assert(JSON.stringify(monthRange(2028, 2)) === JSON.stringify({ start: "2028-02-01", end: "2028-02-29" }), "monthRange: February 2028 (leap year) has 29 days");
    assert(JSON.stringify(monthRange(2026, 11)) === JSON.stringify({ start: "2026-11-01", end: "2026-11-30" }), "monthRange: November has 30 days");
    assert(JSON.stringify(monthRange(2026, 12)) === JSON.stringify({ start: "2026-12-01", end: "2026-12-31" }), "monthRange: December has 31 days (year boundary correctness)");
  }

  // ---------------------------------------------------------------- 5. biometric adapter: mapping, dedup, correction precedence
  {
    const directory: DeviceUserDirectory = {
      resolveTeacherId: (schoolId, deviceId, deviceUserId) =>
        schoolId === "school-bio" && deviceId === "dev-1" && deviceUserId === "U001" ? "tch-bio-1" : null,
    };

    const unmapped = resolveBiometricEvent(
      { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U999", eventId: "evt-1", timestampUtc: "2026-11-04T03:05:00Z" },
      directory, new Set(), undefined
    );
    assert(!unmapped.ok && unmapped.reason === "UNMAPPED_DEVICE_USER", "Biometric: an unrecognised device-user id is rejected, never guessed");

    // Asia/Karachi is UTC+5: 2026-11-04T03:05:00Z -> 08:05 local on 2026-11-04.
    const mapped = resolveBiometricEvent(
      { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-2", timestampUtc: "2026-11-04T03:05:00Z" },
      directory, new Set(), undefined
    );
    assert(mapped.ok === true && mapped.teacherId === "tch-bio-1" && mapped.date === "2026-11-04" && mapped.checkInTime === "08:05", "Biometric: a mapped event resolves the correct teacher and the correct Asia/Karachi local date/time from a UTC timestamp");

    const duplicate = resolveBiometricEvent(
      { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-2", timestampUtc: "2026-11-04T03:05:00Z" },
      directory, new Set(["evt-2"]), undefined
    );
    assert(!duplicate.ok && duplicate.reason === "DUPLICATE_EVENT", "Biometric: a repeated event id is rejected as a duplicate, not re-applied");

    const existingCorrection: TeacherAttendanceDoc = rec("school-bio", "tch-bio-1", "2026-11-04", "ABSENT", "ADMIN_CORRECTION");
    const superseded = resolveBiometricEvent(
      { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-3", timestampUtc: "2026-11-04T05:00:00Z" },
      directory, new Set(), existingCorrection
    );
    assert(!superseded.ok && superseded.reason === "SUPERSEDED_BY_CORRECTION", "Biometric: a deliberate admin correction for that date is never silently overwritten by a later biometric event");

    if (mapped.ok) {
      const doc = buildBiometricAttendanceDoc(
        { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-2", timestampUtc: "2026-11-04T03:05:00Z" },
        mapped, undefined, "Test Teacher", "2026-11-04T03:05:01.000Z"
      );
      assert(doc.status === "PRESENT" && doc.source === "BIOMETRIC" && doc.checkInTime === "08:05", "Biometric: the built attendance doc is PRESENT with the resolved check-in time");

      // A second, later punch the same day must not push the recorded check-in time later -
      // the earliest check-in of the day always wins.
      const laterEvent = resolveBiometricEvent(
        { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-4", timestampUtc: "2026-11-04T09:00:00Z" },
        directory, new Set(), doc
      );
      if (laterEvent.ok) {
        const doc2 = buildBiometricAttendanceDoc(
          { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-4", timestampUtc: "2026-11-04T09:00:00Z" },
          laterEvent, doc, "Test Teacher", "2026-11-04T09:00:01.000Z"
        );
        assert(doc2.checkInTime === "08:05", "Biometric: a later same-day punch never overwrites the day's earliest recorded check-in time");
      } else {
        assert(false, "Biometric: the later same-day event should have resolved ok (sanity)");
      }
    }

    // No raw biometric data is ever stored on the built document.
    if (mapped.ok) {
      const doc = buildBiometricAttendanceDoc(
        { schoolId: "school-bio", deviceId: "dev-1", deviceUserId: "U001", eventId: "evt-2", timestampUtc: "2026-11-04T03:05:00Z" },
        mapped, undefined, "Test Teacher", "2026-11-04T03:05:01.000Z"
      );
      assert(!("fingerprint" in doc) && !("template" in doc), "Biometric: the attendance document never carries a fingerprint/template field");
    }
  }

  // ---------------------------------------------------------------- 6. API: admin correction + audit + teacher's own read
  const A = "school-tatt-api-a";
  const B = "school-tatt-api-b";
  const teacherDoc: TeacherDoc = {
    id: "tch-tatt-api-1", schoolId: A, employeeId: "EMP-TA-1", fullName: "Tatt Teacher", email: "tt@tatt.edu",
    phone: "0300", designation: "Teacher", department: "Science", qualification: "M.Sc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await saveTeacherServer(teacherDoc);
  await saveTeacherServer({ ...teacherDoc, id: "tch-tatt-api-b1", schoolId: B, fullName: "B Teacher", email: "b@tatt.edu" });

  const ADMIN = await createSessionCookieServer({ uid: "u-tatt-admin", email: "admin@tatt.edu", role: "ADMIN", schoolId: A, name: "Admin" });
  const TEACHER = await createSessionCookieServer({ uid: "u-tatt-teacher", email: "t@tatt.edu", role: "TEACHER", schoolId: A, name: "Tatt Teacher", teacherId: teacherDoc.id });
  const ADMIN_B = await createSessionCookieServer({ uid: "u-tatt-admin-b", email: "admin@b.edu", role: "ADMIN", schoolId: B, name: "Admin B" });

  {
    const correction = await json(await teacherAttendancePut(req(ADMIN, "/api/teacher-attendance", "PUT", {
      teacherId: teacherDoc.id, date: "2026-11-03", status: "LEAVE", reason: "Approved sick leave",
    })));
    assert(correction.success === true && correction.record.status === "LEAVE" && correction.record.source === "ADMIN_CORRECTION", "Admin PUT: correction saved with source ADMIN_CORRECTION");
    assert(correction.record.correctionHistory?.length === 1 && correction.record.correctionHistory[0].reason === "Approved sick leave", "Admin PUT: correction is recorded in correctionHistory with its reason");

    const logs = await getAuditLogsServer(A);
    assert(logs.some((l) => l.action === "CORRECT_TEACHER_ATTENDANCE" && l.entityId === correction.record.id), "Admin PUT: the correction is audit-logged, mandatory per the brief");

    const adminView = await json(await teacherAttendanceGet(req(ADMIN, `/api/teacher-attendance?teacherId=${teacherDoc.id}&year=2026&month=11`)));
    assert(adminView.success === true && adminView.days.find((d: any) => d.date === "2026-11-03")?.status === "LEAVE", "Admin GET: the corrected day is reflected in that teacher's monthly view");

    const teacherView = await json(await teacherAttendanceGet(req(TEACHER, "/api/teacher-attendance?year=2026&month=11")));
    assert(teacherView.teacher.id === teacherDoc.id && teacherView.days.find((d: any) => d.date === "2026-11-03")?.status === "LEAVE", "Teacher GET: can see their own corrected record");

    // A teacher cannot read another teacher's attendance by passing teacherId - it's ignored.
    const spoofed = await json(await teacherAttendanceGet(req(TEACHER, `/api/teacher-attendance?teacherId=tch-tatt-api-b1&year=2026&month=11`)));
    assert(spoofed.teacher.id === teacherDoc.id, "Unauthorized: a teacher's spoofed ?teacherId= is ignored - they always see only their own record");

    // A teacher cannot write at all.
    const teacherWriteAttempt = await teacherAttendancePut(req(TEACHER, "/api/teacher-attendance", "PUT", {
      teacherId: teacherDoc.id, date: "2026-11-03", status: "PRESENT",
    }));
    assert(teacherWriteAttempt.status === 403, "Unauthorized: a TEACHER cannot modify any attendance record (ADMIN only)");

    // Cross-school isolation.
    const crossRead = await teacherAttendanceGet(req(ADMIN_B, `/api/teacher-attendance?teacherId=${teacherDoc.id}&year=2026&month=11`));
    assert(crossRead.status === 404, "Cross-school: another school's admin cannot read this teacher's attendance");
    const crossWrite = await teacherAttendancePut(req(ADMIN_B, "/api/teacher-attendance", "PUT", { teacherId: teacherDoc.id, date: "2026-11-03", status: "PRESENT" }));
    assert(crossWrite.status === 404, "Cross-school: another school's admin cannot correct this teacher's attendance");
  }

  // ---------------------------------------------------------------- 7. historical preservation: a later correction on
  // one date never touches another date's already-saved record.
  {
    await teacherAttendancePut(req(ADMIN, "/api/teacher-attendance", "PUT", { teacherId: teacherDoc.id, date: "2026-11-02", status: "ABSENT" }));
    await teacherAttendancePut(req(ADMIN, "/api/teacher-attendance", "PUT", { teacherId: teacherDoc.id, date: "2026-11-04", status: "PRESENT" }));
    const view = await json(await teacherAttendanceGet(req(ADMIN, `/api/teacher-attendance?teacherId=${teacherDoc.id}&year=2026&month=11`)));
    const byDate = new Map(view.days.map((d: any) => [d.date, d.status]));
    assert(byDate.get("2026-11-02") === "ABSENT" && byDate.get("2026-11-03") === "LEAVE" && byDate.get("2026-11-04") === "PRESENT", "Historical preservation: three separate corrections on three different dates each stay exactly as set, none overwriting another");
  }

  // ---------------------------------------------------------------- 8. holidays end-to-end via /api/settings
  {
    const before = await json(await teacherAttendanceGet(req(ADMIN, `/api/teacher-attendance?teacherId=${teacherDoc.id}&year=2026&month=12`)));
    const workingDaysBefore = before.summary.workingDays;

    const settingsPutRes = await json(await settingsPut(req(ADMIN, "/api/settings", "PUT", { holidays: ["2026-12-25"] })));
    assert(settingsPutRes.success === true, "Settings PUT: a holiday date is accepted and saved");

    const settingsGetRes = await json(await settingsGet(req(ADMIN, "/api/settings")));
    assert(settingsGetRes.settings.holidays.includes("2026-12-25"), "Settings GET: the saved holiday is returned");

    const after = await json(await teacherAttendanceGet(req(ADMIN, `/api/teacher-attendance?teacherId=${teacherDoc.id}&year=2026&month=12`)));
    assert(after.summary.workingDays === workingDaysBefore - 1, "Holidays: a configured holiday reduces the working-day count by exactly one, excluded from present/absent/leave entirely");
    assert(!after.days.some((d: any) => d.date === "2026-12-25"), "Holidays: the holiday date does not appear in the classified days at all (never counted as an absence)");

    // Cross-school: school B's settings are unaffected by school A's holiday.
    await updateSchoolSettingsServer({
      id: B, schoolId: B, schoolName: "B School", academicYear: "2026-2027", gradingScale: [], updatedAt: new Date().toISOString(),
    } as any);
    const bSettings = await json(await settingsGet(req(ADMIN_B, "/api/settings")));
    assert(!(bSettings.settings.holidays || []).includes("2026-12-25"), "Cross-school: school A's holiday configuration never applies to school B");
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
