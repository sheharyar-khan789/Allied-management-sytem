import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { dashboardPathForRole } from "@/lib/role-home";

const SESSION_IDLE_SECONDS = 5 * 60;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret || secret.trim().length < 32) {
      throw new Error(
        "Critical Security Configuration Error: JWT_SECRET environment variable is missing or insecurely short in production (minimum 32 characters required). Refusing to verify tokens."
      );
    }
    return new TextEncoder().encode(secret.trim());
  }

  if (!secret || secret.trim().length === 0) {
    return new TextEncoder().encode("allied-school-dev-only-local-secret-key-32-chars-min");
  }

  return new TextEncoder().encode(secret.trim());
}

const SECRET_KEY = getJwtSecret();

interface SessionPayload {
  uid: string;
  email: string;
  role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";
  schoolId: string;
  name: string;
  teacherId?: string;
  studentId?: string;
  studentIds?: string[];
}

/**
 * Generates a fresh, cryptographically random per-request nonce for the CSP script-src
 * directive. Edge-runtime-safe (uses Web Crypto, available in the middleware runtime).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Builds the Content-Security-Policy value for this request. Only genuinely-required
 * external domains are allowed (see FINAL_REMAINING_ISSUES_REPORT.md, M-5, for the source
 * inspection this is based on):
 *  - script-src: 'self' + the per-request nonce + 'strict-dynamic' (lets Next.js's own
 *    nonce'd bootstrap script load its webpack-split chunks without listing each one, and
 *    without ever falling back to 'unsafe-inline'). No 'unsafe-inline' fallback is included
 *    for script-src — every modern browser supports nonce-based CSP.
 *  - style-src: 'unsafe-inline' is required — the app has 3 legitimate, dynamically
 *    computed inline `style={{ width: ... }}` progress bars (admin/page.tsx,
 *    admin/classes/page.tsx, admin/reports/page.tsx) whose value changes per render and
 *    can't be pinned to a static nonce/hash. Inline style injection can't execute
 *    JavaScript, so this is a materially lower-severity allowance than script-src would be.
 *    Also allows fonts.googleapis.com for the Google Fonts stylesheet actually loaded in
 *    src/app/layout.tsx.
 *  - font-src: fonts.gstatic.com — the actual font files Google Fonts serves.
 *  - connect-src: identitytoolkit.googleapis.com + securetoken.googleapis.com +
 *    firestore.googleapis.com — Firebase Auth REST endpoints and Firestore WebChannel
 *    endpoint genuinely used by client SDK.
 *  - img-src: 'self' + data: + https: — matches the app's own next.config.ts
 *    images.remotePatterns, which already allows any https host for next/image.
 *  - frame-ancestors 'none' reinforces the existing X-Frame-Options: DENY.
 */
function buildCsp(nonce: string): string {
  // Next.js's dev server injects eval-based React Fast Refresh / HMR code. A strict
  // script-src would break `next dev` entirely (and only `next dev`), so 'unsafe-eval' is
  // added for non-production only. Production keeps the strict nonce + strict-dynamic policy.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;

  const directives = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: https:`,
    `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ];
  return directives.join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Next.js does NOT read `x-nonce`. It extracts the nonce from the *request*
  // `content-security-policy` header and applies it to the bootstrap/hydration <script> tags
  // it renders itself (see next/dist/server/app-render/app-render.js — it reads
  // `headers['content-security-policy']` and runs getScriptNonceFromHeader on it). Setting the
  // CSP only on the response therefore produced un-nonce'd scripts, and because
  // 'strict-dynamic' makes browsers ignore the 'self' source expression, EVERY script on every
  // middleware-matched route would have been blocked in production. Both headers are set:
  // the request one so Next.js picks up the nonce, the response one so the browser enforces
  // the policy. `x-nonce` is kept as a convenience for any component that wants to read the
  // raw value via headers().
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const attachCsp = (response: NextResponse): NextResponse => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  const attachSlidingSession = async (response: NextResponse, sess: SessionPayload) => {
    const token = await new SignJWT({
      uid: sess.uid,
      email: sess.email,
      role: sess.role,
      schoolId: sess.schoolId,
      name: sess.name,
      teacherId: sess.teacherId,
      studentId: sess.studentId,
      studentIds: sess.studentIds,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_IDLE_SECONDS}s`)
      .sign(SECRET_KEY);
    response.cookies.set("allied_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_IDLE_SECONDS,
    });
    return attachCsp(response);
  };

  const nextWithNonce = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/api")
  ) {
    return attachCsp(nextWithNonce());
  }

  const sessionCookie = req.cookies.get("allied_session")?.value;
  let session: SessionPayload | null = null;

  if (sessionCookie) {
    try {
      const { payload } = await jwtVerify(sessionCookie, SECRET_KEY);
      session = payload as unknown as SessionPayload;
    } catch {
      session = null;
    }
  }

  if (pathname === "/login" || pathname === "/register-institution-x7k2p") {
    if (session && session.uid && session.role) {
      return attachCsp(NextResponse.redirect(new URL(dashboardPathForRole(session.role), req.url)));
    }
    return attachCsp(nextWithNonce());
  }

  const requireRole = async (allowed: SessionPayload["role"][]) => {
    if (!session || !session.uid) {
      return attachCsp(NextResponse.redirect(new URL("/login", req.url)));
    }
    if (!allowed.includes(session.role)) {
      return attachCsp(NextResponse.redirect(new URL(dashboardPathForRole(session.role), req.url)));
    }
    return attachSlidingSession(nextWithNonce(), session);
  };

  if (pathname.startsWith("/admin")) {
    return requireRole(["ADMIN"]);
  }

  if (pathname.startsWith("/teacher")) {
    return requireRole(["TEACHER"]);
  }

  if (pathname.startsWith("/student")) {
    return requireRole(["STUDENT"]);
  }

  if (pathname.startsWith("/parent")) {
    return requireRole(["PARENT"]);
  }

  if (pathname.startsWith("/print")) {
    if (!session || !session.uid) {
      return attachCsp(NextResponse.redirect(new URL("/login", req.url)));
    }
    return attachSlidingSession(nextWithNonce(), session);
  }

  return attachCsp(nextWithNonce());
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/teacher/:path*",
    "/student/:path*",
    "/parent/:path*",
    "/print/:path*",
    "/login",
    "/register-institution-x7k2p",
    "/",
  ],
};
