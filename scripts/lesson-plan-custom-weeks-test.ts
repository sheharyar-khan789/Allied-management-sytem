/**
 * Comprehensive Automated Test Suite for Lesson Plan Custom Weeks Module
 * Covers:
 *  1. Admin manual week creation (name, weekNumber, startDate, endDate, session, status)
 *  2. Duplicate week number detection & rejection (409) in same session
 *  3. Session-specific week number reuse & multi-tenant isolation
 *  4. Editing week name, weekNumber, dates, status (activation/deactivation)
 *  5. Query filtering, searching (by name and number), and sorting
 *  6. Teacher schedule integration (active weeks appear; deactivated weeks excluded)
 *  7. Deactivated week enforcement on new lesson plan creation (403)
 *  8. Historical plan preservation under deactivated weeks
 *  9. Date locking and deletion protection for weeks with existing plans
 * 10. Far-future weeks beyond 2027 (2028, 2030, 2035)
 */
import { NextRequest } from "next/server";
import { GET as weeksGet, POST as weeksPost } from "../src/app/api/lesson-plan-weeks/route";
import { PUT as weekPut, DELETE as weekDelete } from "../src/app/api/lesson-plan-weeks/[id]/route";
import { GET as optionsGet } from "../src/app/api/lesson-plans/options/route";
import { GET as plansGet, POST as plansSave } from "../src/app/api/lesson-plans/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";
import {
  validateWeekInput,
} from "../src/lib/lesson-plan-weeks";

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

