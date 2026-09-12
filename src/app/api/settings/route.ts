import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getSchoolSettingsServer,
  updateSchoolSettingsServer,
  createAuditLogServer
} from "@/lib/firebase/server-db";
import { SchoolSettingsDoc } from "@/lib/firebase/types";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN", "TEACHER"]);
    let settings = await getSchoolSettingsServer(authUser.schoolId);

    if (!settings) {
      settings = {
        id: authUser.schoolId,
        schoolId: authUser.schoolId,
        schoolName: "Allied School",
        campusName: "Main Campus Islamabad",
        motto: "Excellence in Education, Character in Life",
        address: "Campus Avenue, Sector F-8/4, Islamabad",
        phone: "+92 51 2854321",
        email: authUser.email,
        principalName: "Principal",
        academicYear: "2024-2025",
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
      { id: "sess-2024", name: "2024-2025", isCurrent: true, startDate: "2024-08-01", endDate: "2025-06-30" }
    ];

    const formatted = {
      id: settings.id,
      schoolName: settings.schoolName,
      campusName: settings.campusName,
      tagline: settings.motto,
      contactEmail: settings.email,
      contactPhone: settings.phone,
      address: settings.address,
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

    const updated: SchoolSettingsDoc = {
      id: authUser.schoolId,
      schoolId: authUser.schoolId,
      schoolName: body.schoolName || current?.schoolName || "Allied School",
      campusName: body.campusName || current?.campusName || "Main Campus",
      motto: body.tagline || current?.motto || "Excellence in Education",
      address: body.address || current?.address || "Islamabad",
      phone: body.contactPhone || current?.phone || "+92 51 0000000",
      email: body.contactEmail || current?.email || authUser.email,
      principalName: current?.principalName || "Principal",
      academicYear: "2024-2025",
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
