import { adminDb, hasAdminCredentials } from "./admin";
import { cleanUndefined } from "./server-db";
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

export async function saveImportBatchServer(batch: ImportBatchDoc): Promise<void> {
  localTransactionStore.importBatches.set(batch.id, { ...batch });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("importBatches").doc(batch.id).set(cleanUndefined(batch), { merge: true });
    } catch (e: any) {
      console.warn("Failed to persist importBatch to Firestore:", e?.message);
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

export async function saveTransactionServer(tx: TransactionDoc): Promise<void> {
  localTransactionStore.transactions.set(tx.id, { ...tx });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("transactions").doc(tx.id).set(cleanUndefined(tx), { merge: true });
    } catch (e: any) {
      console.warn("Failed to persist transaction to Firestore:", e?.message);
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

export async function getTransactionsByDateRangeServer(
  schoolId: string,
  from?: string,
  to?: string,
  category?: string,
  classId?: string
): Promise<TransactionDoc[]> {
  let list: TransactionDoc[] = [];

  if (hasAdminCredentials) {
    try {
      let query: FirebaseFirestore.Query = adminDb.collection("transactions").where("schoolId", "==", schoolId);
      if (category) {
        query = query.where("category", "==", category);
      }
      const snap = await query.get();
      if (!snap.empty) {
        list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionDoc));
      }
    } catch (e: any) {
      console.warn("getTransactionsByDateRangeServer firestore query error:", e?.message);
    }
  }

  if (list.length === 0) {
    list = Array.from(localTransactionStore.transactions.values()).filter((t) => t.schoolId === schoolId);
  }

  // Filter in memory for date ranges, classId, and category
  return list.filter((t) => {
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (category && t.category !== category) return false;
    if (classId && t.classId !== classId) return false;
    return true;
  });
}

export async function saveExpenseServer(exp: ExpenseDoc): Promise<void> {
  localTransactionStore.expenses.set(exp.id, { ...exp });
  if (hasAdminCredentials) {
    try {
      await adminDb.collection("expenses").doc(exp.id).set(cleanUndefined(exp), { merge: true });
    } catch (e: any) {
      console.warn("Failed to persist expense to Firestore:", e?.message);
    }
  }
}

export async function getExpensesByDateRangeServer(
  schoolId: string,
  from?: string,
  to?: string
): Promise<ExpenseDoc[]> {
  let list: ExpenseDoc[] = [];

  if (hasAdminCredentials) {
    try {
      const snap = await adminDb.collection("expenses").where("schoolId", "==", schoolId).get();
      if (!snap.empty) {
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
