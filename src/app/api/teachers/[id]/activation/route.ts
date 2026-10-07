import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getTeacherByIdServer,
  getUserByEmailServer,
  getUserByIdServer,
} from "@/lib/firebase/server-db";
import { sendPasswordSetupLink } from "@/lib/account-email";

export const dynamic = "force-dynamic";

/**
 * Re-sends a teacher's account activation (set-your-password) email. ADMIN-only and resolved
 * within the admin's own school, so a teacher id from another school is simply not found. The
 * link goes only to the email on the teacher's own login profile.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;

    const teacher = await getTeacherByIdServer(authUser.schoolId, id);
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }

    let profile = teacher.userId ? await getUserByIdServer(teacher.userId) : null;
    if (!profile && teacher.email) profile = await getUserByEmailServer(teacher.email);
    if (
      !profile ||
      profile.role !== "TEACHER" ||
      profile.schoolId !== authUser.schoolId ||
      (profile.teacherId && profile.teacherId !== teacher.id)
    ) {
      return NextResponse.json({ error: "This teacher has no login account to activate." }, { status: 404 });
    }
    if (profile.status !== "ACTIVE") {
      return NextResponse.json({ error: "This teacher's account is inactive." }, { status: 409 });
    }

    const delivery = await sendPasswordSetupLink(profile, "ACTIVATION", {
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
    });

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      delivery.delivered ? "SEND_ACCOUNT_ACTIVATION" : "ACCOUNT_ACTIVATION_EMAIL_FAILED",
      "TEACHER",
      teacher.id,
      delivery.delivered
        ? `Account activation email sent to ${profile.email} via ${delivery.mode}.`
        : `Account activation email to ${profile.email} was NOT delivered (${delivery.mode}): ${delivery.message}`
    );

    return NextResponse.json(
      { success: delivery.delivered, sent: delivery.delivered, channel: delivery.mode, email: profile.email },
      // dev-console: local development without any mail channel; the link is in the server log.
      { status: delivery.delivered || delivery.mode === "dev-console" ? 200 : 502 }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Teacher activation POST error:", error);
    return NextResponse.json({ error: "Failed to send the activation email." }, { status: 500 });
  }
}
