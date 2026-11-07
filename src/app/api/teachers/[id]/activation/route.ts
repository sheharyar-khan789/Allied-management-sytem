import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  getTeacherByIdServer,
  getUserByEmailServer,
  getUserByIdServer,
  saveTeacherServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { sendPasswordSetupLink } from "@/lib/account-email";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { cacheKeys, invalidateCache, invalidateUserProfileCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

/**
 * Re-sends a teacher's account activation (set-your-password) email. ADMIN-only and resolved
 * within the admin's own school, so a teacher id from another school is simply not found. The
 * link goes only to the authoritative email on the teacher's own login profile / Firebase Auth account.
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
    if (!profile && hasAdminCredentials && teacher.email) {
      try {
        const fb = await adminAuth.getUserByEmail(teacher.email);
        if (fb.uid) {
          profile = await getUserByIdServer(fb.uid);
        }
      } catch {}
    }

    if (
      !profile ||
      profile.role !== "TEACHER" ||
      profile.schoolId !== authUser.schoolId ||
      (profile.teacherId && profile.teacherId !== teacher.id)
    ) {
      return NextResponse.json({ error: "This teacher has no login account to activate." }, { status: 404 });
    }
    if (profile.status !== "ACTIVE" || teacher.status !== "ACTIVE") {
      return NextResponse.json({ error: "This teacher's account is inactive." }, { status: 409 });
    }

    // Authoritative email resolution
    let authoritativeEmail = (profile.email || teacher.email || "").toLowerCase().trim();
    if (hasAdminCredentials && profile.uid) {
      try {
        const authRecord = await adminAuth.getUser(profile.uid);
        if (authRecord.email) {
          const authEmail = authRecord.email.toLowerCase().trim();
          if (authEmail !== authoritativeEmail) {
            authoritativeEmail = authEmail;
            profile.email = authoritativeEmail;
            await updateUserServer(profile);
            if (teacher.email !== authoritativeEmail) {
              await saveTeacherServer({ ...teacher, email: authoritativeEmail });
            }
          }
        }
      } catch (err: any) {
        if (err?.code === "auth/user-not-found") {
          return NextResponse.json({ error: "Authentication account not found for this teacher." }, { status: 404 });
        }
      }
    }

    if (teacher.userId !== profile.uid || teacher.email !== authoritativeEmail) {
      await saveTeacherServer({
        ...teacher,
        userId: profile.uid,
        email: authoritativeEmail,
        updatedAt: new Date().toISOString(),
      });
    }

    // Invalidate stale caches
    invalidateUserProfileCache(profile.uid, authoritativeEmail, teacher.email);
    invalidateCache(cacheKeys.userByEmail(authoritativeEmail));
    invalidateCache(cacheKeys.teacher(authUser.schoolId, teacher.id));
    invalidateCache(cacheKeys.teachers(authUser.schoolId));

    const delivery = await sendPasswordSetupLink(
      {
        uid: profile.uid,
        email: authoritativeEmail,
        name: profile.name || teacher.fullName,
        schoolId: profile.schoolId,
      },
      "ACTIVATION",
      {
        origin: req.headers.get("origin"),
        host: req.headers.get("host"),
      }
    );

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      delivery.delivered ? "SEND_ACCOUNT_ACTIVATION" : "ACCOUNT_ACTIVATION_EMAIL_FAILED",
      "TEACHER",
      teacher.id,
      delivery.delivered
        ? `Account activation email sent to ${authoritativeEmail} via ${delivery.mode}.`
        : `Account activation email to ${authoritativeEmail} was NOT delivered (${delivery.mode}): ${delivery.message}`
    );

    return NextResponse.json(
      { success: delivery.delivered, sent: delivery.delivered, channel: delivery.mode, email: authoritativeEmail },
      { status: delivery.delivered || delivery.mode === "dev-console" ? 200 : 502 }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]/activation");
    if (busy) return busy;
    console.error("Teacher activation POST error:", error);
    return NextResponse.json({ error: "Failed to send the activation email." }, { status: 500 });
  }
}
