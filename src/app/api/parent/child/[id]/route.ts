import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getAnnouncementsServer } from "@/lib/firebase/server-db";
import { announcementVisibleToRole } from "@/lib/announcements-visibility";
import { assertParentOwnsStudent } from "@/lib/parent-access";
import { buildStudentAcademicPayload } from "@/lib/student-academic-payload";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["PARENT"]);
    const { id } = await params;
    const student = await assertParentOwnsStudent(authUser, id);
    const payload = await buildStudentAcademicPayload(authUser.schoolId, student, {
      publishedResultsOnly: true,
    });
    const announcements = await getAnnouncementsServer(authUser.schoolId);
    const visible = announcements.filter((a) => announcementVisibleToRole(a, authUser.role));

    return NextResponse.json({
      success: true,
      ...payload,
      announcements: visible.map((a) => ({
        id: a.id,
        title: a.title,
        message: a.message,
        audience: a.audience,
        publishedAt: a.publishedAt || a.createdAt,
      })),
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Parent child payload error:", error);
    return NextResponse.json({ error: "Failed to load child academic record." }, { status: 500 });
  }
}
