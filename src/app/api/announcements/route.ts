import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  createAuditLogServer,
  deleteAnnouncementServer,
  getAnnouncementByIdServer,
  getAnnouncementsServer,
  saveAnnouncementServer,
} from "@/lib/firebase/server-db";
import { announcementVisibleToRole } from "@/lib/announcements-visibility";
import { AnnouncementAudience, AnnouncementDoc, AnnouncementStatus } from "@/lib/firebase/types";

const audienceValues = ["EVERYONE", "TEACHERS", "STUDENTS", "PARENTS"] as const;
const statusValues = ["DRAFT", "PUBLISHED"] as const;

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(8000),
  audience: z.enum(audienceValues),
  status: z.enum(statusValues),
});

function serialize(announcement: AnnouncementDoc, includeAdminFields: boolean) {
  const base = {
    id: announcement.id,
    title: announcement.title,
    message: announcement.message,
    audience: announcement.audience,
    status: announcement.status,
    publishedAt: announcement.publishedAt || null,
    createdAt: announcement.createdAt,
  };
  if (!includeAdminFields) return base;
  return {
    ...base,
    createdBy: announcement.createdBy,
    createdByName: announcement.createdByName || "",
    updatedAt: announcement.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    const list = await getAnnouncementsServer(authUser.schoolId);
    const visible = list.filter((a) => a.schoolId === authUser.schoolId && announcementVisibleToRole(a, authUser.role));
    return NextResponse.json({
      success: true,
      announcements: visible.map((a) => serialize(a, authUser.role === "ADMIN")),
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Announcements GET error:", error);
    return NextResponse.json({ error: "Failed to load announcements." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = upsertSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid announcement payload.", details: parsed.error.flatten() }, { status: 400 });
    }

    const now = new Date().toISOString();
    const status: AnnouncementStatus = parsed.data.status;
    const audience: AnnouncementAudience = parsed.data.audience;
    const doc: AnnouncementDoc = {
      // `announcements` is a flat multi-tenant collection, so a bare millisecond timestamp
      // could collide across (or within) schools and silently overwrite another school's
      // announcement. Matches the timestamp+random convention already used elsewhere.
      id: `ann-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      schoolId: authUser.schoolId,
      title: parsed.data.title,
      message: parsed.data.message,
      audience,
      status,
      publishedAt: status === "PUBLISHED" ? now : undefined,
      createdBy: authUser.uid,
      createdByName: authUser.name,
      createdAt: now,
      updatedAt: now,
    };

    const id = await saveAnnouncementServer(doc);
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "CREATE_ANNOUNCEMENT",
      "ANNOUNCEMENT",
      id,
      `Created announcement "${doc.title}" for ${doc.audience}.`
    );

    return NextResponse.json({ success: true, announcement: serialize({ ...doc, id }, true) }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Announcements POST error:", error);
    return NextResponse.json({ error: "Failed to create announcement." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const parsed = upsertSchema.safeParse(await req.json());
    if (!parsed.success || !parsed.data.id) {
      return NextResponse.json({ error: "Announcement id and valid fields are required." }, { status: 400 });
    }

    const existing = await getAnnouncementByIdServer(authUser.schoolId, parsed.data.id);
    if (!existing || existing.schoolId !== authUser.schoolId) {
      return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const wasPublished = existing.status === "PUBLISHED";
    const willPublish = parsed.data.status === "PUBLISHED";
    const updated: AnnouncementDoc = {
      ...existing,
      title: parsed.data.title,
      message: parsed.data.message,
      audience: parsed.data.audience,
      status: parsed.data.status,
      publishedAt: willPublish ? existing.publishedAt || now : existing.publishedAt,
      updatedAt: now,
      schoolId: authUser.schoolId,
    };
    if (!willPublish && wasPublished) {
      updated.publishedAt = undefined;
    }

    await saveAnnouncementServer(updated);
    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_ANNOUNCEMENT",
      "ANNOUNCEMENT",
      updated.id,
      `Updated announcement "${updated.title}".`
    );

    return NextResponse.json({ success: true, announcement: serialize(updated, true) });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Announcements PUT error:", error);
    return NextResponse.json({ error: "Failed to update announcement." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";
    if (!id) {
      return NextResponse.json({ error: "Announcement id is required." }, { status: 400 });
    }

    const existing = await getAnnouncementByIdServer(authUser.schoolId, id);
    if (!existing || existing.schoolId !== authUser.schoolId) {
      return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
    }

    const deleted = await deleteAnnouncementServer(authUser.schoolId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Announcement could not be deleted." }, { status: 404 });
    }

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "DELETE_ANNOUNCEMENT",
      "ANNOUNCEMENT",
      id,
      `Deleted announcement "${existing.title}".`
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    console.error("Announcements DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete announcement." }, { status: 500 });
  }
}
