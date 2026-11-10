import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import { buildFeeStructureTemplate } from "@/lib/fee-structure-import";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req, ["ADMIN"]);
    const buffer = buildFeeStructureTemplate();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="yearly-fee-structure-template.xlsx"',
      },
    });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Fee structure template error:", error);
    return NextResponse.json({ error: "Failed to generate template." }, { status: 500 });
  }
}
