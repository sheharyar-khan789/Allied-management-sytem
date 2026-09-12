import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "allied-school-firebase-jwt-secure-key-2025"
);

interface SessionPayload {
  uid: string;
  email: string;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  schoolId: string;
  name: string;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignore static assets, images, API routes, and public files
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

  // If on login page
  if (pathname === "/login") {
    if (session && session.uid && session.role) {
      if (session.role === "ADMIN") {
        return NextResponse.redirect(new URL("/admin", req.url));
      } else if (session.role === "TEACHER") {
        return NextResponse.redirect(new URL("/teacher", req.url));
      } else if (session.role === "STUDENT") {
        return NextResponse.redirect(new URL("/student", req.url));
      }
    }
    return NextResponse.next();
  }

  // Protected Admin Routes
  if (pathname.startsWith("/admin")) {
    if (!session || !session.uid) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "ADMIN") {
      const target = session.role === "TEACHER" ? "/teacher" : "/student";
      return NextResponse.redirect(new URL(target, req.url));
    }
    return NextResponse.next();
  }

  // Protected Teacher Routes
  if (pathname.startsWith("/teacher")) {
    if (!session || !session.uid) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "TEACHER") {
      const target = session.role === "ADMIN" ? "/admin" : "/student";
      return NextResponse.redirect(new URL(target, req.url));
    }
    return NextResponse.next();
  }

  // Protected Student Routes
  if (pathname.startsWith("/student")) {
    if (!session || !session.uid) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "STUDENT") {
      const target = session.role === "ADMIN" ? "/admin" : "/teacher";
      return NextResponse.redirect(new URL(target, req.url));
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
    "/login",
    "/"
  ],
};
