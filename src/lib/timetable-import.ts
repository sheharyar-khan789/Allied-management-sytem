/**
 * Timetable import + slot validation (pure functions, no database access).
 *
 * An import goes: file → raw rows (spreadsheet columns, or fields read from an image by
 * src/lib/timetable-extraction.ts) → preview rows matched against the school's REAL classes,
 * subjects and teachers → admin corrections → commit, where every period is validated exactly
 * like a manually added one (validateTimetableSlot, shared with /api/timetable).
 *
 * Nothing is invented: a value that can't be matched stays empty and is reported as an issue.
 */
import type { ClassDoc, SubjectDoc, TeacherDoc, TimetableDoc } from "@/lib/firebase/types";

export const TIMETABLE_DAYS: TimetableDoc["dayOfWeek"][] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

/** Days a school timetable usually applies to when the file doesn't say. */
export const DEFAULT_IMPORT_DAYS: TimetableDoc["dayOfWeek"][] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const IMPORT_MAX_ROWS = 600;

// ---------------------------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------------------------
/** "HH:MM" (24h) → minutes since midnight; also accepts "hh:mm AM/PM". */
export function toMinutes(value: string | undefined | null): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*(AM|PM)?\s*$/i.exec(value || "");
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

/**
 * Normalises a time to "HH:MM" (24h). School timetables often print afternoon times as
 * "01:30" without AM/PM; an hour of 1–6 without a marker is read as afternoon and reported, so
 * the admin can check it. Returns { value: "" } when the text isn't a time.
 */
export function normalizeTime(raw: string | undefined | null): { value: string; assumedPm: boolean } {
  const text = String(raw || "").trim();
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*(AM|PM|A\.M\.|P\.M\.)?\s*$/i.exec(text);
  if (!m) return { value: "", assumedPm: false };
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 23) return { value: "", assumedPm: false };
  let assumedPm = false;
  const marker = (m[3] || "").replace(/\./g, "").toUpperCase();
  if (marker) {
    if (h < 1 || h > 12) return { value: "", assumedPm: false };
    h = (h % 12) + (marker === "PM" ? 12 : 0);
  } else if (h >= 1 && h <= 6) {
    h += 12;
    assumedPm = true;
  }
  return { value: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, assumedPm };
}

// ---------------------------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------------------------
const DAY_ALIASES: Record<string, TimetableDoc["dayOfWeek"]> = {
  mon: "Monday", monday: "Monday",
  tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
  wed: "Wednesday", weds: "Wednesday", wednesday: "Wednesday",
  thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday",
  fri: "Friday", friday: "Friday",
  sat: "Saturday", saturday: "Saturday",
  sun: "Sunday", sunday: "Sunday",
};

/** "Monday", "Mon-Thu, Sat", "Mon/Wed", "All" → weekday names (in week order, no duplicates). */
export function parseDays(raw: string | undefined | null): TimetableDoc["dayOfWeek"][] {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return [];
  if (/^(all|daily|every ?day|all days)$/.test(text)) return [...DEFAULT_IMPORT_DAYS];
  const found = new Set<TimetableDoc["dayOfWeek"]>();
  for (const part of text.split(/[,;/&+]|\band\b/)) {
    const p = part.trim();
    if (!p) continue;
    const range = /^([a-z]+)\s*(?:-|–|to)\s*([a-z]+)$/.exec(p);
    if (range && DAY_ALIASES[range[1]] && DAY_ALIASES[range[2]]) {
      const a = TIMETABLE_DAYS.indexOf(DAY_ALIASES[range[1]]);
      const b = TIMETABLE_DAYS.indexOf(DAY_ALIASES[range[2]]);
      for (let i = a; i <= (b >= a ? b : a); i++) found.add(TIMETABLE_DAYS[i]);
      continue;
    }
    const d = DAY_ALIASES[p.replace(/[^a-z]/g, "")];
    if (d) found.add(d);
  }
  return TIMETABLE_DAYS.filter((d) => found.has(d));
}

