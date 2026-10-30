import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { hasAdminCredentials } from "@/lib/firebase/admin";
import { getEmailConfigStatus } from "@/lib/email-service";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

/**
 * Real, live configuration state for the admin Settings page's "System Status" panel, which used
 * to show three hardcoded "Connected" / "Enabled" tiles regardless of whether Firebase Admin or
 * an email provider were actually reachable. This is the one place an admin can see *why*
 * teacher/student activation emails are not being delivered without reading server logs or env
 * files — only provider names are ever reported, never credential values.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["ADMIN"]);

    const email = getEmailConfigStatus();

    return NextResponse.json({
      success: true,
      firebaseAdmin: {
        connected: hasAdminCredentials,
      },
      email: {
        // "resend" and/or "smtp": the app's own branded mailer is configured.
        providers: email.providers,
        // Even with neither configured, Firebase Authentication's built-in mailer is used as a
        // fallback for accounts that have a real Firebase Auth user (not available for
        // password-reset links sent to a different recipient, e.g. a guardian).
        firebaseAuthFallback: hasAdminCredentials,
        configured: email.providers.length > 0,
        missingForResend: email.providers.includes("resend") ? [] : email.missingForResend,
        missingForSmtp: email.providers.includes("smtp") ? [] : email.missingForSmtp,
      },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/admin/system-status");
    if (busy) return busy;
    console.error("System status error:", error);
    return NextResponse.json({ error: "Failed to read system status." }, { status: 500 });
  }
}
