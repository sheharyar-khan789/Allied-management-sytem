import zlib from "zlib";

/**
 * Minimal, dependency-free readers for the two student import formats.
 *
 * - CSV: RFC 4180 (quoted fields, escaped quotes, CRLF/LF, UTF-8 BOM), with the delimiter
 *   detected from the header line (comma, semicolon or tab).
 * - XLSX: reads the ZIP container with Node's zlib and the first worksheet's XML. Only cell
 *   values are read; formulas are never evaluated and nothing in the file is executed.
 *   Decompressed sizes are capped so a crafted file (zip bomb) can't exhaust memory.
 *
 * Everything works on an in-memory Buffer; nothing is written to disk.
 */

export type SheetRows = string[][];

export class SpreadsheetParseError extends Error {}

/**
 * Strips a leading formula trigger from an imported cell so a value like `=HYPERLINK(...)` or
 * `@SUM(...)` can never be stored and later re-exported into someone's spreadsheet as a live
 * formula. A leading + or - is kept when it starts a number (phone numbers such as
 * "+92 300 ..."), because those are not formulas.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  let v = value;
  for (let i = 0; i < 5; i++) {
    const before = v;
    v = v.replace(/^[=@\t\r]+/, "");
    if (/^[+-]/.test(v) && !/^[+-]\s*[\d(]/.test(v)) v = v.slice(1);
    v = v.trimStart();
    if (v === before) break;
  }
  return v;
}

const MAX_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export function parseCsv(input: string): SheetRows {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: SheetRows = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new SpreadsheetParseError("The CSV file has an unterminated quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------
// ZIP (XLSX container)
// ---------------------------------------------------------------------------
interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // End of central directory: last 22 bytes + up to 64KB comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetParseError("The file is not a valid .xlsx workbook.");

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new SpreadsheetParseError("The .xlsx workbook is corrupted.");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES || entry.compressedSize === 0xffffffff) {
    throw new SpreadsheetParseError("The .xlsx workbook is too large to import.");
  }
  const lh = entry.localHeaderOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) {
    throw new SpreadsheetParseError("The .xlsx workbook is corrupted.");
  }
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_UNCOMPRESSED_BYTES });
    } catch {
      throw new SpreadsheetParseError("The .xlsx workbook could not be decompressed.");
    }
  }
  throw new SpreadsheetParseError("The .xlsx workbook uses an unsupported compression method.");
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, code: string) => {
    if (code === "amp") return "&";
    if (code === "lt") return "<";
    if (code === "gt") return ">";
    if (code === "quot") return '"';
    if (code === "apos") return "'";
    const n = code.startsWith("#x") ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : "";
  });
}

/** Concatenated text of all <t> runs inside an XML fragment (handles rich-text runs). */
function textRuns(fragment: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) out += decodeXml(m[1]);
  return out;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function firstWorksheetPath(files: Map<string, ZipEntry>, buf: Buffer): string {
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const wb = readZipEntry(buf, workbook).toString("utf8");
    const relXml = readZipEntry(buf, rels).toString("utf8");
    const sheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb);
    if (sheet) {
      const relRe = /<Relationship\b([^>]*)\/?>/g;
      let m: RegExpExecArray | null;
      while ((m = relRe.exec(relXml))) {
        const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
        const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
        if (id === sheet[1] && target) {
          const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
          if (files.has(path)) return path;
        }
      }
    }
  }
  const fallback = Array.from(files.keys())
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10))[0];
  if (!fallback) throw new SpreadsheetParseError("The .xlsx workbook has no worksheet.");
  return fallback;
}

export function parseXlsx(buf: Buffer): SheetRows {
  const files = readZipEntries(buf);
  if (!files.has("[Content_Types].xml")) {
    throw new SpreadsheetParseError("The file is not a valid .xlsx workbook.");
  }

  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml");
  if (sst) {
    const xml = readZipEntry(buf, sst).toString("utf8");
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) shared.push(textRuns(m[1]));
  }

  const sheetXml = readZipEntry(buf, files.get(firstWorksheetPath(files, buf))!).toString("utf8");
  const rows: SheetRows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheetXml))) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let next = 0;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const body = cm[2] || "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      if (col > 200) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = raw !== undefined ? shared[parseInt(raw, 10)] ?? "" : "";
      else if (type === "inlineStr") value = textRuns(body);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else value = raw !== undefined ? decodeXml(raw) : "";
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => (c || "").trim() !== ""));
}
