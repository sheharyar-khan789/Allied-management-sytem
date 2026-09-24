import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { UserRole } from "./types";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!secret || secret.trim().length < 32) {
      throw new Error(
        "Critical Security Configuration Error: JWT_SECRET environment variable is missing or insecurely short in production (minimum 32 characters required). Refusing to sign or verify tokens."
      );
    }
    return new TextEncoder().encode(secret.trim());
  }

  // Non-production local development fallback only
  if (!secret || secret.trim().length === 0) {
    return new TextEncoder().encode("allied-school-dev-only-local-secret-key-32-chars-min");
  }

  return new TextEncoder().encode(secret.trim());
}

const SECRET_KEY = getJwtSecret();

export const SESSION_IDLE_SECONDS = 5 * 60;

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: UserRole;
  schoolId: string;
  name: string;
  teacherId?: string;
  studentId?: string;
  studentIds?: string[];
}

export async function createSessionCookieServer(payload: AuthenticatedUser): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_IDLE_SECONDS}s`)
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
