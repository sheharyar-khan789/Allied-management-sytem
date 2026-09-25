import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByEmailServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { createSessionCookieServer, AuthenticatedUser, SESSION_IDLE_SECONDS } from "@/lib/firebase/server-auth";
import { dashboardPathForRole } from "@/lib/role-home";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { checkAuthRateLimit, recordAuthFailure, resetAuthRateLimit } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Extract client IP for rate limiting
  const forwarded = req.headers.get("x-forwarded-for");
  const clientIp = forwarded ? forwarded.split(",")[0].trim() : (req.headers.get("x-real-ip") || "127.0.0.1");

  // Check rate limit
  const rateCheck = checkAuthRateLimit(clientIp);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: `Too many login attempts. Please wait ${Math.ceil(rateCheck.resetInSeconds / 60)} minutes before trying again.` },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateCheck.resetInSeconds),
          "Content-Type": "application/json",
        },
      }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request payload." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const identifier = (body.identifier || body.email || "").toString().trim().toLowerCase();
  const password = (body.password || "").toString();
  const idToken = (body.idToken || "").toString();

  if (!identifier || (!password && !idToken)) {
    return NextResponse.json(
      { error: "Email address and password are required." },
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    let isAuthenticated = false;

    // 1. If Firebase ID token is provided, verify using Firebase Admin SDK
    if (idToken && hasAdminCredentials) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        if (decoded.email?.toLowerCase().trim() === identifier) {
          isAuthenticated = true;
        }
      } catch (tokenErr) {
        console.warn("Firebase ID token verification failed:", tokenErr);
      }
    }

    // 2. If password provided and not authenticated yet, verify via Firebase Auth
    if (!isAuthenticated && password) {
      const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
      const isDummyKey = !apiKey || apiKey.includes("Dummy") || apiKey.includes("AIzaSyDummy");

      if (apiKey && !isDummyKey) {
        // Authenticate against Firebase Identity Toolkit REST API
        try {
          const fbRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: identifier,
                password,
                returnSecureToken: true,
              }),
            }
          );

          if (fbRes.ok) {
            isAuthenticated = true;
          } else {
            const fbErrData = await fbRes.json().catch(() => ({}));
            const msg = fbErrData?.error?.message;
            // In development only, if account is not yet created in live Firebase Auth, allow dev seed credentials
            const devCredentials: Record<string, string> = {
              "admin@alliedschool.edu": "AdminSecure2025#",
              "teacher@alliedschool.edu": "TeacherSecure2025#",
              "student@alliedschool.edu": "StudentSecure2025#",
              "parent@alliedschool.edu": "ParentSecure2025#",
            };

            if (process.env.NODE_ENV !== "production" && msg === "EMAIL_NOT_FOUND" && devCredentials[identifier]) {
              if (devCredentials[identifier] === password) {
                isAuthenticated = true;
              } else {
                recordAuthFailure(clientIp);
                return NextResponse.json(
                  { error: "Invalid email or password." },
                  { status: 401, headers: { "Content-Type": "application/json" } }
                );
              }
            } else if (msg === "INVALID_PASSWORD" || msg === "EMAIL_NOT_FOUND" || msg === "INVALID_LOGIN_CREDENTIALS") {
              recordAuthFailure(clientIp);
              return NextResponse.json(
                { error: "Invalid email or password." },
                { status: 401, headers: { "Content-Type": "application/json" } }
              );
            }
          }
        } catch (fetchErr) {
          console.error("Firebase Auth REST API connection error:", fetchErr);
        }
      }

      // 3. In non-production local development only: verify against known dev seed credentials
      if (!isAuthenticated && process.env.NODE_ENV !== "production") {
        const devCredentials: Record<string, string> = {
          "admin@alliedschool.edu": "AdminSecure2025#",
          "teacher@alliedschool.edu": "TeacherSecure2025#",
          "student@alliedschool.edu": "StudentSecure2025#",
          "parent@alliedschool.edu": "ParentSecure2025#",
        };

        if (devCredentials[identifier] && devCredentials[identifier] === password) {
          isAuthenticated = true;
        }
      }
    }

    if (!isAuthenticated && password) {
      try {
        const hashedUser = await getUserByEmailServer(identifier);
        if (hashedUser?.passwordHash && bcrypt.compareSync(password, hashedUser.passwordHash)) {
          isAuthenticated = true;
        }
      } catch {
        // If database connection error occurs, proceed to unauthenticated check
      }
    }

    // If authentication failed
    if (!isAuthenticated) {
      recordAuthFailure(clientIp);
      return NextResponse.json(
        { error: "Invalid email or password. Please verify your credentials." },
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Reset rate limiter on successful authentication
    resetAuthRateLimit(clientIp);

    // Retrieve user profile from database
    let user = await getUserByEmailServer(identifier);

    // If user exists in Firebase Auth but profile not yet written in Firestore, provision profile
    if (!user && hasAdminCredentials) {
      try {
        const fbUserRecord = await adminAuth.getUserByEmail(identifier);
        if (fbUserRecord) {
          // Role and tenant are taken ONLY from the server-set custom claims this application
          // writes when it provisions an account (register / students / teachers / link-parent
          // all call setCustomUserClaims). The previous fallback inferred the role from a
          // substring of the email address — so any Firebase Auth account whose address merely
          // contained "admin" was auto-provisioned as an ADMIN. Firebase projects accept
          // self-signup against the public web API key by default, which made that an
          // attacker-influenced input. No claims means no provisioning: the login is refused
          // below rather than guessed at.
          const claimedRole = fbUserRecord.customClaims?.role as AuthenticatedUser["role"] | undefined;
          const claimedSchoolId = fbUserRecord.customClaims?.schoolId as string | undefined;
          const VALID_ROLES: AuthenticatedUser["role"][] = ["ADMIN", "TEACHER", "STUDENT", "PARENT"];

          if (claimedRole && VALID_ROLES.includes(claimedRole) && claimedSchoolId) {
            user = {
              uid: fbUserRecord.uid,
              email: fbUserRecord.email || identifier,
              name: fbUserRecord.displayName || identifier.split("@")[0],
              role: claimedRole,
              schoolId: claimedSchoolId,
              teacherId: (fbUserRecord.customClaims?.teacherId as string | undefined) || undefined,
              studentId: (fbUserRecord.customClaims?.studentId as string | undefined) || undefined,
              status: "ACTIVE",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            const { adminDb } = await import("@/lib/firebase/admin");
            await adminDb.collection("users").doc(fbUserRecord.uid).set(user, { merge: true });
          } else {
            console.warn(
              "Refusing to auto-provision a profile for an authenticated account with no role/schoolId custom claims."
            );
          }
        }
      } catch (adminErr) {
        console.warn("Could not auto-provision user from Firebase Auth:", adminErr);
      }
    }

    if (!user) {
      // Deliberately generic: the caller has proven they hold the credentials for this
      // account, but confirming whether a profile exists in this system leaks whether that
      // address belongs to a provisioned user of some school on this deployment.
      recordAuthFailure(clientIp);
      return NextResponse.json(
        { error: "This account is not set up for access. Please contact your administrator." },
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (user.status === "INACTIVE" || user.status === "SUSPENDED") {
      return NextResponse.json(
        { error: "Account is inactive or suspended. Please contact administrator." },
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!user.schoolId) {
      return NextResponse.json(
        { error: "User account is not linked to a school." },
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const sessionData: AuthenticatedUser = {
      uid: user.uid,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      name: user.name,
      teacherId: user.teacherId,
      studentId: user.studentId,
      studentIds: user.studentIds,
    };

    const token = await createSessionCookieServer(sessionData);

    try {
      await createAuditLogServer(
        sessionData.schoolId,
        user.uid,
        user.email,
        user.role,
        "LOGIN",
        "AUTH",
        user.uid,
        `User successfully logged in with role ${user.role}.`
      );
    } catch (auditErr) {
      console.warn("Audit log creation during login skipped:", auditErr);
    }

    const redirectUrl = dashboardPathForRole(user.role);

    const response = NextResponse.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        role: user.role,
        schoolId: sessionData.schoolId,
        name: user.name,
      },
      redirectUrl,
    });

    response.cookies.set("allied_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_IDLE_SECONDS,
    });

    return response;
  } catch (error: any) {
    console.error("Login route error:", error);
    return NextResponse.json(
      { error: "Authentication service error. Please try again." },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
