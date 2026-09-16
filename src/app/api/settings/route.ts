import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSchoolSettingsServer,
  updateSchoolSettingsServer,
  createAuditLogServer,
  getSchoolServer
} from "@/lib/firebase/server-db";
import { SchoolSettingsDoc } from "@/lib/firebase/types";
import { getDefaultAcademicYear } from "@/lib/school-display";

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
        principalName: school?.principalName || "Principal",
        academicYear: school?.academicYear || getDefaultAcademicYear(),
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
      currencySymbol: settings.currencySymbol || "Rs.",
      gradingSystem: settings.gradingSystemLabel || "Standard 4.0 / Percentage",
      currentSessionId: sessions[0].id
    };

    return NextResponse.json({ success: true, settings: formatted, sessions });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve school settings." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const body = await req.json();

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
      principalName: current?.principalName || school?.principalName || "Principal",
      academicYear: (body.academicYear && String(body.academicYear).trim())
        || current?.academicYear
        || school?.academicYear
        || getDefaultAcademicYear(),
      currencySymbol: (body.currencySymbol && String(body.currencySymbol).trim())
        || current?.currencySymbol
        || "Rs.",
      gradingSystemLabel: (body.gradingSystem && String(body.gradingSystem).trim())
        || current?.gradingSystemLabel
        || "Standard 4.0 / Percentage",
      gradingScale: current?.gradingScale || [],
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
      "Updated institution profile and system configuration in Firestore."
    );

    return NextResponse.json({ success: true, settings: updated });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Settings PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update settings." },
      { status: 500 }
    );
  }
}
