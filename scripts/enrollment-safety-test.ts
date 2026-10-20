/**
 * Enrollment safety on top of the production student-account implementation:
 *  - admission numbers: atomic per-school counter, continues existing numbers, safe first-time
 *    initialisation under concurrency, never reissues a number (manual, imported, or legacy)
 *  - idempotent enrollment: a retried submission never creates a second student; a reused key
 *    for a different student is refused rather than answered with the wrong record
 *  - school scoping of both
 *
 * Runs against the in-memory store (tsx does not load .env.local, so no Firebase project is
 * touched). The Firestore transaction and Firebase Authentication code paths are NOT exercised
 * here — only their in-memory equivalents.
 */
import { NextRequest } from "next/server";
import { POST as studentsPost } from "../src/app/api/students/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import {
  getStudentsServer,
  peekCounterServer,
  saveClassServer,
  saveStudentServer,
  updateSchoolSettingsServer,
} from "../src/lib/firebase/server-db";
import {
  admissionCounterKey,
  admissionSequenceOf,
  allocateAdmissionNumbers,
  reserveGivenAdmissionNumbers,
} from "../src/lib/student-identifiers";
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
function req(token: string | null, url: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  const headers = new Headers({ "x-forwarded-for": `10.44.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`, ...extra });
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost:3000${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("ENROLLMENT SAFETY (admission counter, idempotency)");
  console.log("==================================================");

  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const A = "school-enr-a";
  const B = "school-enr-b";
  const C = "school-enr-c";
  for (const id of [A, B, C]) {
    await updateSchoolSettingsServer({
      id, schoolId: id, schoolName: id, campusName: "Main", motto: "", address: "1 Road", phone: "0300",
      email: `office@${id}.edu.pk`, principalName: "Head", academicYear: YEAR, gradingScale: DEFAULT_GRADING_SCALE, updatedAt: now,
    } as any);
    await saveClassServer({ id: `cls-${id}`, schoolId: id, name: "Class 4", section: "A", numericLevel: 4, capacity: 80, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now });
  }
  const legacy = (id: string, schoolId: string, admissionNo: string, year = "2020-2021") =>
    saveStudentServer({
      id, schoolId, admissionNo, fullName: `Legacy ${id}`, fatherName: "F", gender: "MALE", classId: `cls-${schoolId}`, section: "A",
      rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 0, discount: 0,
      academicYear: year, createdAt: now, updatedAt: now,
    });
  // Numbers issued before the counter existed (older year prefix, a gap, a non-standard number).
  await legacy("std-enr-old1", A, "STD-2020-041");
  await legacy("std-enr-old2", A, "STD-2021-007");
  await legacy("std-enr-odd", A, "ADM/2019/900");

  const session = (uid: string, schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role: "ADMIN", schoolId, name: uid } as any);
  const ADMIN = await session("uid-enr-admin", A);
  const ADMIN_B = await session("uid-enr-admin-b", B);
  const body = (first: string, last: string, classId = `cls-${A}`) => ({
    firstName: first, lastName: last, gender: "Female", classId, guardianName: "Guardian", guardianRelation: "Father", guardianPhone: "03001234567",
  });
  const enroll = (token: string, first: string, last: string, key?: string, classId?: string) =>
    studentsPost(req(token, "/api/students", "POST", body(first, last, classId), key ? { "idempotency-key": key } : {}));
  const year = new Date().getFullYear();

  // ------------------------------------------------------------ counter initialisation + concurrency
  {
    assert((await peekCounterServer(admissionCounterKey(A))) === 1, "Before first use the admission counter does not exist");
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => enroll(ADMIN, "Para", `Llel${i}`, `parallel-key-${i}-abcdefghij`)));
    const bodies = await Promise.all(responses.map(json));
    assert(responses.every((r) => r.status === 201), "10 concurrent first-time enrollments all succeed");
    const numbers = bodies.map((b) => b.student?.admissionNo);
    const seqs = numbers.map(admissionSequenceOf).sort((a, b) => a - b);
    assert(new Set(numbers).size === 10, "Concurrent first-time enrollments never share an admission number (safe counter initialisation)");
    assert(seqs[0] === 42 && seqs[9] === 51, "The counter is seeded once from the highest existing number (STD-2020-041 -> 42..51)");
    assert(numbers.every((n) => new RegExp(`^STD-${year}-\\d{3,}$`).test(n)), "Admission numbers keep the STD-YYYY-NNN format");
    const logins = bodies.map((b) => b.student?.email);
    assert(new Set(logins).size === 10, "Login IDs from production's counter stay unique alongside the admission counter");
    assert((await peekCounterServer(admissionCounterKey(A))) === 52, "The counter document stores the next value in production's { next } format");

    const legacyStill = (await getStudentsServer(A, undefined, undefined, undefined, undefined, { allSessions: true })).filter((s) => s.id.startsWith("std-enr-o"));
    assert(legacyStill.length === 3 && legacyStill.some((s) => s.admissionNo === "ADM/2019/900"), "Existing records are untouched by counter initialisation");

    await legacy("std-enr-manual", A, `STD-${year}-052`, YEAR);
    const next = await json(await enroll(ADMIN, "After", "Manual"));
    assert(next.student?.admissionNo === `STD-${year}-053`, "A number already held by a record (e.g. typed in by hand) is skipped, not reissued");

    await reserveGivenAdmissionNumbers(A, [`STD-${year}-070`]);
    assert((await allocateAdmissionNumbers(A, 1))[0] === `STD-${year}-071`, "Numbers kept from an import move the counter past them");
    await reserveGivenAdmissionNumbers(A, [`STD-${year}-010`]);
    assert((await allocateAdmissionNumbers(A, 1))[0] === `STD-${year}-072`, "Reserving a lower number never moves the counter backwards");

    // Import path for a school whose counter doesn't exist yet: reserving must seed, not skip seeding.
    await legacy("std-enr-c-old", C, "STD-2022-300");
    await reserveGivenAdmissionNumbers(C, [`STD-${year}-005`]);
    assert((await allocateAdmissionNumbers(C, 1))[0] === `STD-${year}-301`, "Reserving on a new counter seeds from the roster first (no reissue of STD-...-300)");

    assert((await allocateAdmissionNumbers(B, 1))[0] === `STD-${year}-001`, "Each school has its own admission sequence");
  }

  // ------------------------------------------------------------ idempotent enrollment
  {
    const key = "retry-key-0123456789abcdef";
    const first = await enroll(ADMIN, "Retry", "Safe", key);
    const firstJson = await json(first);
    const id = firstJson.student?.id;
    assert(first.status === 201 && firstJson.temporaryPassword, "Enrollment with an Idempotency-Key succeeds and returns the one-time password");
    const again = await enroll(ADMIN, "Retry", "Safe", key);
    const againJson = await json(again);
    assert(again.status === 200 && againJson.replayed === true && againJson.student?.id === id, "A retry of the same submission returns the student already created");
    assert(!againJson.temporaryPassword, "A replay never reissues or reveals a password");
    assert(againJson.student?.admissionNo === firstJson.student.admissionNo && againJson.student?.email === firstJson.student.email, "A replay keeps the original admission number and login ID");
    const count = (name: string) => getStudentsServer(A, undefined, name, undefined, undefined, { allSessions: true }).then((l) => l.filter((s) => s.fullName === name).length);
    assert((await count("Retry Safe")) === 1, "Only one student exists after the retry");

    const raceKey = "race-key-0123456789abcdefgh";
    const race = await Promise.all([enroll(ADMIN, "Race", "Twice", raceKey), enroll(ADMIN, "Race", "Twice", raceKey)]);
    assert(race.every((r) => r.status === 201 || r.status === 200 || r.status === 409), "Two simultaneous submissions with one key both get a definite answer");
    assert((await count("Race Twice")) === 1, "Two simultaneous submissions with one key create exactly one student");

    const misuse = await enroll(ADMIN, "Someone", "Else", key);
    assert(misuse.status === 409 && !(await json(misuse)).student, "A reused key with different student details is refused, never answered with another student's record");
    assert((await count("Someone Else")) === 0, "The refused request creates nothing");

    const twin1 = await enroll(ADMIN, "Twin", "Sister", "twin-key-aaaaaaaaaaaaaaaa");
    const twin2 = await enroll(ADMIN, "Twin", "Sister", "twin-key-bbbbbbbbbbbbbbbb");
    assert(twin1.status === 201 && twin2.status === 201 && (await count("Twin Sister")) === 2, "Two genuinely different enrollments (different keys) are never merged, even with the same name");

    assert((await enroll(ADMIN, "Bad", "Key", "short")).status === 400, "A malformed Idempotency-Key is rejected");
    assert((await enroll(ADMIN, "No", "Key")).status === 201, "Enrollment without a key still works (older clients)");

    const other = await enroll(ADMIN_B, "Retry", "Safe", key, `cls-${B}`);
    const otherJson = await json(other);
    assert(other.status === 201 && otherJson.student?.id !== id && otherJson.student?.schoolId === B, "The same key in another school never returns this school's student");
  }

  console.log(`\nEnrollment safety tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Enrollment safety test suite crashed:", e);
  process.exit(1);
});
