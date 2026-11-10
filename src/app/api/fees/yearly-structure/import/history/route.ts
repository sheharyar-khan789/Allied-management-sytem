import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getImportBatchesServer } from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const academicYear = searchParams.get("academicYear") || undefined;

    const batches = await getImportBatchesServer(authUser.schoolId, "YEARLY_FEE_STRUCTURE", academicYear);
    return NextResponse.json({ success: true, batches });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Import history error:", error);
    return NextResponse.json({ error: "Failed to load import history." }, { status: 500 });
  }
}
