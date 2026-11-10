import React from "react";
import AnnouncementFeed from "@/components/AnnouncementFeed";

export default function ParentAnnouncementsPage() {
  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Announcements</h1>
        <p className="text-xs text-on-surface-variant mt-0.5">
          School notices published for parents or for everyone. Browser, email, and push notifications are not enabled in this phase.
        </p>
      </div>
      <AnnouncementFeed emptyLabel="No parent or school-wide announcements have been published." />
    </div>
  );
}
