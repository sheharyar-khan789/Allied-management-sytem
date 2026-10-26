import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getStoredFile } from "@/lib/stored-files";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";

export const dynamic = "force-dynamic";

// Only the types the upload route accepts are ever served, always with their stored type.
const SERVABLE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * Serves a file kept in the app's own store (see src/lib/stored-files.ts). Same access rule as
 * the Cloud Storage rules: any signed-in user of the file's own school may read it. The school is
 * taken from the session, never from the URL, so another school's file is a plain 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; name: string }> }
) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    const { folder, name } = await params;
    const file = await getStoredFile(authUser.schoolId, folder, name);
    if (!file || !SERVABLE.has(file.meta.contentType)) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": file.meta.contentType,
        "Content-Length": String(file.data.length),
        "Content-Disposition": `inline; filename="${file.meta.name}"`,
        "X-Content-Type-Options": "nosniff",
        // Files are immutable (every upload gets a new name) and only for this signed-in user:
        // cache privately so a page of photos is not re-read from the database on every visit.
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/files");
    if (busy) return busy;
    console.error("File read error:", (error as Error)?.message || "error");
    return NextResponse.json({ error: "Failed to load file." }, { status: 500 });
  }
}
