/**
 * Student list: Firestore reads per view, and freshness after edits (write-through cache).
 *
 * Runs against the LOCAL Firestore emulator (npm run test:quota) with the quota seed school
 * (300 active students plus older-session records) and counts real document reads with
 * scripts/lib/firestore-op-counter.ts. Before this change every student write dropped the cached
 * roster, so the next list view re-read every student document (~1 read per student, measured
 * ~385 on this seed); now the instance that made the write updates its cached lists in place.
 *
 * Covers: cold/warm/after-edit read counts; edits, enrollment, class moves, status changes and
 * deletes visible immediately in the whole-school, per-class and per-status lists; a failed write
 * falls back to a full re-read (never shows an unsaved change); school isolation; the optional
 * ?page/&pageSize pagination (bounds, totals, teacher scoping).
 *
 * Safety: refuses to run unless FIRESTORE_EMULATOR_HOST is set and the project id is demo-*.
 */
import { prepareEmulatorEnv } from "./lib/emulator-env";

prepareEmulatorEnv();

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

async function main() {
  const { installFirestoreOpCounter, measure, grpcError } = await import("./lib/firestore-op-counter");
  installFirestoreOpCounter();
  const { NextRequest } = await import("next/server");
  const { adminDb } = await import("../src/lib/firebase/admin");
  const { seedQuotaSchool, ids, SCHOOL } = await import("./lib/quota-seed");
  const { createSessionCookieServer } = await import("../src/lib/firebase/server-auth");
  const { resetServerCaches } = await import("../src/lib/server-cache");
  const db = await import("../src/lib/firebase/server-db");
  const studentsRoute = await import("../src/app/api/students/route");

  console.log("==================================================");
  console.log("STUDENT LIST READS / WRITE-THROUGH CACHE (Firestore emulator)");
  console.log("==================================================");
  await seedQuotaSchool(adminDb);

  // A second school with its own students, to prove isolation.
  const B = "demo-quota-school-b";
  const now = new Date().toISOString();
  const seedB = await db.getStudentByIdServer(SCHOOL, "std-1");
  for (let i = 0; i < 3; i++) {
    await adminDb.collection("students").doc(`stdb-${i}`).set({
      ...seedB, id: `stdb-${i}`, schoolId: B, fullName: `Other School ${i}`, admissionNo: `B-${i}`, classId: "clsb-0", createdAt: now, updatedAt: now,
    });
  }

  await adminDb.collection("users").doc("u-admin-b").set({
    uid: "u-admin-b", email: "admin@b.test", name: "B", role: "ADMIN", schoolId: B, status: "ACTIVE", createdAt: now, updatedAt: now,
  });

  const admin = await createSessionCookieServer({ uid: ids.admin.uid, email: ids.admin.email, role: "ADMIN", schoolId: SCHOOL, name: "Admin" } as any);
  const teacher = await createSessionCookieServer({
    uid: ids.teacher.uid, email: ids.teacher.email, role: "TEACHER", schoolId: SCHOOL, name: "Teacher 0", teacherId: ids.teacher.teacherId,
  } as any);
  let ip = 1;
  const req = (token: string, url: string) =>
    new NextRequest("http://localhost:3000" + url, {
      headers: new Headers({ "x-forwarded-for": `10.77.${Math.floor(ip / 250)}.${ip++ % 250}`, cookie: `allied_session=${token}` }),
    });
  const list = async (url = "/api/students?search=", token = admin) => {
    const { result, ops } = await measure(async () => {
      const res = await studentsRoute.GET(req(token, url));
      return { status: res.status, body: await res.json() };
    });
    return { ...result, reads: ops.reads };
  };
  const byId = (body: any, id: string) => (body.students || []).find((s: any) => s.id === id);

  // ------------------------------------------------------------ read counts
  resetServerCaches();
  const cold = await list();
  assert(cold.status === 200 && cold.body.students.length > 200, `Cold instance: the list loads (${cold.body.students?.length} students, ${cold.reads} reads)`);
  const warm = await list();
  assert(warm.reads <= 2, `Warm instance, no edits: ${warm.reads} reads (only the session check, never the roster)`);

  const target = cold.body.students[5];
  const original = await db.getStudentByIdServer(SCHOOL, target.id);
  const edit = await measure(() => db.saveStudentServer({ ...original!, fullName: "Renamed Student", guardianPhone: "03009999999" }));
  const afterEdit = await list();
  assert(afterEdit.reads <= 2, `List right after editing a student: ${afterEdit.reads} reads (was ~1 read per student before this change)`);
  assert(byId(afterEdit.body, target.id)?.fullName === "Renamed Student" && byId(afterEdit.body, target.id)?.guardianPhone === "03009999999", "The edit is visible immediately in the list (fresh data)");
  assert(afterEdit.body.students.length === cold.body.students.length, "No student duplicated or lost by the in-place update");
  assert(edit.ops.writes >= 1, "The edit was really written to Firestore");
  const fromDb = (await adminDb.collection("students").doc(target.id).get()).data();
  assert(fromDb?.fullName === "Renamed Student" && fromDb?.admissionNo === original!.admissionNo, "Firestore has the edit and the fields it didn't change (merge)");
  const cachedRecord = byId(afterEdit.body, target.id);
  assert(cachedRecord.admissionNumber === original!.admissionNo && cachedRecord.classId === original!.classId, "The cached copy keeps the fields the edit didn't touch");

  // ------------------------------------------------------------ class and status filtered lists
  const cls = original!.classId;
  const otherCls = ids.classIds.find((c) => c !== cls)!;
  await list(`/api/students?classId=${cls}&search=`);
  await list(`/api/students?classId=${otherCls}&search=`);
  await list(`/api/students?status=ACTIVE&search=`);
  await db.saveStudentServer({ ...(await db.getStudentByIdServer(SCHOOL, target.id))!, classId: otherCls });
  const oldClass = await list(`/api/students?classId=${cls}&search=`);
  const newClass = await list(`/api/students?classId=${otherCls}&search=`);
  assert(!byId(oldClass.body, target.id) && !!byId(newClass.body, target.id), "A class move takes the student out of the old class list and into the new one");
  assert(oldClass.reads <= 2 && newClass.reads <= 2, `…without re-reading either roster (${oldClass.reads} + ${newClass.reads} reads)`);
  await db.saveStudentServer({ ...(await db.getStudentByIdServer(SCHOOL, target.id))!, status: "INACTIVE" });
  const activeOnly = await list(`/api/students?status=ACTIVE&search=`);
  assert(!byId(activeOnly.body, target.id) && activeOnly.reads <= 2, "A status change removes the student from the ACTIVE list immediately");
  const all = await list();
  assert(byId(all.body, target.id)?.status === "INACTIVE", "…and the whole-school list shows the new status");

  // ------------------------------------------------------------ enrollment through the real API, then delete
  const enroll = await studentsRoute.POST(
    new NextRequest("http://localhost:3000/api/students", {
      method: "POST",
      headers: new Headers({ "x-forwarded-for": "10.77.250.1", cookie: `allied_session=${admin}`, "content-type": "application/json" }),
      body: JSON.stringify({ firstName: "Fresh", lastName: "Enrollee", classId: cls, guardianName: "G", guardianPhone: "03001234567", gender: "Female" }),
    })
  );
  const enrolled = (await enroll.json()).student;
  const afterEnroll = await list();
  assert(enroll.status === 201 && !!byId(afterEnroll.body, enrolled.id), "A newly enrolled student appears in the list immediately");
  assert(afterEnroll.reads <= 2, `List after an enrollment: ${afterEnroll.reads} reads`);
  await db.deleteStudentServer(SCHOOL, enrolled.id);
  const afterDelete = await list();
  assert(!byId(afterDelete.body, enrolled.id) && afterDelete.reads <= 2, "A deleted student disappears immediately, without a roster re-read");

  // ------------------------------------------------------------ failed write: never show an unsaved change
  const proto = Object.getPrototypeOf(adminDb.collection("students").doc("probe"));
  const realSet = proto.set;
  proto.set = function () {
    return Promise.reject(grpcError(14, "UNAVAILABLE", "simulated write failure"));
  };
  let threw = false;
  try {
    await db.saveStudentServer({ ...(await db.getStudentByIdServer(SCHOOL, target.id))!, fullName: "Never Saved" });
  } catch {
    threw = true;
  } finally {
    proto.set = realSet;
  }
  const afterFailure = await list();
  assert(threw, "A failed write is reported to the caller");
  assert(byId(afterFailure.body, target.id)?.fullName === "Renamed Student", "After a failed write the list shows what Firestore really has (not the unsaved change)");
  assert(afterFailure.reads > 100, `…because the failed write dropped the cached lists and the next view re-read them (${afterFailure.reads} reads)`);

  // ------------------------------------------------------------ school isolation
  const adminB = await createSessionCookieServer({ uid: "u-admin-b", email: "admin@b.test", role: "ADMIN", schoolId: B, name: "B" } as any);
  const bBefore = await list("/api/students?search=", adminB);
  await db.saveStudentServer({ ...(await db.getStudentByIdServer(SCHOOL, target.id))!, fullName: "Renamed Again" });
  const bAfter = await list("/api/students?search=", adminB);
  assert(bBefore.body.students?.length === 3 && bAfter.body.students?.length === 3, "Another school's list has only its own 3 students");
  assert(!bAfter.body.students.some((s: any) => s.id === target.id || /Renamed/.test(s.fullName)), "Editing this school's student never enters another school's cached list");
  assert(!(await list()).body.students.some((s: any) => s.id.startsWith("stdb-")), "This school's list never contains the other school's students");

  // ------------------------------------------------------------ pagination
  const total = (await list()).body.students.length;
  const p1 = await list("/api/students?search=&page=1&pageSize=50");
  const p2 = await list("/api/students?search=&page=2&pageSize=50");
  assert(p1.status === 200 && p1.body.students.length === 50 && p1.body.pagination?.total >= total && p1.body.pagination.hasMore === true, "Page 1 returns 50 students with the total and hasMore");
  assert(p2.body.students.length === 50 && !p2.body.students.some((s: any) => p1.body.students.some((t: any) => t.id === s.id)), "Page 2 continues without overlap");
  assert(p1.reads <= 2 && p2.reads <= 2, `Paging is served from the cached roster (${p1.reads} + ${p2.reads} reads)`);
  const last = await list(`/api/students?search=&page=${Math.ceil(p1.body.pagination.total / 50)}&pageSize=50`);
  assert(last.body.pagination.hasMore === false && last.body.students.length > 0, "The last page reports hasMore=false");
  assert((await list("/api/students?page=0")).status === 400 && (await list("/api/students?page=1&pageSize=101")).status === 400, "Invalid page or pageSize is rejected (400)");
  assert(!("pagination" in (await list()).body), "Without ?page the response is unchanged (no pagination block)");
  const tPage = await list("/api/students?search=&page=1&pageSize=100", teacher);
  const { requireTeacherAllocation } = await import("../src/lib/academic-access");
  const { getAuthenticatedUser } = await import("../src/lib/firebase/server-auth");
  const teacherUser = await getAuthenticatedUser(req(teacher, "/api/students"));
  const alloc = (await requireTeacherAllocation(teacherUser!)).classIds;
  assert(
    tPage.status === 200 && tPage.body.students.length > 0 && tPage.body.students.every((s: any) => alloc.has(s.classId)) &&
      tPage.body.pagination.total < p1.body.pagination.total,
    `A teacher's pages contain only students of their allocated classes (${tPage.body.pagination?.total} of ${p1.body.pagination?.total})`
  );

  console.log(`\nStudent list read tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
