"use client";

import React, { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

export default function ReportsAnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reportTab, setReportTab] = useState<"attendance" | "fees" | "academics">("attendance");

  useEffect(() => {
    fetch("/api/reports")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setData(json);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Generating institutional reports...</p>
      </div>
    );
  }

  const summary = data?.summary || {};
  const attendanceByClass = data?.attendanceByClass || [];
  const feeByClass = data?.feeByClass || [];
  const gradeDistribution = data?.gradeDistribution || {};

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Reports & Academic Analytics Center
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              Institutional Reports
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Consolidated school performance, class-wise attendance rates, fee collection metrics, and grade trends.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          <span>Print Official Report</span>
        </button>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Overall Pass Rate
          </span>
          <div className="text-2xl font-bold text-on-tertiary-container mt-1">{summary.passPercentage}%</div>
          <span className="text-[10px] text-on-surface-variant">Examinations evaluated</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Student Body
          </span>
          <div className="text-2xl font-bold text-on-surface mt-1">{summary.totalStudents}</div>
          <span className="text-[10px] text-on-surface-variant">
            {summary.femaleStudents} Female • {summary.maleStudents} Male
          </span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Academic Cohorts
          </span>
          <div className="text-2xl font-bold text-secondary mt-1">{summary.totalClasses || 0}</div>
          <span className="text-[10px] text-on-surface-variant">{summary.totalClasses > 0 ? `${summary.totalClasses} Active Cohorts` : "No classes added"}</span>
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Faculty Strength
          </span>
          <div className="text-2xl font-bold text-on-surface mt-1">{summary.totalTeachers || 0}</div>
          <span className="text-[10px] text-on-surface-variant">{summary.totalTeachers > 0 ? "Active Faculty" : "No teachers added"}</span>
        </div>
      </div>

      {/* Report Switcher Tabs */}
      <div className="border-b border-surface-container-high/60 flex space-x-2 sm:space-x-4 overflow-x-auto no-print">
        <button
          onClick={() => setReportTab("attendance")}
          className={`flex items-center gap-1.5 py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
            reportTab === "attendance"
              ? "border-secondary text-secondary font-bold"
              : "border-transparent text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">event_available</span>
          <span>Attendance Analytics</span>
        </button>

        <button
          onClick={() => setReportTab("fees")}
          className={`flex items-center gap-1.5 py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
            reportTab === "fees"
              ? "border-secondary text-secondary font-bold"
              : "border-transparent text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">payments</span>
          <span>Financial Collection</span>
        </button>

        <button
          onClick={() => setReportTab("academics")}
          className={`flex items-center gap-1.5 py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 transition-all ${
            reportTab === "academics"
              ? "border-secondary text-secondary font-bold"
              : "border-transparent text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">grade</span>
          <span>Grade Distributions</span>
        </button>
      </div>

      {/* Attendance Analytics Table */}
      {reportTab === "attendance" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
          <div className="p-4 border-b border-surface-container-low flex items-center justify-between">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Class-wise Attendance Rates</h3>
            {/* Reflects the bounded window actually queried in /api/reports, not all time. */}
            <span className="text-xs text-on-surface-variant">
              Last {data?.attendanceWindowDays ?? 30} days
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold">Cohort</th>
                  <th className="py-3 px-4 font-bold">Students</th>
                  <th className="py-3 px-4 font-bold">Attendance %</th>
                  <th className="py-3 px-4 font-bold">Present Count</th>
                  <th className="py-3 px-4 font-bold">Late</th>
                  <th className="py-3 px-4 font-bold">Leave</th>
                  <th className="py-3 px-4 font-bold">Absent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {attendanceByClass.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-on-surface-variant text-xs italic">
                      No class attendance records available. Mark attendance to generate reports.
                    </td>
                  </tr>
                )}
                {attendanceByClass.map((c: any) => (
                  <tr key={c.classId} className="hover:bg-surface-container-low/40">
                    <td className="py-3 px-4 font-bold text-on-surface">{c.className}</td>
                    <td className="py-3 px-4 font-semibold">{c.studentCount}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-surface-container-high rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-secondary h-full rounded-full"
                            style={{ width: `${Math.min(100, c.attendanceRate)}%` }}
                          ></div>
                        </div>
                        <span className="font-bold text-on-surface">{c.attendanceRate}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-on-tertiary-container">{c.present}</td>
                    <td className="py-3 px-4 text-amber-700">{c.late}</td>
                    <td className="py-3 px-4 text-secondary">{c.leave}</td>
                    <td className="py-3 px-4 font-bold text-error">{c.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fee Collection Table */}
      {reportTab === "fees" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
          <div className="p-4 border-b border-surface-container-low flex items-center justify-between">
            <h3 className="font-headline-md text-sm font-bold text-on-surface">Class-wise Revenue & Collection</h3>
            <span className="text-xs text-on-surface-variant">Current Academic Session</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold">Cohort</th>
                  <th className="py-3 px-4 font-bold">Enrolled</th>
                  <th className="py-3 px-4 font-bold">Total Expected</th>
                  <th className="py-3 px-4 font-bold">Total Collected</th>
                  <th className="py-3 px-4 font-bold">Outstanding</th>
                  <th className="py-3 px-4 font-bold">Collection %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {feeByClass.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-on-surface-variant text-xs italic">
                      No fee records found for the current academic session.
                    </td>
                  </tr>
                )}
                {feeByClass.map((f: any) => (
                  <tr key={f.classId} className="hover:bg-surface-container-low/40">
                    <td className="py-3 px-4 font-bold text-on-surface">{f.className}</td>
                    <td className="py-3 px-4 font-semibold">{f.studentCount}</td>
                    <td className="py-3 px-4 font-medium">{formatCurrency(f.expected)}</td>
                    <td className="py-3 px-4 font-bold text-on-tertiary-container">{formatCurrency(f.collected)}</td>
                    <td className="py-3 px-4 font-semibold text-error">{formatCurrency(f.outstanding)}</td>
                    <td className="py-3 px-4 font-bold text-secondary">{f.collectionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grade Distribution */}
      {reportTab === "academics" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          {Object.entries(gradeDistribution).map(([grade, count]: [string, any]) => (
            <div
              key={grade}
              className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 text-center space-y-1"
            >
              <span className="text-2xl font-bold text-secondary">{grade}</span>
              <div className="text-xl font-bold text-on-surface">{count}</div>
              <span className="text-[10px] text-on-surface-variant font-medium">Results Awarded</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
