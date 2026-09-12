import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";

export default async function HomePage() {
  const session = await getAuthenticatedUser();

  if (!session || !session.uid) {
    redirect("/login");
  }

  if (session.role === "TEACHER") {
    redirect("/teacher");
  } else if (session.role === "STUDENT") {
    redirect("/student");
  } else {
    redirect("/admin");
  }
}
