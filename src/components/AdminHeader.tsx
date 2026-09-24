"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// The "Portals" dropdown that used to live in this header (commented in-source as a
// "Role / Portal Switcher for rapid demo testing") linked an ADMIN session to /teacher and
// /student. Those are dead links for an admin: src/middleware.ts serves each portal only to
// its own role and redirects everyone else straight back to their own dashboard, so the menu
// could never do anything except bounce. Removed as leftover demo scaffolding.

function parseSessionString(raw: string) {
  let year = "2026-2027";
  let campus = "Main Campus";

  if (!raw) return { year, campus };

  const parts = raw.split("|");
  if (parts.length > 1) {
    campus = parts[1].trim();
  }
  const yearMatch = parts[0].match(/\d{4}-\d{4}/);
  if (yearMatch) {
    year = yearMatch[0];
  } else {
    const cleaned = parts[0].replace(/session/i, "").trim();
    if (cleaned) year = cleaned;
  }
  return { year, campus };
}

interface AdminHeaderProps {
  sessionName?: string;
  title?: string;
  onMenuClick?: () => void;
}

const STORAGE_KEY = "admin_active_session";

export default function AdminHeader({
  sessionName = "Session 2026-2027 | Main Campus",
  title,
  onMenuClick,
}: AdminHeaderProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  // Interactive Academic Session state
  const [displaySession, setDisplaySession] = useState(sessionName);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [sessionInput, setSessionInput] = useState("2026-2027");
  const [campusInput, setCampusInput] = useState("Main Campus");
  const [selectedPreset, setSelectedPreset] = useState("2026-2027");
  const [isSaving, setIsSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Initialize from localStorage or props
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setDisplaySession(stored);
        const parsed = parseSessionString(stored);
        setSessionInput(parsed.year);
        setCampusInput(parsed.campus);
        setSelectedPreset(parsed.year);
      } else if (sessionName) {
        setDisplaySession(sessionName);
        const parsed = parseSessionString(sessionName);
        setSessionInput(parsed.year);
        setCampusInput(parsed.campus);
        setSelectedPreset(parsed.year);
      }
    } catch {
      setDisplaySession(sessionName);
    }
  }, [sessionName]);

  // Sync across tabs and listen for session updates
  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ session?: string }>;
      if (customEvent.detail?.session) {
        setDisplaySession(customEvent.detail.session);
      }
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setDisplaySession(e.newValue);
      }
    };
    window.addEventListener("academic-session-changed", handleCustomChange);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("academic-session-changed", handleCustomChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  // Close on outside click and Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsSessionOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSessionOpen(false);
      }
    };
    if (isSessionOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSessionOpen]);

  const toggleSessionOpen = () => {
    if (!isSessionOpen) {
      const parsed = parseSessionString(displaySession);
      setSessionInput(parsed.year);
      setCampusInput(parsed.campus);
      const standardPresets = ["2024-2025", "2025-2026", "2026-2027", "2027-2028", "2028-2029", "2029-2030"];
      if (standardPresets.includes(parsed.year)) {
        setSelectedPreset(parsed.year);
      } else {
        setSelectedPreset("CUSTOM");
      }
    }
    setIsSessionOpen((prev) => !prev);
  };

  const handleSaveSession = async () => {
    const year = sessionInput.trim() || "2026-2027";
    const campus = campusInput.trim() || "Main Campus";
    const formatted = `Session ${year} | ${campus}`;

    setIsSaving(true);
    setDisplaySession(formatted);

    try {
      localStorage.setItem(STORAGE_KEY, formatted);
      localStorage.setItem("admin_academic_year", year);
      localStorage.setItem("academicSession", year);
      window.dispatchEvent(
        new CustomEvent("academic-session-changed", {
          detail: { session: formatted, year, campus },
        })
      );
    } catch (err) {
      console.error("Failed to write session to localStorage:", err);
    }

    if (/^\d{4}-\d{4}$/.test(year)) {
      try {
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ academicYear: year, campusName: campus }),
        });
        router.refresh();
      } catch (err) {
        console.warn("Could not sync session to server settings:", err);
      }
    }

    setIsSaving(false);
    setIsSessionOpen(false);
  };

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
          {/* Academic Session Interactive Component */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={toggleSessionOpen}
              className={`flex items-center gap-space-xs px-3 py-1.5 rounded-lg font-label-md text-xs font-semibold transition-all cursor-pointer shadow-sm border ${
                isSessionOpen
                  ? "bg-secondary-container/40 text-secondary border-secondary/40 ring-2 ring-secondary/20"
                  : "bg-surface-container text-on-surface hover:bg-surface-container-high border-surface-container-high hover:border-secondary/30"
              }`}
              title="Click to change or edit academic session"
              aria-label="Academic Session selector"
              aria-expanded={isSessionOpen}
            >
              <span className="material-symbols-outlined text-[18px] text-secondary">
                calendar_today
              </span>
              <span className="truncate max-w-[170px] sm:max-w-[240px] md:max-w-none">
                {displaySession}
              </span>
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant transition-transform duration-150">
                {isSessionOpen ? "expand_less" : "expand_more"}
              </span>
            </button>

            {isSessionOpen && (
              <div
                role="dialog"
                aria-label="Edit Academic Session"
                className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl bg-surface-container-lowest border border-outline-variant/40 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-surface-container">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px] text-secondary">
                      edit_calendar
                    </span>
                    <div>
                      <h4 className="font-title-sm text-sm font-bold text-on-surface">Academic Session</h4>
                      <p className="text-[11px] text-on-surface-variant">Switch or edit active session</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSessionOpen(false)}
                    className="p-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                    aria-label="Close session menu"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {/* Select Dropdown */}
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                      Select Session
                    </label>
                    <select
                      value={selectedPreset}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedPreset(val);
                        if (val !== "CUSTOM") {
                          setSessionInput(val);
                        }
                      }}
                      className="w-full h-9 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 text-on-surface text-xs font-medium focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary transition-all"
                    >
                      <option value="2024-2025">2024-2025</option>
                      <option value="2025-2026">2025-2026</option>
                      <option value="2026-2027">2026-2027</option>
                      <option value="2027-2028">2027-2028</option>
                      <option value="2028-2029">2028-2029</option>
                      <option value="2029-2030">2029-2030</option>
                      <option value="CUSTOM">Custom Session...</option>
                    </select>
                  </div>

                  {/* Input field for Custom or manual edit */}
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                      Academic Year / Session Name
                    </label>
                    <input
                      type="text"
                      value={sessionInput}
                      onChange={(e) => {
                        setSessionInput(e.target.value);
                        setSelectedPreset("CUSTOM");
                      }}
                      placeholder="e.g. 2026-2027"
                      className="w-full h-9 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 text-on-surface text-xs font-medium focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary transition-all"
                    />
                  </div>

                  {/* Campus Input */}
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                      Campus
                    </label>
                    <input
                      type="text"
                      value={campusInput}
                      onChange={(e) => setCampusInput(e.target.value)}
                      placeholder="e.g. Main Campus"
                      className="w-full h-9 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 text-on-surface text-xs font-medium focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary transition-all"
                    />
                  </div>

                  {/* Live Preview */}
                  <div className="p-2.5 rounded-lg bg-surface-container/60 border border-surface-container-high">
                    <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider block mb-1">
                      Header Preview:
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-secondary">
                      <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                      <span>
                        Session {sessionInput.trim() || "2026-2027"} | {campusInput.trim() || "Main Campus"}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container">
                    <button
                      type="button"
                      onClick={() => setIsSessionOpen(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSession}
                      disabled={isSaving || !sessionInput.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isSaving ? "sync" : "check"}
                      </span>
                      <span>{isSaving ? "Saving..." : "Save Session"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
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
