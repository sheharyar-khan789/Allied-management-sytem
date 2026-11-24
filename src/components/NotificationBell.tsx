"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface NotificationItem {
  id: string;
  type: "OBSERVATION" | "ANNOUNCEMENT" | "LESSON_PLAN_OPEN" | "LESSON_PLAN_DEADLINE_SOON" | "LESSON_PLAN_CLOSED";
  title: string;
  message: string;
  referenceId: string;
  read: boolean;
  createdAt: string;
}

const DESTINATION: Record<NotificationItem["type"], string> = {
  OBSERVATION: "/teacher/observations",
  ANNOUNCEMENT: "/teacher/announcements",
  LESSON_PLAN_OPEN: "/teacher/lesson-plans",
  LESSON_PLAN_DEADLINE_SOON: "/teacher/lesson-plans",
  LESSON_PLAN_CLOSED: "/teacher/lesson-plans",
};

const ICON: Record<NotificationItem["type"], string> = {
  OBSERVATION: "fact_check",
  ANNOUNCEMENT: "campaign",
  LESSON_PLAN_OPEN: "edit_calendar",
  LESSON_PLAN_DEADLINE_SOON: "alarm",
  LESSON_PLAN_CLOSED: "event_busy",
};

/** Unread-count bell + dropdown list for a teacher's in-app notifications. Polls every 60s —
 *  simple and reliable, no extra realtime infrastructure needed for this volume of events. */
export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      if (data.success) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Best-effort — the bell simply shows stale counts until the next poll.
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const handleOpenNotification = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      fetch(`/api/notifications/${n.id}`, { method: "PATCH" }).catch(() => undefined);
    }
    router.push(DESTINATION[n.type]);
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications", { method: "PATCH" });
    } catch {
      load();
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant transition-colors"
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg bg-surface-container-lowest border border-surface-container-low shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-surface-container-low">
            <span className="text-xs font-bold text-on-surface">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={handleMarkAllRead} className="text-[11px] font-semibold text-secondary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-on-surface-variant">No notifications yet.</p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleOpenNotification(n)}
                    className={`w-full text-left px-3 py-2.5 border-b border-surface-container-low hover:bg-surface-container transition-colors flex gap-2 items-start ${
                      n.read ? "" : "bg-secondary-container/20"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px] text-secondary mt-0.5">{ICON[n.type]}</span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-xs ${n.read ? "font-medium text-on-surface-variant" : "font-bold text-on-surface"}`}>
                        {n.title}
                      </span>
                      <span className="block text-[11px] text-on-surface-variant line-clamp-2">{n.message}</span>
                    </span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-secondary mt-1 shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
