import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { UserRole } from "./types";

const SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "allied-school-firebase-jwt-secure-key-2025"
);

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: UserRole;
  schoolId: string;
  name: string;
  teacherId?: string;
  studentId?: string;
}

export async function createSessionCookieServer(payload: AuthenticatedUser): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET_KEY);
}

export async function getAuthenticatedUser(req?: NextRequest): Promise<AuthenticatedUser | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get("allied_session")?.value;
  } else {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get("allied_session")?.value;
    } catch {
      return null;
    }
  }

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET_KEY);
    return payload as unknown as AuthenticatedUser;
  } catch (e) {
    return null;
  }
}

export async function requireAuth(
  req?: NextRequest,
  allowedRoles?: UserRole[]
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req);

  if (!user || !user.uid || !user.schoolId) {
    throw new Response(
      JSON.stringify({ error: "Unauthorized: Active authenticated session required." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    throw new Response(
      JSON.stringify({ error: `Forbidden: User role ${user.role} is not authorized for this resource.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return user;
}
