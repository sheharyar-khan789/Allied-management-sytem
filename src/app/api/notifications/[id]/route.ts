import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";
import { markNotificationRead } from "@/lib/notifications";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

/** Marks a single notification read — only if it belongs to the calling teacher. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["TEACHER"]);
    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher) return NextResponse.json({ error: "Your account is not linked to a teacher profile." }, { status: 403 });
    const { id } = await params;

    const updated = await markNotificationRead(authUser.schoolId, id, teacher.id);
    if (!updated) {
      return NextResponse.json({ error: "Notification not found, already read, or not yours." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/notifications/[id]");
    if (busy) return busy;
    console.error("Notification PATCH error:", error);
    return NextResponse.json({ error: "Failed to update notification." }, { status: 500 });
  }
}
