"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// The "Portals" dropdown that used to live in this header (commented in-source as a
// "Role / Portal Switcher for rapid demo testing") linked an ADMIN session to /teacher and
// /student. Those are dead links for an admin: src/middleware.ts serves each portal only to
// its own role and redirects everyone else straight back to their own dashboard, so the menu
// could never do anything except bounce. Removed as leftover demo scaffolding.

interface AdminHeaderProps {
  sessionName?: string;
  title?: string;
  onMenuClick?: () => void;
}

export default function AdminHeader({
  sessionName = "Session data unavailable",
  title,
  onMenuClick,
}: AdminHeaderProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/admin/students?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="fixed top-0 left-0 md:left-64 right-0 h-16 bg-surface-container-lowest z-40 shadow-[0_1px_8px_rgba(0,0,0,0.04)] border-b border-surface-container-low no-print">
      <div className="w-full h-full px-space-md sm:px-space-lg flex items-center justify-between gap-space-sm sm:gap-space-md">
        {/* Mobile menu toggle — the sidebar is off-canvas below the md breakpoint */}
        <button
          type="button"
          onClick={onMenuClick}
          className="md:hidden p-2 -ml-1 rounded-lg text-on-surface hover:bg-surface-container transition-colors shrink-0"
          aria-label="Open navigation menu"
        >
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="hidden sm:flex items-center gap-space-md flex-1 max-w-xl">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
              search
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search students"
              placeholder="Search student, teacher, invoice, record..."
              className="w-full h-9 pl-9 pr-14 rounded-lg bg-surface-container-low font-body-md text-[13.5px] text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 transition-all border border-transparent focus:border-outline-variant/50"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-[11px] text-on-surface-variant font-medium">
              ↵ Enter
            </span>
          </div>
        </form>

        {/* Action Elements */}
        <div className="flex items-center gap-1 sm:gap-space-md">
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
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all"
            aria-label="Add Student"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span className="hidden sm:inline">Add Student</span>
          </Link>

          <div className="h-6 w-px bg-outline-variant/40 hidden sm:block"></div>

          {/* Notifications — links to the real audit trail. No fabricated unread count is
              shown here since audit log entries have no "read/unseen" tracking in the schema. */}
          <Link
            href="/admin/audit"
            className="relative p-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            title="System Audit Log"
            aria-label="View system audit log"
          >
            <span className="material-symbols-outlined text-[22px]">notifications</span>
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
