import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  createSessionCookieServer,
  SESSION_COOKIE_OPTIONS,
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
    const {
      passwordHash: _omit,
      resetTokenHash: _rth,
      resetTokenExpires: _rte,
      mfaSecret: _ms,
      mfaPendingSecret: _mps,
      mfaLastUsedStep: _mls,
      revokedSessionIds: _rsi,
      sessionsValidAfter: _sva,
      ...safeUser
    } = resolved as typeof resolved & {
      passwordHash?: string;
      resetTokenHash?: string;
      resetTokenExpires?: string;
      mfaSecret?: string;
      mfaPendingSecret?: string;
      mfaLastUsedStep?: number;
      revokedSessionIds?: string[];
      sessionsValidAfter?: string;
    };
    void [_omit, _rth, _rte, _ms, _mps, _mls, _rsi, _sva];

    const token = await createSessionCookieServer({
      uid: authUser.uid,
      email: authUser.email,
      role: authUser.role,
      schoolId: authUser.schoolId,
      name: authUser.name,
      teacherId: authUser.teacherId,
      studentId: authUser.studentId,
      studentIds: authUser.studentIds,
      authAt: authUser.authAt,
      sid: authUser.sid,
    });

    const response = NextResponse.json({ user: safeUser, session: safeUser });
    response.cookies.set("allied_session", token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    console.error("Session check error:", (error as Error)?.message || "error");
    return NextResponse.json({ user: null, session: null }, { status: 500 });
  }
}
