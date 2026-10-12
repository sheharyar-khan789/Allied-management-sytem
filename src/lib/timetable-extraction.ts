/**
 * Reads a timetable from an image (JPEG/PNG/WebP) or PDF with Claude's vision, returning raw
 * rows for src/lib/timetable-import.ts to match and the admin to review. Never saves anything.
 *
 * Optional: only enabled when ANTHROPIC_API_KEY is set on the server. Without it the import
 * offers the image fallback (the original file is stored and displayed as an image timetable).
 *
 * The model is told to copy what is written, leave unreadable cells empty and flag uncertain
 * fields — the preview turns those into highlighted issues, so nothing is silently invented.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ImportRowInput } from "@/lib/timetable-import";

export const EXTRACTION_MODEL = "claude-opus-5";
/** The Messages API accepts images up to 5 MB each. */
export const MAX_EXTRACTION_IMAGE_BYTES = 5 * 1024 * 1024;

export function isTimetableExtractionAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.ANTHROPIC_API_KEY || "").trim());
}

export type ExtractionMediaType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export interface ExtractionHints {
  classNames: string[];
  subjectNames: string[];
  teacherNames: string[];
}

export interface ExtractionResult {
  title: string;
  /** Date printed on the timetable, if any (as written). */
  date: string;
  rows: ImportRowInput[];
  notes: string[];
}

/** Minimal client surface, so tests can pass a fake. */
export interface ExtractionClient {
  beta: { messages: { create: (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } };
}

export class TimetableExtractionError extends Error {}

const str = { type: "string" } as const;
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "date", "periods", "entries", "notes"],
  properties: {
    title: str,
    date: str,
    periods: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "startTime", "endTime", "fridayStartTime", "fridayEndTime"],
        properties: { label: str, startTime: str, endTime: str, fridayStartTime: str, fridayEndTime: str },
      },
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["className", "periodLabel", "subjectName", "teacherName", "days", "uncertain"],
        properties: {
          className: str,
          periodLabel: str,
          subjectName: str,
          teacherName: str,
          days: { type: "array", items: str },
          uncertain: { type: "array", items: { type: "string", enum: ["class", "subject", "teacher", "time", "period", "days"] } },
        },
      },
    },
    notes: { type: "array", items: str },
  },
} as const;

function buildPrompt(hints: ExtractionHints): string {
  const list = (items: string[]) => (items.length ? items.slice(0, 200).join("; ") : "(none on record)");
  return [
    "This file is a school timetable. Read it and return every scheduled lesson as structured data.",
    "",
    "Rules:",
    "- Copy class, subject and teacher names exactly as written in the timetable. Do not translate, expand or correct them, and do not replace them with a name from the lists below unless it is clearly the same (the lists only help you read unclear handwriting or print).",
    "- periods: one entry per period column/row, with its label as printed (e.g. \"1\") and its start/end time in 24-hour HH:MM. School days run in the morning and early afternoon, so a printed \"01:30\" after \"12:40\" is 13:30. If the timetable prints separate Friday timings, put them in fridayStartTime/fridayEndTime, otherwise leave those empty.",
    "- entries: one entry per class per period that has a lesson. periodLabel must match a periods label. If one cell spans several classes (a merged cell), output one entry for each class. Skip breaks, lunch, assembly, and rows that are not classes (such as a list of free teachers).",
    "- days: the weekdays the entry applies to if the timetable says so; otherwise an empty list.",
    "- If a cell lists two subjects or teachers (for example \"Comp/Bio\" or \"Ms. A / Ms. B\"), keep the text as written and add that field to uncertain.",
    "- Never guess. If any field is unreadable, leave it as an empty string and add the field name to uncertain. If you are not sure you read a name or time correctly, add it to uncertain.",
    "- title: the heading printed on the timetable (or empty). date: any date printed on it, as written (or empty).",
    "- notes: short remarks about anything the school should check (e.g. cells you could not read).",
    "",
    `Classes on record: ${list(hints.classNames)}`,
    `Subjects on record: ${list(hints.subjectNames)}`,
    `Teachers on record: ${list(hints.teacherNames)}`,
  ].join("\n");
}

interface RawExtraction {
  title?: string;
  date?: string;
  periods?: Array<{ label?: string; startTime?: string; endTime?: string; fridayStartTime?: string; fridayEndTime?: string }>;
  entries?: Array<{ className?: string; periodLabel?: string; subjectName?: string; teacherName?: string; days?: string[]; uncertain?: string[] }>;
  notes?: string[];
}

const clip = (v: unknown, n = 120) => String(v ?? "").trim().slice(0, n);

/** Joins entries with their period times. Exported for tests. */
export function extractionToRows(raw: RawExtraction): ExtractionResult {
  const periods = new Map<string, NonNullable<RawExtraction["periods"]>[number]>();
  for (const p of raw.periods || []) if (p?.label) periods.set(clip(p.label).toLowerCase(), p);
  const rows: ImportRowInput[] = [];
  for (const e of raw.entries || []) {
    if (!e) continue;
    const label = clip(e.periodLabel);
    const p = periods.get(label.toLowerCase());
    const uncertain = new Set((e.uncertain || []).map((u) => clip(u, 20).toLowerCase()));
    if (!p) uncertain.add("time");
    rows.push({
      className: clip(e.className),
      subjectName: clip(e.subjectName),
      teacherName: clip(e.teacherName),
      periodName: label ? (/^\d+$/.test(label) ? `Period ${label}` : label) : "",
      startTime: clip(p?.startTime, 10),
      endTime: clip(p?.endTime, 10),
      fridayStartTime: clip(p?.fridayStartTime, 10),
      fridayEndTime: clip(p?.fridayEndTime, 10),
      days: (e.days || []).map((d) => clip(d, 20)).filter(Boolean),
      uncertain: Array.from(uncertain),
    });
  }
  return {
    title: clip(raw.title, 200),
    date: clip(raw.date, 60),
    rows,
    notes: (raw.notes || []).map((n) => clip(n, 300)).filter(Boolean).slice(0, 20),
  };
}

export async function extractTimetableFromFile(
  file: Buffer,
  mediaType: ExtractionMediaType,
  hints: ExtractionHints,
  options: { client?: ExtractionClient } = {}
): Promise<ExtractionResult> {
  if (mediaType !== "application/pdf" && file.length > MAX_EXTRACTION_IMAGE_BYTES) {
    throw new TimetableExtractionError("The image is larger than 5 MB. Please upload a smaller photo or scan.");
  }
  const client: ExtractionClient = options.client || new Anthropic();
  const data = file.toString("base64");
  const source: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  const response = await client.beta.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    // If the request is declined, the API retries it on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: [source, { type: "text", text: buildPrompt(hints) }] }],
  });

  if (response.stop_reason === "refusal") {
    throw new TimetableExtractionError("The timetable could not be read automatically.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new TimetableExtractionError("The timetable is too large to read in one go. Split it into smaller images.");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: RawExtraction;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TimetableExtractionError("The timetable reader returned an unreadable answer. Please try again.");
  }
  return extractionToRows(parsed);
}
