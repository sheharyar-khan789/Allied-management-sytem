import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { saveSchoolServer, updateSchoolSettingsServer, createUserServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { createSessionCookieServer, AuthenticatedUser } from "@/lib/firebase/server-auth";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { School, SchoolSettingsDoc, UserProfile } from "@/lib/firebase/types";
import { getDefaultAcademicYear } from "@/lib/school-display";
import { checkAuthRateLimit, recordAuthFailure } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // School registration creates a brand-new tenant plus a privileged ADMIN account, and was
    // previously the only unauthenticated write endpoint with no rate limiting at all — a
    // single client could create unlimited schools, admin users and Firebase Auth accounts.
    // Uses the same per-IP limiter as /api/auth/login, with a tighter budget because
    // legitimate registration is a rare, deliberate action.
    const forwarded = req.headers.get("x-forwarded-for");
    const clientIp = forwarded
      ? forwarded.split(",")[0].trim()
      : req.headers.get("x-real-ip") || "127.0.0.1";
    const rateCheck = checkAuthRateLimit(`register:${clientIp}`, 5, 900);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many registration attempts. Please wait ${Math.ceil(
            rateCheck.resetInSeconds / 60
          )} minutes before trying again.`,
        },
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

    const fullName = (body.fullName || "").toString().trim();
    const email = (body.email || "").toString().trim().toLowerCase();
    const password = (body.password || "").toString();
    const schoolName = (body.schoolName || "").toString().trim();
    const idToken = (body.idToken || "").toString();
    const registrationSecret = (body.registrationSecret || req.headers.get("x-registration-secret") || "").toString().trim();

    // Institutional registration gate: require the shared registration secret code
    const expectedSecret = (process.env.SCHOOL_REGISTRATION_SECRET || "").trim();
    if (!expectedSecret || registrationSecret !== expectedSecret) {
      return NextResponse.json(
        { error: "Invalid or missing registration authorization secret code." },
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!fullName || !email || (!password && !idToken) || !schoolName) {
      return NextResponse.json(
        { error: "Full name, email, password, and school name are required." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid administrator email address." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Server-side bounds on every free-text field. Client-side `required`/`minLength` is not a
    // control: these values become the tenant's permanent display identity (printed on fee
    // challans and report cards) and the admin account's own credentials.
    if (fullName.length < 2 || fullName.length > 120) {
      return NextResponse.json(
        { error: "Administrator name must be between 2 and 120 characters." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (schoolName.length < 2 || schoolName.length > 160) {
      return NextResponse.json(
        { error: "School name must be between 2 and 160 characters." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (email.length > 254) {
      return NextResponse.json(
        { error: "Please enter a valid administrator email address." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    // Firebase Auth enforces only a 6-character minimum. This account is the school's sole
    // administrator, with access to every student record, exam result and financial figure in
    // the tenant, so a stricter floor is applied here before the account is ever created.
    if (!idToken) {
      if (password.length < 10 || password.length > 128) {
        recordAuthFailure(`register:${clientIp}`, 5, 900);
        return NextResponse.json(
          { error: "Administrator password must be between 10 and 128 characters." },
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    let uid: string;
    let createdAuthUid: string | null = null;

    if (idToken && hasAdminCredentials) {
      const decoded = await adminAuth.verifyIdToken(idToken);
      uid = decoded.uid;
    } else if (hasAdminCredentials) {
      const authUser = await adminAuth.createUser({
        email,
        emailVerified: true,
        password,
        displayName: fullName,
      });
      uid = authUser.uid;
      createdAuthUid = authUser.uid;
    } else {
      uid = `usr-${Date.now()}`;
    }

    const schoolSlug = schoolName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    // A collision-resistant random suffix (not the last 4 digits of a timestamp, which two
    // schools registering within the same ~10-second window could share) appended to the
    // readable slug. This schoolId is the root of the entire tenant-isolation model, so a
    // collision here would be far more severe than a duplicate display id elsewhere.
    const uniqueSuffix = crypto.randomBytes(6).toString("hex");
    const schoolId = `${schoolSlug || "allied-school"}-${uniqueSuffix}`;
    const now = new Date().toISOString();

    if (hasAdminCredentials) {
      try {
        await adminAuth.setCustomUserClaims(uid, {
          role: "ADMIN",
          schoolId,
        });
      } catch (claimsErr) {
        console.warn("Failed to set custom claims on admin user:", claimsErr);
      }
    }

    const defaultAcademicYear = getDefaultAcademicYear();

    // Phone/address are intentionally left blank rather than pre-filled with a fabricated
    // Islamabad number/address: a brand-new school has no real contact details yet, and the
    // admin fills these in from Settings. Presenting fake contact info as if it were the
    // school's own data would be misleading on printed challans/report cards.
    const schoolDoc: School = {
      id: schoolId,
      name: schoolName,
      code: (schoolSlug.toUpperCase().slice(0, 6) || "SCH001").replace(/-/g, ""),
      academicYear: defaultAcademicYear,
      principalName: fullName,
      email,
      phone: "",
      address: "",
      createdAt: now,
      updatedAt: now,
    };

    const settingsDoc: SchoolSettingsDoc = {
      id: schoolId,
      schoolId,
      schoolName,
      campusName: "",
      motto: "",
      address: "",
      phone: "",
      email,
      principalName: fullName,
      academicYear: defaultAcademicYear,
      gradingScale: [
        { minPercentage: 90, grade: "A+", gpa: 4.0 },
        { minPercentage: 80, grade: "A", gpa: 3.7 },
        { minPercentage: 70, grade: "B+", gpa: 3.3 },
        { minPercentage: 60, grade: "B", gpa: 3.0 },
        { minPercentage: 50, grade: "C", gpa: 2.5 },
        { minPercentage: 40, grade: "D", gpa: 2.0 },
        { minPercentage: 0, grade: "F", gpa: 0.0 },
      ],
      updatedAt: now,
    };

    const profileDoc: UserProfile = {
      uid,
      name: fullName,
      email,
      role: "ADMIN",
      schoolId,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveSchoolServer(schoolDoc);
      await updateSchoolSettingsServer(settingsDoc);
      await createUserServer(profileDoc);
      await createAuditLogServer(
        schoolId,
        uid,
        email,
        "ADMIN",
        "REGISTER_SCHOOL",
        "AUTH",
        schoolId,
        `School ${schoolName} registered with Administrator ${fullName}.`
      );
    } catch (dbErr: any) {
      if (createdAuthUid && hasAdminCredentials) {
        try {
          await adminAuth.deleteUser(createdAuthUid);
        } catch (delErr) {
          console.error("Rollback admin user failed:", delErr);
        }
      }
      throw dbErr;
    }

    const sessionData: AuthenticatedUser = {
      uid,
      email,
      role: "ADMIN",
      schoolId,
      name: fullName,
    };

    const token = await createSessionCookieServer(sessionData);

    const response = NextResponse.json({
      success: true,
      schoolId,
      user: profileDoc,
      redirectUrl: "/admin",
    }, { status: 201 });

    response.cookies.set("allied_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error: any) {
    console.error("Registration route error:", error);
    const duplicateEmail = error?.code === "auth/email-already-exists";
    return NextResponse.json(
      {
        error: duplicateEmail
          ? "A user with this administrator email already exists."
          : "Failed to complete school registration.",
      },
      { status: duplicateEmail ? 409 : 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