// ---------------------------------------------------------------------------------------------
// Name matching against the school's real records
// ---------------------------------------------------------------------------------------------
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6",
  seventh: "7", eighth: "8", ninth: "9", tenth: "10", "1st": "1", "2nd": "2", "3rd": "3", "4th": "4", "5th": "5",
  "6th": "6", "7th": "7", "8th": "8", "9th": "9", "10th": "10",
};
const IGNORED_CLASS_WORDS = new Set(["grade", "class", "section", "std", "standard"]);
const TITLE_WORDS = new Set(["ms", "mr", "mrs", "miss", "sir", "madam", "dr", "prof", "maam", "mam", "teacher"]);

function tokens(text: string, ignore: Set<string> = new Set()): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => NUMBER_WORDS[t] || t)
    .filter((t) => !ignore.has(t));
}

const key = (parts: string[]) => parts.join(" ");

function uniqueMatch<T>(candidates: T[], score: (c: T) => number): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const c of candidates) {
    const s = score(c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
      tie = false;
    } else if (s === bestScore && s > 0) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

/** Same tokens (2), or one side's tokens all contained in the other's (1). */
function tokenScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (key(a) === key(b)) return 2;
  const sa = new Set(a);
  const sb = new Set(b);
  if (a.every((t) => sb.has(t)) || b.every((t) => sa.has(t))) return 1;
  return 0;
}

export function classLabel(c: Pick<ClassDoc, "name" | "section">): string {
  return c.name.includes(c.section) ? c.name : `${c.name}-${c.section}`;
}

export function matchClass(raw: string, classes: ClassDoc[]): ClassDoc | null {
  const t = tokens(raw, IGNORED_CLASS_WORDS);
  return uniqueMatch(classes, (c) =>
    Math.max(tokenScore(t, tokens(`${c.name} ${c.section}`, IGNORED_CLASS_WORDS)), tokenScore(t, tokens(classLabel(c), IGNORED_CLASS_WORDS)))
  );
}

export function matchSubject(raw: string, classId: string | null, subjects: SubjectDoc[]): SubjectDoc | null {
  if (!classId) return null;
  const t = tokens(raw);
  const own = subjects.filter((s) => s.classId === classId);
  return uniqueMatch(own, (s) => Math.max(tokenScore(t, tokens(s.name)), s.code ? (key(t) === key(tokens(s.code)) ? 2 : 0) : 0));
}

