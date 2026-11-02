/**
 * Regression: the admin student list used to cut a school at 250 students (a school with 389
 * showed 250). Runs against the in-memory store; touches no Firebase project.
 */
import { NextRequest } from "next/server";
import { GET as studentsGet } from "../src/app/api/students/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveStudentServer, updateSchoolSettingsServer } from "../src/lib/firebase/server-db";
import { ClassDoc, StudentDoc } from "../src/lib/firebase/types";

let passed = 0;
let failed = 0;
const assert = (c: unknown, n: string) => {
  if (c) { console.log(`[PASS] ${n}`); passed++; } else { console.error(`[FAIL] ${n}`); failed++; }
};

async function run() {
  const now = new Date().toISOString();
  const YEAR = "2026-2027";
  const S = "school-cap-test";
  await updateSchoolSettingsServer({
    id: S, schoolId: S, schoolName: "Cap", campusName: "", motto: "", address: "", phone: "", email: "a@cap.test",
    principalName: "P", academicYear: YEAR, gradingScale: [], updatedAt: now,
  });
  const cls = (id: string): ClassDoc => ({
    id, schoolId: S, name: id, section: "A", numericLevel: 1, capacity: 500, classTeacherId: null,
    academicYear: YEAR, createdAt: now, updatedAt: now,
  });
  await saveClassServer(cls("cls-cap-1"));
  await saveClassServer(cls("cls-cap-2"));
  const mk = (i: number): StudentDoc => ({
    id: `std-cap-${i}`, schoolId: S, admissionNo: `ADM-${i}`, fullName: `Student ${String(i).padStart(4, "0")}`, fatherName: "F",
    gender: "MALE", classId: i % 2 ? "cls-cap-1" : "cls-cap-2", section: "A", rollNo: String(i), status: "ACTIVE",
    guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 0, discount: 0, academicYear: YEAR,
    createdAt: now, updatedAt: now,
  });
  for (let i = 1; i <= 389; i++) await saveStudentServer(mk(i));

  const token = await createSessionCookieServer({ uid: "uid-cap-admin", email: "a@cap.test", role: "ADMIN", schoolId: S, name: "A" });
  const get = async (qs = "") => {
    const headers = new Headers({ cookie: `allied_session=${token}`, "x-forwarded-for": "10.55.0.1" });
    const res = await studentsGet(new NextRequest(`http://x/api/students${qs}`, { headers }));
    return { status: res.status, body: await res.json() };
  };

  const all = await get();
  assert(all.status === 200 && all.body.students.length === 389, `Whole school returned: ${all.body.students?.length} of 389 (was cut at 250)`);
  assert(new Set(all.body.students.map((s: any) => s.id)).size === 389, "No duplicates, every student once");
  const c1 = await get("?classId=cls-cap-1");
  assert(c1.body.students.length === 195, `One class returned in full (${c1.body.students.length})`);
  const search = await get("?search=Student%200389");
  assert(search.body.students.length === 1 && search.body.students[0].admissionNumber === "ADM-389", "Search finds the 389th student (past the old cap)");
  const limited = await get("?limit=50");
  assert(limited.body.students.length === 50, "An explicit limit is still respected");

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
