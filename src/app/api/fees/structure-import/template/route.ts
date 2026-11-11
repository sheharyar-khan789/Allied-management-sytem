import { NextResponse } from "next/server";
import { FEE_STRUCTURE_IMPORT_TEMPLATE_HEADERS } from "@/lib/fee-structure-import";

export const dynamic = "force-dynamic";

export async function GET() {
  const csvContent =
    FEE_STRUCTURE_IMPORT_TEMPLATE_HEADERS.join(",") +
    "\n" +
    "ADM-0001,M. Huzaifa,Nursery-A,3700,3000,5000,200,0\n" +
    "ADM-0002,M. Laique,Nursery-A,3700,3000,0,200,500\n";

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="yearly-fee-structure-template.csv"',
    },
  });
}
