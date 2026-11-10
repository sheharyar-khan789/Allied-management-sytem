import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { dashboardPathForRole } from "@/lib/role-home";

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
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
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

  if (pathname === "/login") {
    if (session && session.uid && session.role) {
      return NextResponse.redirect(new URL(dashboardPathForRole(session.role), req.url));
    }
    return NextResponse.next();
  }

  const requireRole = (allowed: SessionPayload["role"][]) => {
    if (!session || !session.uid) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (!allowed.includes(session.role)) {
      return NextResponse.redirect(new URL(dashboardPathForRole(session.role), req.url));
    }
    return NextResponse.next();
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
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/teacher/:path*",
    "/student/:path*",
    "/parent/:path*",
    "/print/:path*",
    "/login",
    "/",
  ],
};
