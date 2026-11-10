"use client";

import React, { useEffect, useState } from "react";
import FeeLedgerTab from "@/components/fees/FeeLedgerTab";
import YearlyFeeStructureTab from "@/components/fees/YearlyFeeStructureTab";
import VoucherGenerationTab from "@/components/fees/VoucherGenerationTab";
import DailyTransactionsTab from "@/components/fees/DailyTransactionsTab";
import StudentFeeUpdateTab from "@/components/fees/StudentFeeUpdateTab";
import OtherCollectionsTab from "@/components/fees/OtherCollectionsTab";
import OtherExpensesTab from "@/components/fees/OtherExpensesTab";
import FinancialDashboardTab from "@/components/fees/FinancialDashboardTab";
import ReportsExportsTab from "@/components/fees/ReportsExportsTab";

const TABS = [
  { key: "dashboard", label: "Financial Dashboard", icon: "dashboard" },
  { key: "ledger", label: "Collection Ledger", icon: "receipt_long" },
  { key: "yearly-structure", label: "Yearly Fee Structure", icon: "table_rows" },
  { key: "voucher-generation", label: "Voucher Generation", icon: "receipt" },
  { key: "daily-transactions", label: "Daily Transactions", icon: "sync_alt" },
  { key: "student-fee-update", label: "Student Fee Update", icon: "manage_accounts" },
  { key: "other-collections", label: "Other Collections", icon: "savings" },
  { key: "other-expenses", label: "Other Expenses", icon: "payments" },
  { key: "reports", label: "Reports & Exports", icon: "summarize" },
] as const;

export default function FeeManagementPage() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["key"]>("dashboard");
  // Lifted here (rather than fetched independently by each tab) so changing the academic
  // year in one section is remembered when switching to another, instead of silently
  // resetting back to the school's default every time.
  const [academicYear, setAcademicYear] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d?.settings?.academicYear) setAcademicYear(d.settings.academicYear);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Fees & Payments</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Manage the yearly fee structure, generate vouchers, and collect payments — all from one place.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-surface-container-high/40 no-print overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === tab.key
                ? "border-secondary text-secondary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" && <FinancialDashboardTab academicYear={academicYear} onAcademicYearChange={setAcademicYear} />}
      {activeTab === "ledger" && <FeeLedgerTab />}
      {activeTab === "yearly-structure" && <YearlyFeeStructureTab academicYear={academicYear} onAcademicYearChange={setAcademicYear} />}
      {activeTab === "voucher-generation" && <VoucherGenerationTab academicYear={academicYear} onAcademicYearChange={setAcademicYear} />}
      {activeTab === "daily-transactions" && <DailyTransactionsTab academicYear={academicYear} onAcademicYearChange={setAcademicYear} />}
      {activeTab === "student-fee-update" && <StudentFeeUpdateTab academicYear={academicYear} onAcademicYearChange={setAcademicYear} />}
      {activeTab === "other-collections" && <OtherCollectionsTab />}
      {activeTab === "other-expenses" && <OtherExpensesTab />}
      {activeTab === "reports" && <ReportsExportsTab academicYear={academicYear} onAcademicYearChange={setAcademicYear} />}
    </div>
  );
}
