import { adminDb, hasAdminCredentials } from "./admin";
import { cleanUndefined, onFirestoreError, withIndexFallback } from "./server-db";
import crypto from "crypto";

export interface ImportBatchDoc {
  id: string;
  schoolId: string;
  importedBy: string;
  importedAt: string;
  fileName: string;
  fileHash: string;
  rowCount: number;
  successCount: number;
  failCount: number;
  academicYear: string;
  status: "PENDING" | "COMMITTED" | "PARTIAL";
}

export interface TransactionDoc {
  id: string; // deterministic ID: tx_<schoolId>_<batchId>_<rowNumber> or hashed
  schoolId: string;
  importBatchId: string;
  rowNumber: number;
  date: string; // YYYY-MM-DD
  category: "Fees" | "Annual Amount" | "Other Expenses";
  details: string;
  studentId?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  amount: number;
  academicYear: string;
  createdBy: string;
  createdAt: string;
  challanRef?: string;
  /** Daily Import payment allocation trail: which challan(s) this row's amount was actually
   *  applied to and how much went to each — oldest-outstanding-first, see planPaymentAllocation
   *  in transaction-import.ts. Absent on rows that predate this field or on Other Expenses rows. */
  allocations?: { challanId: string; amount: number; paymentId: string }[];
  /** The part of this row's amount that could not be applied to any outstanding challan and was
   *  instead recorded as the student's advance credit (AdvanceCreditDoc) — never silently
   *  dropped, never auto-applied to an unrelated future month. */
  advanceCreditApplied?: number;
  /**
   * Set when the linked ExpenseDoc was edited or deleted (see updateExpenseServer/
   * voidExpenseServer). The document is never deleted — its content-hashed id must stay
   * occupied so re-importing the exact original CSV row is still correctly rejected as a
   * duplicate. Every dashboard sum that reads `transactions` must exclude voided rows.
   */
  voided?: boolean;
  voidedAt?: string;
}

