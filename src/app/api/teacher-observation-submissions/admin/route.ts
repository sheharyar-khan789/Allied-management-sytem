import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getAllPendingSubmissionsServer } from "@/lib/firebase/server-db";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

/** Admin-only review list — defaults to PENDING, pass ?status=ALL|APPROVED|REJECTED to widen. */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "PENDING";

    const submissions = await getAllPendingSubmissionsServer(
      authUser.schoolId,
      status === "ALL" ? {} : { status }
    );

    return NextResponse.json({ success: true, submissions });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/teacher-observation-submissions/admin");
    if (busy) return busy;
    console.error("Teacher observation submission admin GET error:", error);
    return NextResponse.json({ error: "Failed to load submissions." }, { status: 500 });
  }
}
