"use client";

import React, { useEffect, useState } from "react";
import FileUpload from "@/components/FileUpload";

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({
    schoolName: "",
    campusName: "",
    tagline: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    academicYear: "",
    currencySymbol: "Rs.",
    gradingSystem: "Standard 4.0 / Percentage",
    logoUrl: "",
  });
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSaveError(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      const json = await res.json().catch(() => null);

      if (res.ok) {
        if (json?.settings) {
          setSettings((prev: any) => ({
            ...prev,
            academicYear: json.settings.academicYear ?? prev.academicYear,
            currencySymbol: json.settings.currencySymbol ?? prev.currencySymbol,
            gradingSystem: json.settings.gradingSystemLabel ?? prev.gradingSystem,
          }));
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError(json?.error || "Failed to save settings. Please try again.");
      }
    } catch (err) {
      console.error(err);
      setSaveError("Failed to save settings. Please check your connection and try again.");
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

      {saveError && (
        <div className="p-3 rounded-lg bg-error-container/20 border border-error/30 text-error text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{saveError}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        {/* Section 1: Institution Profile */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-surface-container-low">
            <span className="material-symbols-outlined text-secondary text-[20px]">school</span>
            <h2 className="font-headline-md text-sm font-bold text-on-surface">Institutional Profile</h2>
          </div>

          <div className="pb-2 border-b border-surface-container-low">
            <FileUpload
              folder="school-logo"
              label="Official School Logo / Crest"
              helperText="Upload official emblem (JPG, PNG, WebP up to 5MB)"
              currentUrl={settings.logoUrl}
              onUploadComplete={(url) => setSettings((prev: any) => ({ ...prev, logoUrl: url }))}
              onRemove={() => setSettings((prev: any) => ({ ...prev, logoUrl: "" }))}
              previewType="image"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="settings-institution-name-1" className="block font-semibold text-on-surface mb-1">Institution Name</label>
              <input id="settings-institution-name-1"
                type="text"
                name="schoolName"
                value={settings.schoolName}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div>
              <label htmlFor="settings-campus-title-2" className="block font-semibold text-on-surface mb-1">Campus Title</label>
              <input id="settings-campus-title-2"
                type="text"
                name="campusName"
                value={settings.campusName}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="settings-motto-tagline-3" className="block font-semibold text-on-surface mb-1">Motto / Tagline</label>
              <input id="settings-motto-tagline-3"
                type="text"
                name="tagline"
                value={settings.tagline}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div>
              <label htmlFor="settings-contact-email-4" className="block font-semibold text-on-surface mb-1">Contact Email</label>
              <input id="settings-contact-email-4"
                type="email"
                name="contactEmail"
                value={settings.contactEmail}
                onChange={handleChange}
                placeholder="e.g. admin@school.edu.pk"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div>
              <label htmlFor="settings-helpdesk-phone-5" className="block font-semibold text-on-surface mb-1">Helpdesk Phone</label>
              <input id="settings-helpdesk-phone-5"
                type="text"
                name="contactPhone"
                value={settings.contactPhone}
                onChange={handleChange}
                placeholder="e.g. +92 51 0000000"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="settings-campus-physical-address-6" className="block font-semibold text-on-surface mb-1">Campus Physical Address</label>
              <input id="settings-campus-physical-address-6"
                type="text"
                name="address"
                value={settings.address}
                onChange={handleChange}
                placeholder="Enter physical campus location"
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
              <label htmlFor="settings-academic-session-7" className="block font-semibold text-on-surface mb-1">Academic Session</label>
              <input id="settings-academic-session-7"
                type="text"
                name="academicYear"
                value={settings.academicYear}
                onChange={handleChange}
                placeholder="e.g. 2025-2026"
                pattern="\d{4}-\d{4}"
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">Format: YYYY-YYYY. Shown across dashboards and printed documents.</p>
            </div>

            <div>
              <label htmlFor="settings-currency-symbol-8" className="block font-semibold text-on-surface mb-1">Currency Symbol</label>
              <input id="settings-currency-symbol-8"
                type="text"
                name="currencySymbol"
                value={settings.currencySymbol}
                onChange={handleChange}
                className="w-full h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono font-bold"
              />
            </div>

            <div>
              <label htmlFor="settings-grading-system-9" className="block font-semibold text-on-surface mb-1">Grading System</label>
              <select id="settings-grading-system-9"
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

        {/* Section 3: System Status */}
        <div className="p-5 rounded-xl bg-surface-container-low/60 border border-surface-container-high/60 space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-[20px]">verified</span>
            <h3 className="font-headline-md text-xs font-bold text-on-surface uppercase tracking-wider">
              System Status
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high">
              <span className="text-[10px] text-on-surface-variant font-medium">Cloud Sync</span>
              <div className="font-bold text-on-tertiary-container mt-0.5">Connected</div>
            </div>

            <div className="p-3 rounded-lg bg-surface-container-lowest border border-surface-container-high">
              <span className="text-[10px] text-on-surface-variant font-medium">Account Security</span>
              <div className="font-bold text-on-tertiary-container mt-0.5">Enabled</div>
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
