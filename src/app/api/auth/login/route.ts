import { NextRequest, NextResponse } from "next/server";
import { getUserByEmailServer, createAuditLogServer } from "@/lib/firebase/server-db";
import { createSessionCookieServer, AuthenticatedUser } from "@/lib/firebase/server-auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = body.identifier || body.email;

    if (!identifier) {
      return NextResponse.json(
        { error: "Username/Email is required." },
        { status: 400 }
      );
    }

    const email = identifier.toLowerCase().trim();
    const user = await getUserByEmailServer(email);

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials. User not found." },
        { status: 401 }
      );
    }

    if (user.status === "INACTIVE" || user.status === "SUSPENDED") {
      return NextResponse.json(
        { error: "Account is inactive or suspended. Please contact administrator." },
        { status: 403 }
      );
    }

    const sessionData: AuthenticatedUser = {
      uid: user.uid,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId || "allied-school-main",
      name: user.name,
      teacherId: user.teacherId,
      studentId: user.studentId,
    };

    const token = await createSessionCookieServer(sessionData);

    await createAuditLogServer(
      sessionData.schoolId,
      user.uid,
      user.email,
      user.role,
      "LOGIN",
      "AUTH",
      user.uid,
      `User logged in with role ${user.role}.`
    );

    let redirectUrl = "/admin";
    if (user.role === "TEACHER") redirectUrl = "/teacher";
    else if (user.role === "STUDENT") redirectUrl = "/student";

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
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error: any) {
    console.error("Login route error:", error);
    return NextResponse.json(
      { error: "Authentication service error." },
      { status: 500 }
    );
  }
}
