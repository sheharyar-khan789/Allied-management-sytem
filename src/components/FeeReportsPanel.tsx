"use client";

import React, { useState } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const thisYear = new Date().getFullYear();
const YEAR_OPTIONS = [thisYear - 1, thisYear, thisYear + 1].map((y) => `${y}-${y + 1}`);

interface ClassOption {
  id: string;
  name: string;
  section: string;
}

function ReportCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3">
      <div>
        <h3 className="font-bold text-sm text-on-surface">{title}</h3>
        <p className="text-[11px] text-on-surface-variant mt-0.5">{description}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">{children}</div>
    </div>
  );
}

export default function FeeReportsPanel({ classes }: { classes: ClassOption[] }) {
  const [academicYear, setAcademicYear] = useState(YEAR_OPTIONS[1]);
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [year, setYear] = useState(thisYear);
  const [classId, setClassId] = useState("all");

  const selectClass = "h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40";
  const linkClass = "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ReportCard title="Monthly Fee Collection Report" description="Total collected per student for one month, school-wide.">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
          {MONTHS.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectClass}>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <a href={`/api/fees/reports/collection?scope=MONTHLY&month=${month}&year=${year}`} className={linkClass}>
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export
        </a>
      </ReportCard>

      <ReportCard title="Yearly Fee Collection Report" description="Total collected per month across the whole academic year.">
        <select value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={selectClass}>
          {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <a href={`/api/fees/reports/collection?scope=YEARLY&academicYear=${academicYear}`} className={linkClass}>
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export
        </a>
      </ReportCard>

      <ReportCard title="Class-wise Collection Report" description="Expected, collected and outstanding totals per class.">
        <select value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={selectClass}>
          {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <a href={`/api/fees/reports/collection?scope=CLASS_WISE&academicYear=${academicYear}`} className={linkClass}>
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export
        </a>
      </ReportCard>

      <ReportCard title="Outstanding Dues Report" description="Every student with an unpaid balance, highest first. Never counted as collected cash.">
        <select value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={selectClass}>
          {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className={selectClass}>
          <option value="all">All classes</option>
          {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}-{c.section}</option>))}
        </select>
        <a href={`/api/fees/reports/outstanding-dues?academicYear=${academicYear}${classId !== "all" ? `&classId=${classId}` : ""}`} className={linkClass}>
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export
        </a>
      </ReportCard>

      <ReportCard title="Advance Payment Report" description="Every student with an unapplied advance credit for the academic year.">
        <select value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className={selectClass}>
          {YEAR_OPTIONS.map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <a href={`/api/fees/reports/advance-payments?academicYear=${academicYear}`} className={linkClass}>
          <span className="material-symbols-outlined text-[16px]">download</span>
          Export
        </a>
      </ReportCard>

      <ReportCard title="Net Financial Summary" description="Income, expenses and net balance for a date range (see the Financial Dashboard for the on-screen view).">
        <a href="/admin/fees/dashboard" className={linkClass}>
          <span className="material-symbols-outlined text-[16px]">monitoring</span>
          Open Dashboard
        </a>
      </ReportCard>
    </div>
  );
}
