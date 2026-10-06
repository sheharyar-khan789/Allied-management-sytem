import { isRealDeployment } from "@/lib/session-token";

/**
 * Request-level checks shared by middleware (edge runtime) and route handlers (node runtime).
 * Web APIs only.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface RequestLike {
  method: string;
  url: string;
  headers: Headers;
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests. The session cookie is
 * SameSite=Lax, which already blocks cross-site POSTs in modern browsers; this is the explicit
 * second layer. A browser always sends Origin on cross-origin POST/PUT/PATCH/DELETE (and
 * Sec-Fetch-Site on all modern versions), so:
 *  - Origin present and different from this request's own origin  -> reject
 *  - no Origin, but Sec-Fetch-Site says cross-site/same-site        -> reject
 *  - neither header (curl, server-to-server, tests)                 -> allow (no ambient browser cookies)
 * Additional allowed origins can be listed in CSRF_TRUSTED_ORIGINS (comma separated).
 */
export function isCrossSiteStateChange(req: RequestLike, env: Record<string, string | undefined> = process.env): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;

  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === "null") return true;
    const allowed = new Set<string>();
    try {
      allowed.add(new URL(req.url).origin);
    } catch {
      // ignore
    }
    // Behind a proxy the URL Next.js sees can differ from the public one; trust the
    // forwarded/host header only for building the expected origin, never for anything else.
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || (() => {
      try {
        return new URL(req.url).protocol.replace(":", "");
      } catch {
        return "https";
      }
    })();
    if (host) allowed.add(`${proto}://${host}`);
    for (const extra of (env.CSRF_TRUSTED_ORIGINS || env.NEXT_PUBLIC_APP_URL || "").split(",")) {
      const v = extra.trim();
      if (!v) continue;
      try {
        allowed.add(new URL(v).origin);
      } catch {
        // ignore malformed entries
      }
    }
    if (allowed.has(origin)) return false;
    // Local development / tests only (never in production, on Vercel or with real Firebase
    // credentials): a localhost page talking to a localhost server is same-site.
    if (!isRealDeployment(env)) {
      try {
        const h = new URL(origin).hostname;
        if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return false;
      } catch {
        // fall through
      }
    }
    return true;
  }

  const fetchSite = (req.headers.get("sec-fetch-site") || "").toLowerCase();
  return fetchSite === "cross-site" || fetchSite === "same-site";
}

/**
 * Client IP for rate limiting. On Vercel `x-real-ip` / `x-vercel-forwarded-for` are set by the
 * platform and cannot be spoofed by the client; the left-most `x-forwarded-for` entry is only
 * trustworthy behind a proxy that overwrites it (Vercel does). Never used for authorization.
 */
export function getClientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim().slice(0, 64);
  const real = headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
  return "127.0.0.1";
}
