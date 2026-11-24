import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  claimUsernameServer,
  createAuditLogServer,
  getTeacherByIdServer,
  getUserByEmailServer,
  getUserByIdServer,
  getUsernameRecordServer,
  releaseUsernameServer,
  saveTeacherServer,
  updateUserServer,
} from "@/lib/firebase/server-db";
import { sendPasswordSetupLink } from "@/lib/account-email";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";
import { cacheKeys, invalidateCache, invalidateUserProfileCache } from "@/lib/server-cache";
import { generateTemporaryPassword } from "@/lib/temp-password";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { USERNAME_TAKEN_MESSAGE } from "@/lib/teacher-username";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "@/lib/password-reset";

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

/**
 * Escape hatch for a teacher stuck in "Activation Pending": they were created via the e-mailed
 * set-password link (no username/temporary password) and never received or used it — most often
 * because no email provider is configured in this environment. This issues the same admin-visible
 * username + one-time temporary password that the username-signup path already produces at
 * creation time (see POST /api/teachers), without touching the mustChangePassword/requireAuth
 * gate: the teacher still must choose their own password at first login. Only usable while the
 * account has never actually completed activation (no passwordHash yet) — it cannot be used to
 * reset an already-active teacher's credentials (use /api/teachers/[id]/reset-password for that).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }

    const teacher = await getTeacherByIdServer(authUser.schoolId, id);
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found." }, { status: 404 });
    }
    if (teacher.status !== "ACTIVE") {
      return NextResponse.json({ error: "This teacher's account is inactive." }, { status: 409 });
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
    if (profile.passwordHash) {
      return NextResponse.json(
        { error: "This teacher has already activated their account. Use password reset instead." },
        { status: 409 }
      );
    }

    const problem = validateUsername(body.username);
    if (problem) return NextResponse.json({ error: problem, field: "username" }, { status: 400 });
    const username = normalizeUsername(body.username);
    const holder = await getUsernameRecordServer(username);
    if (holder && holder.uid !== profile.uid) {
      return NextResponse.json({ error: USERNAME_TAKEN_MESSAGE, field: "username" }, { status: 409 });
    }

    let claimedNow = false;
    if (!holder) {
      const claim = await claimUsernameServer({ username, uid: profile.uid, schoolId: authUser.schoolId, teacherId: teacher.id });
      if (claim === "TAKEN") {
        return NextResponse.json({ error: USERNAME_TAKEN_MESSAGE, field: "username" }, { status: 409 });
      }
      claimedNow = true;
    }

    const temporaryPassword = generateTemporaryPassword({ email: profile.email, name: profile.name || teacher.fullName });
    const previousUsername = profile.username;

    try {
      if (hasAdminCredentials) {
        await adminAuth.updateUser(profile.uid, { password: temporaryPassword });
      }
      await updateUserServer({
        ...profile,
        username,
        mustChangePassword: true,
        // Mirrors POST /api/teachers: without a real Firebase project, the app's own bcrypt check
        // is the only way to sign in, so the temp password's hash (never the password) is stored
        // here too. With a real Firebase project, Auth alone holds it.
        ...(!hasAdminCredentials ? { passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_COST) } : {}),
        updatedAt: new Date().toISOString(),
      });
      await saveTeacherServer({ ...teacher, userId: profile.uid, username, updatedAt: new Date().toISOString() });
    } catch (err) {
      if (claimedNow) await releaseUsernameServer(username, profile.uid).catch(() => undefined);
      throw err;
    }
    if (previousUsername && previousUsername !== username) {
      await releaseUsernameServer(previousUsername, profile.uid).catch(() => undefined);
    }

    invalidateUserProfileCache(profile.uid);
    invalidateCache(cacheKeys.teacher(authUser.schoolId, teacher.id));
    invalidateCache(cacheKeys.teachers(authUser.schoolId));

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "ISSUE_TEACHER_TEMP_CREDENTIALS",
      "TEACHER",
      teacher.id,
      `Issued a temporary login username "${username}" and one-time password for faculty member ${teacher.fullName} (${teacher.employeeId}), who had not completed e-mail activation.`
    );

    return NextResponse.json(
      {
        success: true,
        // Present ONLY in this response: never stored anywhere, never returned again.
        credentials: { username, temporaryPassword, mustChangePassword: true },
      },
      { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]/activation");
    if (busy) return busy;
    console.error("Teacher activation PATCH error:", error);
    return NextResponse.json({ error: "Failed to issue temporary credentials." }, { status: 500 });
  }
}
