import { FEE_MONTHS, FeeMonth } from "@/lib/firebase/types";

/** Canonical month name for a challan's free-text month ("oct", "October") or null. */
export function feeMonthOf(value: string | undefined): FeeMonth | null {
  const v = (value || "").trim().toLowerCase();
  if (v.length < 3) return null;
  return FEE_MONTHS.find((m) => m.toLowerCase() === v || m.toLowerCase().startsWith(v)) || null;
}
