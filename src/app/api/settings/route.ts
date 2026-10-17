import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRecentAuth } from "@/lib/firebase/server-auth";
import { z } from "zod";
import { parseJsonBody, safeUrl } from "@/lib/input-validation";
import {
  getSchoolSettingsServer,
  updateSchoolSettingsServer,
  createAuditLogServer,
  getSchoolServer
} from "@/lib/firebase/server-db";
import { ExamCategory, SchoolSettingsDoc } from "@/lib/firebase/types";
import { getDefaultAcademicYear, realPrincipalName } from "@/lib/school-display";
import { serviceBusyResponseFor } from "@/lib/firebase/firestore-errors";
import { DEFAULT_SCHOOL_TIMEZONE } from "@/lib/lesson-plan-schedule";
import { EXAM_CATEGORIES, EXAM_CATEGORY_PERMISSION_DEFAULTS } from "@/lib/exam-results";

/** A conservative allowlist check: must parse as a real IANA zone (Intl throws on a bad one). */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    // Only /admin/settings reads this route. (Portals that need the school's display
    // identity get it server-side via schoolPrintIdentity, not through this endpoint.)
    const authUser = await requireAuth(req, ["ADMIN"]);
    let settings = await getSchoolSettingsServer(authUser.schoolId);
    const school = await getSchoolServer(authUser.schoolId);

    if (!settings) {
      settings = {
        id: authUser.schoolId,
        schoolId: authUser.schoolId,
        schoolName: school?.name || "Allied School",
        campusName: "Main Campus",
        motto: "Excellence in Education",
        address: school?.address || "",
        phone: school?.phone || "",
        email: school?.email || authUser.email,
        // Never a placeholder name: an unset head is shown as "not configured" with a link here.
        principalName: school?.principalName || "",
        principalTitle: "",
        academicYear: school?.academicYear || getDefaultAcademicYear(),
        timezone: DEFAULT_SCHOOL_TIMEZONE,
        gradingScale: [
          { minPercentage: 90, grade: "A+", gpa: 4.0 },
          { minPercentage: 80, grade: "A", gpa: 3.7 },
          { minPercentage: 70, grade: "B+", gpa: 3.3 },
          { minPercentage: 60, grade: "B", gpa: 3.0 },
          { minPercentage: 50, grade: "C", gpa: 2.5 },
          { minPercentage: 40, grade: "D", gpa: 2.0 },
          { minPercentage: 0, grade: "F", gpa: 0.0 },
        ],
        updatedAt: new Date().toISOString(),
      };
      await updateSchoolSettingsServer(settings);
    }

    // "sessions" previously fabricated fixed calendar dates ("2024-08-01"/"2025-06-30") for a
    // single hardcoded id regardless of the school's real academic year. There's no real
    // session start/end date stored anywhere yet, so we report the real academic year label
    // without inventing dates.
    const sessions = [
      { id: settings.academicYear || "current", name: settings.academicYear || "Current Session", isCurrent: true }
    ];

    const formatted = {
      id: settings.id,
      schoolName: settings.schoolName || school?.name || "Allied School",
      campusName: settings.campusName || "",
      tagline: settings.motto || "",
      contactEmail: settings.email || school?.email || authUser.email,
      contactPhone: settings.phone || school?.phone || "",
      address: settings.address || school?.address || "",
      academicYear: settings.academicYear || getDefaultAcademicYear(),
      // Explicitly configured (never inferred from the server) — drives the ASD weekly
      // lesson-plan Saturday submission window/lock. See lesson-plan-schedule.ts.
      timezone: settings.timezone || DEFAULT_SCHOOL_TIMEZONE,
      currencySymbol: settings.currencySymbol || "Rs.",
      gradingSystem: settings.gradingSystemLabel || "Standard 4.0 / Percentage",
      currentSessionId: sessions[0].id,
      logoUrl: settings.logoUrl || school?.logoUrl || "",
      // Head of institution as printed on report cards (signature block).
      principalName: realPrincipalName(settings.principalName) || realPrincipalName(school?.principalName) || "",
      principalTitle: settings.principalTitle || "",
      // Always the full map (defaults filled in) so the settings UI has a definite value per
      // category to show/toggle, not just whatever overrides happen to be stored.
      examCategoryPermissions: {
        ...EXAM_CATEGORY_PERMISSION_DEFAULTS,
        ...(settings.examCategoryPermissions || {}),
      },
    };

    return NextResponse.json({ success: true, settings: formatted, sessions });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/settings");
    if (busy) return busy;
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve school settings." },
      { status: 500 }
    );
  }
}

