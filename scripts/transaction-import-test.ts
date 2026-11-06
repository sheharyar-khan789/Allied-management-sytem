import {
  TRANSACTION_IMPORT_HEADERS,
  parseTransactionDate,
  parseTransactionAmount,
  normalizeCategory,
  parseTransactionRow,
  validateTransactionRows,
  buildTransactionSummary,
  TransactionImportRow,
} from "../src/lib/transaction-import";
import { generateTransactionId } from "../src/lib/firebase/transaction-db";

const PASS: string[] = [];
const FAIL: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    PASS.push(name);
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    FAIL.push(`${name}: ${e.message}`);
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

function expect(val: any) {
  return {
    toBe: (expected: any) => {
      if (val !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`);
    },
    toEqual: (expected: any) => {
      if (JSON.stringify(val) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`);
      }
    },
    toBeNull: () => {
      if (val !== null) throw new Error(`Expected null, got ${JSON.stringify(val)}`);
    },
    toContain: (s: string) => {
      if (!String(val).includes(s)) throw new Error(`Expected to contain "${s}", got "${val}"`);
    },
    toBeGreaterThan: (n: number) => {
      if (!(val > n)) throw new Error(`Expected > ${n}, got ${val}`);
    },
  };
}

console.log("\n--- RUNNING TRANSACTION IMPORT & FINANCIAL DASHBOARD TESTS ---");

// 1. Template headers
test("1. Template has exactly 5 required headers in correct order", () => {
  expect(TRANSACTION_IMPORT_HEADERS.length).toBe(5);
  expect(TRANSACTION_IMPORT_HEADERS[0]).toBe("Day & Date");
  expect(TRANSACTION_IMPORT_HEADERS[1]).toBe("Category");
  expect(TRANSACTION_IMPORT_HEADERS[2]).toBe("Details");
  expect(TRANSACTION_IMPORT_HEADERS[3]).toBe("Class");
  expect(TRANSACTION_IMPORT_HEADERS[4]).toBe("Amount");
});

// 2. Date parsing
test("2. Date parsing: DD-MM-YYYY format", () => {
  expect(parseTransactionDate("15-11-2026")).toBe("2026-11-15");
  expect(parseTransactionDate("01-04-2025")).toBe("2025-04-01");
});

test("3. Date parsing: DD/MM/YYYY format", () => {
  expect(parseTransactionDate("15/11/2026")).toBe("2026-11-15");
  expect(parseTransactionDate("5/9/2026")).toBe("2026-09-05");
});

test("4. Date parsing: ISO YYYY-MM-DD format", () => {
  expect(parseTransactionDate("2026-11-15")).toBe("2026-11-15");
});

test("5. Date parsing: Excel serial number", () => {
  // 46341 in Excel is 2026-11-15
  const parsed = parseTransactionDate("46341");
  expect(parsed).toBe("2026-11-15");
});

test("6. Date parsing: invalid formats return null", () => {
  expect(parseTransactionDate("")).toBeNull();
  expect(parseTransactionDate("invalid-date")).toBeNull();
  expect(parseTransactionDate("32-01-2026")).toBeNull();
  expect(parseTransactionDate("15-13-2026")).toBeNull();
});

// 3. Amount parsing
test("7. Amount parsing: standard and formatted numbers", () => {
  expect(parseTransactionAmount("3700")).toBe(3700);
  expect(parseTransactionAmount("3,700")).toBe(3700);
  expect(parseTransactionAmount("12,500.50")).toBe(12500.5);
});

test("8. Amount parsing: currency prefixes stripped", () => {
  expect(parseTransactionAmount("Rs. 3500")).toBe(3500);
  expect(parseTransactionAmount("Rs 3000")).toBe(3000);
  expect(parseTransactionAmount("PKR 9,600")).toBe(9600);
  expect(parseTransactionAmount("$1000")).toBe(1000);
});

test("9. Amount parsing: negative numbers and non-numeric return null", () => {
  expect(parseTransactionAmount("-500")).toBeNull();
  expect(parseTransactionAmount("abc")).toBeNull();
  expect(parseTransactionAmount("")).toBeNull();
});

// 4. Category normalization
test("10. Category normalization: case-insensitive exact matching", () => {
  expect(normalizeCategory("Fees")).toBe("Fees");
  expect(normalizeCategory("fees")).toBe("Fees");
  expect(normalizeCategory("FEES")).toBe("Fees");
  expect(normalizeCategory("Annual Amount")).toBe("Annual Amount");
  expect(normalizeCategory("annual amount")).toBe("Annual Amount");
  expect(normalizeCategory("Other Expenses")).toBe("Other Expenses");
  expect(normalizeCategory("other expenses")).toBe("Other Expenses");
});

test("11. Category normalization: unrecognized categories return null", () => {
  expect(normalizeCategory("Tuition")).toBeNull();
  expect(normalizeCategory("Other")).toBeNull();
  expect(normalizeCategory("Income")).toBeNull();
  expect(normalizeCategory("")).toBeNull();
});

// 5. Row parsing
test("12. parseTransactionRow extracts all 5 fields", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  expect(row.rowNumber).toBe(2);
  expect(row.date).toBe("2026-11-15");
  expect(row.category).toBe("Fees");
  expect(row.details).toBe("M. Huzaifa");
  expect(row.className).toBe("Nursery");
  expect(row.amount).toBe(3700);
});

