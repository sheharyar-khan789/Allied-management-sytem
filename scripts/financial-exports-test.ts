/**
 * Excel/CSV exports (Priority 7): Yearly Fee Structure export and the Financial Summary
 * export. Every figure in the CSV must come from the same underlying records as the
 * on-screen views it mirrors — verified here by reconciling the exported numbers against
 * the records this test itself created, not by trusting the route's own arithmetic.
 */
import { NextRequest } from "next/server";
import { GET as structureExportGet } from "../src/app/api/fees/structure-import/export/route";
import { GET as dashboardExportGet } from "../src/app/api/fees/dashboard/export/route";
import { POST as structureImportPost } from "../src/app/api/fees/structure-import/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { saveClassServer, saveStudentServer } from "../src/lib/firebase/server-db";
import { saveOtherCollectionServer, saveExpenseServer } from "../src/lib/firebase/transaction-db";
import { ClassDoc, StudentDoc } from "../src/lib/firebase/types";

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

function parseCsv(text: string): string[][] {
  return text.trim().split(/\r\n/).map((line) => line.split(","));
}

async function run() {
  console.log("==================================================");
  console.log("FINANCIAL EXPORTS (CSV)");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-exp-a";
  const YEAR = "2026-2027";

  const classA: ClassDoc = { id: "cls-exp-a", schoolId: A, name: "Class 5", section: "A", numericLevel: 5, capacity: 40, classTeacherId: null, academicYear: YEAR, createdAt: now, updatedAt: now };
  await saveClassServer(classA);
  const s1: StudentDoc = { id: "std-exp-1", schoolId: A, admissionNo: "EXP-001", fullName: "Ali Khan", fatherName: "F", gender: "MALE", classId: classA.id, section: "A", rollNo: "1", status: "ACTIVE", guardianName: "G", guardianPhone: "0300", guardianRelation: "Father", monthlyFee: 3000, discount: 0, academicYear: YEAR, className: "Class 5-A", createdAt: now, updatedAt: now };
  await saveStudentServer(s1);

  const ADMIN_A = await createSessionCookieServer({ uid: "uid-exp-admin-a", email: "a@x.edu", role: "ADMIN", schoolId: A, name: "a" });

  await structureImportPost(
    req(ADMIN_A, "http://x/api/fees/structure-import", "POST", {
      academicYear: YEAR,
      rows: [{ rowNumber: 2, input: { admissionNo: "EXP-001", studentName: "Ali Khan", monthlyTuitionFee: "3700", annualFee: "3000", admissionFee: "5000", otherCharges: "200", discount: "0" } }],
    })
  );

  // ---- Yearly Fee Structure export ----
  const structureCsvRes = await structureExportGet(req(ADMIN_A, `http://x/api/fees/structure-import/export?academicYear=${YEAR}`));
  assert(structureCsvRes.status === 200, "Structure export: returns 200");
  assert(structureCsvRes.headers.get("content-type")?.includes("text/csv"), "Structure export: Content-Type is text/csv");
  const structureCsv = parseCsv(await structureCsvRes.text());
  assert(structureCsv[0][0] === "Admission No", "Structure export: header row starts with Admission No");
  const aliRow = structureCsv.find((r) => r[0] === "EXP-001");
  assert(!!aliRow && aliRow[3] === "3700" && aliRow[4] === "3000", "Structure export: Ali's row has the correct monthly/annual fee");
  assert(!!aliRow && Number(aliRow[8]) === (3700 + 200) * 12 + 3000 + 5000, "Structure export: Yearly Expected Fee column is (tuition+other)*12 + annual + admission");

  const unauthStructure = await structureExportGet(req(null, `http://x/api/fees/structure-import/export?academicYear=${YEAR}`));
  assert(unauthStructure.status === 401, "Unauthorized: an unauthenticated request to the structure export is rejected");

  // ---- Financial Summary export ----
  await saveOtherCollectionServer({ id: "oc-exp-1", schoolId: A, date: "2026-11-01", category: "FINE", description: "Fine", amount: 1000, createdBy: "uid-exp-admin-a", createdAt: now });
  await saveExpenseServer({ id: "exp-exp-1", schoolId: A, date: "2026-11-01", description: "Electricity", amount: 5000, category: "ELECTRICITY", createdBy: "uid-exp-admin-a", createdAt: now });

  const dashboardCsvRes = await dashboardExportGet(req(ADMIN_A, `http://x/api/fees/dashboard/export?academicYear=${YEAR}`));
  assert(dashboardCsvRes.status === 200, "Financial summary export: returns 200");
  const dashboardCsv = parseCsv(await dashboardCsvRes.text());
  const header = dashboardCsv[0];
  const row = dashboardCsv[1];
  const col = (name: string) => row[header.indexOf(name)];
  assert(Number(col("Other Collections")) === 1000, "Financial summary export: Other Collections reconciles to the recorded fine");
  assert(Number(col("Other Expenses")) === 5000, "Financial summary export: Other Expenses reconciles to the recorded electricity bill");
  assert(Number(col("Yearly Expected Fees")) === (3700 + 200) * 12 + 3000 + 5000, "Financial summary export: Yearly Expected Fees reconciles to the structure just imported");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
