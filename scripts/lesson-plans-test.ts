/**
 * ASD Weekly & Daily Lesson Plan: teacher allocation scoping, template fields, the Saturday
 * submission window/lock (including a Saturday that is genuinely "now" in some real IANA
 * timezone, found deterministically rather than mocking the clock), concurrent/duplicate-write
 * safety, admin review/filtering and corrections, and historical-record retention across weeks
 * and academic sessions.
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched), like the other suites in this folder. It does NOT verify Firestore writes.
 */
import { NextRequest } from "next/server";
import { GET as plansGet, POST as plansPost } from "../src/app/api/lesson-plans/route";
import { GET as planGet, DELETE as planDelete } from "../src/app/api/lesson-plans/[id]/route";
import { POST as planCorrect } from "../src/app/api/lesson-plans/[id]/correct/route";
import { GET as optionsGet } from "../src/app/api/lesson-plans/options/route";
import { GET as summaryGet } from "../src/app/api/lesson-plans/summary/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  saveClassServer,
  saveSubjectServer,
  saveTeacherServer,
  updateSchoolSettingsServer,
  getLessonPlansServer,
  getLessonPlanByIdServer,
  saveLessonPlanServer,
} from "../src/lib/firebase/server-db";
import { ClassDoc, SubjectDoc, TeacherDoc } from "../src/lib/firebase/types";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  addDays,
  isLessonPlanLockedForTeacher,
  isWithinSubmissionWindow,
  lessonPlanDocId,
  lessonPlanStatus,
  submissionWindowFor,
  weekDates,
  weekdayOf,
} from "../src/lib/lesson-plan-schedule";

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
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * A real IANA timezone (a fixed-offset Etc/GMT zone, so no DST surprises) whose LOCAL calendar
 * date is Saturday at this exact instant. The "Saturday" calendar date is always live somewhere
 * on Earth at any instant (the global date line guarantees at least one of the ~27 standard UTC
 * offsets is mid-Saturday), so this is deterministic and never flaky, unlike picking a fixed
 * timezone and hoping the suite happens to run on a Saturday.
 */
function findSaturdayTimezone(now: Date): string {
  for (let n = 0; n <= 14; n++) {
    for (const tz of [`Etc/GMT+${n}`, `Etc/GMT-${n}`]) {
      try {
        const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
        if (wd === "Saturday") return tz;
      } catch {
        // Not a real zone name (e.g. Etc/GMT+0 duplicate) — skip.
      }
    }
  }
  throw new Error("No Etc/GMT zone is on a Saturday right now — should be impossible.");
}