const text = (max: number) => z.string().trim().max(max).optional();
const settingsSchema = z.object({
  schoolName: text(160),
  campusName: text(160),
  tagline: text(200),
  contactEmail: z.string().trim().max(254).optional().or(z.literal("")),
  contactPhone: text(40),
  address: text(300),
  academicYear: text(9),
  timezone: text(60),
  currencySymbol: text(8),
  gradingSystem: text(80),
  logoUrl: safeUrl.optional().nullable(),
  principalName: text(120),
  principalTitle: text(80),
  examCategoryPermissions: z
    .record(z.enum(EXAM_CATEGORIES as [ExamCategory, ...ExamCategory[]]), z.enum(["ALLOWED", "READ_ONLY"]))
    .optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    // The page sends back what GET returned; unknown keys are dropped (the tenant is always the
    // session's school), every kept field is length-bounded, and the logo must be an https URL.
    const parsed = await parseJsonBody(req, settingsSchema);
    if (!parsed.ok) return parsed.response;
    requireRecentAuth(authUser, "change school settings", req);
    const body = parsed.data;

    if (body.schoolName !== undefined && !String(body.schoolName).trim()) {
      return NextResponse.json({ error: "Institution name cannot be empty." }, { status: 400 });
    }
    if (body.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.contactEmail).trim())) {
      return NextResponse.json({ error: "Please enter a valid contact email address." }, { status: 400 });
    }
    if (body.academicYear !== undefined && String(body.academicYear).trim().length > 0) {
      if (!/^\d{4}-\d{4}$/.test(String(body.academicYear).trim())) {
        return NextResponse.json(
          { error: "Academic session must be in the format YYYY-YYYY, e.g. 2025-2026." },
          { status: 400 }
        );
      }
    }
    if (body.timezone !== undefined && String(body.timezone).trim().length > 0 && !isValidTimeZone(String(body.timezone).trim())) {
      return NextResponse.json(
        { error: "Timezone must be a valid IANA timezone name, e.g. Asia/Karachi." },
        { status: 400 }
      );
    }

    const current = await getSchoolSettingsServer(authUser.schoolId);
    const school = await getSchoolServer(authUser.schoolId);

    const updated: SchoolSettingsDoc = {
      id: authUser.schoolId,
      schoolId: authUser.schoolId,
      schoolName: body.schoolName || current?.schoolName || school?.name || "Allied School",
      campusName: body.campusName ?? current?.campusName ?? "",
      motto: body.tagline ?? current?.motto ?? "",
      address: body.address ?? current?.address ?? school?.address ?? "",
      phone: body.contactPhone ?? current?.phone ?? school?.phone ?? "",
      email: body.contactEmail || current?.email || authUser.email,
      principalName:
        body.principalName !== undefined
          ? body.principalName
          : current?.principalName ?? school?.principalName ?? "",
      principalTitle: body.principalTitle !== undefined ? body.principalTitle : current?.principalTitle ?? "",
      academicYear: (body.academicYear && String(body.academicYear).trim())
        || current?.academicYear
        || school?.academicYear
        || getDefaultAcademicYear(),
      timezone: (body.timezone && String(body.timezone).trim())
        || current?.timezone
        || DEFAULT_SCHOOL_TIMEZONE,
      currencySymbol: (body.currencySymbol && String(body.currencySymbol).trim())
        || current?.currencySymbol
        || "Rs.",
      gradingSystemLabel: (body.gradingSystem && String(body.gradingSystem).trim())
        || current?.gradingSystemLabel
        || "Standard 4.0 / Percentage",
      gradingScale: current?.gradingScale || [],
      logoUrl: body.logoUrl !== undefined ? (body.logoUrl ?? "") : (current?.logoUrl || school?.logoUrl || ""),
      examCategoryPermissions: body.examCategoryPermissions !== undefined
        ? body.examCategoryPermissions
        : current?.examCategoryPermissions,
      updatedAt: new Date().toISOString(),
    };

    await updateSchoolSettingsServer(updated);

    await createAuditLogServer(
      authUser.schoolId,
      authUser.uid,
      authUser.email,
      authUser.role,
      "UPDATE_SETTINGS",
      "SETTING",
      authUser.schoolId,
      current?.academicYear && current.academicYear !== updated.academicYear
        ? `Switched active academic session from ${current.academicYear} to ${updated.academicYear}. Records of ${current.academicYear} are preserved and shown again when it is selected.`
        : (current?.principalName || "") !== updated.principalName || (current?.principalTitle || "") !== (updated.principalTitle || "")
          ? "Updated institution profile, including the head of institution shown on report cards."
          : "Updated institution profile and system configuration in Firestore."
    );

    return NextResponse.json({ success: true, settings: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    const busy = serviceBusyResponseFor(error, "/api/settings");
    if (busy) return busy;
    console.error("Settings PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update settings." },
      { status: 500 }
    );
  }
}
