/**
 * In-app notifications (Tasks 4 & 5 wiring): a teacher observation notifies the subject teacher
 * (unless it's an Admin/Principal-only private note), a published TEACHERS/EVERYONE announcement
 * fans out one notification per active teacher with no duplicates, and a teacher can only ever
 * read or mark-read their own notifications. Runs against the in-memory store (no Firebase
 * credentials loaded by tsx).
 */
import { NextRequest } from "next/server";
import { POST as observationPost } from "../src/app/api/teacher-observations/route";
import { POST as announcementPost, PUT as announcementPut } from "../src/app/api/announcements/route";
import { GET as notificationsGet, PATCH as markAllReadPatch } from "../src/app/api/notifications/route";
import { PATCH as markOnePatch } from "../src/app/api/notifications/[id]/route";
import { createSessionCookieServer } from "../src/lib/firebase/server-auth";
import { createUserServer, saveTeacherServer, updateSchoolSettingsServer } from "../src/lib/firebase/server-db";
import { TeacherDoc } from "../src/lib/firebase/types";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

function req(token: string | null, url: string, method = "GET", body?: unknown) {
  const headers = new Headers();
  if (token) headers.set("cookie", `allied_session=${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const json = async (res: Response) => res.json().catch(() => ({}));
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function run() {
  console.log("==================================================");
  console.log("NOTIFICATIONS — OBSERVATIONS, ANNOUNCEMENTS, MARK-READ");
  console.log("==================================================");

  const now = new Date().toISOString();
  const SCHOOL = "school-notif-a";
  await updateSchoolSettingsServer({
    id: SCHOOL, schoolId: SCHOOL, schoolName: "Notif Test School", campusName: "Main", motto: "", address: "",
    phone: "", email: `admin@${SCHOOL}.edu`, principalName: "P", academicYear: "2026-2027", gradingScale: [], updatedAt: now,
  });

  const teacherA: TeacherDoc = {
    id: "tch-notif-a", schoolId: SCHOOL, userId: "uid-notif-a", employeeId: "TCH-NA", fullName: "Teacher A",
    email: "a@school-notif-a.edu", phone: "0300", designation: "Teacher", department: "Science", qualification: "MSc",
    status: "ACTIVE", assignedClassIds: [], assignedSubjectIds: [], weeklyLoad: 10, createdAt: now, updatedAt: now,
  };
  const teacherB: TeacherDoc = { ...teacherA, id: "tch-notif-b", userId: "uid-notif-b", employeeId: "TCH-NB", fullName: "Teacher B", email: "b@school-notif-a.edu" };
  const teacherLeft: TeacherDoc = { ...teacherA, id: "tch-notif-left", userId: "uid-notif-left", employeeId: "TCH-NL", fullName: "Teacher Left", email: "left@school-notif-a.edu", status: "INACTIVE", endingDate: "2026-01-01" };
  for (const t of [teacherA, teacherB, teacherLeft]) {
    await saveTeacherServer(t);
    await createUserServer({ uid: t.userId!, email: t.email, name: t.fullName, role: "TEACHER", schoolId: SCHOOL, teacherId: t.id, status: t.status, createdAt: now, updatedAt: now });
  }

  const ADMIN = await createSessionCookieServer({ uid: "uid-notif-admin", email: "admin@x.edu", role: "ADMIN", schoolId: SCHOOL, name: "Admin" });
  const TEACHER_A = await createSessionCookieServer({ uid: "uid-notif-a", email: teacherA.email, role: "TEACHER", schoolId: SCHOOL, teacherId: teacherA.id, name: "Teacher A" });
  const TEACHER_B = await createSessionCookieServer({ uid: "uid-notif-b", email: teacherB.email, role: "TEACHER", schoolId: SCHOOL, teacherId: teacherB.id, name: "Teacher B" });

  // ======================================================================
  // 1. OBSERVATION — notifies the subject teacher, but never for a private note
  // ======================================================================
  const obsRes = await observationPost(req(ADMIN, "http://x/api/teacher-observations", "POST", {
    teacherId: teacherA.id, observationDate: "2026-02-01", category: "CLASSROOM_MANAGEMENT", rating: "SATISFACTORY", note: "Good pacing in class.",
  }));
  assert(obsRes.status === 201, "Admin creates a (non-private) observation for Teacher A");

  const privateObsRes = await observationPost(req(ADMIN, "http://x/api/teacher-observations", "POST", {
    teacherId: teacherA.id, observationDate: "2026-02-02", category: "CLASSROOM_MANAGEMENT", rating: "NEEDS_IMPROVEMENT", note: "Confidential concern.", isPrivate: true,
  }));
  assert(privateObsRes.status === 201, "Admin creates a private observation for Teacher A");

  const listAfterObs = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  assert(listAfterObs.notifications.length === 1, "Teacher A has exactly one notification — the private observation did NOT notify them");
  assert(listAfterObs.notifications[0].type === "OBSERVATION" && !listAfterObs.notifications[0].read, "The notification is for the observation and unread");
  assert(listAfterObs.unreadCount === 1, "Unread count is 1");

  const teacherBAfterObs = await json(await notificationsGet(req(TEACHER_B, "http://x/api/notifications")));
  assert(teacherBAfterObs.notifications.length === 0, "Teacher B gets no notification for an observation about Teacher A");

  // ======================================================================
  // 2. ANNOUNCEMENT — fans out to every active teacher, skips the departed one, no duplicates
  // ======================================================================
  const annRes = await announcementPost(req(ADMIN, "http://x/api/announcements", "POST", {
    title: "Staff meeting Friday", message: "3pm in the hall.", audience: "TEACHERS", status: "PUBLISHED",
  }));
  const annJson = await json(annRes);
  assert(annRes.status === 201, "Admin publishes a TEACHERS-audience announcement");

  const teacherAAfterAnn = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  const teacherBAfterAnn = await json(await notificationsGet(req(TEACHER_B, "http://x/api/notifications")));
  assert(teacherAAfterAnn.notifications.some((n: any) => n.type === "ANNOUNCEMENT" && n.referenceId === annJson.announcement.id), "Teacher A is notified of the announcement");
  assert(teacherBAfterAnn.notifications.some((n: any) => n.type === "ANNOUNCEMENT"), "Teacher B is notified of the announcement too (TEACHERS audience)");
  assert(teacherAAfterAnn.notifications.length === 2, "Teacher A now has 2 notifications total (observation + announcement)");

  // Re-publishing the same announcement (e.g. an admin re-saves it as PUBLISHED again via PUT)
  // must not create a second notification for anyone.
  const rePublishRes = await announcementPut(req(ADMIN, "http://x/api/announcements", "PUT", {
    id: annJson.announcement.id, title: annJson.announcement.title, message: annJson.announcement.message,
    audience: "TEACHERS", status: "PUBLISHED",
  }));
  assert(rePublishRes.status === 200, "Admin re-saves the already-published announcement");
  const teacherAAfterRepublish = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  assert(teacherAAfterRepublish.notifications.length === 2, "No duplicate notification was created by the re-save (dedupe by announcement+teacher)");

  // A draft announcement must not notify anyone.
  const draftRes = await announcementPost(req(ADMIN, "http://x/api/announcements", "POST", {
    title: "Draft only", message: "Not ready yet.", audience: "TEACHERS", status: "DRAFT",
  }));
  const draftJson = await json(draftRes);
  const teacherAAfterDraft = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  assert(teacherAAfterDraft.notifications.length === 2, "A DRAFT announcement does not notify anyone");

  // Publishing that draft later (DRAFT -> PUBLISHED) DOES notify, exactly once.
  await announcementPut(req(ADMIN, "http://x/api/announcements", "PUT", {
    id: draftJson.announcement.id, title: draftJson.announcement.title, message: draftJson.announcement.message,
    audience: "TEACHERS", status: "PUBLISHED",
  }));
  const teacherAAfterPublishDraft = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  assert(teacherAAfterPublishDraft.notifications.length === 3, "Publishing the draft notifies teachers exactly once");

  // ======================================================================
  // 3. PERMISSIONS & MARK-READ
  // ======================================================================
  const targetNotif = listAfterObs.notifications[0];
  const crossReadAttempt = await markOnePatch(req(TEACHER_B, `http://x/api/notifications/${targetNotif.id}`, "PATCH"), idParams(targetNotif.id));
  assert(crossReadAttempt.status === 404, "Teacher B cannot mark Teacher A's notification as read");

  const ownReadRes = await markOnePatch(req(TEACHER_A, `http://x/api/notifications/${targetNotif.id}`, "PATCH"), idParams(targetNotif.id));
  assert(ownReadRes.status === 200, "Teacher A marks their own notification as read");
  const afterOwnRead = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  assert(afterOwnRead.unreadCount === 2, "Unread count drops by one after marking that notification read");

  const markAllRes = await markAllReadPatch(req(TEACHER_A, "http://x/api/notifications", "PATCH"));
  const markAllJson = await json(markAllRes);
  assert(markAllRes.status === 200 && markAllJson.updated === 2, "Mark-all-read updates exactly the remaining 2 unread notifications");
  const afterMarkAll = await json(await notificationsGet(req(TEACHER_A, "http://x/api/notifications")));
  assert(afterMarkAll.unreadCount === 0, "Unread count is 0 after mark-all-read");

  console.log("==================================================");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
