import React from "react";
import TeacherObservationsPanel from "@/components/TeacherObservationsPanel";

export default function TeacherObservationsPage() {
  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">My Observations</h1>
        <p className="text-xs text-on-surface-variant mt-0.5">Feedback written about you by school administration.</p>
      </div>
      <TeacherObservationsPanel mode="teacher" />
    </div>
  );
}
