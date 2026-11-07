import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { resetTeacherPassword } from "@/lib/teacher-lifecycle";

export const dynamic = "force-dynamic";

/**
 * Admin: Triggers a password reset link for the teacher.
 * - Resolves the teacher's authoritative account using UID first.
 * - Targets the current synchronized email address (never a stale or outdated email).
 * - Accurately distinguishes between verified email delivery (PROVIDER_ACCEPTED) and unconfirmed Firebase delivery (DELIVERY_UNCONFIRMED).
 * - Strictly isolated to the authenticated administrator's school.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;

    const result = await resetTeacherPassword(
      authUser.schoolId,
      id,
      {
        origin: req.headers.get("origin"),
        host: req.headers.get("host"),
      },
      {
        performedByUid: authUser.uid,
        performedByEmail: authUser.email,
        performedByRole: authUser.role,
      }
    );

    if (!result.ok && result.channel !== "dev-console") {
      return NextResponse.json(
        {
          error: result.error || "Failed to process password reset.",
          deliveryStatus: result.deliveryStatus,
          canRetry: result.canRetry ?? true,
          email: result.email,
        },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        deliveryStatus: result.deliveryStatus,
        sent: result.sent,
        email: result.email,
        channel: result.channel,
        providerMessageId: result.providerMessageId,
        canRetry: result.canRetry,
        message:
          result.message ||
          (result.deliveryStatus === "DELIVERY_UNCONFIRMED"
            ? `Password reset request processed. Email delivery cannot be confirmed by Firebase. Please ask the teacher to check inbox and spam folders.`
            : result.deliveryStatus === "PROVIDER_ACCEPTED"
            ? `Password reset email accepted by ${result.channel}${result.providerMessageId ? ` (ID: ${result.providerMessageId})` : ""} for ${result.email}.`
            : `Password reset request processed for ${result.email}.`),
      },
      { status: result.status }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]/reset-password");
    if (busy) return busy;
    console.error("Teacher reset password POST error:", error);
    return NextResponse.json({ error: "Failed to process teacher password reset." }, { status: 500 });
  }
}
