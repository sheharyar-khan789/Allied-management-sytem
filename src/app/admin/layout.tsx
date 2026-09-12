import React from "react";
import AdminSidebar from "@/components/AdminSidebar";
import AdminHeader from "@/components/AdminHeader";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import { getStudentsServer, getTeachersServer, getSchoolSettingsServer } from "@/lib/firebase/server-db";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthenticatedUser();
  const schoolId = session?.schoolId || "allied-school-main";

  let totalStudents = 0;
  let totalTeachers = 0;
  let sessionName = "Session 2024-2025 | Mid-Term";

  try {
    const [students, teachers, settings] = await Promise.all([
      getStudentsServer(schoolId),
      getTeachersServer(schoolId),
      getSchoolSettingsServer(schoolId)
    ]);
    totalStudents = students.filter((s) => s.status === "ACTIVE").length;
    totalTeachers = teachers.filter((t) => t.status === "ACTIVE").length;
    if (settings?.academicYear) {
      sessionName = `Session ${settings.academicYear} | Main Campus`;
    }
  } catch (e) {
    // Graceful fallback
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Fixed Admin Sidebar */}
      <AdminSidebar
        totalStudents={totalStudents}
        totalTeachers={totalTeachers}
        userName={session?.name || "Administrator"}
        userRole={session?.role === "ADMIN" ? "Super Admin" : "Staff"}
      />

      {/* Main Content Area */}
      <div className="pl-64 flex flex-col min-h-screen w-full">
        {/* Top Header */}
        <AdminHeader sessionName={sessionName} />

        {/* Page Body */}
        <main className="w-full pt-16 px-space-lg py-space-lg flex-1 bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
