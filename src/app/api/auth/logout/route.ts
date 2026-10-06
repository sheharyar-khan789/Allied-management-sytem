import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session-token";
import { revokeSessionIdServer } from "@/lib/firebase/server-db";
import { securityLog } from "@/lib/security-log";

export async function POST(req: NextRequest) {
  // Server-side revocation: the session id is recorded as revoked on the user's profile, so the
  // token stops working everywhere immediately (requireAuth checks it), not just in this browser.
  try {
    const claims = await verifySessionToken(req.cookies.get("allied_session")?.value);
    if (claims?.uid && claims.sid) {
      await revokeSessionIdServer(claims.uid, claims.sid);
      securityLog("auth.logout", { subject: claims.uid, role: claims.role, schoolId: claims.schoolId });
    }
  } catch (e) {
    console.error("Logout revocation failed:", (e as Error)?.message || "error");
  }

  const response = NextResponse.json({ success: true, message: "Logged out successfully" });
  response.cookies.delete("allied_session");
  return response;
}
