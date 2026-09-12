"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AdminHeaderProps {
  sessionName?: string;
  title?: string;
}

export default function AdminHeader({
  sessionName = "Session 2024-2025 | Term 1",
  title,
}: AdminHeaderProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [showPortalSwitch, setShowPortalSwitch] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/admin/students?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="fixed top-0 left-64 right-0 h-16 bg-surface-container-lowest z-40 shadow-[0_1px_8px_rgba(0,0,0,0.04)] border-b border-surface-container-low no-print">
      <div className="w-full h-full px-space-lg flex items-center justify-between gap-space-md">
        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex items-center gap-space-md flex-1 max-w-xl">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
              search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search student, teacher, invoice, record..."
              className="w-full h-9 pl-9 pr-14 rounded-lg bg-surface-container-low font-body-md text-[13.5px] text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 transition-all border border-transparent focus:border-outline-variant/50"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-[11px] text-on-surface-variant font-medium">
              ↵ Enter
            </span>
          </div>
        </form>

        {/* Action Elements */}
        <div className="flex items-center gap-space-md">
          {/* Academic Session Badge */}
          <div className="hidden xl:flex items-center gap-space-xs px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-label-md text-xs font-semibold">
            <span className="material-symbols-outlined text-[18px] text-secondary">
              calendar_today
            </span>
            <span>{sessionName}</span>
          </div>

          {/* Quick Create Dropdown / Link */}
          <Link
            href="/admin/students/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Add Student</span>
          </Link>

          <div className="h-6 w-px bg-outline-variant/40 hidden sm:block"></div>

          {/* Role / Portal Switcher for rapid demo testing */}
          <div className="relative">
            <button
              onClick={() => setShowPortalSwitch(!showPortalSwitch)}
              className="px-2.5 py-1 rounded-lg bg-surface-container-high text-on-surface font-label-sm text-[11px] font-semibold hover:bg-surface-container transition-all flex items-center gap-1"
              title="Switch Portals"
            >
              <span className="material-symbols-outlined text-[16px] text-secondary">swap_horiz</span>
              <span className="hidden md:inline">Portals</span>
            </button>

            {showPortalSwitch && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-surface-container-high py-1 z-50 text-xs">
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-on-surface-variant border-b border-surface-container-low">
                  Portal Switcher
                </div>
                <Link
                  href="/admin"
                  onClick={() => setShowPortalSwitch(false)}
                  className="block px-3 py-2 text-on-surface hover:bg-surface-container-low flex items-center gap-2 font-medium"
                >
                  <span className="material-symbols-outlined text-sm text-secondary">shield_person</span>
                  Admin Dashboard
                </Link>
                <Link
                  href="/teacher"
                  onClick={() => setShowPortalSwitch(false)}
                  className="block px-3 py-2 text-on-surface hover:bg-surface-container-low flex items-center gap-2 font-medium"
                >
                  <span className="material-symbols-outlined text-sm text-primary">school</span>
                  Teacher Portal
                </Link>
                <Link
                  href="/student"
                  onClick={() => setShowPortalSwitch(false)}
                  className="block px-3 py-2 text-on-surface hover:bg-surface-container-low flex items-center gap-2 font-medium"
                >
                  <span className="material-symbols-outlined text-sm text-on-tertiary-container">person</span>
                  Student Portal
                </Link>
              </div>
            )}
          </div>

          {/* Notifications */}
          <Link
            href="/admin/audit"
            className="relative p-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            title="System Audit Notifications"
          >
            <span className="material-symbols-outlined text-[22px]">notifications</span>
            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-error text-on-error font-label-sm text-[10px] flex items-center justify-center font-bold">
              3
            </span>
          </Link>

          {/* User Avatar */}
          <div className="flex items-center gap-space-sm pl-1">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-inner">
                <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-on-tertiary-container ring-2 ring-surface-container-lowest"></span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
