/**
 * transaction-import.ts
 * Pure-function library (no DB access) for parsing and validating
 * the 5-column transaction import format.
 *
 * Columns: "Day & Date" | "Category" | "Details" | "Class" | "Amount"
 */

export const TRANSACTION_IMPORT_HEADERS = [
  "Day & Date",
  "Category",
  "Details",
  "Class",
  "Amount",
] as const;

export type TransactionCategory = "Fees" | "Annual Amount" | "Other Expenses";
export type TransactionRowStatus = "VALID" | "INVALID" | "DUPLICATE" | "AMBIGUOUS";

export interface TransactionImportRow {
  rowNumber: number;
  date: string | null;        // ISO YYYY-MM-DD parsed from "Day & Date"
  category: TransactionCategory | null;
  details: string;
  className: string;
  amount: number | null;
  rawDate: string;
  rawCategory: string;
  rawAmount: string;
}

export interface TransactionImportResult {
  row: TransactionImportRow;
  status: TransactionRowStatus;
  errors: string[];
  resolvedStudentId?: string;
  resolvedStudentName?: string;
  resolvedClassId?: string;
}

export interface TransactionImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  ambiguousRows: number;
  feesTotal: number;
  annualAmountTotal: number;
  otherExpensesTotal: number;
  results: TransactionImportResult[];
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse date from multiple formats:
 *   - DD-MM-YYYY
 *   - DD/MM/YYYY
 *   - YYYY-MM-DD (ISO)
 *   - Excel serial number (days since 1899-12-30)
 *
 * Returns ISO YYYY-MM-DD string or null if unparseable.
 */
