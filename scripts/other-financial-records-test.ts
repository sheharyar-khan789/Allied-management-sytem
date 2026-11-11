/**
 * Other Collections (`/api/fees/other-collections`) and Other Expenses
 * (`/api/fees/other-expenses`): school income that is not a student fee payment, and
 * operational expenses, each recorded and totalled independently of FeeChallanDoc/PaymentDoc —
 * never counted as, or mixed with, student tuition collection.
 */
import { NextRequest } from "next/server";
import { POST as collectionsPost, GET as collectionsGet } from "../src/app/api/fees/other-collections/route";
import { POST as expensesPost, GET as expensesGet } from "../src/app/api/fees/other-expenses/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";

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

const json = async (res: Response) => res.json().catch(() => ({}));

async function run() {
  console.log("==================================================");
  console.log("OTHER COLLECTIONS & OTHER EXPENSES");
  console.log("==================================================");

  const A = "school-ofr-a";
  const B = "school-ofr-b";
  const session = (uid: string, role: "ADMIN" | "TEACHER", schoolId: string) =>
    createSessionCookieServer({ uid, email: `${uid}@x.edu`, role, schoolId, name: uid });
  const ADMIN_A = await session("uid-ofr-admin-a", "ADMIN", A);
  const ADMIN_B = await session("uid-ofr-admin-b", "ADMIN", B);
  const TEACHER_A = await session("uid-ofr-teacher-a", "TEACHER", A);

  // ---- Other Collections ----
  const c1 = await json(
    await collectionsPost(req(ADMIN_A, "http://x/api/fees/other-collections", "POST", { date: "2026-11-01", category: "REGISTRATION", description: "New admission registration", amount: 2000 }))
  );
  assert(c1.success && c1.collection?.id, "Collection: registration income is recorded");
  const c2 = await json(
    await collectionsPost(req(ADMIN_A, "http://x/api/fees/other-collections", "POST", { date: "2026-11-02", category: "FINE", description: "Late book return fine", amount: 500 }))
  );
  assert(c2.success, "Collection: fine collection is recorded");
  await collectionsPost(req(ADMIN_B, "http://x/api/fees/other-collections", "POST", { date: "2026-11-01", category: "EVENT", description: "School B event", amount: 9999 }));

  const listA = await json(await collectionsGet(req(ADMIN_A, "http://x/api/fees/other-collections")));
  assert(listA.collections?.length === 2 && listA.total === 2500, "Collection: school A's list and total (2500) never includes school B's record");

  const badCategory = await collectionsPost(req(ADMIN_A, "http://x/api/fees/other-collections", "POST", { date: "2026-11-01", category: "NOT_REAL", description: "x", amount: 100 }));
  assert(badCategory.status === 400, "Collection: an invalid category is rejected");

  const negativeAmount = await collectionsPost(req(ADMIN_A, "http://x/api/fees/other-collections", "POST", { date: "2026-11-01", category: "FINE", description: "x", amount: -5 }));
  assert(negativeAmount.status === 400, "Collection: a non-positive amount is rejected");

  const teacherCollection = await collectionsPost(req(TEACHER_A, "http://x/api/fees/other-collections", "POST", { date: "2026-11-01", category: "FINE", description: "x", amount: 100 }));
  assert(teacherCollection.status === 403, "Unauthorized: a TEACHER cannot record other collections");

  // ---- Other Expenses ----
  const e1 = await json(
    await expensesPost(req(ADMIN_A, "http://x/api/fees/other-expenses", "POST", { date: "2026-11-01", category: "ELECTRICITY", description: "November electricity bill", amount: 12000 }))
  );
  assert(e1.success && e1.expense?.category === "ELECTRICITY", "Expense: electricity expense is recorded");
  const e2 = await json(
    await expensesPost(req(ADMIN_A, "http://x/api/fees/other-expenses", "POST", { date: "2026-11-05", category: "STATIONERY", description: "Office stationery", amount: 3000 }))
  );
  assert(e2.success, "Expense: stationery expense is recorded");
  await expensesPost(req(ADMIN_B, "http://x/api/fees/other-expenses", "POST", { date: "2026-11-01", category: "MAINTENANCE", description: "School B maintenance", amount: 50000 }));

  const expenseListA = await json(await expensesGet(req(ADMIN_A, "http://x/api/fees/other-expenses")));
  assert(expenseListA.expenses?.length === 2 && expenseListA.total === 15000, "Expense: school A's list and total (15000) never includes school B's record");

  const dateFiltered = await json(await expensesGet(req(ADMIN_A, "http://x/api/fees/other-expenses?from=2026-11-05&to=2026-11-05")));
  assert(dateFiltered.expenses?.length === 1 && dateFiltered.total === 3000, "Expense: date-range filter returns only the matching record");

  const teacherExpense = await expensesPost(req(TEACHER_A, "http://x/api/fees/other-expenses", "POST", { date: "2026-11-01", category: "STAFF", description: "x", amount: 100 }));
  assert(teacherExpense.status === 403, "Unauthorized: a TEACHER cannot record other expenses");

  const unauthenticated = await expensesGet(req(null, "http://x/api/fees/other-expenses"));
  assert(unauthenticated.status === 401, "Unauthorized: an unauthenticated request is rejected");

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
