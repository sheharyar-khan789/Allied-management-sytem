import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getClassesServer,
  getStudentsServer,
  getFeeChallansForStudentsServer,
  getSchoolServer,
  getSchoolSettingsServer,
  getAcademicSessionContextServer,
} from "@/lib/firebase/server-db";
import { schoolPrintIdentity } from "@/lib/school-display";
import { buildVoucher } from "@/lib/fee-voucher-server";
import { feeMonthOf } from "@/lib/fee-ledger";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import type { FeeChallanDoc } from "@/lib/firebase/types";

/** Most vouchers one bulk print returns (a large class fits; this only bounds a single response). */
const MAX_VOUCHERS = 300;
const YEAR_RE = /^\d{4}$/;
const SESSION_RE = /^[\w .\/-]{3,20}$/;

/**
 * GET /api/print/challans?classId=&month=&year=&academicYear=&studentIds=a,b — ADMIN only.
 *
 * Every voucher of one class for one fee month, built from the school's real student and challan
 * records with a handful of batched reads (students of the class, then those students' challans in
 * chunks) — never one query per student. Pending Fees come from the same challan set, so no extra
 * reads. All amounts are computed on the server (src/lib/fee-voucher.ts); the client submits only
 * filters, never money. A student with no challan for the month, or with more than one, is reported
 * in `missing` / `duplicates` instead of being silently skipped or printed twice.
 */
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const schoolId = authUser.schoolId;
    const sp = new URL(req.url).searchParams;

    // Selector data for the bulk-print screen: known sessions + the classes of the chosen session.
    if (sp.get("meta") === "1") {
      const metaCtx = await getAcademicSessionContextServer(schoolId);
      const wantedSession = (sp.get("academicYear") || "").trim();
      if (wantedSession && !SESSION_RE.test(wantedSession)) {
        return NextResponse.json({ error: "Invalid academic session." }, { status: 400 });
      }
      const chosen = wantedSession || metaCtx.academicYear || "";
      const allClasses = await getClassesServer(schoolId, { allSessions: true });
      const sessions = Array.from(
        new Set([metaCtx.academicYear, ...allClasses.map((c) => c.academicYear)].filter((v): v is string => Boolean(v)))
      ).sort().reverse();
      const classesOfSession = allClasses
        .filter((c) => !chosen || (c.academicYear || metaCtx.academicYear) === chosen)
        .map((c) => ({ id: c.id, name: c.name, section: c.section || "", numericLevel: c.numericLevel }))
        .sort((a, b) => (a.numericLevel ?? 0) - (b.numericLevel ?? 0) || a.section.localeCompare(b.section));
      return NextResponse.json({ success: true, activeSession: metaCtx.academicYear || "", sessions, academicYear: chosen, classes: classesOfSession });
    }

    const classId = (sp.get("classId") || "").trim();
    const monthRaw = (sp.get("month") || "").trim();
    const yearRaw = (sp.get("year") || "").trim();
    const sessionRaw = (sp.get("academicYear") || "").trim();
    const studentIds = (sp.get("studentIds") || "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 500);

    if (!classId) return NextResponse.json({ error: "Select a class." }, { status: 400 });
    const month = feeMonthOf(monthRaw);
    if (!month) return NextResponse.json({ error: "Select a valid fee month." }, { status: 400 });
    if (yearRaw && !YEAR_RE.test(yearRaw)) return NextResponse.json({ error: "Invalid year." }, { status: 400 });
    if (sessionRaw && !SESSION_RE.test(sessionRaw)) return NextResponse.json({ error: "Invalid academic session." }, { status: 400 });
    const year = yearRaw ? Number(yearRaw) : undefined;

    const ctx = await getAcademicSessionContextServer(schoolId);
    const academicYear = sessionRaw || ctx.academicYear || undefined;
    const scope = academicYear ? { academicYear } : undefined;

    // The class must belong to this school (and the chosen session).
    const classes = await getClassesServer(schoolId, scope);
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return NextResponse.json({ error: "Class not found for this school and session." }, { status: 404 });

    const students = await getStudentsServer(schoolId, classId, undefined, undefined, undefined, scope);
    const wanted = studentIds.length ? new Set(studentIds) : null;
    const selected = students
      .filter((s) => s.classId === classId && (!wanted || wanted.has(s.id)))
      .sort((a, b) => (Number(a.rollNo) || 0) - (Number(b.rollNo) || 0) || a.fullName.localeCompare(b.fullName));

    const [school, settings, challans] = await Promise.all([
      getSchoolServer(schoolId),
      getSchoolSettingsServer(schoolId),
      getFeeChallansForStudentsServer(schoolId, selected.map((s) => s.id), scope),
    ]);
    const identity = schoolPrintIdentity(school, settings);

    const byStudent = new Map<string, FeeChallanDoc[]>();
    for (const c of challans) {
      if (c.schoolId !== schoolId) continue; // tenant guard, belt and braces
      if (academicYear && c.academicYear && c.academicYear !== academicYear) continue; // never mix sessions
      const list = byStudent.get(c.studentId);
      if (list) list.push(c);
      else byStudent.set(c.studentId, [c]);
    }

    const vouchers: ReturnType<typeof buildVoucher>[] = [];
    const missing: { studentId: string; fullName: string; admissionNo: string }[] = [];
    const duplicates: { studentId: string; fullName: string; count: number }[] = [];
    for (const st of selected) {
      const all = byStudent.get(st.id) || [];
      const forMonth = all.filter((c) => feeMonthOf(c.month) === month && (year === undefined || c.year === year));
      if (forMonth.length === 0) {
        missing.push({ studentId: st.id, fullName: st.fullName, admissionNo: st.admissionNo });
        continue;
      }
      if (forMonth.length > 1) duplicates.push({ studentId: st.id, fullName: st.fullName, count: forMonth.length });
      // One page per student: the most recently issued challan of that month.
      const chosen = [...forMonth].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
      vouchers.push(buildVoucher(identity, st, chosen, all));
    }

    const truncated = vouchers.length > MAX_VOUCHERS;
    return NextResponse.json({
      success: true,
      academicYear: academicYear || "",
      className: `${cls.name}${cls.section ? `-${cls.section}` : ""}`,
      month,
      year: year ?? null,
      students: selected.map((s) => ({ id: s.id, fullName: s.fullName, admissionNo: s.admissionNo })),
      vouchers: truncated ? vouchers.slice(0, MAX_VOUCHERS) : vouchers,
      missing,
      duplicates,
      truncated,
    });
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/print/challans");
    if (busy) return busy;
    console.error("Bulk print challans error:", error);
    return NextResponse.json({ error: "Failed to load fee vouchers." }, { status: 500 });
  }
}
