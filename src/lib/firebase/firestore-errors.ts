/**
 * Firestore failure classification shared by every server path.
 *
 * On the Spark (free) plan Firestore answers RESOURCE_EXHAUSTED (gRPC code 8) once the daily
 * read/write quota is used up, until the quota resets at midnight Pacific time. That is not an
 * authentication failure and not a bug in the request: callers turn it into HTTP 503 with a
 * clear "temporarily busy" message, never into 500 "Authentication service error", and never
 * count it against a user's login attempts.
 *
 * UNAVAILABLE (14) and DEADLINE_EXCEEDED (4) are transient network/backend blips and get a short
 * retry (see withFirestoreRetry). RESOURCE_EXHAUSTED is never retried: retrying only burns more
 * of a quota that is already gone.
 */

export const FIRESTORE_CODE = {
  DEADLINE_EXCEEDED: 4,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  UNAVAILABLE: 14,
} as const;

export const SERVICE_BUSY_MESSAGE = "Service is temporarily busy. Please try again in a few minutes.";

/** Log tags, so the cause is obvious in Vercel → Logs at a glance. */
export const FIRESTORE_QUOTA_EXCEEDED = "FIRESTORE_QUOTA_EXCEEDED";
export const FIRESTORE_UNAVAILABLE = "FIRESTORE_UNAVAILABLE";
export const FIRESTORE_INDEX_MISSING = "FIRESTORE_INDEX_MISSING";

const STRING_CODES: Record<string, number> = {
  "deadline-exceeded": 4,
  "resource-exhausted": 8,
  "failed-precondition": 9,
  unavailable: 14,
  DEADLINE_EXCEEDED: 4,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  UNAVAILABLE: 14,
};

/**
 * The gRPC status code of a Firestore error, looking through wrappers (`cause`) and, as a last
 * resort, the message ("8 RESOURCE_EXHAUSTED: Quota exceeded." is how the Admin SDK words it).
 */
export function firestoreErrorCode(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== "object" || depth > 4) return undefined;
  const e = error as { code?: unknown; cause?: unknown; message?: unknown };
  if (typeof e.code === "number") return e.code;
  if (typeof e.code === "string" && STRING_CODES[e.code] !== undefined) return STRING_CODES[e.code];
  const fromCause = firestoreErrorCode(e.cause, depth + 1);
  if (fromCause !== undefined) return fromCause;
  const message = typeof e.message === "string" ? e.message : "";
  if (/\bRESOURCE_EXHAUSTED\b|Quota exceeded/i.test(message)) return FIRESTORE_CODE.RESOURCE_EXHAUSTED;
  if (/\bUNAVAILABLE\b/.test(message)) return FIRESTORE_CODE.UNAVAILABLE;
  if (/\bDEADLINE_EXCEEDED\b/.test(message)) return FIRESTORE_CODE.DEADLINE_EXCEEDED;
  if (/\bFAILED_PRECONDITION\b/.test(message)) return FIRESTORE_CODE.FAILED_PRECONDITION;
  return undefined;
}

export function isQuotaExceededError(error: unknown): boolean {
  return firestoreErrorCode(error) === FIRESTORE_CODE.RESOURCE_EXHAUSTED;
}

/** Worth one more try after a short pause. */
export function isTransientFirestoreError(error: unknown): boolean {
  const code = firestoreErrorCode(error);
  return code === FIRESTORE_CODE.UNAVAILABLE || code === FIRESTORE_CODE.DEADLINE_EXCEEDED;
}

/** The database can't serve requests right now: answer 503, not 500/401. */
export function isServiceUnavailableError(error: unknown): boolean {
  if (error instanceof ServiceUnavailableError) return true;
  return isQuotaExceededError(error) || isTransientFirestoreError(error);
}

/** A query needs a composite index that isn't deployed (yet). */
export function isMissingIndexError(error: unknown): boolean {
  if (firestoreErrorCode(error) !== FIRESTORE_CODE.FAILED_PRECONDITION) return false;
  const message = (error as { message?: unknown })?.message;
  return typeof message === "string" ? /index/i.test(message) : true;
}

/** Thrown when Firestore is out of quota or unreachable; mapped to HTTP 503 by callers. */
export class ServiceUnavailableError extends Error {
  readonly code: number;
  readonly reason: typeof FIRESTORE_QUOTA_EXCEEDED | typeof FIRESTORE_UNAVAILABLE;
  constructor(cause: unknown) {
    const quota = isQuotaExceededError(cause);
    super(SERVICE_BUSY_MESSAGE);
    this.name = "ServiceUnavailableError";
    this.code = firestoreErrorCode(cause) ?? FIRESTORE_CODE.UNAVAILABLE;
    this.reason = quota ? FIRESTORE_QUOTA_EXCEEDED : FIRESTORE_UNAVAILABLE;
    (this as { cause?: unknown }).cause = cause;
  }
}

/** One structured log line per Firestore outage, tagged so it is searchable in Vercel logs. */
export function logFirestoreOutage(operation: string, error: unknown): void {
  const tag = isQuotaExceededError(error) ? FIRESTORE_QUOTA_EXCEEDED : FIRESTORE_UNAVAILABLE;
  const code = firestoreErrorCode(error);
  const message = String((error as { message?: unknown })?.message || "").slice(0, 200);
  console.error(`[${tag}] ${operation} failed (code ${code ?? "?"}): ${message}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a Firestore operation, retrying UNAVAILABLE / DEADLINE_EXCEEDED at most `retries` times
 * (default 2) with exponential backoff. RESOURCE_EXHAUSTED and every other error is rethrown
 * immediately.
 */
export async function withFirestoreRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = Math.max(0, Math.min(options.retries ?? 2, 2));
  const base = options.baseDelayMs ?? 150;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isTransientFirestoreError(error)) throw error;
      console.warn(`[${FIRESTORE_UNAVAILABLE}] ${operation}: transient error, retry ${attempt + 1}/${retries}`);
      await sleep(base * 2 ** attempt + Math.floor(Math.random() * base));
    }
  }
}

/** HTTP 503 with the user-facing "temporarily busy" message. */
export function serviceBusyResponse(): Response {
  return new Response(JSON.stringify({ error: SERVICE_BUSY_MESSAGE, serviceBusy: true }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Retry-After": "120", "Cache-Control": "no-store" },
  });
}

/**
 * For API route catch blocks: a 503 response if `error` means Firestore is out of quota or
 * unavailable (logging it with the FIRESTORE_* tag), otherwise null.
 */
export function serviceBusyResponseFor(error: unknown, operation = "request"): Response | null {
  if (!isServiceUnavailableError(error)) return null;
  logFirestoreOutage(operation, error instanceof ServiceUnavailableError ? error.cause ?? error : error);
  return serviceBusyResponse();
}