export function parseTransactionDate(raw: string | number): string | null {
  if (raw === null || raw === undefined) return null;

  // Excel serial number
  const asStr = String(raw).trim();
  if (asStr === "") return null;

  const asNum = Number(asStr);
  if (!isNaN(asNum) && asStr !== "" && /^\d+(\.\d+)?$/.test(asStr)) {
    // Excel serial: days since 1899-12-30 (accounting for the bogus leap year 1900 bug)
    const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
    const ms = excelEpoch.getTime() + Math.floor(asNum) * 86400000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    // Sanity check: year must be reasonable
    if (y < 1900 || y > 2100) return null;
    return `${y}-${m}-${day}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(asStr);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    const day = parseInt(dd, 10);
    const month = parseInt(mm, 10);
    const year = parseInt(yyyy, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(asStr);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const month = parseInt(mm, 10);
    const day = parseInt(dd, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/**
 * Parse monetary amount:
 * - Strip commas, whitespace, currency symbols (Rs., Rs, PKR, $, etc.)
 * - Negative amounts → null (invalid)
 * - Non-numeric → null
 */
export function parseTransactionAmount(raw: string | number): number | null {
  if (raw === null || raw === undefined) return null;
  const asStr = String(raw).trim();
  if (asStr === "") return null;

  // Strip currency symbols and thousands separators
  const cleaned = asStr
    .replace(/Rs\.?\s*/gi, "")
    .replace(/PKR\s*/gi, "")
    .replace(/\$\s*/g, "")
    .replace(/,/g, "")
    .trim();

  // Check for negative
  if (/^-/.test(cleaned)) return null;

  const val = parseFloat(cleaned);
  if (isNaN(val)) return null;
  if (val < 0) return null;

  return val;
}

// ---------------------------------------------------------------------------
// Category normalization
// ---------------------------------------------------------------------------

/**
 * Normalize category string to TransactionCategory or null.
 * Case-insensitive exact match for the three valid categories.
 */
export function normalizeCategory(raw: string): TransactionCategory | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === "fees") return "Fees";
  if (lower === "annual amount") return "Annual Amount";
  if (lower === "other expenses") return "Other Expenses";
  return null;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse one spreadsheet row (5 cells) into a TransactionImportRow.
 * cells[0] = Day & Date, [1] = Category, [2] = Details, [3] = Class, [4] = Amount
 */
export function parseTransactionRow(
  rowNumber: number,
  cells: (string | number)[]
): TransactionImportRow {
  const rawDate = String(cells[0] ?? "").trim();
  const rawCategory = String(cells[1] ?? "").trim();
  const details = String(cells[2] ?? "").trim();
  const className = String(cells[3] ?? "").trim();
  const rawAmount = String(cells[4] ?? "").trim();

  return {
    rowNumber,
    date: parseTransactionDate(cells[0] as string | number),
    category: normalizeCategory(rawCategory),
    details,
    className,
    amount: parseTransactionAmount(cells[4] as string | number),
    rawDate,
    rawCategory,
    rawAmount,
  };
}

// ---------------------------------------------------------------------------
// Class/section matching
// ---------------------------------------------------------------------------

/**
 * Lowercases, trims, and splits a class label into its real tokens — "Class 5-A" -> ["class",
 * "5", "a"], "5 A" -> ["5", "a"], "Nursery-A" -> ["nursery", "a"]. Matching compares these
 * tokens, never a raw substring: a naive `"class15a".includes("5a")` is true, so comparing
 * stripped strings directly would let an imported "5-A" cross-match an existing "Class 15-A",
 * or match a different section of the same grade ("5-B") whenever the import didn't give the
 * section — token equality cannot make that mistake.
 */
export function classLabelTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * True when every token of the imported class text appears, verbatim, among the student's
 * actual class tokens. An empty imported class text always matches (the row is then resolved
 * by student name alone) — this is unchanged existing behaviour, not a new leniency.
 */
export function classLabelsMatch(studentClassName: string, importedClassText: string): boolean {
  const importTokens = classLabelTokens(importedClassText);
  if (importTokens.length === 0) return true;
  const studentTokens = classLabelTokens(studentClassName);
  return importTokens.every((t) => studentTokens.includes(t));
}

/** Collapses internal whitespace (not just leading/trailing) before any name comparison, so
 *  "Ali  Khan" (accidental double space) still matches the real "Ali Khan". */
function normalizeName(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Dedup key for one "Other Expenses" row: same date + same description + same amount is
 * treated as the same expense re-submitted, never silently recorded twice. Normalizes
 * whitespace/case the same way normalizeName does, for the same reason.
 */
export function buildExpenseDedupKey(date: string, details: string, amount: number): string {
  return `${date}|${normalizeName(details)}|${amount}`;
}

// ---------------------------------------------------------------------------
// Daily Import payment allocation
// ---------------------------------------------------------------------------

export interface AllocationChallanInput {
  id: string;
  /** Sort key for "oldest first" ordering among the non-targeted challans — e.g. year*12+monthIndex. */
  periodKey: number;
  balanceAmount: number;
}

export interface AllocationLine {
  challanId: string;
  amount: number;
}

export interface AllocationPlan {
  lines: AllocationLine[];
  /** Whatever is left after every outstanding challan (targeted month first, then the rest
   *  oldest-first) has been fully settled — becomes the student's advance credit, never
   *  silently dropped and never applied to a challan that was not actually outstanding. */
  advanceCredit: number;
}

/**
 * Allocates one Daily Import payment: first to the challan the row's own date targets (up to
 * its balance), then to the student's other outstanding challans oldest-period-first, then
 * whatever remains becomes advance credit. A payment is never applied to a challan with a
 * zero/negative balance, and no challan's balance is ever reduced below zero, so an unrelated
 * month is never marked Paid just because a different month's payment arrived.
 */
export function planPaymentAllocation(
  targetChallanId: string | null,
  outstandingChallans: AllocationChallanInput[],
  amount: number
): AllocationPlan {
  const target = targetChallanId ? outstandingChallans.find((c) => c.id === targetChallanId) : undefined;
  const others = outstandingChallans
    .filter((c) => c.id !== targetChallanId)
    .sort((a, b) => a.periodKey - b.periodKey);
  const ordered = target ? [target, ...others] : others;

  let remaining = amount;
  const lines: AllocationLine[] = [];
  for (const challan of ordered) {
    if (remaining <= 0) break;
    if (challan.balanceAmount <= 0) continue;
    const applied = Math.min(remaining, challan.balanceAmount);
    lines.push({ challanId: challan.id, amount: applied });
    remaining -= applied;
  }

  return { lines, advanceCredit: Math.max(0, remaining) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate parsed rows against student list and check for duplicates.
 *
 * Rules:
 * - "Other Expenses": VALID if date + amount + details are present (no student needed);
 *   DUPLICATE if the same date+description+amount already exists (existingExpenseKeys) or
 *   appears earlier in this same file.
 * - "Fees" / "Annual Amount":
 *   - Must resolve exactly 1 student by fullName (case-insensitive, whitespace-normalized,
 *     contains) + className (token match, see classLabelsMatch)
 *   - 0 matches → INVALID ("Student not found")
 *   - 2+ matches → AMBIGUOUS ("Multiple students match")
 *   - 1 match → VALID; DUPLICATE if the exact same studentId+date+category+amount already
 *     exists (existingTxDates) or appears earlier in this same file — NOT merely the same
 *     student+month, since a student can legitimately make several distinct payments
 *     (partial, then the remainder, or an advance) within one month.
 */
export function validateTransactionRows(
  rows: TransactionImportRow[],
  students: Array<{
    id: string;
    fullName: string;
    className: string;
    classId: string;
  }>,
  existingTxDates?: Set<string>, // set of `${studentId}|${date}|${category}|${amount}` for duplicate check
  existingExpenseKeys?: Set<string> // set of buildExpenseDedupKey(...) for "Other Expenses" rows
): TransactionImportResult[] {
  // Track duplicates within this batch (for Fees category, and separately for Other Expenses)
  const seenInBatch = new Set<string>();
  const seenExpenseKeysInBatch = new Set<string>();
  const results: TransactionImportResult[] = [];

  for (const row of rows) {
    const errors: string[] = [];
    let status: TransactionRowStatus = "VALID";
    let resolvedStudentId: string | undefined;
    let resolvedStudentName: string | undefined;
    let resolvedClassId: string | undefined;

    // Validate date
    if (!row.date) {
      errors.push(`Invalid or missing date: "${row.rawDate}"`);
    }

    // Validate category
    if (!row.category) {
      errors.push(`Unknown category: "${row.rawCategory}". Must be "Fees", "Annual Amount", or "Other Expenses".`);
    }

    // Validate amount
    if (row.amount === null) {
      errors.push(`Invalid or missing amount: "${row.rawAmount}"`);
    }

    // Validate details
    if (!row.details) {
      errors.push("Details/description is required.");
    }

    if (errors.length > 0) {
      results.push({ row, status: "INVALID", errors });
      continue;
    }

    // "Other Expenses" — no student resolution needed, but still checked for duplicates.
    if (row.category === "Other Expenses") {
      if (row.date) {
        const expenseKey = buildExpenseDedupKey(row.date, row.details, row.amount ?? 0);
        if (existingExpenseKeys?.has(expenseKey) || seenExpenseKeysInBatch.has(expenseKey)) {
          results.push({
            row,
            status: "DUPLICATE",
            errors: [`Duplicate: an "Other Expenses" entry already exists for "${row.details}" on ${row.date} for Rs. ${row.amount}.`],
          });
          continue;
        }
        seenExpenseKeysInBatch.add(expenseKey);
      }
      results.push({ row, status: "VALID", errors: [] });
      continue;
    }

    // "Fees" or "Annual Amount" — must resolve a student.
    const detailsNorm = normalizeName(row.details);

    const matches = students.filter((s) => {
      const nameNorm = normalizeName(s.fullName);
      const nameMatch = nameNorm.includes(detailsNorm) || detailsNorm.includes(nameNorm);
      const classMatch = classLabelsMatch(s.className, row.className);
      return nameMatch && classMatch;
    });

    if (matches.length === 0) {
      results.push({
        row,
        status: "INVALID",
        errors: [`Student not found: "${row.details}" in class "${row.className}"`],
      });
      continue;
    }

    if (matches.length > 1) {
      results.push({
        row,
        status: "AMBIGUOUS",
        errors: [
          `Multiple students match "${row.details}" in class "${row.className}": ${matches
            .slice(0, 3)
            .map((s) => s.fullName)
            .join(", ")}${matches.length > 3 ? ` +${matches.length - 3} more` : ""}`,
        ],
      });
      continue;
    }

    // Exactly 1 match — check for duplicates (Fees and Annual Amount: both are now actual
    // received payments under Daily Import's payment-recording model, Phase 2). The dedup key
    // is the EXACT row content (student + date + category + amount), never just student+month —
    // a student can legitimately make several distinct payments (partial, then the remainder,
    // or an advance) within the same month, and only resubmitting the identical row is a
    // genuine duplicate.
    const student = matches[0];
    resolvedStudentId = student.id;
    resolvedStudentName = student.fullName;
    resolvedClassId = student.classId;

    if ((row.category === "Fees" || row.category === "Annual Amount") && row.date) {
      const dupKey = `${student.id}|${row.date}|${row.category}|${row.amount}`;

      if (existingTxDates?.has(dupKey) || seenInBatch.has(dupKey)) {
        results.push({
          row,
          status: "DUPLICATE",
          errors: [`Duplicate: a ${row.category} payment of ${row.amount} for "${student.fullName}" on ${row.date} already exists.`],
          resolvedStudentId,
          resolvedStudentName,
          resolvedClassId,
        });
        continue;
      }

      seenInBatch.add(dupKey);
    }

    results.push({
      row,
      status: "VALID",
      errors: [],
      resolvedStudentId,
      resolvedStudentName,
      resolvedClassId,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Build category totals for all results.
 * Note: otherExpenses is NOT added to any "net collection" total.
 */
export function buildTransactionSummary(
  results: TransactionImportResult[]
): TransactionImportSummary {
  let validRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;
  let ambiguousRows = 0;
  let feesTotal = 0;
  let annualAmountTotal = 0;
  let otherExpensesTotal = 0;

  for (const r of results) {
    switch (r.status) {
      case "VALID":
        validRows++;
        if (r.row.amount !== null) {
          if (r.row.category === "Fees") feesTotal += r.row.amount;
          else if (r.row.category === "Annual Amount") annualAmountTotal += r.row.amount;
          else if (r.row.category === "Other Expenses") otherExpensesTotal += r.row.amount;
        }
        break;
      case "INVALID":
        invalidRows++;
        break;
      case "DUPLICATE":
        duplicateRows++;
        break;
      case "AMBIGUOUS":
        ambiguousRows++;
        break;
    }
  }

  return {
    totalRows: results.length,
    validRows,
    invalidRows,
    duplicateRows,
    ambiguousRows,
    feesTotal,
    annualAmountTotal,
    otherExpensesTotal,
    results,
  };
}
