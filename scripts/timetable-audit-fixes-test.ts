import { NextRequest } from "next/server";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getTimetableServer,
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc, TimetableDoc } from "../src/lib/firebase/types";
import {
  GET as timetableGet,
  POST as timetablePost,
  PUT as timetablePut,
  DELETE as timetableDelete,
} from "../src/app/api/timetable/route";
import {
  isSameRoom,
  periodOrder,
  comparePeriodNames,
  sortTimetableEntries,
  validateTimetableSlot,
  TIMETABLE_DAYS,
} from "../src/lib/timetable-import";

let passed = 0;
let failed = 0;

function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${name}`);
    failed++;
  }
}

let ipCounter = 100;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.88.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("\n=======================================================");
  console.log("TIMETABLE AUDIT & FIXES REGRESSION TEST SUITE");
  console.log("=======================================================\n");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const schoolA = "school-audit-a";
  const schoolB = "school-audit-b";

  for (const sId of [schoolA, schoolB]) {
    await updateSchoolSettingsServer({
      id: sId,
      schoolId: sId,
      schoolName: `Allied School ${sId}`,
      campusName: "Dhoria Campus",
      motto: "",
      address: "",
      phone: "",
      email: `admin@${sId}.edu`,
      principalName: "Principal",
      academicYear: YEAR,
      gradingScale: [],
      updatedAt: now,
    });
  }

  // Classes
  const cls = (id: string, sId: string, name: string, section: string, roomNo: string): ClassDoc => ({
    id, schoolId: sId, name, section, numericLevel: 9, capacity: 40, roomNo,
    classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now,
  });

  const grade9Sci = cls("cls-9-sci", schoolA, "Grade 9 - Science", "Science", "R-101");
  const grade9Art = cls("cls-9-art", schoolA, "Grade 9 - Arts", "Arts", "R-102");
  const grade10A = cls("cls-10-a", schoolA, "Grade 10", "A", "R-201");
  const schoolBClass = cls("cls-b-9", schoolB, "Grade 9", "A", "R-101");

  for (const c of [grade9Sci, grade9Art, grade10A, schoolBClass]) {
    await saveClassServer(c);
  }

  // Teachers
  const teacher = (id: string, sId: string, fullName: string): TeacherDoc => ({
    id, schoolId: sId, fullName, email: `${id}@allied.edu`, phone: "+92 300 1234567",
    designation: "Educator", qualification: "M.Sc", experience: "5 years",
    subjects: [], classIds: [], status: "ACTIVE", createdAt: now, updatedAt: now,
  });

  const tchTariq = teacher("tch-tariq", schoolA, "Tariq Mahmood");
  const tchNasir = teacher("tch-nasir", schoolA, "Nasir Ali");
  const tchUsman = teacher("tch-usman", schoolA, "Usman Ghani");
  const tchBilal = teacher("tch-bilal", schoolA, "Bilal Ahmed");
  const tchSchoolB = teacher("tch-b-1", schoolB, "School B Teacher");

  for (const t of [tchTariq, tchNasir, tchUsman, tchBilal, tchSchoolB]) {
    await saveTeacherServer(t);
  }

  // Subjects
  const subj = (id: string, classId: string, name: string, teacherId: string, sId = schoolA): SubjectDoc => ({
    id, schoolId: sId, classId, name, code: id.toUpperCase(), teacherId,
    credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now,
  });

  const sbBio9 = subj("sb-bio-9", grade9Sci.id, "Biology", tchTariq.id);
  const sbPhy9 = subj("sb-phy-9", grade9Sci.id, "Physics", tchUsman.id);
  const sbGSci9 = subj("sb-gsci-9", grade9Art.id, "General Science", tchNasir.id);
  const sbComp9 = subj("sb-comp-9", grade9Art.id, "Computer Studies", tchBilal.id);
  const sbMath10 = subj("sb-math-10", grade10A.id, "Mathematics", tchTariq.id);
  const sbSchoolB = subj("sb-b-1", schoolBClass.id, "English", tchSchoolB.id, schoolB);

  for (const s of [sbBio9, sbPhy9, sbGSci9, sbComp9, sbMath10, sbSchoolB]) {
    await saveSubjectServer(s);
  }

  // Sessions
  const adminA = await createSessionCookieServer({ uid: "admin-a", email: "admin@a.edu", role: "ADMIN", schoolId: schoolA, name: "Admin A" });
  const adminB = await createSessionCookieServer({ uid: "admin-b", email: "admin@b.edu", role: "ADMIN", schoolId: schoolB, name: "Admin B" });
  const teacherTariqSession = await createSessionCookieServer({ uid: "user-tariq", email: "tariq@a.edu", role: "TEACHER", schoolId: schoolA, name: "Tariq Mahmood", teacherId: tchTariq.id });
  const teacherNasirSession = await createSessionCookieServer({ uid: "user-nasir", email: "nasir@a.edu", role: "TEACHER", schoolId: schoolA, name: "Nasir Ali", teacherId: tchNasir.id });

  // ---------------------------------------------------------------------------
  // SECTION 1: Room Comparison & Conflict Logic
  // ---------------------------------------------------------------------------
  console.log("--- Section 1: Room Normalization & Conflict Detection ---");
  assert(isSameRoom("R-101", "r-101"), "isSameRoom: matches case-insensitively");
  assert(isSameRoom(" Room 101 ", "room 101"), "isSameRoom: trims leading and trailing whitespace");
  assert(isSameRoom("R-101", "R-102") === false, "isSameRoom: distinct rooms do not match");
  assert(isSameRoom("-", "-") === false, "isSameRoom: placeholder '-' is never treated as a room match");
  assert(isSameRoom("", "") === false, "isSameRoom: empty room strings are never treated as a match");

  // ---------------------------------------------------------------------------
  // SECTION 2: Canonical Timetable Sorting
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 2: Canonical Timetable Sorting ---");
  assert(periodOrder("Period 1") === 1, "periodOrder: extracts 1 from 'Period 1'");
  assert(periodOrder("Period 10") === 10, "periodOrder: extracts 10 from 'Period 10'");
  assert(comparePeriodNames("Period 1", "Period 2") < 0, "comparePeriodNames: Period 1 < Period 2");
  assert(comparePeriodNames("Period 2", "Period 10") < 0, "comparePeriodNames: Period 2 < Period 10 (natural numeric sort)");

  const unsortedEntries: Partial<TimetableDoc>[] = [
    { dayOfWeek: "Wednesday", periodName: "Period 2", startTime: "09:40 AM", className: "Grade 9 - Science" },
    { dayOfWeek: "Monday", periodName: "Period 2", startTime: "09:40 AM", className: "Grade 9 - Science" },
    { dayOfWeek: "Monday", periodName: "Period 1", startTime: "08:00 AM", className: "Grade 9 - Science" },
    { dayOfWeek: "Friday", periodName: "Period 1", startTime: "08:00 AM", className: "Grade 9 - Science" },
    { dayOfWeek: "Monday", periodName: "Period 3", startTime: "01:00 PM", className: "Grade 9 - Science" },
  ];
  const sorted = sortTimetableEntries(unsortedEntries as TimetableDoc[]);
  assert(sorted[0].dayOfWeek === "Monday" && sorted[0].periodName === "Period 1", "sortTimetableEntries: Monday Period 1 comes first");
  assert(sorted[1].dayOfWeek === "Monday" && sorted[1].periodName === "Period 2", "sortTimetableEntries: Monday Period 2 comes second");
  assert(sorted[2].dayOfWeek === "Monday" && sorted[2].periodName === "Period 3", "sortTimetableEntries: Monday Period 3 (01:00 PM) comes after morning periods");
  assert(sorted[3].dayOfWeek === "Wednesday", "sortTimetableEntries: Wednesday comes after Monday");
  assert(sorted[4].dayOfWeek === "Friday", "sortTimetableEntries: Friday comes after Wednesday");

  // ---------------------------------------------------------------------------
  // SECTION 3: Parallel Periods & Grade 9 Science & Arts Independence
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 3: Parallel Periods & Grade 9 Science/Arts Independence ---");

  // Period 1: Grade 9 Science (Biology, Teacher Tariq, Room R-101, Monday 09:00–09:40)
  const resSci1 = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade9Sci.id,
    subjectId: sbBio9.id,
    teacherId: tchTariq.id,
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-101",
  }));
  const dataSci1 = await json(resSci1);
  assert(resSci1.status === 201 && dataSci1.success, "Grade 9 Science (Biology, Teacher Tariq, R-101) scheduled at Monday 09:00–09:40");

  // Period 2: Grade 9 Arts (General Science, Teacher Nasir, Room R-102, Monday 09:00–09:40)
  // SIMULTANEOUS at identical time with different teacher and different room
  const resArt1 = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade9Art.id,
    subjectId: sbGSci9.id,
    teacherId: tchNasir.id,
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-102",
  }));
  const dataArt1 = await json(resArt1);
  assert(resArt1.status === 201 && dataArt1.success, "Grade 9 Arts (General Science, Teacher Nasir, R-102) scheduled SIMULTANEOUSLY at Monday 09:00–09:40");

  // Verify both exist independently in the timetable
  const listAll = await getTimetableServer(schoolA);
  const monParallel = listAll.filter((t) => t.dayOfWeek === "Monday" && t.startTime === "09:00");
  assert(monParallel.length === 2, "Both Grade 9 Science and Arts parallel periods exist independently");
  assert(monParallel[0].id !== monParallel[1].id, "Parallel periods have distinct document IDs");

  // ---------------------------------------------------------------------------
  // SECTION 4: Conflict Enforcement (Teacher & Room Double-Booking)
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 4: Conflict Detection & Validation ---");

  // Test: Same teacher assigned to two classes at the same time must be REJECTED
  const resTeacherClash = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade10A.id,
    subjectId: sbMath10.id,
    teacherId: tchTariq.id, // Teacher Tariq already in Grade 9 Science at 09:00-09:40
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-201",
  }));
  assert(resTeacherClash.status === 409, "Teacher clash: same teacher double-booked in two classes at overlapping time is rejected (409)");

  // Test: Same room assigned to two classes at the same time must be REJECTED
  const resRoomClash = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade10A.id,
    subjectId: sbMath10.id,
    teacherId: tchUsman.id, // Different teacher
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-101", // Room R-101 is already occupied by Grade 9 Science
  }));
  assert(resRoomClash.status === 409, "Room clash: same room double-booked by another class at overlapping time is rejected (409)");

  // Test: Case-insensitive and trimmed room conflict detection
  const resRoomCaseClash = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade10A.id,
    subjectId: sbMath10.id,
    teacherId: tchUsman.id,
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "  r-101  ", // lowercase with whitespace
  }));
  assert(resRoomCaseClash.status === 409, "Room clash: case-insensitive/whitespace room collision is correctly detected and rejected (409)");

  // Test: Exact duplicate period must be REJECTED
  const resDup = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade9Sci.id,
    subjectId: sbBio9.id,
    teacherId: tchTariq.id,
    dayOfWeek: "Monday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-101",
  }));
  assert(resDup.status === 409 && /duplicate/i.test(JSON.stringify(await json(resDup))), "Duplicate period: exact same class/subject/teacher/time is rejected (409)");

  // Test: Invalid time ranges
  const resBackwards = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade9Sci.id,
    subjectId: sbPhy9.id,
    teacherId: tchUsman.id,
    dayOfWeek: "Tuesday",
    periodName: "Period 1",
    startTime: "10:00",
    endTime: "09:00", // End before start
    roomNo: "R-101",
  }));
  assert(resBackwards.status === 400, "Time validation: end time before start time is rejected (400)");

  // Test: Invalid day of week
  const resBadDay = await timetablePost(req(adminA, "http://localhost/api/timetable", "POST", {
    classId: grade9Sci.id,
    subjectId: sbPhy9.id,
    teacherId: tchUsman.id,
    dayOfWeek: "Holiday",
    periodName: "Period 1",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-101",
  }));
  assert(resBadDay.status === 400, "Day validation: invalid day of week is rejected (400)");

  // ---------------------------------------------------------------------------
  // SECTION 5: Record Preservation During Edit & Delete
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 5: Record Preservation During Updates ---");

  // Edit Grade 9 Science period (change room to R-103)
  const resEdit = await timetablePut(req(adminA, "http://localhost/api/timetable", "PUT", {
    id: dataSci1.id,
    classId: grade9Sci.id,
    subjectId: sbBio9.id,
    teacherId: tchTariq.id,
    dayOfWeek: "Monday",
    periodName: "Period 1 - Updated",
    startTime: "09:00",
    endTime: "09:40",
    roomNo: "R-103",
  }));
  assert(resEdit.status === 200, "Editing Grade 9 Science period via PUT succeeds (200)");

  // Verify Grade 9 Arts period is 100% UNTOUCHED
  const artsAfterEdit = (await getTimetableServer(schoolA)).find((t) => t.id === dataArt1.id);
  assert(artsAfterEdit !== undefined && artsAfterEdit.periodName === "Period 1" && artsAfterEdit.roomNo === "R-102", "Grade 9 Arts period remained completely intact when Science period was updated");

  // Delete Grade 9 Science period
  const resDel = await timetableDelete(req(adminA, `http://localhost/api/timetable?id=${encodeURIComponent(dataSci1.id)}`, "DELETE"));
  assert(resDel.status === 200, "Deleting Grade 9 Science period via DELETE succeeds (200)");

  // Verify Grade 9 Arts period STILL exists
  const artsAfterDel = (await getTimetableServer(schoolA)).find((t) => t.id === dataArt1.id);
  assert(artsAfterDel !== undefined, "Grade 9 Arts period remained intact after Science period was deleted");

  // ---------------------------------------------------------------------------
  // SECTION 6: Teacher Portal and Consistency
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 6: Teacher Portal Consistency & Cross-School Isolation ---");

  // Teacher Nasir loads their timetable
  const resTeacherNasir = await timetableGet(req(teacherNasirSession, "http://localhost/api/timetable"));
  const dataTeacherNasir = await json(resTeacherNasir);
  assert(
    resTeacherNasir.status === 200 &&
    dataTeacherNasir.timetable.length === 1 &&
    dataTeacherNasir.timetable[0].id === dataArt1.id,
    "Teacher Nasir sees their own assigned period (Grade 9 Arts General Science)"
  );

  // Teacher Tariq (whose period was deleted) sees 0 periods on Monday
  const resTeacherTariq = await timetableGet(req(teacherTariqSession, "http://localhost/api/timetable"));
  const dataTeacherTariq = await json(resTeacherTariq);
  assert(
    resTeacherTariq.status === 200 &&
    dataTeacherTariq.timetable.length === 0,
    "Teacher Tariq sees 0 periods after their period was deleted"
  );

  // Cross-school isolation: Admin B cannot see or delete School A's timetable
  const resCrossGet = await timetableGet(req(adminB, "http://localhost/api/timetable"));
  const dataCrossGet = await json(resCrossGet);
  assert(
    resCrossGet.status === 200 &&
    !dataCrossGet.timetable.some((t: any) => t.schoolId === schoolA),
    "School B admin cannot see School A timetable periods"
  );

  const resCrossDel = await timetableDelete(req(adminB, `http://localhost/api/timetable?id=${encodeURIComponent(dataArt1.id)}`, "DELETE"));
  assert(resCrossDel.status === 404, "School B admin cannot delete School A timetable period (404)");

  // Final summary
  console.log("\n=======================================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("=======================================================\n");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Unhandled test runner exception:", err);
  process.exit(1);
});
