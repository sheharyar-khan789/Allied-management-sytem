import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { resolveAuthenticatedTeacher } from "@/lib/academic-access";
import { listTeacherNotifications, markAllNotificationsRead } from "@/lib/notifications";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

/**
 * A teacher's own in-app notifications (observations recorded about them, announcements
 * targeted at teachers, lesson-plan window events). TEACHER-only: there is no admin "view
 * someone else's notifications" mode, and a teacher's identity is resolved server-side from
 * their session exactly like /api/teacher-observations, so no id can widen the read.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["TEACHER"]);
    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher) return NextResponse.json({ error: "Your account is not linked to a teacher profile." }, { status: 403 });

    const { notifications, unreadCount } = await listTeacherNotifications(authUser.schoolId, teacher.id);
    return NextResponse.json({ success: true, notifications, unreadCount });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/notifications");
    if (busy) return busy;
    console.error("Notifications GET error:", error);
    return NextResponse.json({ error: "Failed to load notifications." }, { status: 500 });
  }
}

/** Marks every one of the caller's unread notifications as read. */
export async function PATCH(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["TEACHER"]);
    const teacher = await resolveAuthenticatedTeacher(authUser);
    if (!teacher) return NextResponse.json({ error: "Your account is not linked to a teacher profile." }, { status: 403 });

    const updated = await markAllNotificationsRead(authUser.schoolId, teacher.id);
    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/notifications");
    if (busy) return busy;
    console.error("Notifications mark-all-read error:", error);
    return NextResponse.json({ error: "Failed to update notifications." }, { status: 500 });
  }
}
