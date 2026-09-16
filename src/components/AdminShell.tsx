"use client";

import React, { useState } from "react";
import AdminSidebar from "@/components/AdminSidebar";
import AdminHeader from "@/components/AdminHeader";

interface AdminShellProps {
  totalStudents: number;
  totalTeachers: number;
  userName: string;
  userRole: string;
  sessionName: string;
  dataLoadError?: boolean;
  children: React.ReactNode;
}

/**
 * Below md, AdminSidebar renders off-canvas and AdminHeader spans full width with a
 * hamburger toggle. This is the only piece of that behavior that needs client-side state
 * (open/closed), so it's kept in this small wrapper rather than converting the whole
 * server-rendered AdminLayout (which does the real data fetching) into a client component.
 */
export default function AdminShell({
  totalStudents,
  totalTeachers,
  userName,
  userRole,
  sessionName,
  dataLoadError,
  children,
}: AdminShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar
        totalStudents={totalStudents}
        totalTeachers={totalTeachers}
        userName={userName}
        userRole={userRole}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <div className="pl-0 md:pl-64 flex flex-col min-h-screen w-full">
        <AdminHeader sessionName={sessionName} onMenuClick={() => setMobileNavOpen((v) => !v)} />

        <main className="w-full pt-16 px-space-md sm:px-space-lg py-space-lg flex-1 bg-background">
          {dataLoadError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-error/30 bg-error-container/10 px-4 py-3 text-xs font-semibold text-error flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>
                Live student/teacher counts and session details could not be loaded from the
                database. Figures shown below may be incomplete until this is resolved.
              </span>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