export interface ExpenseDoc {
  id: string;
  schoolId: string;
  date: string;
  description: string;
  amount: number;
  category: "OTHER_EXPENSE";
  importBatchId?: string;
  transactionRef?: string;
  createdBy: string;
  createdAt: string;
  academicYear?: string;
  /** Set when this expense is edited (the OLD transactionRef is voided, a new one created at the
   *  fresh content-hash id — see updateExpenseServer) or deleted (see voidExpenseServer). The
   *  expense row itself is kept for history, never hard-deleted; every dashboard sum that reads
   *  `expenses` must exclude voided rows. */
  voided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

// In-memory fallback stores for tests or local dev
const localTransactionStore = {
  importBatches: new Map<string, ImportBatchDoc>(),
  transactions: new Map<string, TransactionDoc>(),
  expenses: new Map<string, ExpenseDoc>(),
};

/** Deterministic transaction ID to guarantee idempotency across retries */
export function generateTransactionId(schoolId: string, batchId: string, rowNumber: number): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${schoolId}:${batchId}:${rowNumber}`)
    .digest("hex")
    .slice(0, 16);
  return `tx_${hash}`;
}

/**
 * Deterministic from the ROW'S OWN CONTENT, never from batchId — two separate commit calls
 * (a genuine retry, or two concurrent requests importing the same file) produce the exact
 * same id for "the same" row, so saveTransactionServer's `.create()` naturally rejects the
 * second one instead of recording the payment/expense twice. generateTransactionId above
 * (batch-scoped) is kept as-is for backward compatibility; this is used for the actual
 * commit path's idempotency guarantee.
 */
export function generateContentTransactionId(
  schoolId: string,
  date: string,
  category: string,
  details: string,
  className: string,
  amount: number
): string {
  const normalized = `${schoolId}|${date}|${category}|${details.trim().toLowerCase().replace(/\s+/g, " ")}|${className.trim().toLowerCase().replace(/\s+/g, " ")}|${amount}`;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `tx_${hash}`;
}

/** Same deterministic-from-content idea as generateContentTransactionId, for the companion ExpenseDoc. */
export function generateContentExpenseId(schoolId: string, date: string, details: string, amount: number): string {
  const normalized = `${schoolId}|${date}|${details.trim().toLowerCase().replace(/\s+/g, " ")}|${amount}`;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `exp_${hash}`;
}

export async function saveImportBatchServer(batch: ImportBatchDoc): Promise<void> {
  localTransactionStore.importBatches.set(batch.id, { ...batch });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("importBatches").doc(batch.id).set(cleanUndefined(batch), { merge: true });
    } catch (e) {
      // In production this rethrows (see onFirestoreError), so a real write failure is never
      // reported back to the admin as a false "import succeeded" — it was previously swallowed
      // by a bare console.warn here.
      onFirestoreError(`saveImportBatchServer(${batch.id})`, e);
    }
  }
}

export async function getImportBatchesServer(schoolId: string, limitCount = 20): Promise<ImportBatchDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb
        .collection("importBatches")
        .where("schoolId", "==", schoolId)
        .limit(limitCount)
        .get();
      if (!snap.empty) {
        const batches = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImportBatchDoc));
        batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
        return batches;
      }
    } catch (e: any) {
      console.warn("getImportBatchesServer error:", e?.message);
    }
  }

  const list = Array.from(localTransactionStore.importBatches.values()).filter((b) => b.schoolId === schoolId);
  list.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return list.slice(0, limitCount);
}

/**
 * `tx.id` must be a deterministic hash of the row's own content (see
 * generateTransactionId), never a random/time-based id — that is what makes this throw
 * (rather than silently create a second record) when the exact same row is committed twice,
 * whether by a retry or by two concurrent requests importing the same file.
 */
export async function saveTransactionServer(tx: TransactionDoc): Promise<void> {
  if (localTransactionStore.transactions.has(tx.id)) {
    throw new Error("This exact transaction row has already been imported.");
  }
  localTransactionStore.transactions.set(tx.id, { ...tx });
  if (hasAdminCredentials) {
    try {
      // .create() (not .set()) so a genuine concurrent duplicate fails loudly with
      // ALREADY_EXISTS instead of silently overwriting — the caller's catch block then
      // correctly reports this row as failed/not-imported rather than a false success.
      await adminDb.collection("transactions").doc(tx.id).create(cleanUndefined(tx));
    } catch (e: any) {
      localTransactionStore.transactions.delete(tx.id);
      if (e?.code === 6) {
        throw new Error("This exact transaction row has already been imported.");
      }
      onFirestoreError(`saveTransactionServer(${tx.id})`, e);
    }
  }
}

export async function getTransactionsByBatchServer(schoolId: string, batchId: string): Promise<TransactionDoc[]> {
  if (hasAdminCredentials) {
    try {
      const snap = await adminDb
        .collection("transactions")
        .where("schoolId", "==", schoolId)
        .where("importBatchId", "==", batchId)
        .get();
      if (!snap.empty) {
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionDoc));
      }
    } catch (e: any) {
      console.warn("getTransactionsByBatchServer error:", e?.message);
    }
  }

  return Array.from(localTransactionStore.transactions.values()).filter(
    (t) => t.schoolId === schoolId && t.importBatchId === batchId
  );
}

function localTransactionsFallback(schoolId: string): TransactionDoc[] {
  return Array.from(localTransactionStore.transactions.values()).filter((t) => t.schoolId === schoolId);
}

/**
 * When both `from` and `to` are given, reads ONLY that date range via an indexed Firestore
 * query (schoolId + date, same pattern as getPaymentsByDateRangeServer) instead of the whole
 * school's transactions collection — a dashboard that re-reads this on every load must not pay
 * for the school's entire transaction history every time. `category`/`classId` are applied
 * in-memory on that already-small result, not as part of the indexed query, so a single
 * composite index (schoolId, date) covers every combination instead of needing one per filter.
 * Falls back to the full read (existing behaviour) if the composite index isn't deployed yet,
 * or if no date range is given at all (e.g. the import-duplicate-detection caller).
 */
export async function getTransactionsByDateRangeServer(
  schoolId: string,
  from?: string,
  to?: string,
  category?: string,
  classId?: string
): Promise<TransactionDoc[]> {
  let list: TransactionDoc[] = [];
  const hasRange = !!from && !!to;

  if (hasAdminCredentials) {
    try {
      if (hasRange) {
        list = await withIndexFallback(
          "transactions.byDateRange",
          async () => {
            const snap = await adminDb
              .collection("transactions")
              .where("schoolId", "==", schoolId)
              .where("date", ">=", from!)
              .where("date", "<=", to!)
              .get();
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionDoc));
          },
          async () => {
            const snap = await adminDb.collection("transactions").where("schoolId", "==", schoolId).get();
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionDoc));
          }
        );
      } else {
        let query: FirebaseFirestore.Query = adminDb.collection("transactions").where("schoolId", "==", schoolId);
        if (category) query = query.where("category", "==", category);
        const snap = await query.get();
        list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionDoc));
      }
    } catch (e: any) {
      console.warn("getTransactionsByDateRangeServer firestore query error:", e?.message);
    }
  }

  // Same defensive fallback the original implementation always had: an empty result (whether
  // from a genuinely empty collection, a query error caught above, or no admin credentials at
  // all in dev/test) falls back to this instance's local cache rather than surfacing nothing.
  if (list.length === 0) {
    list = localTransactionsFallback(schoolId);
  }

  // Filter in memory for date ranges (defensive, already applied above when the index was
  // used), classId, and category.
  return list.filter((t) => {
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (category && t.category !== category) return false;
    if (classId && t.classId !== classId) return false;
    return true;
  });
}

/** Same deterministic-id + `.create()` idempotency guard as saveTransactionServer, and for the same reason. */
export async function saveExpenseServer(exp: ExpenseDoc): Promise<void> {
  if (localTransactionStore.expenses.has(exp.id)) {
    throw new Error("This exact expense has already been imported.");
  }
  localTransactionStore.expenses.set(exp.id, { ...exp });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("expenses").doc(exp.id).create(cleanUndefined(exp));
    } catch (e: any) {
      localTransactionStore.expenses.delete(exp.id);
      if (e?.code === 6) {
        throw new Error("This exact expense has already been imported.");
      }
      onFirestoreError(`saveExpenseServer(${exp.id})`, e);
    }
  }
}

/** One expense record by id, scoped to the school, or null. */
export async function getExpenseByIdServer(schoolId: string, expenseId: string): Promise<ExpenseDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("expenses").doc(expenseId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as ExpenseDoc;
        return data.schoolId === schoolId ? data : null;
      }
    } catch (e: any) {
      console.warn("getExpenseByIdServer error:", e?.message);
    }
  }
  const local = localTransactionStore.expenses.get(expenseId);
  return local && local.schoolId === schoolId ? local : null;
}

/** One transaction by id, scoped to the school, or null. */
export async function getTransactionByIdServer(schoolId: string, txId: string): Promise<TransactionDoc | null> {
  if (hasAdminCredentials) {
    try {
      const doc = await adminDb.collection("transactions").doc(txId).get();
      if (doc.exists) {
        const data = { id: doc.id, ...doc.data() } as TransactionDoc;
        return data.schoolId === schoolId ? data : null;
      }
    } catch (e: any) {
      console.warn("getTransactionByIdServer error:", e?.message);
    }
  }
  const local = localTransactionStore.transactions.get(txId);
  return local && local.schoolId === schoolId ? local : null;
}

/**
 * Marks a transaction voided in place — never deletes it, so its content-hashed id stays
 * occupied and a later import of the exact same original row is still correctly rejected as a
 * duplicate (see saveTransactionServer's `.create()` guard). Every dashboard sum over
 * `transactions` must filter out `voided === true`.
 */
export async function voidTransactionServer(schoolId: string, txId: string): Promise<void> {
  const existing = await getTransactionByIdServer(schoolId, txId);
  if (!existing || existing.voided) return;
  const updated: TransactionDoc = { ...existing, voided: true, voidedAt: new Date().toISOString() };
  localTransactionStore.transactions.set(txId, updated);
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("transactions").doc(txId).set(cleanUndefined(updated), { merge: true });
    } catch (e) {
      onFirestoreError(`voidTransactionServer(${txId})`, e);
    }
  }
}

/**
 * Corrects an existing, manually-entered expense's own fields in place (same document id —
 * unlike `saveExpenseServer`'s `.create()`-based import-time dedup, an explicit edit is not a
 * duplicate submission, so it is never rejected). Only ever called for an expense the caller has
 * already verified belongs to this school.
 *
 * When date/description/amount changes, the linked TransactionDoc's content-hash id
 * (generateContentTransactionId) no longer matches its own content. Editing it in place would
 * free its old id for re-import while the new content silently claims no id at all — instead the
 * old transaction is voided (kept, never deleted) and a new one is created at the freshly
 * derived id, re-pointing `transactionRef`. This is what keeps the dashboard's Block 5
 * (sums ExpenseDoc) and Daily Breakdown (sums TransactionDoc) from drifting apart after an edit.
 */
export async function updateExpenseServer(
  schoolId: string,
  expenseId: string,
  updates: Partial<Pick<ExpenseDoc, "date" | "description" | "amount">>
): Promise<ExpenseDoc | null> {
  const existing = await getExpenseByIdServer(schoolId, expenseId);
  if (!existing) return null;
  const updated: ExpenseDoc = { ...existing, ...updates };

  const contentChanged = updates.date !== undefined || updates.description !== undefined || updates.amount !== undefined;
  if (contentChanged && existing.transactionRef) {
    const newTxId = generateContentTransactionId(schoolId, updated.date, "Other Expenses", updated.description, "N/A", updated.amount);
    if (newTxId !== existing.transactionRef) {
      await voidTransactionServer(schoolId, existing.transactionRef);
      const newTx: TransactionDoc = {
        id: newTxId,
        schoolId,
        importBatchId: "manual-entry",
        rowNumber: 1,
        date: updated.date,
        category: "Other Expenses",
        details: updated.description,
        className: "N/A",
        amount: updated.amount,
        academicYear: existing.academicYear || "",
        createdBy: existing.createdBy,
        createdAt: new Date().toISOString(),
      };
      try {
        await saveTransactionServer(newTx);
        updated.transactionRef = newTxId;
      } catch {
        // The new content-hash id is already occupied by an identical row recorded elsewhere —
        // leave transactionRef pointing at the now-voided old transaction rather than fail the
        // whole edit. The expense itself stays the source of truth for Block 5; only the Daily
        // Breakdown's per-day split for this one row is affected.
      }
    }
  }

  localTransactionStore.expenses.set(expenseId, { ...updated });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("expenses").doc(expenseId).set(cleanUndefined(updated), { merge: true });
    } catch (e) {
      onFirestoreError(`updateExpenseServer(${expenseId})`, e);
    }
  }
  return updated;
}

/**
 * Soft-void only — never hard-deletes an expense, for the same content-hash dedup reason as
 * voidTransactionServer. Also voids the linked TransactionDoc, so Block 5 and the Daily
 * Breakdown stay consistent after a delete, not just after an edit.
 */
export async function voidExpenseServer(
  schoolId: string,
  expenseId: string,
  voidedBy: string,
  reason: string
): Promise<ExpenseDoc | null> {
  const existing = await getExpenseByIdServer(schoolId, expenseId);
  if (!existing) return null;
  const updated: ExpenseDoc = {
    ...existing,
    voided: true,
    voidedAt: new Date().toISOString(),
    voidedBy,
    voidReason: reason,
  };
  localTransactionStore.expenses.set(expenseId, { ...updated });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("expenses").doc(expenseId).set(cleanUndefined(updated), { merge: true });
    } catch (e) {
      onFirestoreError(`voidExpenseServer(${expenseId})`, e);
    }
  }
  if (existing.transactionRef) {
    await voidTransactionServer(schoolId, existing.transactionRef);
  }
  return updated;
}

/**
 * Same indexed-range-query-with-fallback strategy as getTransactionsByDateRangeServer, and for
 * the same reason: a dashboard load must not pay for the school's entire expense history every
 * time it only needs today's or this month's figures.
 */
export async function getExpensesByDateRangeServer(
  schoolId: string,
  from?: string,
  to?: string
): Promise<ExpenseDoc[]> {
  let list: ExpenseDoc[] = [];
  const hasRange = !!from && !!to;

  if (hasAdminCredentials) {
    try {
      if (hasRange) {
        list = await withIndexFallback(
          "expenses.byDateRange",
          async () => {
            const snap = await adminDb
              .collection("expenses")
              .where("schoolId", "==", schoolId)
              .where("date", ">=", from!)
              .where("date", "<=", to!)
              .get();
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseDoc));
          },
          async () => {
            const snap = await adminDb.collection("expenses").where("schoolId", "==", schoolId).get();
            return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseDoc));
          }
        );
      } else {
        const snap = await adminDb.collection("expenses").where("schoolId", "==", schoolId).get();
        list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseDoc));
      }
    } catch (e: any) {
      console.warn("getExpensesByDateRangeServer error:", e?.message);
    }
  }

  if (list.length === 0) {
    list = Array.from(localTransactionStore.expenses.values()).filter((e) => e.schoolId === schoolId);
  }

  return list.filter((e) => {
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });
}
