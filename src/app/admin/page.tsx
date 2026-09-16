"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function AdminDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = async () => {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleSync = () => {
    setRefreshing(true);
    fetchDashboard();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="font-body-md text-sm text-on-surface-variant">Loading live school operations data...</p>
      </div>
    );
  }

  const stats = data?.stats || {
    totalStudents: 0,
    totalTeachers: 0,
    totalClasses: 0,
    attendancePercentage: 0.0,
    totalExpectedFee: 0,
    totalCollectedFee: 0,
    totalOutstandingFee: 0,
    collectionRate: 0.0,
  };

  const snapshots = data?.classWiseSnapshots || [];
  const auditLogs = data?.recentAuditLogs || [];
  const recentPayments = data?.recentPayments || [];

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Operational Hub Banner */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary-container to-primary p-space-lg text-on-primary shadow-sm">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-secondary/10 blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-secondary-container/40 text-secondary-fixed text-[11px] font-bold tracking-wide uppercase">
                Operational Hub
              </span>
              <span className="flex items-center gap-1.5 text-xs text-surface-dim font-medium">
                <span className="inline-block w-2 h-2 rounded-full bg-on-tertiary-container animate-pulse"></span>
                Live Production Database
              </span>
            </div>
            <h1 className="font-headline-lg text-2xl sm:text-3xl font-bold tracking-tight text-on-primary">
              Welcome back, Administrator
            </h1>
            <p className="font-body-md text-xs sm:text-sm text-on-primary-container italic font-medium">
              “Better Education, Brighter Future” — Allied School Management System
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-space-sm self-start md:self-auto">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-lowest/10 backdrop-blur-md shadow-inner text-on-primary text-xs font-semibold">
              <span className="material-symbols-outlined text-[18px] text-tertiary-fixed">event</span>
              <span>
                {data?.settings?.academicYear
                  ? `Session: ${data.settings.academicYear}`
                  : "Session not configured"}
              </span>
            </div>
            <button
              onClick={handleSync}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity disabled:opacity-50"
              type="button"
            >
              <span className={`material-symbols-outlined text-[18px] ${refreshing ? "animate-spin" : ""}`}>
                cached
              </span>
              <span>{refreshing ? "Syncing..." : "Sync Cloud"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 6 Key Performance Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Total Students */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/40">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
                Total Students
              </span>
              <span className="font-headline-xl text-2xl sm:text-3xl text-on-surface mt-1 font-bold leading-none">
                {stats.totalStudents}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-secondary">
              <span className="material-symbols-outlined text-[20px]">group</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-surface-container-low flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-on-tertiary-container bg-tertiary-container/10 px-1.5 py-0.5 rounded">
              Active Roster
            </span>
            <span className="text-on-surface-variant text-[11px] font-medium">{stats.totalStudents > 0 ? "Enrolled" : "No students yet"}</span>
          </div>
        </div>

        {/* Total Teachers */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/40">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
                Total Teachers
              </span>
              <span className="font-headline-xl text-2xl sm:text-3xl text-on-surface mt-1 font-bold leading-none">
                {stats.totalTeachers}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-primary-container">
              <span className="material-symbols-outlined text-[20px]">school</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-surface-container-low flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-on-surface bg-surface-container-high px-1.5 py-0.5 rounded">
              <span className="material-symbols-outlined text-[12px]">verified</span> Faculty
            </span>
            <span className="text-on-tertiary-container text-[11px] font-bold">{stats.totalTeachers > 0 ? `${stats.totalTeachers} Active` : "None added"}</span>
          </div>
        </div>

        {/* Total Classes */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/40">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
                Total Classes
              </span>
              <span className="font-headline-xl text-2xl sm:text-3xl text-on-surface mt-1 font-bold leading-none">
                {stats.totalClasses}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-secondary">
              <span className="material-symbols-outlined text-[20px]">menu_book</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-surface-container-low flex items-center justify-between text-xs">
            <span className="text-on-surface-variant text-[11px] font-medium">Class Cohorts</span>
            <span className="text-secondary text-[11px] font-semibold">{stats.totalClasses > 0 ? `${stats.totalClasses} Cohorts` : "None configured"}</span>
          </div>
        </div>

        {/* Fee Collected */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/40">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
                Fee Collected
              </span>
              <span className="font-headline-xl text-xl sm:text-2xl text-on-tertiary-container mt-1 font-bold leading-none">
                {formatCurrency(stats.totalCollectedFee)}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[20px]">paid</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-surface-container-low flex items-center justify-between text-xs">
            <span className="text-on-tertiary-container font-bold text-[11px]">{stats.collectionRate}% target</span>
            <span className="text-on-surface-variant text-[11px]">All terms</span>
          </div>
        </div>

        {/* Outstanding Fee */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/40">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
                Outstanding
              </span>
              <span className="font-headline-xl text-xl sm:text-2xl text-error mt-1 font-bold leading-none">
                {formatCurrency(stats.totalOutstandingFee)}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-error-container/40 flex items-center justify-center text-error">
              <span className="material-symbols-outlined text-[20px]">pending_actions</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-surface-container-low flex items-center justify-between text-xs">
            <span className="text-error font-bold text-[11px]">Unsettled</span>
            <Link href="/admin/fees" className="text-secondary text-[11px] font-semibold hover:underline">
              View Dues →
            </Link>
          </div>
        </div>

        {/* Attendance % */}
        <div className="flex flex-col justify-between p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow border border-surface-container-high/40">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
                Attendance
              </span>
              <span className="font-headline-xl text-2xl sm:text-3xl text-on-surface mt-1 font-bold leading-none">
                {stats.attendancePercentage > 0 ? `${stats.attendancePercentage}%` : "No data"}
              </span>
            </div>
            <div className="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-on-tertiary-container">
              <span className="material-symbols-outlined text-[20px]">event_available</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-surface-container-low flex items-center justify-between text-xs">
            {/* The figure is computed over a bounded recent window (see /api/dashboard), so it
                is labelled with that window rather than implying an all-time verified average. */}
            <span className="text-on-tertiary-container font-bold text-[11px]">
              {stats.attendancePercentage > 0
                ? `Last ${stats.attendanceWindowDays ?? 30} days`
                : "No logs"}
            </span>
            <span className="text-on-surface-variant text-[11px]">
              {stats.attendancePercentage > 0 ? "Present or late" : "Pending entry"}
            </span>
          </div>
        </div>
      </div>

      {/* Class-wise Collection Snapshot (Real DB calculations) */}
      <div className="flex flex-col bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-container-low">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-headline-md text-base sm:text-lg font-bold text-on-surface">
                Class-wise Collection Snapshot
              </h2>
              <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-[11px] font-bold text-secondary">
                Live Ledger
              </span>
            </div>
            <p className="font-body-sm text-xs text-on-surface-variant mt-0.5">
              Real-time calculations across active cohorts (Expected, Collected, Outstanding, Collection %)
            </p>
          </div>
          <Link
            href="/admin/fees"
            className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline self-start sm:self-auto"
          >
            <span>Manage Fee Challans</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                <th className="py-3 px-4 font-bold">Class Cohort</th>
                <th className="py-3 px-4 font-bold">Class Teacher</th>
                <th className="py-3 px-4 font-bold">Students</th>
                <th className="py-3 px-4 font-bold">Expected</th>
                <th className="py-3 px-4 font-bold">Collected</th>
                <th className="py-3 px-4 font-bold">Outstanding</th>
                <th className="py-3 px-4 font-bold">Collection %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {snapshots.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-on-surface-variant text-xs italic">
                    No class cohorts found. Add classes in Academic Setup to see ledger snapshots.
                  </td>
                </tr>
              )}
              {snapshots.slice(0, 8).map((snap: any) => (
                <tr key={snap.id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-on-surface flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-surface-container flex items-center justify-center text-xs text-secondary font-bold">
                      {snap.className.split(" ")[1]?.charAt(0) || "C"}
                    </span>
                    <span>{snap.className}</span>
                  </td>
                  <td className="py-3 px-4 text-on-surface-variant">{snap.classTeacherName}</td>
                  <td className="py-3 px-4 font-semibold text-on-surface">{snap.studentCount}</td>
                  <td className="py-3 px-4 font-medium text-on-surface">{formatCurrency(snap.expected)}</td>
                  <td className="py-3 px-4 font-bold text-on-tertiary-container">{formatCurrency(snap.collected)}</td>
                  <td className="py-3 px-4 font-semibold text-error">{formatCurrency(snap.outstanding)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 sm:w-24 bg-surface-container-high rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-secondary h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, snap.collectionPercentage)}%` }}
                        ></div>
                      </div>
                      <span className="font-bold text-xs text-on-surface">{snap.collectionPercentage}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Grid: Quick Actions, Recent Activities & Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Operations Hub */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col justify-between">
          <div>
            <h3 className="font-headline-md text-base font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[20px]">bolt</span>
              Quick Academic Actions
            </h3>
            <p className="font-body-sm text-xs text-on-surface-variant mt-1">
              Direct access to administrative and academic workflows.
            </p>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <Link
                href="/admin/students/new"
                className="p-3 rounded-lg bg-surface-container-low hover:bg-surface-container border border-surface-container-high flex flex-col items-center text-center transition-all group"
              >
                <span className="material-symbols-outlined text-secondary text-[24px] group-hover:scale-110 transition-transform">
                  person_add
                </span>
                <span className="font-label-md text-xs font-semibold text-on-surface mt-1">Add Student</span>
              </Link>

              <Link
                href="/admin/attendance"
                className="p-3 rounded-lg bg-surface-container-low hover:bg-surface-container border border-surface-container-high flex flex-col items-center text-center transition-all group"
              >
                <span className="material-symbols-outlined text-on-tertiary-container text-[24px] group-hover:scale-110 transition-transform">
                  how_to_reg
                </span>
                <span className="font-label-md text-xs font-semibold text-on-surface mt-1">Mark Attendance</span>
              </Link>

              <Link
                href="/admin/fees"
                className="p-3 rounded-lg bg-surface-container-low hover:bg-surface-container border border-surface-container-high flex flex-col items-center text-center transition-all group"
              >
                <span className="material-symbols-outlined text-secondary text-[24px] group-hover:scale-110 transition-transform">
                  receipt_long
                </span>
                <span className="font-label-md text-xs font-semibold text-on-surface mt-1">Collect Fee</span>
              </Link>

              <Link
                href="/admin/exams"
                className="p-3 rounded-lg bg-surface-container-low hover:bg-surface-container border border-surface-container-high flex flex-col items-center text-center transition-all group"
              >
                <span className="material-symbols-outlined text-primary text-[24px] group-hover:scale-110 transition-transform">
                  edit_note
                </span>
                <span className="font-label-md text-xs font-semibold text-on-surface mt-1">Enter Marks</span>
              </Link>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-surface-container-low border border-surface-container-high/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">verified</span>
              <span className="text-xs font-semibold text-on-surface">Institutional Reports</span>
            </div>
            <Link href="/admin/reports" className="text-xs font-bold text-secondary hover:underline">
              Generate →
            </Link>
          </div>
        </div>

        {/* Recent Audit Activities */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-headline-md text-base font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[20px]">history</span>
              Audit Trail Activity
            </h3>
            <Link href="/admin/audit" className="text-xs font-semibold text-secondary hover:underline">
              View All
            </Link>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-64">
            {auditLogs.length === 0 && (
              <p className="text-xs text-on-surface-variant italic text-center py-6">No administrative activities recorded yet.</p>
            )}
            {auditLogs.slice(0, 5).map((log: any) => (
              <div key={log.id} className="flex items-start gap-2.5 text-xs pb-2.5 border-b border-surface-container-low last:border-0">
                <div className="w-6 h-6 rounded-full bg-surface-container flex items-center justify-center shrink-0 text-secondary">
                  <span className="material-symbols-outlined text-[14px]">
                    {log.action.includes("CREATE") ? "add_circle" : log.action.includes("FEE") ? "payments" : "info"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-on-surface leading-tight truncate">{log.details}</p>
                  <div className="flex items-center gap-2 text-[10px] text-on-surface-variant mt-0.5">
                    <span className="font-semibold text-primary">{log.userName}</span>
                    <span>•</span>
                    <span>{formatDate(log.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Fee Transactions */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-headline-md text-base font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-on-tertiary-container text-[20px]">receipt</span>
              Recent Fee Receipts
            </h3>
            <Link href="/admin/fees" className="text-xs font-semibold text-secondary hover:underline">
              Ledger
            </Link>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-64">
            {recentPayments.length === 0 && (
              <p className="text-xs text-on-surface-variant italic text-center py-6">No fee payments recorded yet.</p>
            )}
            {recentPayments.slice(0, 5).map((pay: any) => (
              <div key={pay.id} className="flex items-center justify-between text-xs pb-2.5 border-b border-surface-container-low last:border-0">
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-on-surface truncate">
                    {pay.studentName || pay.studentId || "Student"}
                  </span>
                  <span className="text-[10px] text-on-surface-variant font-mono">
                    {pay.receiptNo || pay.id}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-on-tertiary-container">{formatCurrency(pay.amount)}</span>
                  <span className="text-[10px] text-on-surface-variant">{formatDate(pay.paymentDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
