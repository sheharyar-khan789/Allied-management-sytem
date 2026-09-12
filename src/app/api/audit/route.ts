import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { getAuditLogsServer } from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const entity = searchParams.get("entity");
    const search = searchParams.get("search")?.toLowerCase() || "";

    const logs = await getAuditLogsServer(authUser.schoolId, 100);

    let filtered = logs;
    if (action && action !== "ALL" && action !== "all") {
      filtered = filtered.filter((l) => l.action.toLowerCase() === action.toLowerCase());
    }
    if (entity && entity !== "ALL" && entity !== "all") {
      filtered = filtered.filter((l) => l.entity.toLowerCase() === entity.toLowerCase());
    }
    if (search) {
      filtered = filtered.filter((l) =>
        l.details.toLowerCase().includes(search) ||
        l.userEmail.toLowerCase().includes(search) ||
        l.action.toLowerCase().includes(search) ||
        l.entity.toLowerCase().includes(search)
      );
    }

    const mapped = filtered.map((l) => ({
      id: l.id,
      userId: l.userId,
      userName: l.userEmail.split("@")[0] || "Admin",
      userRole: l.role,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId || "",
      details: l.details,
      createdAt: l.timestamp,
    }));

    return NextResponse.json({ success: true, logs: mapped });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Audit GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve audit log history." },
      { status: 500 }
    );
  }
}
