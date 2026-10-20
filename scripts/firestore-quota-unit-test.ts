/**
 * Unit tests (no database) for the Firestore quota handling building blocks:
 * error classification, the retry policy, the 503 mapping and the server-side TTL cache.
 */
import {
  firestoreErrorCode,
  isMissingIndexError,
  isQuotaExceededError,
  isServiceUnavailableError,
  isServiceBusyDigest,
  isTransientFirestoreError,
  SERVICE_BUSY_DIGEST_PREFIX,
  SERVICE_BUSY_MESSAGE,
  serviceBusyResponseFor,
  ServiceUnavailableError,
  withFirestoreRetry,
} from "../src/lib/firebase/firestore-errors";
import {
  cached,
  cacheKeys,
  invalidateCache,
  invalidateUserProfileCache,
  peekCached,
  resetServerCaches,
} from "../src/lib/server-cache";
import { onFirestoreError } from "../src/lib/firebase/server-db";

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

const grpc = (code: number, name: string, msg = "x") => Object.assign(new Error(`${code} ${name}: ${msg}`), { code });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function quiet<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const e = console.error;
  const w = console.warn;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = e;
    console.warn = w;
  }
}

async function main() {
  // --- classification
  assert(firestoreErrorCode(grpc(8, "RESOURCE_EXHAUSTED")) === 8, "numeric gRPC code is read");
  assert(firestoreErrorCode({ code: "resource-exhausted" }) === 8, "string code (client SDK style) is read");
  assert(
    firestoreErrorCode(new Error("Database error during getUserByEmailServer(x): 8 RESOURCE_EXHAUSTED: Quota exceeded.")) === 8,
    "the production log message from Vercel is recognised as RESOURCE_EXHAUSTED"
  );
  assert(firestoreErrorCode({ message: "wrapper", cause: grpc(14, "UNAVAILABLE") }) === 14, "code found through a wrapper's cause");
  assert(isQuotaExceededError(grpc(8, "RESOURCE_EXHAUSTED")) && !isTransientFirestoreError(grpc(8, "RESOURCE_EXHAUSTED")), "quota is not transient");
  assert(isTransientFirestoreError(grpc(14, "UNAVAILABLE")) && isTransientFirestoreError(grpc(4, "DEADLINE_EXCEEDED")), "UNAVAILABLE / DEADLINE_EXCEEDED are transient");
  assert(
    isServiceUnavailableError(grpc(8, "RESOURCE_EXHAUSTED")) && isServiceUnavailableError(grpc(14, "UNAVAILABLE")) && !isServiceUnavailableError(new Error("boom")),
    "only quota/unavailable errors map to 503"
  );
  assert(isServiceUnavailableError(new ServiceUnavailableError(grpc(8, "RESOURCE_EXHAUSTED"))), "ServiceUnavailableError maps to 503");
  assert(isMissingIndexError(grpc(9, "FAILED_PRECONDITION", "The query requires an index.")), "missing composite index is recognised");
  assert(!isMissingIndexError(grpc(8, "RESOURCE_EXHAUSTED")), "quota is not a missing index");

  // --- retry policy
  {
    let calls = 0;
    const out = await quiet(() => withFirestoreRetry("t", async () => { calls++; if (calls <= 2) throw grpc(14, "UNAVAILABLE"); return "ok"; }, { baseDelayMs: 1 }));
    assert(out.result === "ok" && calls === 3, "UNAVAILABLE is retried (2 retries, then success)");
  }
  {
    let calls = 0;
    const err = await quiet(() => withFirestoreRetry("t", async () => { calls++; throw grpc(14, "UNAVAILABLE"); }, { baseDelayMs: 1 }).catch((e) => e));
    assert(isTransientFirestoreError(err.result) && calls === 3, "at most 2 retries (3 attempts) for UNAVAILABLE");
  }
  {
    let calls = 0;
    const err = await withFirestoreRetry("t", async () => { calls++; throw grpc(8, "RESOURCE_EXHAUSTED"); }, { baseDelayMs: 1 }).catch((e) => e);
    assert(isQuotaExceededError(err) && calls === 1, "RESOURCE_EXHAUSTED is never retried");
  }
  {
    let calls = 0;
    await withFirestoreRetry("t", async () => { calls++; throw new Error("permission"); }, { baseDelayMs: 1 }).catch(() => undefined);
    assert(calls === 1, "other errors are not retried");
  }
  {
    let calls = 0;
    await quiet(() => withFirestoreRetry("t", async () => { calls++; throw grpc(4, "DEADLINE_EXCEEDED"); }, { retries: 5, baseDelayMs: 1 }).catch(() => undefined));
    assert(calls === 3, "retries are capped at 2 even if more are requested");
  }

  // --- 503 mapping
  {
    const { result, lines } = await quiet(async () => serviceBusyResponseFor(grpc(8, "RESOURCE_EXHAUSTED"), "/api/x"));
    const body = result ? await result.json() : null;
    assert(result?.status === 503 && body?.error === SERVICE_BUSY_MESSAGE && result.headers.get("Retry-After"), "quota → 503 with the busy message and Retry-After");
    assert(lines.some((l) => l.includes("[FIRESTORE_QUOTA_EXCEEDED]")), "quota is logged with the FIRESTORE_QUOTA_EXCEEDED tag");
    assert(serviceBusyResponseFor(new Error("boom")) === null, "ordinary errors are left to the route (500)");
  }
  {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { result: wrapped } = await quiet(async () => {
      try {
        onFirestoreError("getUserByEmailServer(x)", grpc(8, "RESOURCE_EXHAUSTED", "Quota exceeded."));
        return null;
      } catch (e) {
        return e;
      }
    });
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    assert(isQuotaExceededError(wrapped) && (wrapped as { code?: number }).code === 8, "onFirestoreError keeps the gRPC code when it wraps the error");
  }

  // --- server cache
  resetServerCaches();
  {
    let loads = 0;
    const loader = async () => { loads++; await sleep(5); return { n: 1, list: [1, 2] }; };
    const [a, b] = await Promise.all([cached("k1", 1000, loader), cached("k1", 1000, loader)]);
    assert(loads === 1 && a.n === 1 && b.n === 1, "concurrent misses share one load");
    a.list.push(99);
    const c = await cached("k1", 1000, loader);
    assert(loads === 1 && c.list.length === 2, "cached values are cloned: a caller's mutation never leaks");
    invalidateCache("k1");
    await cached("k1", 1000, loader);
    assert(loads === 2, "invalidation forces a reload");
  }
  {
    let loads = 0;
    await cached("k2", 20, async () => ++loads);
    await sleep(40);
    await cached("k2", 20, async () => ++loads);
    assert(loads === 2, "entries expire after their TTL");
  }
  {
    let loads = 0;
    await cached("k3", 1000, async () => { loads++; throw new Error("x"); }).catch(() => undefined);
    await cached("k3", 1000, async () => ++loads);
    assert(loads === 2, "failures are not cached");
  }
  {
    await cached(cacheKeys.sessionProfile("school-a", "u1"), 1000, async () => ({ uid: "u1" }));
    await cached(cacheKeys.sessionProfile("school-b", "u1"), 1000, async () => ({ uid: "u1" }));
    await cached(cacheKeys.sessionProfile("school-a", "u10"), 1000, async () => ({ uid: "u10" }));
    invalidateUserProfileCache("u1");
    assert(
      !peekCached(cacheKeys.sessionProfile("school-a", "u1")) &&
        !peekCached(cacheKeys.sessionProfile("school-b", "u1")) &&
        !!peekCached(cacheKeys.sessionProfile("school-a", "u10")),
      "invalidating a user drops exactly that user's cached profile (every school), nobody else's"
    );
  }

  {
    // src/app/error.tsx: production hides server error messages but keeps an existing digest, so
    // a real outage is recognised by its digest and nothing else is shown as "busy".
    const a = new ServiceUnavailableError({ code: 8 });
    const b = new ServiceUnavailableError({ code: 14 });
    assert(a.digest.startsWith(SERVICE_BUSY_DIGEST_PREFIX) && isServiceBusyDigest(a.digest), "an outage error carries a service-busy digest");
    assert(a.digest !== b.digest, "each outage gets its own reference (matches its log line)");
    assert(
      !isServiceBusyDigest("2914583117") && !isServiceBusyDigest(undefined) && !isServiceBusyDigest((new Error("boom") as Error & { digest?: string }).digest),
      "ordinary errors and Next.js hash digests are never treated as busy"
    );
  }

  console.log(`\nQuota unit tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
