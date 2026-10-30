"use client";

import React, { useState } from "react";

/**
 * Self-service "change my password while signed in" form, shared by every role's own account
 * page. Posts to /api/auth/change-password, which already verifies the current password,
 * updates Firebase Auth, and revokes other sessions — see src/lib/firebase/auth-password.ts for
 * why that call cannot hang indefinitely (a bounded AbortSignal on every Identity Toolkit call).
 */
export default function ChangePasswordPanel({ idPrefix = "account" }: { idPrefix?: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword.length < 10 || newPassword.length > 128) {
      setError("New password must be between 10 and 128 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to change password.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated. Use the new password the next time you sign in.");
    } catch (err: any) {
      setError(err.message || "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4"
    >
      <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary text-[18px]">lock</span>
        Change Password
      </h3>
      {error && <p className="text-xs text-error">{error}</p>}
      {message && <p className="text-xs text-secondary">{message}</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div>
          <label htmlFor={`${idPrefix}-current-password`} className="text-on-surface-variant">
            Current password
          </label>
          <input
            id={`${idPrefix}-current-password`}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            required
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-new-password`} className="text-on-surface-variant">
            New password
          </label>
          <input
            id={`${idPrefix}-new-password`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            required
            minLength={10}
            maxLength={128}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-confirm-password`} className="text-on-surface-variant">
            Confirm new password
          </label>
          <input
            id={`${idPrefix}-confirm-password`}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface"
            required
            minLength={10}
            maxLength={128}
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-60"
      >
        {saving ? "Saving..." : "Update password"}
      </button>
    </form>
  );
}
