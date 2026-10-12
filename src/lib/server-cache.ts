/**
 * Small per-instance, in-memory TTL cache for data that changes rarely but is read on almost every
 * request (user profiles for the session check, school settings, classes/exams, subjects,
 * teachers, per-class aggregate counts).
 *
 * Why: on Vercel every page navigation and API call re-read these documents from Firestore, which
 * is what exhausted the Spark plan's 50K reads/day. A 30–60 second cache removes the repeated
 * reads while keeping data fresh:
 *  - every write path in server-db.ts invalidates the affected keys in the same instance, so the
 *    instance that made a change sees it immediately;
 *  - another serverless instance can serve the previous value for at most the TTL.
 *
 * Values are deep-cloned on the way in and out, so a caller mutating a returned object can never
 * corrupt what later requests see. Concurrent misses for the same key share one Firestore read.
 */

interface Entry {
  expiresAt: number;
  value?: unknown;
  promise?: Promise<unknown>;
}

const MAX_ENTRIES = 5000;
const store = new Map<string, Entry>();

export const CACHE_TTL_MS = {
  /** User profile behind the session check: bounds how long a revocation can take on another instance. */
  SESSION_PROFILE: 30_000,
  /** School settings, classes, exams, subjects, teachers. */
  SCHOOL_REFERENCE: 60_000,
  /** Aggregate counts/sums for dashboards and reports. */
  AGGREGATES: 60_000,
} as const;

function clone<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") return value;
  return structuredClone(value);
}

function evictIfFull() {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Still full: drop the oldest insertions (Map preserves insertion order).
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Returns the cached value for `key`, or runs `loader` once and caches its result for `ttlMs`. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    if (hit.promise) return clone((await hit.promise) as T);
    return clone(hit.value as T);
  }

  evictIfFull();
  const promise = loader();
  const entry: Entry = { expiresAt: now + ttlMs, promise };
  store.set(key, entry);
  try {
    const value = await promise;
    // Only keep it if nobody invalidated the key while we were loading.
    if (store.get(key) === entry) store.set(key, { expiresAt: entry.expiresAt, value: clone(value) });
    return clone(value);
  } catch (error) {
    if (store.get(key) === entry) store.delete(key);
    throw error;
  }
}

/** The cached value if present and fresh (no load), else undefined. */
export function peekCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit || hit.expiresAt <= Date.now() || hit.promise) return undefined;
  return clone(hit.value as T);
}

export function invalidateCache(key: string): void {
  store.delete(key);
}

export function invalidateCachePrefix(prefix: string): void {
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function invalidateCacheWhere(predicate: (key: string) => boolean): void {
  for (const key of Array.from(store.keys())) {
    if (predicate(key)) store.delete(key);
  }
}

/** Test helper: drop everything (e.g. to measure a cold serverless instance). */
export function resetServerCaches(): void {
  store.clear();
}

// Cache keys. Everything school-scoped starts with `school:<schoolId>:` so tenants never share an
// entry and a whole school can be invalidated at once.
export const cacheKeys = {
  sessionProfile: (schoolId: string, uid: string) => `profile:${schoolId}:${uid}`,
  school: (schoolId: string) => `school:${schoolId}:doc`,
  settings: (schoolId: string) => `school:${schoolId}:settings`,
  sessionContext: (schoolId: string) => `school:${schoolId}:sessionctx`,
  subjects: (schoolId: string) => `school:${schoolId}:subjects`,
  teachers: (schoolId: string) => `school:${schoolId}:teachers`,
  teacher: (schoolId: string, teacherId: string) => `school:${schoolId}:teacher:${teacherId}`,
  studentsPrefix: (schoolId: string) => `school:${schoolId}:students:`,
  students: (schoolId: string, classId: string, status: string) => `school:${schoolId}:students:${classId}:${status}`,
  studentCountsPrefix: (schoolId: string) => `school:${schoolId}:studentcounts:`,
  feeAggregatesPrefix: (schoolId: string) => `school:${schoolId}:feeagg:`,
  examGradesPrefix: (schoolId: string) => `school:${schoolId}:examgrades:`,
  teacherCounts: (schoolId: string) => `school:${schoolId}:teachercounts`,
  attendanceTotalsPrefix: (schoolId: string) => `school:${schoolId}:atttotals:`,
  recentPayments: (schoolId: string) => `school:${schoolId}:recentpayments`,
  timetableAll: (schoolId: string) => `school:${schoolId}:timetable`,
};

/** Drops every cached copy of one user's profile (all schools), e.g. after logout or a role change. */
export function invalidateUserProfileCache(uid: string): void {
  invalidateCacheWhere((key) => key.startsWith("profile:") && key.endsWith(`:${uid}`));
}
