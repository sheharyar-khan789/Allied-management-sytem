import {
  createNotificationServer,
  getNotificationsForTeacherServer,
  getTeachersServer,
  markAllNotificationsReadServer,
  markNotificationReadServer,
} from "@/lib/firebase/server-db";
import { NotificationDoc, NotificationType } from "@/lib/firebase/types";

/** A teacher observation was created for them — see POST /api/teacher-observations. */
export async function notifyTeacherOfObservation(params: {
  schoolId: string;
  teacherId: string;
  observationId: string;
  observationTitle: string;
}): Promise<void> {
  await createNotificationServer({
    schoolId: params.schoolId,
    recipientTeacherId: params.teacherId,
    type: "OBSERVATION",
    title: "New observation recorded",
    message: params.observationTitle || "An administrator has recorded a new observation for you.",
    referenceId: params.observationId,
    dedupeKey: `observation:${params.observationId}`,
  });
}

/**
 * Fans out one notification per active teacher for a TEACHERS/EVERYONE-audience announcement.
 * Deduped per (announcement, teacher), so re-publishing or a retried request never double-notifies.
 * Inactive (Left) teachers are skipped — they have no login to see it.
 */
export async function notifyTeachersOfAnnouncement(params: {
  schoolId: string;
  announcementId: string;
  title: string;
  audience: string;
}): Promise<number> {
  if (params.audience !== "TEACHERS" && params.audience !== "EVERYONE") return 0;
  const teachers = await getTeachersServer(params.schoolId, 500);
  const active = teachers.filter((t) => t.status === "ACTIVE");
  let count = 0;
  for (const teacher of active) {
    const { created } = await createNotificationServer({
      schoolId: params.schoolId,
      recipientTeacherId: teacher.id,
      type: "ANNOUNCEMENT",
      title: "New announcement",
      message: params.title,
      referenceId: params.announcementId,
      dedupeKey: `announcement:${params.announcementId}:${teacher.id}`,
    });
    if (created) count++;
  }
  return count;
}

/** A lesson-plan submission-window event (open / deadline-soon / closed) for one teacher. */
export async function notifyTeacherLessonPlanEvent(params: {
  schoolId: string;
  teacherId: string;
  windowId: string;
  event: "LESSON_PLAN_OPEN" | "LESSON_PLAN_DEADLINE_SOON" | "LESSON_PLAN_CLOSED";
  title: string;
  message: string;
}): Promise<{ id: string; created: boolean }> {
  return createNotificationServer({
    schoolId: params.schoolId,
    recipientTeacherId: params.teacherId,
    type: params.event as NotificationType,
    title: params.title,
    message: params.message,
    referenceId: params.windowId,
    dedupeKey: `lessonplan:${params.windowId}:${params.event}:${params.teacherId}`,
  });
}

export async function listTeacherNotifications(schoolId: string, teacherId: string): Promise<{
  notifications: NotificationDoc[];
  unreadCount: number;
}> {
  const notifications = await getNotificationsForTeacherServer(schoolId, teacherId, 100);
  return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
}

export async function markNotificationRead(schoolId: string, id: string, teacherId: string): Promise<boolean> {
  return markNotificationReadServer(schoolId, id, teacherId);
}

export async function markAllNotificationsRead(schoolId: string, teacherId: string): Promise<number> {
  return markAllNotificationsReadServer(schoolId, teacherId);
}
