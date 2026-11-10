import { NextRequest } from "next/server";
import { GET as collectionsGet, POST as collectionsPost } from "../src/app/api/other-collections/route";
import { POST as collectionsReverse } from "../src/app/api/other-collections/[id]/reverse/route";
import { GET as expensesGet, POST as expensesPost } from "../src/app/api/other-expenses/route";
import { POST as expensesReverse } from "../src/app/api/other-expenses/[id]/reverse/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";

async function run() {
  console.log("==================================================");
  console.log("RUNNING AUTOMATED TEST SUITE: OTHER COLLECTIONS & EXPENSES (PHASE 6)");
  console.log("==================================================");

  let passed = 0;
  let total = 0;
  function assert(condition: boolean, name: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${name}`);
      process.exitCode = 1;
    }
  }

  const schoolId = "school-other-income-test-001";
  const adminToken = await createSessionCookieServer({ uid: "usr-admin-oie", email: "admin-oie@example.com", role: "ADMIN", schoolId, name: "Admin" });
  const teacherToken = await createSessionCookieServer({ uid: "usr-teacher-oie", email: "teacher-oie@example.com", role: "TEACHER", schoolId, name: "Teacher" });

  function jsonReq(path: string, method: string, body: any, cookie: string) {
    return new NextRequest(`http://localhost:3000${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  }

  // ----------------------------------------------------
  // TEST: Teachers cannot record or view other collections/expenses
  // ----------------------------------------------------
  const teacherCollectionRes = await collectionsPost(jsonReq("/api/other-collections", "POST", { date: "2025-11-01", category: "REGISTRATION", description: "x", amount: 100 }, `allied_session=${teacherToken}`));
  assert(teacherCollectionRes.status === 403, "Teacher is forbidden from recording other collections");

  const teacherExpenseRes = await expensesPost(jsonReq("/api/other-expenses", "POST", { date: "2025-11-01", category: "ELECTRICITY", description: "x", amount: 100 }, `allied_session=${teacherToken}`));
  assert(teacherExpenseRes.status === 403, "Teacher is forbidden from recording other expenses");

  // ----------------------------------------------------
  // TEST: Invalid category / non-positive amount rejected
  // ----------------------------------------------------
  const badCategoryRes = await collectionsPost(jsonReq("/api/other-collections", "POST", { date: "2025-11-01", category: "BOGUS", description: "x", amount: 100 }, `allied_session=${adminToken}`));
  assert(badCategoryRes.status === 400, "Unknown collection category is rejected");

  const badAmountRes = await expensesPost(jsonReq("/api/other-expenses", "POST", { date: "2025-11-01", category: "ELECTRICITY", description: "x", amount: 0 }, `allied_session=${adminToken}`));
  assert(badAmountRes.status === 400, "Zero/negative expense amount is rejected");

  // ----------------------------------------------------
  // TEST: Recording collections and expenses, and that totals aggregate correctly
  // ----------------------------------------------------
  await collectionsPost(jsonReq("/api/other-collections", "POST", { date: "2025-11-01", category: "REGISTRATION", description: "New admission registration fee", amount: 2000, paymentMethod: "CASH" }, `allied_session=${adminToken}`));
  await collectionsPost(jsonReq("/api/other-collections", "POST", { date: "2025-11-02", category: "FINE", description: "Late library return fine", amount: 300, paymentMethod: "CASH" }, `allied_session=${adminToken}`));
  await expensesPost(jsonReq("/api/other-expenses", "POST", { date: "2025-11-01", category: "ELECTRICITY", description: "November electricity bill", amount: 15000, paymentMethod: "BANK_TRANSFER", reference: "WAPDA-1123" }, `allied_session=${adminToken}`));

  const collectionsRes = await collectionsGet(new NextRequest("http://localhost:3000/api/other-collections", { headers: { cookie: `allied_session=${adminToken}` } }));
  const collectionsData = await collectionsRes.json();
  assert(collectionsData.stats.totalAmount === 2300, `Total collections correctly sums active records (got ${collectionsData.stats.totalAmount})`);
  assert(collectionsData.stats.byCategory.REGISTRATION === 2000 && collectionsData.stats.byCategory.FINE === 300, "Category breakdown is correct for collections");

  const expensesRes = await expensesGet(new NextRequest("http://localhost:3000/api/other-expenses", { headers: { cookie: `allied_session=${adminToken}` } }));
  const expensesData = await expensesRes.json();
  assert(expensesData.stats.totalAmount === 15000, "Total expenses correctly sums active records");
  assert(
    collectionsData.records.every((r: any) => r.category !== "ELECTRICITY") && expensesData.records.every((r: any) => r.category !== "REGISTRATION"),
    "Collections and expenses remain in separate, non-overlapping ledgers"
  );

  // ----------------------------------------------------
  // TEST: Reversal excludes a record from totals without deleting it
  // ----------------------------------------------------
  const fineRecordId = collectionsData.records.find((r: any) => r.category === "FINE").id;
  const reverseRes = await collectionsReverse(
    jsonReq(`/api/other-collections/${fineRecordId}/reverse`, "POST", { reason: "Fine waived by principal" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: fineRecordId }) }
  );
  assert(reverseRes.status === 200, "Reversing a collection record succeeds");

  const afterReverseRes = await collectionsGet(new NextRequest("http://localhost:3000/api/other-collections", { headers: { cookie: `allied_session=${adminToken}` } }));
  const afterReverseData = await afterReverseRes.json();
  assert(afterReverseData.stats.totalAmount === 2000, "Reversed record is excluded from the total (2300 -> 2000)");
  const stillPresent = afterReverseData.records.find((r: any) => r.id === fineRecordId);
  assert(!!stillPresent && stillPresent.reversed === true, "Reversed record remains visible in history, flagged reversed, never deleted");

  // ----------------------------------------------------
  // TEST: A record cannot be reversed twice
  // ----------------------------------------------------
  const doubleReverseRes = await collectionsReverse(
    jsonReq(`/api/other-collections/${fineRecordId}/reverse`, "POST", { reason: "again" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: fineRecordId }) }
  );
  assert(doubleReverseRes.status === 400, "Reversing an already-reversed collection record is rejected");

  // ----------------------------------------------------
  // TEST: Expense reversal works the same way
  // ----------------------------------------------------
  const electricityId = expensesData.records.find((r: any) => r.category === "ELECTRICITY").id;
  const expenseReverseRes = await expensesReverse(
    jsonReq(`/api/other-expenses/${electricityId}/reverse`, "POST", { reason: "Billing error, corrected invoice issued" }, `allied_session=${adminToken}`),
    { params: Promise.resolve({ id: electricityId }) }
  );
  assert(expenseReverseRes.status === 200, "Reversing an expense record succeeds");
  const afterExpenseReverseRes = await expensesGet(new NextRequest("http://localhost:3000/api/other-expenses", { headers: { cookie: `allied_session=${adminToken}` } }));
  const afterExpenseReverseData = await afterExpenseReverseRes.json();
  assert(afterExpenseReverseData.stats.totalAmount === 0, "Reversed expense is excluded from the total");

  console.log("==================================================");
  console.log(`TEST RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
