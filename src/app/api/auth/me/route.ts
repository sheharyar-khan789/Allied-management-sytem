import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  createSessionCookieServer,
  SESSION_IDLE_SECONDS,
} from "@/lib/firebase/server-auth";
import { getUserByIdServer } from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json({ user: null, session: null }, { status: 401 });
    }

    const profile = await getUserByIdServer(authUser.uid);
    const resolved = profile || authUser;
    const { passwordHash: _omit, ...safeUser } = resolved as typeof resolved & {
      passwordHash?: string;
    };
    void _omit;

    const token = await createSessionCookieServer({
      uid: authUser.uid,
      email: authUser.email,
      role: authUser.role,
      schoolId: authUser.schoolId,
      name: authUser.name,
      teacherId: authUser.teacherId,
      studentId: authUser.studentId,
      studentIds: authUser.studentIds,
    });

    const response = NextResponse.json({ user: safeUser, session: safeUser });
    response.cookies.set("allied_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_IDLE_SECONDS,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ user: null, session: null }, { status: 500 });
  }
}
