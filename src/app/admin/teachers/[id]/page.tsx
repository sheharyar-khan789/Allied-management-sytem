"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export default function TeacherProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [teacher, setTeacher] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/teachers/${id}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setTeacher(json.teacher);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading teacher profile...</p>
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-error">Faculty profile not found</p>
        <Link href="/admin/teachers" className="text-xs text-secondary hover:underline">
          ← Back to Teachers Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Teacher Profile Banner */}
      <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-primary text-white flex items-center justify-center font-headline-lg text-2xl font-bold shadow-md">
            {teacher.firstName.charAt(0)}
            {teacher.lastName.charAt(0)}
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
                {teacher.firstName} {teacher.lastName}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold font-mono">
                {teacher.employeeId}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-tertiary-container/10 text-on-tertiary-container font-label-sm text-xs font-bold">
                {teacher.status}
              </span>
            </div>
            <p className="font-body-md text-xs text-on-surface-variant font-medium">
              {teacher.designation} • {teacher.qualification} • {teacher.phone} • {teacher.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/teacher"
            className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm flex items-center gap-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">launch</span>
            <span>Teacher Portal View</span>
          </Link>
        </div>
      </div>

      {/* Grid: Details & Workload */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Taught Subjects & Classes */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">menu_book</span>
              Assigned Subjects & Classes
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container text-xs font-bold text-secondary">
              {teacher.taughtSubjects?.length || 0} Allocations
            </span>
          </div>

          <div className="space-y-2">
            {teacher.taughtSubjects?.map((sub: any) => (
              <div
                key={sub.id}
                className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-on-surface">{sub.name}</div>
                  <div className="text-[10px] text-on-surface-variant font-mono">Code: {sub.code}</div>
                </div>
                <span className="px-2 py-1 rounded bg-surface-container font-semibold text-primary">
                  {sub.class?.name}-{sub.class?.section}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Observations Authored */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">psychology</span>
              Student Observations Authored
            </h3>
            <span className="text-xs text-on-surface-variant">{teacher.observations?.length || 0} Logged</span>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto">
            {teacher.observations?.map((obs: any) => (
              <div
                key={obs.id}
                className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-secondary">
                    {obs.student?.firstName} {obs.student?.lastName} ({obs.student?.class?.name})
                  </span>
                  <span className="text-[10px] text-on-surface-variant">{formatDate(obs.date)}</span>
                </div>
                <p className="font-semibold text-on-surface">{obs.title}</p>
                <p className="text-on-surface-variant text-[11px] leading-relaxed">{obs.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
