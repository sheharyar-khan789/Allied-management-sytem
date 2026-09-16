import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/firebase/server-auth";
import {
  getLockedRecordsServer,
  createAuditLogServer,
  getStudentByIdServer,
  getSchoolSettingsServer
} from "@/lib/firebase/server-db";

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuth(req, ["ADMIN"]);
    const [records, settings] = await Promise.all([
      getLockedRecordsServer(authUser.schoolId),
      getSchoolSettingsServer(authUser.schoolId),
    ]);

    const formatted = records.map((r) => ({
      id: r.id,
      recordType: r.type,
      studentId: r.studentId,
      studentName: r.studentName || "Student",
      admissionNo: r.admissionNo || "",
      className: (r as any).className || "Academic Record",
      sessionName: r.academicYear || settings?.academicYear || "Current Session",
      referenceNo: `ALS-TRN-${r.id.toUpperCase()}`,
      certifiedDate: r.sealedAt,
      certifiedBy: r.sealedBy,
      summaryJson: JSON.stringify({ gpa: r.gpa, percentage: r.percentage, remarks: r.remarks }),
      status: "LOCKED_CERTIFIED",
    }));

    return NextResponse.json({ success: true, records: formatted });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("Locked records error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve locked records." },
      { status: 500 }
    );
  }
}
