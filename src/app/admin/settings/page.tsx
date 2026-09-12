"use client";

import React, { useEffect, useState } from "react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({
    schoolName: "",
    campusName: "",
    tagline: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    currencySymbol: "Rs.",
    gradingSystem: "Standard 4.0 / Percentage",
  });
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          if (json.settings) setSettings(json.settings);
          if (json.sessions) setSessions(json.sessions);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading system settings...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto gap-space-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
            Settings & System Configuration
          </h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Manage school identity, academic calendars, currency denominations, and operational parameters.
          </p>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>School configuration saved and updated successfully.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        {/* Section 1: Institution Profile */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-container-low">
            <span className="material-symbols-outlined text-secondary text-[20px]">school</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">Institutional Profile</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-on-surface mb-1">Institution Name</label>
              <input
                type="text"
                name="schoolName"
                value={settings.schoolName}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div>
              <label className="block font-semibold text-on-surface mb-1">Campus Title</label>
              <input
                type="text"
                name="campusName"
                value={settings.campusName}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-on-surface mb-1">Motto / Tagline</label>
              <input
                type="text"
                name="tagline"
                value={settings.tagline}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div>
              <label className="block font-semibold text-on-surface mb-1">Contact Email</label>
              <input
                type="email"
                name="contactEmail"
                value={settings.contactEmail}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div>
              <label className="block font-semibold text-on-surface mb-1">Helpdesk Phone</label>
              <input
                type="text"
                name="contactPhone"
                value={settings.contactPhone}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-on-surface mb-1">Campus Physical Address</label>
              <input
                type="text"
                name="address"
                value={settings.address}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Academic & Financial Configuration */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-container-low">
            <span className="material-symbols-outlined text-secondary text-[20px]">tune</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">Academic & Financial Policy</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-on-surface mb-1">Currency Symbol</label>
              <input
                type="text"
                name="currencySymbol"
                value={settings.currencySymbol}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono font-bold"
              />
            </div>

            <div>
              <label className="block font-semibold text-on-surface mb-1">Grading System</label>
              <select
                name="gradingSystem"
                value={settings.gradingSystem}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              >
                <option value="Standard 4.0 / Percentage">Standard 4.0 / Percentage (A+, A, B, C, D, F)</option>
                <option value="Percentage Only">Percentage Only (0 - 100%)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Database & Server Diagnostics */}
        <div className="p-5 rounded-xl bg-surface-container-low/60 border border-surface-container-high/60 space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[20px]">dns</span>
            <h3 className="font-headline-md text-xs font-bold text-on-surface uppercase tracking-wider">
              Database & Sync Health
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high">
              <span className="text-[10px] text-on-surface-variant font-medium">Database Engine</span>
              <div className="font-bold text-on-surface mt-0.5">Google Cloud Firestore</div>
            </div>

            <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high">
              <span className="text-[10px] text-on-surface-variant font-medium">Authentication</span>
              <div className="font-bold text-on-tertiary-container mt-0.5">Role-Based JWT Sessions</div>
            </div>

            <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high">
              <span className="text-[10px] text-on-surface-variant font-medium">Audit History</span>
              <div className="font-bold text-secondary mt-0.5">Active Event Logging</div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? (
              <span>Saving Changes...</span>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">save</span>
                <span>Save Configuration</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
