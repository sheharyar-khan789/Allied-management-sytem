import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getUserByIdServer, updateUserServer } from "@/lib/firebase/server-db";
import { adminAuth, hasAdminCredentials } from "@/lib/firebase/admin";

function isValidNewPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req);
    let body: { currentPassword?: string; newPassword?: string; userId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 });
    }

    const currentPassword = (body.currentPassword || "").toString();
    const newPassword = (body.newPassword || "").toString();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required." },
        { status: 400 }
      );
    }

    if (!isValidNewPassword(newPassword)) {
      return NextResponse.json(
        { error: "New password must be between 8 and 128 characters." },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current password." },
        { status: 400 }
      );
    }

    const profile = await getUserByIdServer(authUser.uid);
    if (!profile) {
      return NextResponse.json({ error: "User profile not found." }, { status: 404 });
    }

    let currentOk = false;
    if (profile.passwordHash) {
      currentOk = bcrypt.compareSync(currentPassword, profile.passwordHash);
    }

    if (!currentOk) {
      const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
      const isDummyKey = !apiKey || apiKey.includes("Dummy") || apiKey.includes("AIzaSyDummy");
      if (apiKey && !isDummyKey) {
        try {
          const fbRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: authUser.email,
                password: currentPassword,
                returnSecureToken: false,
              }),
            }
          );
          currentOk = fbRes.ok;
        } catch {
          currentOk = false;
        }
      }
    }

    if (!currentOk) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    if (hasAdminCredentials) {
      try {
        await adminAuth.updateUser(authUser.uid, { password: newPassword });
      } catch (authErr) {
        console.error("Failed to update authentication password:", authErr);
        return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
      }
    }

    const { passwordHash: _omit, ...safeProfile } = profile;
    void _omit;
    await updateUserServer({
      ...safeProfile,
      passwordHash,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Failed to change password." }, { status: 500 });
  }
}
