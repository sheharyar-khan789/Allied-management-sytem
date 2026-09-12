// Lightweight in-memory rate limiter for authentication endpoints
// Provides burst and brute-force protection per Vercel serverless container instance

interface RateLimitRecord {
  count: number;
  firstAttempt: number;
  blockedUntil: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Cleanup stale entries every 10 minutes to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.blockedUntil && now - record.firstAttempt > 10 * 60 * 1000) {
        rateLimitStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Checks rate limit for a given key (e.g. IP address or IP + identifier).
 * Default: Max 10 failed attempts within a 5-minute window.
 */
export function checkAuthRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowSeconds: number = 300
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const record = rateLimitStore.get(key);

  if (!record) {
    return {
      allowed: true,
      remaining: maxAttempts,
      resetInSeconds: windowSeconds,
    };
  }

  // Check if currently in cooldown
  if (record.blockedUntil > now) {
    const resetInSeconds = Math.ceil((record.blockedUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds,
    };
  }

  // Check if window has expired
  if (now - record.firstAttempt > windowMs) {
    rateLimitStore.delete(key);
    return {
      allowed: true,
      remaining: maxAttempts,
      resetInSeconds: windowSeconds,
    };
  }

  // Within window and not blocked
  const remaining = Math.max(0, maxAttempts - record.count);
  const resetInSeconds = Math.ceil((record.firstAttempt + windowMs - now) / 1000);

  return {
    allowed: record.count < maxAttempts,
    remaining,
    resetInSeconds,
  };
}

/**
 * Records a failed attempt for the given key.
 * If failures exceed maxAttempts, enters a cooldown period.
 */
export function recordAuthFailure(
  key: string,
  maxAttempts: number = 10,
  cooldownSeconds: number = 300
) {
  const now = Date.now();
  const windowMs = cooldownSeconds * 1000;
  let record = rateLimitStore.get(key);

  if (!record || now - record.firstAttempt > windowMs) {
    record = {
      count: 1,
      firstAttempt: now,
      blockedUntil: 0,
    };
  } else {
    record.count += 1;
    if (record.count >= maxAttempts) {
      record.blockedUntil = now + windowMs;
    }
  }

  rateLimitStore.set(key, record);
}

/**
 * Resets rate limit counter upon successful authentication.
 */
export function resetAuthRateLimit(key: string) {
  rateLimitStore.delete(key);
}
