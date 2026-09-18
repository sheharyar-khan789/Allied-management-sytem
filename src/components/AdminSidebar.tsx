"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface AdminSidebarProps {
  totalStudents?: number;
  totalTeachers?: number;
  userName?: string;
  userRole?: string;
  mobileOpen?: boolean;
  onClose?: () => void;
}

export default function AdminSidebar({
  totalStudents = 0,
  totalTeachers = 0,
  userName = "Administrator",
  userRole = "Super Admin",
  mobileOpen = false,
  onClose,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error(err);
      window.location.href = "/login";
    }
  };

  const navItems = [
    { label: "Dashboard", href: "/admin", icon: "dashboard" },
    { label: "Students", href: "/admin/students", icon: "school", badge: totalStudents },
    { label: "Teachers", href: "/admin/teachers", icon: "person_apron", badge: totalTeachers },
    { label: "Classes & Subjects", href: "/admin/classes", icon: "menu_book" },
    { label: "Attendance", href: "/admin/attendance", icon: "event_available" },
    { label: "Fees & Payments", href: "/admin/fees", icon: "payments" },
    { label: "Payroll", href: "/admin/payroll", icon: "account_balance_wallet" },
    { label: "Exams & Results", href: "/admin/exams", icon: "assignment_turned_in" },
    { label: "Reports", href: "/admin/reports", icon: "bar_chart" },
    { label: "Announcements", href: "/admin/announcements", icon: "campaign" },
  ];

  const adminItems = [
    { label: "Locked Records", href: "/admin/locked-records", icon: "lock" },
    { label: "History / Audit Log", href: "/admin/audit", icon: "history" },
    { label: "Settings", href: "/admin/settings", icon: "settings" },
  ];

  const isActive = (path: string) => {
    if (path === "/admin") return pathname === "/admin";
    return pathname?.startsWith(path);
  };

  return (
    <>
      {/* Mobile backdrop — clicking it closes the drawer, matching standard drawer/nav UX */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden no-print"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-primary-container z-50 flex flex-col justify-between overflow-y-auto no-print transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="flex flex-col">
          {/* Brand Header */}
          <div className="h-16 px-space-md flex items-center gap-space-sm bg-primary/30 border-b border-surface-container-high/10">
            <img
              src="/images/logo.png"
              alt="Allied School Logo"
              className="h-9 w-9 object-contain rounded-lg bg-white p-0.5 shadow-sm"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = "none";
              }}
            />
            <div className="flex flex-col">
              <span className="font-headline-sm text-[16px] text-on-primary font-bold tracking-tight leading-none">

                Allied School
              </span>
              <span className="font-label-sm text-[10px] text-on-primary-container font-semibold tracking-wider uppercase mt-1">
                SMS Platform
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto p-1.5 rounded-lg text-on-primary-container hover:bg-primary/50 md:hidden"
              aria-label="Close navigation menu"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>

        {/* Academic Operations */}
        <div className="px-space-md pt-space-md pb-space-xs">
          <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-primary-container font-semibold">
            Academic Operations
          </span>
        </div>
        <nav className="flex flex-col gap-1 px-space-sm">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center justify-between px-space-md py-2.5 rounded-lg transition-all ${
                  active
                    ? "bg-secondary-container text-on-secondary-container font-semibold shadow-sm"
                    : "text-on-primary-container hover:bg-primary/50 hover:text-on-primary"
                }`}
              >
                <div className="flex items-center gap-space-sm">
                  <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                  <span className="font-body-md text-[13.5px]">{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full font-label-sm text-[11px] font-bold ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-primary text-on-primary"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          {/* Administration Section */}
          <div className="px-space-md pt-space-md pb-space-xs">
            <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-primary-container font-semibold">
              Administration
            </span>
          </div>
          {adminItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center justify-between px-space-md py-2.5 rounded-lg transition-all ${
                  active
                    ? "bg-secondary-container text-on-secondary-container font-semibold shadow-sm"
                    : "text-on-primary-container hover:bg-primary/50 hover:text-on-primary"
                }`}
              >
                <div className="flex items-center gap-space-sm">
                  <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                  <span className="font-body-md text-[13.5px]">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Profile & Status */}
      <div className="p-space-md bg-primary flex flex-col gap-space-sm border-t border-surface-container-high/10">
        <div className="flex items-center justify-between px-space-sm py-1.5 rounded bg-primary-container/80">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-on-tertiary-container animate-pulse"></span>
            <span className="font-label-sm text-[11px] text-on-primary font-medium">Online</span>
          </div>
          <span className="font-body-sm text-[11px] text-on-primary-container font-mono">DB Active</span>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-space-sm">
            <div className="w-9 h-9 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-label-lg text-sm font-bold shadow-sm">
              AU
            </div>
            <div className="flex flex-col">
              <span className="font-label-md text-[13px] text-on-primary leading-none font-semibold">
                {userName}
              </span>
              <div className="mt-1">
                <span className="px-1.5 py-0.5 rounded bg-surface-container-high/20 text-on-primary-container font-label-sm text-[10px]">
                  {userRole}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-primary-container text-on-primary-container hover:text-error transition-colors"
            title="Sign Out"
            aria-label="Sign out"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