let ip = 1;
function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": `10.99.${Math.floor(ip / 250)}.${ip++ % 250}` });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  console.log("==================================================");
  console.log("LESSON PLAN CUSTOM WEEKS - FULL MODULE TEST SUITE");
  console.log("==================================================");

  const now = new Date().toISOString();

  // Week dates below are anchored to real "now" (comfortably future, never hardcoded calendar
  // dates) because /api/lesson-plans rejects starting a brand-new draft once a week's Monday
  // 00:00 deadline has passed (src/lib/lesson-plan-schedule.ts) — a fixed literal date silently
  // breaks this suite every time real time catches up to it.
  const toYMD = (d: Date) => d.toISOString().split("T")[0];
  const addDaysUTC = (dateStr: string, days: number): string => {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return toYMD(d);
  };
  // The Monday at least `weeksAhead` weeks from today (UTC), rolled forward to the next Monday.
  const futureMonday = (weeksAhead: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const toMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    d.setUTCDate(d.getUTCDate() + toMonday);
    return toYMD(d);
  };
  const WEEK1_START = futureMonday(3);
  const WEEK1_END = addDaysUTC(WEEK1_START, 5); // Monday..Saturday
  const WEEK2_START = addDaysUTC(WEEK1_START, 7);
  const WEEK2_END = addDaysUTC(WEEK2_START, 5);
  const WEEK3_START = addDaysUTC(WEEK1_START, 14);
  const WEEK3_END = addDaysUTC(WEEK3_START, 5);

  const YEAR = "2026-2027";
  const NEXT_YEAR = "2027-2028";
  const SCHOOL_A = "school-cw-a";
  const SCHOOL_B = "school-cw-b";

  for (const id of [SCHOOL_A, SCHOOL_B]) {
    await updateSchoolSettingsServer({
      id,
      schoolId: id,
      schoolName: `Custom Weeks School ${id}`,
      campusName: "Main Campus",
      motto: "Excellence",
      address: "123 School Way",
      phone: "03001234567",
      email: `admin@${id}.edu`,
      principalName: "Principal",
      academicYear: YEAR,
      timezone: "Asia/Karachi",
      gradingScale: [],
      updatedAt: now,
    });
  }

  const adminTokenA = await createSessionCookieServer({
    uid: "admin-cw-a",
    email: "admin@school-cw-a.test",
    role: "ADMIN",
    schoolId: SCHOOL_A,
  });

  const adminTokenB = await createSessionCookieServer({
    uid: "admin-cw-b",
    email: "admin@school-cw-b.test",
    role: "ADMIN",
    schoolId: SCHOOL_B,
  });

  const teacherDocA: TeacherDoc = {
    id: "tch-cw-a1",
    schoolId: SCHOOL_A,
    fullName: "Ayesha Khan",
    email: "ayesha@school-cw-a.test",
    username: "ayesha.khan",
    phone: "03000000001",
    specialization: "English",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  await saveTeacherServer(teacherDocA);

  const teacherTokenA = await createSessionCookieServer({
    uid: "tch-cw-a1",
    email: "ayesha@school-cw-a.test",
    role: "TEACHER",
    schoolId: SCHOOL_A,
    teacherId: "tch-cw-a1",
  });

  const classDocA: ClassDoc = {
    id: "cls-cw-1",
    schoolId: SCHOOL_A,
    name: "Class 6",
    section: "A",
    academicYear: YEAR,
    createdAt: now,
    updatedAt: now,
  };
  await saveClassServer(classDocA);

  const subjectDocA: SubjectDoc = {
    id: "sb-cw-eng",
    schoolId: SCHOOL_A,
    name: "English",
    code: "ENG-6",
    classId: "cls-cw-1",
    teacherId: "tch-cw-a1",
    academicYear: YEAR,
    createdAt: now,
    updatedAt: now,
  };
  await saveSubjectServer(subjectDocA);

  // ----------------------------------------------------
  // SECTION 1: Unit Validation (validateWeekInput)
  // ----------------------------------------------------
  console.log("\n--- Section 1: validateWeekInput ---");
  const v1 = validateWeekInput({
    label: "Mid-Term Week",
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    weekNumber: 1,
    status: "ACTIVE",
    order: 10,
  });
  assert(v1.ok && v1.value.weekNumber === 1 && v1.value.status === "ACTIVE", "validateWeekInput accepts valid week with weekNumber, label, and ACTIVE status");

  const v2 = validateWeekInput({
    label: "Invalid Number",
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    weekNumber: -5,
  });
  assert(!v2.ok && v2.error.includes("positive integer"), "validateWeekInput rejects negative weekNumber");

  const v3 = validateWeekInput({
    label: "Invalid Number Zero",
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    weekNumber: 0,
  });
  assert(!v3.ok && v3.error.includes("positive integer"), "validateWeekInput rejects weekNumber 0");

  const v4 = validateWeekInput({
    label: "Invalid Status",
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    status: "UNKNOWN_STATUS",
  });
  assert(!v4.ok && v4.error.includes("ACTIVE or INACTIVE"), "validateWeekInput rejects invalid status value");

  const v5 = validateWeekInput({
    label: "Inactive Week",
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    status: "INACTIVE",
  });
  assert(v5.ok && v5.value.status === "INACTIVE", "validateWeekInput parses INACTIVE status correctly");

  // ----------------------------------------------------
  // SECTION 2: Admin Week Creation (POST /api/lesson-plan-weeks)
  // ----------------------------------------------------
  console.log("\n--- Section 2: Admin Week Creation ---");

  // Teacher cannot create weeks
  const resTeacherPost = await weeksPost(req(teacherTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Hacked Week",
    startDate: WEEK1_START,
    endDate: WEEK1_END,
  }));
  assert(resTeacherPost.status === 403, "TEACHER role is forbidden from creating custom weeks (403)");

  // Admin creates Week 1
  const resW1 = await weeksPost(req(adminTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Orientation & Basics",
    weekNumber: 1,
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    academicYear: YEAR,
    status: "ACTIVE",
    order: 1,
  }));
  const bodyW1 = await json(resW1);
  assert(resW1.status === 201 && bodyW1.week?.weekNumber === 1 && bodyW1.week?.status === "ACTIVE", "Admin successfully creates Week 1 with status ACTIVE");

  // Duplicate weekNumber in same school and session rejected with 409
  const resDupNum = await weeksPost(req(adminTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Another Week 1",
    weekNumber: 1,
    startDate: WEEK2_START,
    endDate: WEEK2_END,
    academicYear: YEAR,
  }));
  const bodyDupNum = await json(resDupNum);
  assert(resDupNum.status === 409 && bodyDupNum.error?.includes("Week number 1 is already used"), "Duplicate weekNumber 1 in same session is rejected with HTTP 409 Conflict");

  // Same weekNumber 1 in DIFFERENT session is allowed
  const resNextYearW1 = await weeksPost(req(adminTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Next Year Orientation",
    weekNumber: 1,
    startDate: "2027-08-16",
    endDate: "2027-08-21",
    academicYear: NEXT_YEAR,
  }));
  assert(resNextYearW1.status === 201, "Same weekNumber 1 in a DIFFERENT academic session (2027-2028) is accepted (201)");

  // Same weekNumber 1 in DIFFERENT school is allowed (Multi-tenant isolation)
  const resSchoolBW1 = await weeksPost(req(adminTokenB, "/api/lesson-plan-weeks", "POST", {
    label: "School B Week 1",
    weekNumber: 1,
    startDate: WEEK1_START,
    endDate: WEEK1_END,
    academicYear: YEAR,
  }));
  assert(resSchoolBW1.status === 201, "Same weekNumber 1 in a DIFFERENT school is isolated and accepted (201)");

  // Admin creates Week 2
  const resW2 = await weeksPost(req(adminTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Grammar & Composition",
    weekNumber: 2,
    startDate: WEEK2_START,
    endDate: WEEK2_END,
    academicYear: YEAR,
    status: "ACTIVE",
    order: 2,
  }));
  assert(resW2.status === 201, "Admin creates Week 2 successfully");

  // Admin creates Week 3 as INACTIVE initially
  const resW3 = await weeksPost(req(adminTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Revision & Sports",
    weekNumber: 3,
    startDate: WEEK3_START,
    endDate: WEEK3_END,
    academicYear: YEAR,
    status: "INACTIVE",
    order: 3,
  }));
  assert(resW3.status === 201, "Admin creates Week 3 with INACTIVE status");

  // Far future week beyond 2027 (e.g., 2030)
  const resFuture = await weeksPost(req(adminTokenA, "/api/lesson-plan-weeks", "POST", {
    label: "Far Future Term Week",
    weekNumber: 10,
    startDate: "2030-01-07",
    endDate: "2030-01-12",
    academicYear: "2029-2030",
    status: "ACTIVE",
  }));
  assert(resFuture.status === 201, "Custom week far beyond 2027 (in 2030) is created successfully without restriction");

  // ----------------------------------------------------
  // SECTION 3: Admin Week Query, Search, Filter & Sort
  // ----------------------------------------------------
  console.log("\n--- Section 3: Admin Query, Search, Filter & Sort ---");

  // Search by name "Grammar"
  const resSearchName = await weeksGet(req(adminTokenA, "/api/lesson-plan-weeks?search=Grammar"));
  const bodySearchName = await json(resSearchName);
  assert(
    resSearchName.status === 200 &&
    bodySearchName.weeks?.length === 1 &&
    bodySearchName.weeks[0].label === "Grammar & Composition",
    "Search by name 'Grammar' returns only Week 2"
  );

  // Search by week number "2"
  const resSearchNum = await weeksGet(req(adminTokenA, "/api/lesson-plan-weeks?search=2"));
  const bodySearchNum = await json(resSearchNum);
  assert(
    resSearchNum.status === 200 &&
    bodySearchNum.weeks?.some((w: any) => w.weekNumber === 2),
    "Search by week number '2' matches Week 2"
  );

  // Filter by status ACTIVE
  const resFilterActive = await weeksGet(req(adminTokenA, "/api/lesson-plan-weeks?status=ACTIVE"));
  const bodyFilterActive = await json(resFilterActive);
  assert(
    resFilterActive.status === 200 &&
    bodyFilterActive.weeks?.every((w: any) => w.status === "ACTIVE"),
    "Filter by status=ACTIVE returns only active weeks"
  );

  // Filter by status INACTIVE
  const resFilterInactive = await weeksGet(req(adminTokenA, "/api/lesson-plan-weeks?status=INACTIVE"));
  const bodyFilterInactive = await json(resFilterInactive);
  assert(
    resFilterInactive.status === 200 &&
    bodyFilterInactive.weeks?.length >= 1 &&
    bodyFilterInactive.weeks.every((w: any) => w.status === "INACTIVE"),
    "Filter by status=INACTIVE returns only deactivated weeks"
  );

  // Sort by weekNumber asc
  const resSortNum = await weeksGet(req(adminTokenA, "/api/lesson-plan-weeks?sortBy=weekNumber&sortOrder=asc"));
  const bodySortNum = await json(resSortNum);
  const nums = bodySortNum.weeks?.map((w: any) => w.weekNumber).filter((n: any) => n !== null);
  const sorted = [...nums].sort((a, b) => a - b);
  assert(JSON.stringify(nums) === JSON.stringify(sorted), "Sort by weekNumber asc returns correctly ordered weeks");

  // ----------------------------------------------------
  // SECTION 4: Admin Week Editing & Activation / Deactivation
  // ----------------------------------------------------
  console.log("\n--- Section 4: Admin Editing & Status Toggle ---");

  const w1Id = bodyW1.week.id;

  // Edit Week 1 name and weekNumber
  const resEditW1 = await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      label: "Orientation & Foundation",
      weekNumber: 1,
    }),
    idParams(w1Id)
  );
  const bodyEditW1 = await json(resEditW1);
  assert(
    resEditW1.status === 200 &&
    bodyEditW1.week?.label === "Orientation & Foundation",
    "Admin edits week name successfully"
  );

  // Attempt to edit week number to a conflicting existing number (e.g., Week 2)
  const resEditConf = await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      weekNumber: 2,
    }),
    idParams(w1Id)
  );
  assert(resEditConf.status === 409, "Editing week number to an already taken number (Week 2) returns 409 Conflict");

  // Deactivate Week 1
  const resDeactW1 = await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      status: "INACTIVE",
    }),
    idParams(w1Id)
  );
  const bodyDeactW1 = await json(resDeactW1);
  assert(
    resDeactW1.status === 200 &&
    bodyDeactW1.week?.status === "INACTIVE",
    "Admin deactivates Week 1 (status set to INACTIVE)"
  );

  // Reactivate Week 1
  const resActW1 = await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      status: "ACTIVE",
    }),
    idParams(w1Id)
  );
  const bodyActW1 = await json(resActW1);
  assert(
    resActW1.status === 200 &&
    bodyActW1.week?.status === "ACTIVE",
    "Admin re-activates Week 1 (status set to ACTIVE)"
  );

  // Deactivate Week 3 explicitly
  const w3DocId = `lpw_${SCHOOL_A}_${WEEK3_START}`;
  await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w3DocId}`, "PUT", {
      status: "INACTIVE",
    }),
    idParams(w3DocId)
  );

  // ----------------------------------------------------
  // SECTION 5: Teacher Schedule & Deactivated Week Enforcement
  // ----------------------------------------------------
  console.log("\n--- Section 5: Teacher Schedule & Deactivated Week Enforcement ---");

  // Options endpoint for Teacher
  const resOpt = await optionsGet(req(teacherTokenA, "/api/lesson-plans/options"));
  const bodyOpt = await json(resOpt);
  assert(resOpt.status === 200, "Teacher fetches lesson plan options successfully");

  const optionWeekIds = bodyOpt.weeks?.map((w: any) => w.weekId) || [];
  assert(optionWeekIds.includes(WEEK1_START), "Active Week 1 appears in teacher available weeks");
  assert(optionWeekIds.includes(WEEK2_START), "Active Week 2 appears in teacher available weeks");
  assert(!optionWeekIds.includes(WEEK3_START), "Deactivated Week 3 does NOT appear in teacher available weeks");

  // Teacher submits a plan for ACTIVE Week 1
  const daysWeek1 = [
    { date: WEEK1_START, content: "Introduction to Grammar" },
    { date: addDaysUTC(WEEK1_START, 1), content: "Nouns & Pronouns" },
    { date: addDaysUTC(WEEK1_START, 2), content: "Verbs & Tenses" },
    { date: addDaysUTC(WEEK1_START, 3), content: "Practice Exercises" },
    { date: addDaysUTC(WEEK1_START, 4), content: "Spelling Quiz" },
    { date: WEEK1_END, content: "Weekly Recap" },
  ];
  const resSubmitW1 = await plansSave(req(teacherTokenA, "/api/lesson-plans", "POST", {
    classId: "cls-cw-1",
    subjectId: "sb-cw-eng",
    weekId: WEEK1_START,
    days: daysWeek1,
    action: "SAVE_DRAFT",
  }));
  assert(resSubmitW1.status === 201, "Teacher successfully saves draft for active Week 1 (status 201)");

  // Teacher tries to create a new lesson plan against DEACTIVATED Week 3
  const daysWeek3 = [
    { date: WEEK3_START, content: "Sports day plan" },
  ];
  const resSubmitDeactivated = await plansSave(req(teacherTokenA, "/api/lesson-plans", "POST", {
    classId: "cls-cw-1",
    subjectId: "sb-cw-eng",
    weekId: WEEK3_START,
    days: daysWeek3,
    action: "SAVE_DRAFT",
  }));
  const bodySubmitDeact = await json(resSubmitDeactivated);
  assert(
    resSubmitDeactivated.status === 403 &&
    bodySubmitDeact.error?.includes("deactivated by an administrator"),
    "Teacher cannot create a new lesson plan against a deactivated week (403 Forbidden)"
  );

  // Now, if an admin deactivates Week 1 AFTER a lesson plan already exists:
  await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      status: "INACTIVE",
    }),
    idParams(w1Id)
  );

  // The historical lesson plan must STILL be accessible and retrievable
  const planIdW1 = `lp_${SCHOOL_A}_tch-cw-a1_cls-cw-1_sb-cw-eng_${WEEK1_START}`;
  const resGetHist = await plansGet(req(teacherTokenA, `/api/lesson-plans?classId=cls-cw-1&subjectId=sb-cw-eng&weekId=${WEEK1_START}`));
  const bodyHist = await json(resGetHist);
  assert(
    resGetHist.status === 200 &&
    bodyHist.plans?.some((p: any) => p.id === planIdW1),
    "Historical lesson plan remains accessible and intact after week is deactivated"
  );

  // Dates cannot be edited once plans are filed
  const resEditDatesWithPlans = await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      startDate: addDaysUTC(WEEK1_START, -1),
      endDate: addDaysUTC(WEEK1_START, 4),
    }),
    idParams(w1Id)
  );
  assert(
    resEditDatesWithPlans.status === 409,
    "Dates cannot be modified for a week that already holds lesson plans (409 Conflict)"
  );

  // Week with plans cannot be deleted
  const resDelWithPlans = await weekDelete(req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`), idParams(w1Id));
  assert(
    resDelWithPlans.status === 409,
    "A week that already holds lesson plans cannot be deleted (409 Conflict)"
  );

  // Re-activate Week 1 to restore its active status
  await weekPut(
    req(adminTokenA, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      status: "ACTIVE",
    }),
    idParams(w1Id)
  );

  // ----------------------------------------------------
  // SECTION 6: Multi-Tenant Isolation
  // ----------------------------------------------------
  console.log("\n--- Section 6: Multi-Tenant Isolation ---");

  // School B admin listing weeks does NOT see School A's weeks
  const resListB = await weeksGet(req(adminTokenB, "/api/lesson-plan-weeks"));
  const bodyListB = await json(resListB);
  const labelsB = bodyListB.weeks?.map((w: any) => w.label) || [];
  assert(
    !labelsB.includes("Orientation & Foundation") && !labelsB.includes("Grammar & Composition"),
    "School B admin cannot see School A's custom weeks"
  );

  // School B admin cannot modify School A's week
  const resHackPut = await weekPut(
    req(adminTokenB, `/api/lesson-plan-weeks/${w1Id}`, "PUT", {
      label: "Hacked by School B",
    }),
    idParams(w1Id)
  );
  assert(resHackPut.status === 404, "School B admin cannot edit School A's week (404 Not Found)");

  // School B admin cannot delete School A's week
  const resHackDel = await weekDelete(req(adminTokenB, `/api/lesson-plan-weeks/${w1Id}`), idParams(w1Id));
  assert(resHackDel.status === 404, "School B admin cannot delete School A's week (404 Not Found)");

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log("\n==================================================");
  console.log(`LESSON PLAN CUSTOM WEEKS TEST RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
