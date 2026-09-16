"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface ParentNavProps {
  parentName?: string;
}

export default function ParentNav({ parentName = "Parent / Guardian" }: ParentNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentQs = searchParams.get("studentId") ? `?studentId=${encodeURIComponent(searchParams.get("studentId") || "")}` : "";

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      window.location.href = "/login";
    }
  };

  const navLinks = [
    { label: "Dashboard", href: "/parent", icon: "dashboard" },
    { label: "Children", href: "/parent/children", icon: "family_restroom" },
    { label: "Attendance", href: "/parent/attendance", icon: "event_available" },
    { label: "Fees", href: "/parent/fees", icon: "payments" },
    { label: "Results", href: "/parent/results", icon: "workspace_premium" },
    { label: "Announcements", href: "/parent/announcements", icon: "campaign" },
  ];

  return (
    <header className="sticky top-0 z-40 bg-surface-container-lowest border-b border-surface-container-low shadow-sm no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-secondary text-white flex items-center justify-center font-bold shrink-0">
              <span className="material-symbols-outlined text-[20px]">family_restroom</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-headline-sm text-sm font-bold text-on-surface truncate">Parent Portal</span>
                <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-semibold text-secondary hidden sm:inline">
                  Guardian
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant truncate">{parentName}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg hover:bg-error-container text-on-surface-variant hover:text-error transition-colors flex items-center gap-1 text-xs"
            title="Sign Out"
            aria-label="Sign out"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>

        <div className="flex space-x-1 sm:space-x-3 border-t border-surface-container-low overflow-x-auto py-1">
          {navLinks.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={`${item.href}${studentQs}`}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all whitespace-nowrap ${
                  active
                    ? "bg-secondary-container text-on-secondary-container shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
