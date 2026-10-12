import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  createSessionCookieServer,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/firebase/server-auth";
import { getSessionProfileServer } from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json({ user: null, session: null }, { status: 401 });
    }

    // Same (≤30s cached) profile the session check just used: no second read.
    const profile = await getSessionProfileServer(authUser.schoolId, authUser.uid);
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
    // 503 (not 401) while Firestore is out of quota: the client only signs out on 401.
    const busy = serviceBusyResponseFor(error, "/api/auth/me");
    if (busy) return busy;
    console.error("Session check error:", (error as Error)?.message || "error");
    return NextResponse.json({ user: null, session: null }, { status: 500 });
  }
}
