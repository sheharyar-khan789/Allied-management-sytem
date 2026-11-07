import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { resetTeacherPassword } from "@/lib/teacher-lifecycle";

export const dynamic = "force-dynamic";

/**
 * Admin: Triggers a password reset link for the teacher.
 * - Always resolves the teacher's authoritative account using UID first.
 * - Targets the current synchronized email address (never a stale or outdated email).
 * - Generates Firebase password reset link and dispatches the reset email.
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
      return NextResponse.json({ error: result.error || "Failed to send password reset link." }, { status: result.status });
    }

    return NextResponse.json(
      {
        success: true,
        sent: result.sent,
        email: result.email,
        channel: result.channel,
        resetLink: result.resetLink,
        message: `Password reset link has been dispatched to ${result.email}.`,
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
