import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { reverseOtherCollectionServer, createAuditLogServer } from "@/lib/firebase/server-db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { id } = await params;
    const body = await req.json();
    const { reason } = body;

    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: "A reason is required to reverse a record." }, { status: 400 });
    }

    const updated = await reverseOtherCollectionServer(authUser.schoolId, id, reason, authUser.uid);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "REVERSE_OTHER_COLLECTION",
      "OTHER_COLLECTION",
      id,
      `Reversed other collection of Rs. ${updated.amount} (${updated.category}). Reason: ${reason}`
    );

    return NextResponse.json({ success: true, record: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Other collection reversal error:", error);
    return NextResponse.json({ error: error?.message || "Failed to reverse record." }, { status: 400 });
  }
}
