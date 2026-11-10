import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSchoolSettingsServer,
  updateSchoolSettingsServer,
  createAuditLogServer,
  getSchoolServer
} from "@/lib/firebase/server-db";
import { SchoolSettingsDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
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
        academicYear: school?.academicYear || "2024-2025",
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

    const sessions = [
      { id: "sess-2024", name: settings.academicYear || "2024-2025", isCurrent: true, startDate: "2024-08-01", endDate: "2025-06-30" }
    ];

    const formatted = {
      id: settings.id,
      schoolName: settings.schoolName || school?.name || "Allied School",
      campusName: settings.campusName || "",
      tagline: settings.motto || "",
      contactEmail: settings.email || school?.email || authUser.email,
      contactPhone: settings.phone || school?.phone || "",
      address: settings.address || school?.address || "",
      currencySymbol: "Rs.",
      gradingSystem: "Standard 4.0 / Percentage",
      currentSessionId: "sess-2024"
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
      academicYear: current?.academicYear || school?.academicYear || "2024-2025",
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
