import { NextRequest, NextResponse } from "next/server";
import { saveSchoolServer, updateSchoolSettingsServer, createUserServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { createSessionCookieServer, AuthenticatedUser } from "@/lib/firebase/server-auth";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { School, SchoolSettingsDoc, UserProfile } from "@/lib/firebase/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
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
    const schoolId = `${schoolSlug || "allied-school"}-${Date.now().toString().slice(-4)}`;
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

    const schoolDoc: School = {
      id: schoolId,
      name: schoolName,
      code: (schoolSlug.toUpperCase().slice(0, 6) || "SCH001").replace(/-/g, ""),
      academicYear: "2024-2025",
      principalName: fullName,
      email,
      phone: "+92 300 1234567",
      address: "Campus Avenue, City Centre",
      createdAt: now,
      updatedAt: now,
    };

    const settingsDoc: SchoolSettingsDoc = {
      id: schoolId,
      schoolId,
      schoolName,
      campusName: "Main Campus",
      motto: "Excellence in Education",
      address: "Campus Avenue, City Centre",
      phone: "+92 300 1234567",
      email,
      principalName: fullName,
      academicYear: "2024-2025",
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
