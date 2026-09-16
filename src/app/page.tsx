import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { dashboardPathForRole } from "@/lib/role-home";

export default async function HomePage() {
  const session = await getAuthenticatedUser();

  if (!session || !session.uid) {
    redirect("/login");
  }

  redirect(dashboardPathForRole(session.role));
}