export function matchTeacher(raw: string, teachers: TeacherDoc[]): TeacherDoc | null {
  const t = tokens(raw, TITLE_WORDS);
  return uniqueMatch(teachers, (tc) => tokenScore(t, tokens(tc.fullName, TITLE_WORDS)));
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------
/** One period as read from the file, before matching. */
export interface ImportRowInput {
  className: string;
  subjectName: string;
  teacherName: string;
  periodName: string;
  startTime: string;
  endTime: string;
  /** Times on Friday when the school runs a different Friday schedule (may be empty). */
  fridayStartTime?: string;
  fridayEndTime?: string;
  days: string[];
  roomNo?: string;
  /** Fields the reader itself was unsure about (e.g. hard-to-read handwriting). */
  uncertain?: string[];
}

export type IssueLevel = "error" | "warning";
export interface RowIssue {
  field: "class" | "subject" | "teacher" | "period" | "time" | "fridayTime" | "days" | "room";
  level: IssueLevel;
  message: string;
}

/** A matched row as shown in the preview and sent back (corrected) on commit. */
export interface PreviewRow {
  key: string;
  raw: { className: string; subjectName: string; teacherName: string };
  classId: string;
  subjectId: string;
  teacherId: string;
  periodName: string;
  startTime: string;
  endTime: string;
  fridayStartTime: string;
  fridayEndTime: string;
  days: TimetableDoc["dayOfWeek"][];
  roomNo: string;
  issues: RowIssue[];
}

export interface ImportContext {
  classes: ClassDoc[];
  subjects: SubjectDoc[];
  teachers: TeacherDoc[];
}

/** Issues that only depend on the row's current values (re-run after every correction). */
export function rowIssues(
  row: Omit<PreviewRow, "issues" | "key"> & { key?: string },
  ctx: ImportContext,
  extra: RowIssue[] = []
): RowIssue[] {
  const issues: RowIssue[] = [...extra];
  const cls = ctx.classes.find((c) => c.id === row.classId);
  if (!cls) {
    issues.push({ field: "class", level: "error", message: row.raw.className ? `Class "${row.raw.className}" not found — pick the class.` : "Class is missing." });
  }
  const subject = ctx.subjects.find((s) => s.id === row.subjectId && s.classId === row.classId);
  if (!subject) {
    issues.push({
      field: "subject",
      level: "error",
      message: row.raw.subjectName
        ? `Subject "${row.raw.subjectName}" not found in this class — pick it (add it under Classes first if it doesn't exist).`
        : "Subject is missing.",
    });
  }
  if (row.teacherId && !ctx.teachers.some((t) => t.id === row.teacherId)) {
    issues.push({ field: "teacher", level: "error", message: "Selected teacher is not in this school." });
  } else if (!row.teacherId && row.raw.teacherName) {
    issues.push({
      field: "teacher",
      level: "warning",
      message: `Teacher "${row.raw.teacherName}" not matched — the subject's allocated teacher will be used unless you pick one.`,
    });
  }
  if (!row.periodName.trim()) issues.push({ field: "period", level: "error", message: "Period name is missing." });
  const s = toMinutes(row.startTime);
  const e = toMinutes(row.endTime);
  if (s === null || e === null) issues.push({ field: "time", level: "error", message: "Start and end time are required (HH:MM)." });
  else if (e <= s) issues.push({ field: "time", level: "error", message: "End time must be after start time." });
  if (row.fridayStartTime || row.fridayEndTime) {
    const fs = toMinutes(row.fridayStartTime);
    const fe = toMinutes(row.fridayEndTime);
    if (fs === null || fe === null) issues.push({ field: "fridayTime", level: "error", message: "Friday times must both be set (HH:MM) or both empty." });
    else if (fe <= fs) issues.push({ field: "fridayTime", level: "error", message: "Friday end time must be after its start time." });
  }
  if (row.days.length === 0) issues.push({ field: "days", level: "error", message: "Choose at least one day." });
  return issues;
}

/** Matches raw rows to the school's records and reports everything that needs a human look. */
export function buildPreviewRows(inputs: ImportRowInput[], ctx: ImportContext): PreviewRow[] {
  return inputs.slice(0, IMPORT_MAX_ROWS).map((input, i) => {
    const extra: RowIssue[] = [];
    const cls = matchClass(input.className, ctx.classes);
    const subject = matchSubject(input.subjectName, cls?.id || null, ctx.subjects);
    const teacher = input.teacherName ? matchTeacher(input.teacherName, ctx.teachers) : null;

    const start = normalizeTime(input.startTime);
    const end = normalizeTime(input.endTime);
    const fStart = normalizeTime(input.fridayStartTime);
    const fEnd = normalizeTime(input.fridayEndTime);
    if (start.assumedPm || end.assumedPm) extra.push({ field: "time", level: "warning", message: "Time had no AM/PM; read as afternoon — please check." });
    if (fStart.assumedPm || fEnd.assumedPm) extra.push({ field: "fridayTime", level: "warning", message: "Friday time had no AM/PM; read as afternoon — please check." });
    if ((input.startTime && !start.value) || (input.endTime && !end.value)) {
      extra.push({ field: "time", level: "error", message: `Could not read the time "${input.startTime || ""}–${input.endTime || ""}".` });
    }

    const days = parseDays(input.days.join(","));
    const uncertain = new Set((input.uncertain || []).map((u) => u.toLowerCase()));
    const fieldFor: Record<string, RowIssue["field"]> = {
      class: "class", classname: "class", subject: "subject", subjectname: "subject", teacher: "teacher", teachername: "teacher",
      time: "time", starttime: "time", endtime: "time", period: "period", periodname: "period", days: "days", room: "room",
    };
    for (const u of uncertain) {
      const f = fieldFor[u.replace(/[^a-z]/g, "")];
      if (f) extra.push({ field: f, level: "warning", message: `The ${f} was hard to read in the file — please confirm.` });
    }

    const row: Omit<PreviewRow, "issues"> = {
      key: `r${i + 1}`,
      raw: { className: input.className || "", subjectName: input.subjectName || "", teacherName: input.teacherName || "" },
      classId: cls?.id || "",
      subjectId: subject?.id || "",
      teacherId: teacher?.id || "",
      periodName: (input.periodName || "").trim().slice(0, 60),
      startTime: start.value,
      endTime: end.value,
      fridayStartTime: fStart.value,
      fridayEndTime: fEnd.value,
      days,
      roomNo: (input.roomNo || "").trim().slice(0, 40),
    };
    return { ...row, issues: rowIssues(row, ctx, extra) };
  });
}

// ---------------------------------------------------------------------------------------------
// Spreadsheet rows (CSV / XLSX): one period per line
// ---------------------------------------------------------------------------------------------
export const SPREADSHEET_COLUMNS = ["Day", "Period", "Start", "End", "Class", "Subject", "Teacher", "Room", "Friday Start", "Friday End"];

const HEADER_ALIASES: Record<string, keyof ImportRowInput | "day"> = {
  day: "day", days: "day", weekday: "day",
  period: "periodName", periodname: "periodName", periodno: "periodName", slot: "periodName",
  start: "startTime", starttime: "startTime", from: "startTime", begins: "startTime",
  end: "endTime", endtime: "endTime", to: "endTime", ends: "endTime",
  class: "className", classname: "className", grade: "className", section: "className",
  subject: "subjectName", subjectname: "subjectName", course: "subjectName",
  teacher: "teacherName", teachername: "teacherName", faculty: "teacherName",
  room: "roomNo", roomno: "roomNo", roomnumber: "roomNo",
  fridaystart: "fridayStartTime", fristart: "fridayStartTime", fridaystarttime: "fridayStartTime",
  fridayend: "fridayEndTime", friend: "fridayEndTime", fridayendtime: "fridayEndTime",
};

/** Header-mapped rows → ImportRowInput[]; throws a readable error when required columns are missing. */
export function sheetRowsToInputs(rows: string[][]): ImportRowInput[] {
  const nonEmpty = rows.filter((r) => r.some((c) => String(c || "").trim()));
  if (nonEmpty.length < 2) throw new Error("The file has no timetable rows (expected a header row and at least one period).");
  const header = nonEmpty[0].map((h) => HEADER_ALIASES[String(h || "").toLowerCase().replace(/[^a-z]/g, "")]);
  const required: Array<keyof ImportRowInput | "day"> = ["className", "subjectName", "startTime", "endTime"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length > 0) {
    throw new Error(`Missing column(s): ${missing.map((m) => ({ className: "Class", subjectName: "Subject", startTime: "Start", endTime: "End" } as Record<string, string>)[m as string]).join(", ")}. Expected columns: ${SPREADSHEET_COLUMNS.join(", ")}.`);
  }
  const out: ImportRowInput[] = [];
  for (const r of nonEmpty.slice(1, IMPORT_MAX_ROWS + 1)) {
    const v: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) v[h] = String(r[i] ?? "").trim().slice(0, 200);
    });
    out.push({
      className: v.className || "",
      subjectName: v.subjectName || "",
      teacherName: v.teacherName || "",
      periodName: v.periodName ? (/^\d+$/.test(v.periodName) ? `Period ${v.periodName}` : v.periodName) : "",
      startTime: v.startTime || "",
      endTime: v.endTime || "",
      fridayStartTime: v.fridayStartTime || "",
      fridayEndTime: v.fridayEndTime || "",
      days: v.day ? [v.day] : [],
      roomNo: v.roomNo || "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Slot validation (shared by manual add/edit and import commit)
// ---------------------------------------------------------------------------------------------
export interface SlotInput {
  classId: string;
  subjectId: string;
  teacherId?: string;
  dayOfWeek: string;
  periodName: string;
  startTime: string;
  endTime: string;
  roomNo?: string;
  topic?: string;
}

export type SlotResult =
  | { ok: true; slot: Omit<TimetableDoc, "id" | "createdAt" | "updatedAt"> }
  | { ok: false; error: string; status: number };

/**
 * Validates one period against this school's own records. Names are always taken from the
 * referenced documents, never from the request, and the period may not overlap another period
 * of the same teacher, class or room on that day (`sameDay` = the other periods of that day).
 */
export function validateTimetableSlot(
  schoolId: string,
  body: SlotInput,
  ctx: ImportContext,
  sameDay: TimetableDoc[]
): SlotResult {
  const classId = String(body?.classId || "").trim();
  const subjectId = String(body?.subjectId || "").trim();
  const dayOfWeek = String(body?.dayOfWeek || "").trim() as TimetableDoc["dayOfWeek"];
  const periodName = String(body?.periodName || "").trim();
  const startTime = String(body?.startTime || "").trim();
  const endTime = String(body?.endTime || "").trim();
  const roomNo = String(body?.roomNo || "").trim();
  const topic = String(body?.topic || "").trim();
  const requestedTeacherId = String(body?.teacherId || "").trim();

  if (!classId || !subjectId || !dayOfWeek || !periodName || !startTime || !endTime) {
    return { ok: false, status: 400, error: "Class, Subject, Day, Period, Start Time, and End Time are required." };
  }
  if ([classId, subjectId, requestedTeacherId].some((v) => v.length > 128) || periodName.length > 60 || roomNo.length > 40 || topic.length > 200) {
    return { ok: false, status: 400, error: "One or more fields are too long (period max 60, room max 40, topic max 200 characters)." };
  }
  if (!TIMETABLE_DAYS.includes(dayOfWeek)) return { ok: false, status: 400, error: "Day must be a weekday name (Monday–Sunday)." };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return { ok: false, status: 400, error: "Start and end time must be valid times (HH:MM)." };
  if (end <= start) return { ok: false, status: 400, error: "End time must be after start time." };

  const cls = ctx.classes.find((c) => c.id === classId);
  if (!cls) return { ok: false, status: 404, error: "Class not found for this school." };
  const subject = ctx.subjects.find((s) => s.id === subjectId);
  if (!subject || subject.classId !== classId) {
    return { ok: false, status: 404, error: "Subject not found for this class." };
  }

  // Defaults to the subject's allocated teacher; an explicit teacher must belong to this school.
  const teacherId = requestedTeacherId || subject.teacherId || "";
  const teacher = teacherId ? ctx.teachers.find((t) => t.id === teacherId) : null;
  if (teacherId && !teacher) return { ok: false, status: 404, error: "Teacher not found for this school." };

  const overlaps = (t: TimetableDoc) => {
    const s = toMinutes(t.startTime);
    const e = toMinutes(t.endTime);
    return t.dayOfWeek === dayOfWeek && s !== null && e !== null && s < end && start < e;
  };
  const clash =
    (teacher && sameDay.find((t) => t.teacherId === teacher.id && overlaps(t))) ||
    sameDay.find((t) => t.classId === classId && overlaps(t)) ||
    (roomNo && roomNo !== "-" && sameDay.find((t) => t.roomNo === roomNo && overlaps(t)));
  if (clash) {
    const who =
      teacher && clash.teacherId === teacher.id ? `${teacher.fullName} is` :
      clash.classId === classId ? "This class is" : `Room ${roomNo} is`;
    return {
      ok: false,
      status: 409,
      error: `${who} already scheduled on ${dayOfWeek} ${clash.startTime}–${clash.endTime} (${clash.subjectName}, ${clash.className}).`,
    };
  }

  return {
    ok: true,
    slot: {
      schoolId,
      teacherId: teacher ? teacher.id : "",
      teacherName: teacher ? teacher.fullName : "Unassigned",
      classId: cls.id,
      className: `${cls.name}-${cls.section}`,
      subjectId: subject.id,
      subjectName: subject.name,
      dayOfWeek,
      periodName,
      startTime,
      endTime,
      roomNo: roomNo || cls.roomNo || "",
      topic,
    },
  };
}

/** A preview row → one slot input per selected day (Friday uses the Friday times when set). */
export function expandRow(row: PreviewRow): SlotInput[] {
  return row.days.map((day) => {
    const friday = day === "Friday" && row.fridayStartTime && row.fridayEndTime;
    return {
      classId: row.classId,
      subjectId: row.subjectId,
      teacherId: row.teacherId,
      dayOfWeek: day,
      periodName: row.periodName,
      startTime: friday ? row.fridayStartTime : row.startTime,
      endTime: friday ? row.fridayEndTime : row.endTime,
      roomNo: row.roomNo,
    };
  });
}
