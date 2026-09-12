"use client";

import React, { useState } from "react";
import Link from "next/link";

export default function TeacherSchedulePage() {
  const [selectedDay, setSelectedDay] = useState("Today");

  const timetable = [
    {
      period: "Period 1",
      time: "08:00 AM - 08:45 AM",
      subject: "Mathematics",
      class: "Class 5-A",
      room: "Room 105",
      status: "COMPLETED",
      topic: "Fractions & Decimal Conversion",
    },
    {
      period: "Period 2",
      time: "08:50 AM - 09:35 AM",
      subject: "General Science",
      class: "Class 5-B",
      room: "Science Lab 1",
      status: "COMPLETED",
      topic: "Plant Cell Structure & Photosynthesis",
    },
    {
      period: "Period 3",
      time: "09:40 AM - 10:25 AM",
      subject: "Mathematics",
      class: "Class 6-A",
      room: "Room 107",
      status: "ACTIVE",
      topic: "Algebraic Expressions & Linear Equations",
    },
    {
      period: "Period 4",
      time: "10:55 AM - 11:40 AM",
      subject: "General Science",
      class: "Class 6-B",
      room: "Room 108",
      status: "UPCOMING",
      topic: "Energy Transformation & Heat",
    },
    {
      period: "Period 5",
      time: "11:45 AM - 12:30 PM",
      subject: "Mathematics Remedial",
      class: "Class 5-A (Selected Group)",
      room: "Room 105",
      status: "UPCOMING",
      topic: "Geometry Practice & Angle Measurement",
    },
  ];

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Banner */}
      <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">
              Daily Class Schedule & Timetable
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Term 1
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            View allocated periods, designated classrooms, lesson topics, and quick action registers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/teacher/attendance"
            className="px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
            <span>Roll Call Register</span>
          </Link>
          <Link
            href="/teacher/gradebook"
            className="px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">edit_note</span>
            <span>Rapid Gradebook</span>
          </Link>
        </div>
      </div>

      {/* Timetable Cards */}
      <div className="space-y-3">
        {timetable.map((t, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-xl bg-surface-container-lowest shadow-sm border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              t.status === "ACTIVE"
                ? "border-secondary ring-1 ring-secondary/20 shadow-md"
                : "border-surface-container-high/40"
            }`}
          >
            <div className="flex items-start sm:items-center gap-3.5">
              <div
                className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center font-bold shrink-0 ${
                  t.status === "ACTIVE"
                    ? "bg-secondary text-white"
                    : t.status === "COMPLETED"
                    ? "bg-tertiary-container/10 text-on-tertiary-container"
                    : "bg-surface-container text-on-surface-variant"
                }`}
              >
                <span className="text-xs font-mono">{t.period.split(" ")[1]}</span>
                <span className="text-[9px] uppercase font-semibold">Period</span>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-on-surface">{t.subject}</h3>
                  <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-primary">
                    {t.class}
                  </span>
                  <span className="text-[11px] text-on-surface-variant font-mono">({t.room})</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5 font-medium">
                  Topic: <span className="text-on-surface font-semibold">{t.topic}</span>
                </p>
                <span className="text-[10px] text-on-surface-variant font-mono block sm:inline mt-1 sm:mt-0">
                  {t.time}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                  t.status === "ACTIVE"
                    ? "bg-secondary/10 text-secondary animate-pulse"
                    : t.status === "COMPLETED"
                    ? "bg-tertiary-container/10 text-on-tertiary-container"
                    : "bg-surface-container text-on-surface-variant"
                }`}
              >
                {t.status}
              </span>

              <Link
                href="/teacher/attendance"
                className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-xs flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                <span>Roll Call</span>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
