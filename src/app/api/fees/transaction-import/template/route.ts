import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // The 6th column, Admission No, is optional and backward compatible: a classic 5-column
  // file (no Admission No at all) still imports exactly as before, matching by name + class.
  // When present, it is the authoritative match and is never looked up by name.
  const csvContent =
    "Day & Date,Category,Details,Class,Amount,Admission No\n" +
    "15-11-2026,Fees,M. Huzaifa,Nursery,3700,ADM-0001\n" +
    "15-11-2026,Annual Amount,M. Laique,Nursery,3000,ADM-0002\n" +
    "15-11-2026,Other Expenses,Electricity Bill,General,12000,\n";

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="transaction-import-template.csv"',
    },
  });
}
