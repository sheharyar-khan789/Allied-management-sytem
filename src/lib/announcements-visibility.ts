import { AnnouncementAudience, AnnouncementDoc, UserRole } from "@/lib/firebase/types";

export function announcementVisibleToRole(
  announcement: AnnouncementDoc,
  role: UserRole
): boolean {
  if (announcement.status !== "PUBLISHED" && role !== "ADMIN") {
    return false;
  }

  if (role === "ADMIN") return true;

  const audience: AnnouncementAudience = announcement.audience;
  if (audience === "EVERYONE") return true;
  if (audience === "TEACHERS") return role === "TEACHER";
  if (audience === "STUDENTS") return role === "STUDENT";
  if (audience === "PARENTS") return role === "PARENT";
  return false;
}
