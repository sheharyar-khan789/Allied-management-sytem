"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function StudentDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/student/me")
      .then((res) => res.json())
      .then((d) => {
        if (d?.success) setData(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading student portal...</p>
      </div>
    );
  }

  const student = data?.student;

  if (!student) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8 bg-surface-container-lowest rounded-xl border border-surface-container-high/40">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">person_off</span>
        <h2 className="text-lg font-bold text-on-surface">No Student Profile Linked</h2>
        <p className="text-xs text-on-surface-variant mt-1 max-w-sm">
          Your account is not currently linked to an active student record. Please contact the campus administrator.
        </p>
      </div>
    );
  }

  const stats = data?.stats || {
    attendance: { percentage: 0, present: 0, absent: 0 },
    fees: { expected: 0, paid: 0, outstanding: 0 },
    academics: { percentage: 0, gpa: 0, totalMarks: 0, obtainedMarks: 0 },
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Student Welcome Banner */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary-container to-primary p-space-lg text-on-primary shadow-sm">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-secondary/10 blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-secondary-container/40 text-secondary-fixed text-[11px] font-bold tracking-wide uppercase">
                Student Portal
              </span>
              <span className="text-xs text-surface-dim font-medium">
                {student?.class?.name ? `${student.class.name}${student.class.section ? `-${student.class.section}` : ""}` : "Student"} • Roll #{student?.rollNumber || "N/A"}
              </span>
            </div>
            <h1 className="font-headline-lg text-2xl sm:text-3xl font-bold tracking-tight text-on-primary">
              Welcome back, {student?.firstName || "Student"} {student?.lastName || ""}
            </h1>
            <p className="font-body-md text-xs sm:text-sm text-on-primary-container italic font-medium">
              “Knowledge is light” — Allied School Academic Journey
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/student/results"
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm flex items-center gap-1.5 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">workspace_premium</span>
              <span>View Report Card</span>
            </Link>
          </div>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Attendance */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Attendance
            </span>
            <div className="text-2xl font-bold text-on-tertiary-container mt-1">
              {stats.attendance.percentage}%
            </div>
            <span className="text-[10px] text-on-surface-variant">Regular On Campus</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-tertiary-container/10 text-on-tertiary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">event_available</span>
          </div>
        </div>

        {/* Academic GPA */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Term GPA
            </span>
            <div className="text-2xl font-bold text-secondary mt-1">
              {typeof stats.academics.gpa === "number" ? stats.academics.gpa.toFixed(2) : "0.00"}
            </div>
            <span className="text-[10px] text-secondary font-semibold">
              {stats.academics.gpa > 0 ? "Cumulative Average" : "No Grades Posted"}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">grade</span>
          </div>
        </div>

        {/* Fee Standing */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Fee Standing
            </span>
            <div className="text-2xl font-bold text-on-surface mt-1">
              {stats.fees.outstanding === 0 ? "Clear" : formatCurrency(stats.fees.outstanding)}
            </div>
            <span className="text-[10px] text-on-tertiary-container font-semibold">
              {stats.fees.outstanding === 0 ? "All Dues Cleared" : "Pending Payment"}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-surface-container text-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">payments</span>
          </div>
        </div>

        {/* Class Rank / Enrolled Class */}
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Cohort Standing
            </span>
            <div className="text-2xl font-bold text-primary mt-1">
              {student?.class?.name ? `${student.class.name} ${student.class.section || ""}`.trim() : "Enrolled"}
            </div>
            <span className="text-[10px] text-on-surface-variant">Class Standing</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">military_tech</span>
          </div>
        </div>
      </div>

      {/* 2 Column Details: Recent Exam Grades & Recent Observations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent Exam Scores */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[18px]">workspace_premium</span>
                Mid-Term Exam Evaluation
              </h3>
              <Link href="/student/results" className="text-xs font-semibold text-secondary hover:underline">
                Full Report Card →
              </Link>
            </div>

            <div className="space-y-2.5 mt-3">
              {(!student?.examResults || student.examResults.length === 0) ? (
                <div className="text-center py-6 text-on-surface-variant text-xs">
                  No exam results published yet.
                </div>
              ) : (
                student.examResults.slice(0, 4).map((r: any) => (
                  <div
                    key={r.id}
                    className="p-2.5 rounded-lg bg-surface-container-low/60 border border-surface-container-high/30 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-on-surface">{r.examSchedule?.subject?.name}</span>
                      <span className="text-[10px] text-on-surface-variant block font-mono">
                        Code: {r.examSchedule?.subject?.code}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface">
                        {r.marksObtained} / {r.maxMarks}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-tertiary-container/10 text-on-tertiary-container font-bold text-[11px]">
                        {r.grade}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Teacher Commendations */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[18px]">psychology</span>
                Teacher Commendations & Notes
              </h3>
            </div>

            <div className="space-y-2.5 mt-3">
              {(!student?.observations || student.observations.length === 0) ? (
                <div className="text-center py-6 text-on-surface-variant text-xs">
                  No observations or commendations recorded yet.
                </div>
              ) : (
                student.observations.slice(0, 2).map((obs: any) => (
                  <div
                    key={obs.id}
                    className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/30 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-secondary">{obs.title}</span>
                      <span className="text-[10px] text-on-surface-variant">{formatDate(obs.date)}</span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">{obs.content}</p>
                    <span className="text-[10px] text-on-surface-variant italic block pt-1">
                      — {obs.teacher?.firstName} {obs.teacher?.lastName}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