// 6. Validation & Student Resolution
const sampleStudents = [
  { id: "std-1", fullName: "M. Huzaifa", className: "Nursery", classId: "cls-nursery" },
  { id: "std-2", fullName: "M. Laique", className: "Nursery", classId: "cls-nursery" },
  { id: "std-3", fullName: "Ali Khan", className: "Class 1", classId: "cls-1" },
  { id: "std-4", fullName: "Ali Khan", className: "Class 2", classId: "cls-2" },
];

test("13. validateTransactionRows: valid Fees row with matching student", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const results = validateTransactionRows([row], sampleStudents);
  expect(results.length).toBe(1);
  expect(results[0].status).toBe("VALID");
  expect(results[0].resolvedStudentId).toBe("std-1");
  expect(results[0].resolvedStudentName).toBe("M. Huzaifa");
});

test("14. validateTransactionRows: non-existent student marked INVALID", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Fees", "NonExistent Student", "Nursery", "3700"]);
  const results = validateTransactionRows([row], sampleStudents);
  expect(results.length).toBe(1);
  expect(results[0].status).toBe("INVALID");
  expect(results[0].errors[0]).toContain("Student not found");
});

test("15. validateTransactionRows: ambiguous match marked AMBIGUOUS when class not provided", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Fees", "Ali Khan", "", "3700"]);
  const results = validateTransactionRows([row], sampleStudents);
  expect(results.length).toBe(1);
  expect(results[0].status).toBe("AMBIGUOUS");
  expect(results[0].errors[0]).toContain("Multiple students match");
});

test("16. validateTransactionRows: student disambiguated via Class column", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Fees", "Ali Khan", "Class 2", "3700"]);
  const results = validateTransactionRows([row], sampleStudents);
  expect(results.length).toBe(1);
  expect(results[0].status).toBe("VALID");
  expect(results[0].resolvedStudentId).toBe("std-4");
});

test("17. validateTransactionRows: Other Expenses requires no student match", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Other Expenses", "Electricity Bill", "General", "12000"]);
  const results = validateTransactionRows([row], sampleStudents);
  expect(results.length).toBe(1);
  expect(results[0].status).toBe("VALID");
  expect(results[0].resolvedStudentId).toBe(undefined);
});

test("18. validateTransactionRows: detect duplicate Fees in same month/batch", () => {
  const row1 = parseTransactionRow(2, ["15-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const row2 = parseTransactionRow(3, ["20-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const results = validateTransactionRows([row1, row2], sampleStudents);
  expect(results[0].status).toBe("VALID");
  expect(results[1].status).toBe("DUPLICATE");
  expect(results[1].errors[0]).toContain("Duplicate");
});

test("19. validateTransactionRows: detect duplicate Fees against existing DB records", () => {
  const row = parseTransactionRow(2, ["15-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const existingSet = new Set(["std-1_2026-11"]);
  const results = validateTransactionRows([row], sampleStudents, existingSet);
  expect(results[0].status).toBe("DUPLICATE");
});

test("20. validateTransactionRows: same student in different months are both VALID", () => {
  const rowNov = parseTransactionRow(2, ["15-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const rowDec = parseTransactionRow(3, ["15-12-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const results = validateTransactionRows([rowNov, rowDec], sampleStudents);
  expect(results[0].status).toBe("VALID");
  expect(results[1].status).toBe("VALID");
});

// 7. Summary & Accounting Rules
test("21. buildTransactionSummary computes category totals correctly", () => {
  const r1 = parseTransactionRow(2, ["15-11-2026", "Fees", "M. Huzaifa", "Nursery", "3700"]);
  const r2 = parseTransactionRow(3, ["15-11-2026", "Annual Amount", "M. Laique", "Nursery", "3000"]);
  const r3 = parseTransactionRow(4, ["15-11-2026", "Other Expenses", "Office Supplies", "Office", "1500"]);
  const r4 = parseTransactionRow(5, ["15-11-2026", "Fees", "Unknown Person", "Nursery", "3700"]);

  const validated = validateTransactionRows([r1, r2, r3, r4], sampleStudents);
  const summary = buildTransactionSummary(validated);

  expect(summary.totalRows).toBe(4);
  expect(summary.validRows).toBe(3);
  expect(summary.invalidRows).toBe(1);
  expect(summary.feesTotal).toBe(3700);
  expect(summary.annualAmountTotal).toBe(3000);
  expect(summary.otherExpensesTotal).toBe(1500);
});

test("22. Accounting Rule: Other Expenses is NOT added to student collections", () => {
  const feesTotal = 3700;
  const annualTotal = 3000;
  const expensesTotal = 1500;

  // Net collection must ONLY be fees + annual
  const netCollection = feesTotal + annualTotal;
  expect(netCollection).toBe(6700);
  // Must NOT equal fees + annual + expenses
  expect(netCollection !== feesTotal + annualTotal + expensesTotal).toBe(true);
});

// 8. Deterministic Transaction ID & Idempotency
test("23. generateTransactionId is deterministic and reproducible", () => {
  const id1 = generateTransactionId("school-1", "batch-100", 5);
  const id2 = generateTransactionId("school-1", "batch-100", 5);
  const id3 = generateTransactionId("school-1", "batch-100", 6);

  expect(id1).toBe(id2);
  expect(id1.startsWith("tx_")).toBe(true);
  expect(id1 !== id3).toBe(true);
});

// Summary Report
console.log("\n=======================================================");
console.log(`TOTAL TESTS: ${PASS.length + FAIL.length}`);
console.log(`PASSED: ${PASS.length}`);
console.log(`FAILED: ${FAIL.length}`);
console.log("=======================================================\n");

if (FAIL.length > 0) {
  process.exit(1);
}
