"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const fetchAuditLogs = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (actionFilter !== "all") params.append("action", actionFilter);

      const res = await fetch(`/api/audit?${params.toString()}`);
      const json = await res.json();
      if (json.success) setLogs(json.logs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [search, actionFilter]);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              System History & Audit Trail
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {logs.length} Actions Logged
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Immutable application event log tracking administrative modifications, student registrations, and financial operations.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs font-semibold shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          <span>Export Audit Log</span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
        <div className="relative flex-1 max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="search"
            aria-label="Search audit log"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by actor, action, keyword..."
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container-low font-body-md text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/20 transition-all border border-transparent focus:border-outline-variant/50"
          />
        </div>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-medium text-on-surface border border-outline-variant/40"
        >
          <option value="all">All Actions</option>
          <option value="CREATE_STUDENT">Student Enrolled</option>
          <option value="COLLECT_FEE_PAYMENT">Fee Payment</option>
          <option value="MARK_ATTENDANCE">Attendance Recorded</option>
          <option value="ENTER_EXAM_MARKS">Exam Marks Saved</option>
          <option value="LOGIN">User Logins</option>
        </select>
      </div>

      {/* Audit Log Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading system audit trail...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <span className="material-symbols-outlined text-4xl text-outline-variant">history</span>
            <p className="text-sm font-semibold text-on-surface">No audit logs matching query</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                  <th className="py-3 px-4 font-bold">Timestamp</th>
                  <th className="py-3 px-4 font-bold">Actor / User</th>
                  <th className="py-3 px-4 font-bold">Role</th>
                  <th className="py-3 px-4 font-bold">Action</th>
                  <th className="py-3 px-4 font-bold">Entity</th>
                  <th className="py-3 px-4 font-bold">Details Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-4 text-on-surface-variant whitespace-nowrap font-mono text-[11px]">
                      {new Date(log.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>

                    <td className="py-3 px-4 font-bold text-on-surface">{log.userName}</td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-surface-container text-[10px] font-bold text-primary">
                        {log.userRole}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-mono font-semibold text-secondary text-[11px]">
                      {log.action}
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-semibold text-on-surface">
                        {log.entity}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-medium text-on-surface max-w-md">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
