import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { dashboardPathForRole } from "@/lib/role-home";

// Per request (never prerendered): the page must carry the CSP nonce, and the guard below reads
// the live profile. Same reason as src/app/login/layout.tsx.
export const dynamic = "force-dynamic";

/**
 * Only an account that still owes a password change belongs on this screen. Anyone else, whether
 * signed out or already past the requirement, is sent away, so it is not a general "change
 * password" page and cannot be used to skip anything.
 */
export default async function ChangePasswordLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuthenticatedUser();
  if (!session || !session.uid) redirect("/login");
  if (!session.mustChangePassword) redirect(dashboardPathForRole(session.role));
  return children;
}
