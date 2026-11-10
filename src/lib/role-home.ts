import { UserRole } from "@/lib/firebase/types";

export function dashboardPathForRole(role?: UserRole | string | null): string {
  if (role === "TEACHER") return "/teacher";
  if (role === "STUDENT") return "/student";
  if (role === "PARENT") return "/parent";
  if (role === "ADMIN") return "/admin";
  return "/login";
}
