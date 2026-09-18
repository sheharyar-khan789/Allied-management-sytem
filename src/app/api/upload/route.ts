import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { uploadFileToStorage, validateUpload, AllowedFolder } from "@/lib/storage";

export const dynamic = "force-dynamic";

const VALID_FOLDERS: AllowedFolder[] = [
  "profile-photos",
  "documents",
  "fee-receipts",
  "result-cards",
  "school-logo",
];

export async function POST(req: NextRequest) {
  try {
    // Only authenticated school staff (ADMIN or TEACHER) can upload assets
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);

    const formData = await req.formData();
    const file = formData.get("file");
    const folder = (formData.get("folder") || "").toString() as AllowedFolder;

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "No file provided in the upload request." },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!VALID_FOLDERS.includes(folder)) {
      return NextResponse.json(
        { error: `Invalid folder target. Allowed: ${VALID_FOLDERS.join(", ")}` },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert Blob/File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = file.type || "application/octet-stream";
    const filename = file.name || "upload.bin";

    // Validate size and mime type
    const validation = validateUpload(folder, contentType, buffer.length);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const uploadResult = await uploadFileToStorage({
      buffer,
      folder,
      filename,
      contentType,
      schoolId: authUser.schoolId,
    });

    return NextResponse.json(
      {
        success: true,
        ...uploadResult,
      },
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("File upload error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to upload file to storage." },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
