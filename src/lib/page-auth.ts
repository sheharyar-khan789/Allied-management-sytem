import { redirect } from "next/navigation";
import { AuthenticatedUser, getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { UserRole } from "@/lib/firebase/types";
import { dashboardPathForRole } from "@/lib/role-home";

/**
 * Server-side guard for the role layouts (/admin, /teacher, /student, /parent). Middleware
 * already redirects, but it must not be the only check (middleware-bypass class of bugs): the
 * layouts read school data on the server, so they re-verify the session — including revocation
 * against the live profile — and the role themselves.
 */
export async function requirePageRole(role: UserRole): Promise<AuthenticatedUser> {
  const session = await getAuthenticatedUser();
  if (!session || !session.uid || !session.schoolId) redirect("/login");
  // A temporary password must be replaced before any portal page loads (the API refuses too).
  if (session.mustChangePassword) redirect("/change-password");
  if (session.role !== role) redirect(dashboardPathForRole(session.role));
  return session;
}
