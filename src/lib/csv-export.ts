/**
 * Shared server-side CSV builder for financial exports (Yearly Fee Structure, Financial
 * Summary, ...). Every export route builds real rows from the actual database records it
 * just read — never hardcoded or fabricated figures — and sends them through this one escaper.
 */

/** Spreadsheet formula injection: a cell starting with = + - @ (or tab/CR) is evaluated as a
 *  formula by Excel/Sheets. Prefix an apostrophe so it is always shown as plain text. */
export function csvEscape(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(",")).join("\r\n") + "\r\n";
}

export function csvResponseHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