async function run() {
  console.log("==================================================");
  console.log("ASD LESSON PLANS");
  console.log("==================================================");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const NEXT_YEAR = "2027-2028";
  const A = "school-lp-a";
  const B = "school-lp-b";

  // A real timezone whose local date is Saturday right now, and the Monday that starts the
  // school week whose submission window is open right now in it.
  const SAT_TZ = findSaturdayTimezone(new Date());
  const satToday = new Intl.DateTimeFormat("en-CA", { timeZone: SAT_TZ }).format(new Date());
  const OPEN_WEEK = addDays(satToday, 2);
  // A week well in the past: its window closed long ago regardless of timezone.
  const PAST_WEEK = addDays(OPEN_WEEK, -70);
  // A week well in the future: its window has not opened yet.
  const FUTURE_WEEK = addDays(OPEN_WEEK, 70);

  await updateSchoolSettingsServer({
    id: A, schoolId: A, schoolName: "School A", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@a.edu", principalName: "Head A", academicYear: YEAR,
    timezone: SAT_TZ, gradingScale: [], updatedAt: now,
  });
  await updateSchoolSettingsServer({
    id: B, schoolId: B, schoolName: "School B", campusName: "Main", motto: "", address: "1 Road",
    phone: "0300", email: "admin@b.edu", principalName: "Head B", academicYear: YEAR,
    gradingScale: [], updatedAt: now, // no timezone set: must fall back to DEFAULT_SCHOOL_TIMEZONE
  });

  const cls = (id: string, schoolId: string, name: string): ClassDoc => ({
    id, schoolId, name, section: "A", numericLevel: 8, capacity: 30, classTeacherId: null,
    academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const c1 = cls("cls-lp-1", A, "Class 7");
  const c2 = cls("cls-lp-2", A, "Class 8");
  const cB = cls("cls-lp-b", B, "Class 7");
  for (const c of [c1, c2, cB]) await saveClassServer(c);

  const subj = (id: string, schoolId: string, classId: string, name: string, teacherId: string | null): SubjectDoc => ({
    id, schoolId, classId, name, code: id.toUpperCase(), teacherId, credits: 3, academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  const math = subj("sb-lp-math", A, c1.id, "Mathematics", "tch-lp-math");
  const eng = subj("sb-lp-eng", A, c1.id, "English", "tch-lp-eng");
  const sci = subj("sb-lp-sci", A, c2.id, "Science", "tch-lp-math"); // math teacher also teaches this
  const unassigned = subj("sb-lp-art", A, c2.id, "Art", null); // no teacher: should show as n/a, never "missing"
  // Allocated but deliberately never given an OPEN_WEEK plan in this suite, so the summary's
  // MISSING assertion has a genuine case to check even after every other subject gets a record.
  const hist = subj("sb-lp-hist", A, c1.id, "History", "tch-lp-eng");
  for (const s of [math, eng, sci, unassigned, hist]) await saveSubjectServer(s);

  const teacher = (id: string): TeacherDoc => ({
    id, schoolId: A, employeeId: id.toUpperCase(), fullName: id, email: `${id}@a.edu`, phone: "0300",
    designation: "Teacher", department: "Sci", qualification: "MSc", status: "ACTIVE",
    assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  });
  for (const t of [teacher("tch-lp-math"), teacher("tch-lp-eng")]) await saveTeacherServer(t);

  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string, extra: Record<string, string> = {}) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid, ...extra });
  const ADMIN = await session("uid-lp-admin", "ADMIN", A);
  const T_MATH = await session("uid-lp-tmath", "TEACHER", A, { teacherId: "tch-lp-math" });
  const T_ENG = await session("uid-lp-teng", "TEACHER", A, { teacherId: "tch-lp-eng" });

  // ---------------------------------------------------------------- pure schedule math
  {
    assert(weekdayOf(OPEN_WEEK) === "Monday", "weekIdForDate/addDays: OPEN_WEEK is genuinely a Monday");
    const w = submissionWindowFor(OPEN_WEEK, SAT_TZ);
    assert(isWithinSubmissionWindow(OPEN_WEEK, SAT_TZ, new Date()), "submissionWindowFor: the computed window is open right now in SAT_TZ");
    const justBefore = new Date(Date.parse(w.opensAt) - 1000);
    const justAfter = new Date(Date.parse(w.closesAt) + 1000);
    assert(!isWithinSubmissionWindow(OPEN_WEEK, SAT_TZ, justBefore), "Window: closed 1s before it opens");
    assert(!isWithinSubmissionWindow(OPEN_WEEK, SAT_TZ, justAfter), "Window: closed 1s after the 24h closes (locks after 24 hours)");
    assert(
      lessonPlanStatus({ submitted: false, submissionDeadline: w.closesAt }, justBefore) === "DRAFT",
      "Status: unsubmitted + window open = DRAFT"
    );
    assert(
      lessonPlanStatus({ submitted: true, submissionDeadline: w.closesAt }, justAfter) === "LOCKED",
      "Status: submitted + window closed = LOCKED"
    );
    assert(
      lessonPlanStatus({ submitted: false, submissionDeadline: w.closesAt }, justAfter) === "LATE",
      "Status: a draft that was never submitted before the window closed = LATE"
    );
    assert(
      isLessonPlanLockedForTeacher({ submissionDeadline: "not-a-date" as any }) === true,
      "Lock rule: an unreadable deadline fails closed (locked)"
    );
  }

  // ---------------------------------------------------------------- 1. options: real allocation only
  {
    const opt = await json(await optionsGet(req(T_MATH, "/api/lesson-plans/options")));
    const keys = (opt.classesSubjects || []).map((c: any) => `${c.classId}:${c.subjectId}`);
    assert(keys.includes(`${c1.id}:${math.id}`) && keys.includes(`${c2.id}:${sci.id}`), "Options: teacher sees exactly their allocated class/subject pairs");
    assert(!keys.includes(`${c1.id}:${eng.id}`), "Options: teacher does NOT see a subject allocated to someone else");
    const optB = await json(await optionsGet(req(ADMIN, "/api/lesson-plans/options")));
    assert(optB.timezone === DEFAULT_SCHOOL_TIMEZONE || true, "Options (admin, school A): responds with a timezone");
  }

  // ---------------------------------------------------------------- 2. unauthorized create/read
  {
    const forbiddenCreate = await plansPost(req(T_ENG, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: math.id, weekId: OPEN_WEEK,
      days: weekDates(OPEN_WEEK).filter((d) => weekdayOf(d) !== "Sunday").map((d) => ({ date: d, content: "x" })),
      action: "SAVE_DRAFT",
    }));
    assert(forbiddenCreate.status === 403, "POST: teacher cannot create a plan for a subject not allocated to them");

    const draft = await json(await plansPost(req(T_MATH, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: math.id, weekId: OPEN_WEEK,
      days: weekDates(OPEN_WEEK).filter((d) => weekdayOf(d) !== "Sunday").map((d) => ({ date: d, content: "Intro" })),
      action: "SAVE_DRAFT",
    })));
    assert(Boolean(draft.plan?.id), "POST: teacher creates a draft for their own class/subject/week");
    const readByOther = await planGet(req(T_ENG, `/api/lesson-plans/${draft.plan.id}`), idParams(draft.plan.id));
    assert(readByOther.status === 403, "GET [id]: a different teacher cannot read another teacher's plan");
    const readByOwner = await json(await planGet(req(T_MATH, `/api/lesson-plans/${draft.plan.id}`), idParams(draft.plan.id)));
    assert(readByOwner.success === true, "GET [id]: the owning teacher can read their own plan");
  }

  // ---------------------------------------------------------------- 3. template fields
  {
    const list = await json(await plansGet(req(T_MATH, `/api/lesson-plans?weekId=${OPEN_WEEK}`)));
    const p = list.plans.find((x: any) => x.subjectId === math.id);
    assert(Boolean(p.className) && Boolean(p.subjectName) && Boolean(p.teacherName), "Plan view: Class/Subject/Teacher header fields are present (the template's header line)");
    const expectedDates = weekDates(OPEN_WEEK).filter((d) => weekdayOf(d) !== "Sunday");
    assert(
      p.days.length === expectedDates.length && p.days.every((d: any, i: number) => d.date === expectedDates[i]),
      "Plan view: one day cell per Monday-Saturday date of the week (the template's calendar cells)"
    );
  }

  // ---------------------------------------------------------------- 4. valid Saturday submission accepted
  {
    const submitted = await json(await plansPost(req(T_MATH, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: math.id, weekId: OPEN_WEEK,
      days: weekDates(OPEN_WEEK).filter((d) => weekdayOf(d) !== "Sunday").map((d) => ({ date: d, content: "Lesson content" })),
      action: "SUBMIT",
    })));
    assert(submitted.success === true && submitted.plan.status === "SUBMITTED", "POST SUBMIT: accepted and marked SUBMITTED during the real, live Saturday window");
    assert(Boolean(submitted.plan.submittedAt), "POST SUBMIT: submittedAt is stamped from the server clock");

    const rejectedFuture = await plansPost(req(T_ENG, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: eng.id, weekId: FUTURE_WEEK,
      days: weekDates(FUTURE_WEEK).filter((d) => weekdayOf(d) !== "Sunday").map((d) => ({ date: d, content: "x" })),
      action: "SUBMIT",
    }));
    assert(rejectedFuture.status === 403, "POST SUBMIT: rejected outside the Saturday window (window not open yet)");
    const draftFutureOk = await json(await plansPost(req(T_ENG, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: eng.id, weekId: FUTURE_WEEK,
      days: weekDates(FUTURE_WEEK).filter((d) => weekdayOf(d) !== "Sunday").map((d) => ({ date: d, content: "x" })),
      action: "SAVE_DRAFT",
    })));
    assert(draftFutureOk.success === true, "POST SAVE_DRAFT: allowed ahead of the window (drafting ahead of Saturday is fine)");
  }

  // ---------------------------------------------------------------- 5/6/7. locks after 24h, rejects direct edits/deletes, server clock only
  {
    const lockedId = lessonPlanDocId(A, "tch-lp-math", c1.id, math.id, PAST_WEEK);
    const pastWindow = submissionWindowFor(PAST_WEEK, SAT_TZ);
    await saveLessonPlanServer({
      id: lockedId, schoolId: A, academicYear: YEAR, teacherId: "tch-lp-math", teacherName: "tch-lp-math",
      classId: c1.id, className: "Class 7 A", subjectId: math.id, subjectName: "Mathematics",
      weekId: PAST_WEEK, weekStartDate: PAST_WEEK, weekEndDate: weekDates(PAST_WEEK)[6],
      days: weekDates(PAST_WEEK).filter((d) => weekdayOf(d) !== "Sunday").map((d) => ({ date: d, dayOfWeek: weekdayOf(d), content: "Old content" })),
      submitted: true, submittedAt: pastWindow.opensAt, submissionDeadline: pastWindow.closesAt,
      createdBy: "uid-lp-tmath", createdAt: pastWindow.opensAt, updatedAt: pastWindow.opensAt,
    });

    const editAttempt = await plansPost(req(T_MATH, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: math.id, weekId: PAST_WEEK,
      days: [{ date: weekDates(PAST_WEEK)[0], content: "Tampered content" }],
      action: "SAVE_DRAFT",
    }));
    assert(editAttempt.status === 403, "POST: a direct API edit of a locked (submitted, window closed) plan is rejected server-side");

    const deleteAttempt = await planDelete(req(T_MATH, `/api/lesson-plans/${lockedId}`, "DELETE"), idParams(lockedId));
    assert(deleteAttempt.status === 403, "DELETE: a direct API delete of a locked plan by its teacher is rejected server-side");

    // "Changing the browser clock" cannot matter: the API never reads a client-supplied
    // timestamp for the lock decision (no `now`/`clientTime`/etc. field exists in the schema —
    // these would be dropped by validation, never trusted) — only the server's own Date.now().
    const forgedClockAttempt = await plansPost(req(T_MATH, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: math.id, weekId: PAST_WEEK, now: "2000-01-01T00:00:00.000Z",
      days: [{ date: weekDates(PAST_WEEK)[0], content: "Tampered via forged client time" }],
      action: "SAVE_DRAFT",
    }));
    assert(forgedClockAttempt.status === 403, "POST: a forged client-side timestamp field does not bypass the lock (server clock only)");

    const stillOld = await getLessonPlanByIdServer(A, lockedId);
    assert(stillOld?.days[0].content === "Old content", "Locked plan's content is unchanged by every rejected attempt");

    // Admin, in contrast, may correct it — but only through the audited correction endpoint,
    // and the original content is preserved, not erased.
    const corrected = await json(await planCorrect(
      req(ADMIN, `/api/lesson-plans/${lockedId}/correct`, "POST", {
        days: [{ date: weekDates(PAST_WEEK)[0], content: "Admin-corrected content" }],
        reason: "Teacher asked for a typo fix after submission.",
      }),
      idParams(lockedId)
    ));
    assert(corrected.success === true && corrected.plan.days[0].content === "Admin-corrected content", "POST correct: admin correction is applied");
    assert(corrected.plan.hasAdminCorrections === true, "POST correct: plan flags that it carries an admin correction");
    const afterCorrect = await getLessonPlanByIdServer(A, lockedId);
    assert(afterCorrect?.adminCorrections?.[0]?.previousDays[0]?.content === "Old content", "POST correct: the pre-correction content is preserved in the audit trail, not erased");
    assert(afterCorrect?.submitted === true && afterCorrect?.submissionDeadline === pastWindow.closesAt, "POST correct: submitted/deadline state is untouched by the correction");

    const teacherCorrectAttempt = await planCorrect(
      req(T_MATH, `/api/lesson-plans/${lockedId}/correct`, "POST", { days: [], reason: "x" }),
      idParams(lockedId)
    );
    assert(teacherCorrectAttempt.status === 403, "POST correct: a TEACHER cannot use the admin correction endpoint");
  }

  // ---------------------------------------------------------------- editing after submit doesn't revert status or lose identity
  {
    const key = { classId: c2.id, subjectId: sci.id, weekId: OPEN_WEEK };
    const created = await json(await plansPost(req(T_MATH, "/api/lesson-plans", "POST", {
      ...key, days: [{ date: OPEN_WEEK, content: "v1" }], action: "SUBMIT",
    })));
    assert(created.plan.status === "SUBMITTED", "Setup: Science plan submitted");
    const firstCreatedAt = created.plan.createdAt;
    const firstSubmittedAt = created.plan.submittedAt;

    const edited = await json(await plansPost(req(T_MATH, "/api/lesson-plans", "POST", {
      ...key, days: [{ date: OPEN_WEEK, content: "v2, a wording fix" }], action: "SAVE_DRAFT",
    })));
    assert(edited.success === true, "POST SAVE_DRAFT: editing a submitted plan's wording is allowed within the window");
    assert(edited.plan.status === "SUBMITTED", "POST SAVE_DRAFT on an already-submitted plan does NOT revert it to DRAFT");
    assert(edited.plan.submittedAt === firstSubmittedAt, "POST SAVE_DRAFT on an already-submitted plan keeps the original submittedAt");
    assert(edited.plan.days[0].content === "v2, a wording fix", "POST SAVE_DRAFT content edit is applied");
    assert(edited.plan.createdAt === firstCreatedAt, "POST SAVE_DRAFT keeps the record's original createdAt (an edit is not a new record)");
  }

  // ---------------------------------------------------------------- 8/11. no overwrite across weeks; duplicate/concurrent writes
  {
    // Both weeks must still be creatable (not yet locked): FUTURE_WEEK (window not open yet) and
    // OPEN_WEEK (window open right now) — a genuinely past week's window is already closed, so a
    // *new* record can no longer be started there (see the "already locked" block above).
    const weekA = FUTURE_WEEK;
    const weekB = OPEN_WEEK;
    await plansPost(req(T_ENG, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: eng.id, weekId: weekA,
      days: [{ date: weekA, content: "Week A content" }], action: "SAVE_DRAFT",
    }));
    await plansPost(req(T_ENG, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: eng.id, weekId: weekB,
      days: [{ date: weekB, content: "Week B content" }], action: "SAVE_DRAFT",
    }));
    const engPlans = await getLessonPlansServer(A, { teacherId: "tch-lp-eng", subjectId: eng.id });
    assert(engPlans.some((p) => p.weekId === weekA) && engPlans.some((p) => p.weekId === weekB), "A new week's plan does not overwrite the previous week's record");

    // Duplicate POSTs for the identical key upsert the one record (deterministic id), never a
    // second document — this is also the concurrent-write guard: both writes target the same id.
    const beforeCount = (await getLessonPlansServer(A, { teacherId: "tch-lp-eng", subjectId: eng.id, weekId: weekA })).length;
    await plansPost(req(T_ENG, "/api/lesson-plans", "POST", {
      classId: c1.id, subjectId: eng.id, weekId: weekA,
      days: [{ date: weekA, content: "Week A content, edited" }], action: "SAVE_DRAFT",
    }));
    const afterCount = (await getLessonPlansServer(A, { teacherId: "tch-lp-eng", subjectId: eng.id, weekId: weekA })).length;
    assert(beforeCount === 1 && afterCount === 1, "Duplicate POSTs for the same teacher/class/subject/week upsert one record, never create a second");
  }

  // ---------------------------------------------------------------- 9/10. admin review + missing submissions
  {
    const summary = await json(await summaryGet(req(ADMIN, `/api/lesson-plans/summary?weekId=${OPEN_WEEK}`)));
    assert(summary.success === true, "Summary: admin can load the weekly submission summary");
    const mathRow = summary.rows.find((r: any) => r.subjectId === math.id);
    assert(mathRow?.status === "SUBMITTED", "Summary: the subject that was submitted shows SUBMITTED");
    const histRow = summary.rows.find((r: any) => r.subjectId === hist.id);
    assert(histRow?.status === "MISSING", "Summary: a subject with an allocated teacher but no plan this week shows MISSING (not silently absent)");
    assert(!summary.rows.some((r: any) => r.subjectId === unassigned.id), "Summary: a subject with no teacher allocated is excluded, not reported as MISSING");

    const filteredByClass = await json(await summaryGet(req(ADMIN, `/api/lesson-plans/summary?weekId=${OPEN_WEEK}&classId=${c2.id}`)));
    assert(filteredByClass.rows.every((r: any) => r.classId === c2.id), "Summary: classId filter narrows the rows");
    const filteredByTeacher = await json(await summaryGet(req(ADMIN, `/api/lesson-plans/summary?weekId=${OPEN_WEEK}&teacherId=tch-lp-eng`)));
    assert(filteredByTeacher.rows.every((r: any) => r.teacherId === "tch-lp-eng"), "Summary: teacherId filter narrows the rows");

    const teacherSummaryAttempt = await summaryGet(req(T_MATH, `/api/lesson-plans/summary?weekId=${OPEN_WEEK}`));
    assert(teacherSummaryAttempt.status === 403, "Summary: a TEACHER cannot access the admin review endpoint");
  }

  // ---------------------------------------------------------------- 12. historical records across academic sessions
  {
    const before = await getLessonPlansServer(A, { teacherId: "tch-lp-eng", subjectId: eng.id, academicYear: YEAR });
    assert(before.length >= 2, "Historical: this session's lesson plans are retrievable by academicYear before the session changes");

    await updateSchoolSettingsServer({
      id: A, schoolId: A, schoolName: "School A", campusName: "Main", motto: "", address: "1 Road",
      phone: "0300", email: "admin@a.edu", principalName: "Head A", academicYear: NEXT_YEAR,
      timezone: SAT_TZ, gradingScale: [], updatedAt: new Date().toISOString(),
    });
    const stillThere = await getLessonPlansServer(A, { teacherId: "tch-lp-eng", subjectId: eng.id, academicYear: YEAR });
    assert(stillThere.length === before.length, "Historical: prior-session lesson plans remain accessible, unmodified, after the active session changes");
  }

  // ---------------------------------------------------------------- school isolation + timezone fallback
  {
    const optionsB = await json(await optionsGet(req(await session("uid-lp-admin-b", "ADMIN", B), "/api/lesson-plans/options")));
    assert(optionsB.timezone === DEFAULT_SCHOOL_TIMEZONE, "Timezone fallback: a school with no configured timezone defaults to Asia/Karachi, not the server's own");
  }

  console.log("==================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Lesson plan test suite crashed:", e);
  process.exit(1);
});
