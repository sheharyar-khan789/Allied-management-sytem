import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const csvContent =
    "Day & Date,Category,Details,Class,Amount\n" +
    "15-11-2026,Fees,M. Huzaifa,Nursery,3700\n" +
    "15-11-2026,Annual Amount,M. Laique,Nursery,3000\n" +
    "15-11-2026,Other Expenses,Electricity Bill,General,12000\n";

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="transaction-import-template.csv"',
    },
  });
}
