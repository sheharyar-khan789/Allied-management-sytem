import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import { parseJsonBody } from "@/lib/input-validation";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { updateTeacherAccountEmail } from "@/lib/teacher-lifecycle";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email({ message: "Please provide a valid email address." }),
});

/**
 * Admin: changes a teacher's sign-in email address safely:
 * - Preserves existing Firebase UID, username, role, schoolId, teacherId, and allocations.
 * - Updates Firebase Auth account, Firestore UserProfile, and TeacherDoc with two-phase rollback.
 * - Enforces school-level tenant isolation and prevents duplicate email collisions.
 * - Invalidates user session caches and revokes active sessions.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = await parseJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "change a teacher's login email", req);
    const { id } = await params;
    const newEmail = parsed.data.email;

    const result = await updateTeacherAccountEmail(authUser.schoolId, id, newEmail, {
      performedByUid: authUser.uid,
      performedByEmail: authUser.email,
      performedByRole: authUser.role,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      unchanged: result.unchanged || false,
      email: result.email,
      teacherId: id,
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teachers/[id]/login-email");
    if (busy) return busy;
    console.error("Teacher login email update error:", error?.message || "error");
    return NextResponse.json({ error: "Failed to update the login email." }, { status: 500 });
  }
}
