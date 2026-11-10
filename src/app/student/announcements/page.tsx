import React from "react";
import AnnouncementFeed from "@/components/AnnouncementFeed";

export default function StudentAnnouncementsPage() {
  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Announcements</h1>
        <p className="text-xs text-on-surface-variant mt-0.5">Notices published for students or for everyone.</p>
      </div>
      <AnnouncementFeed emptyLabel="No student or school-wide announcements have been published." />
    </div>
  );
}
