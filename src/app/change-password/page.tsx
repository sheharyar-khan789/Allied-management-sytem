"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mandatory first-login screen for an account created with a temporary password. The server
 * (requireAuth and the role layouts) refuses everything else until this succeeds; this page only
 * collects the new password. Nothing is stored in the browser.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || done) return;
    setError("");
    if (newPassword.length < 10) return setError("Your new password must be at least 10 characters long.");
    if (newPassword !== confirmPassword) return setError("The new passwords do not match.");
    if (newPassword === currentPassword) return setError("Your new password must be different from the temporary password.");

    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the password. Please try again.");
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // "/" sends each role to its own dashboard.
      router.replace("/");
      router.refresh();
    } catch (err: any) {
      setError(
        err?.name === "AbortError"
          ? "The request took too long. Your password was not changed; please try again."
          : err.message || "Could not change the password. Please try again."
      );
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
  };

  const field =
    "w-full h-11 px-3.5 pr-10 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant focus:border-secondary focus:outline-none";

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-surface-container-low py-12 px-4 sm:px-6">
      <div className="bg-surface-container-lowest border border-surface-container-high/50 shadow-xl rounded-2xl p-6 sm:p-10 w-full max-w-md">
        <h1 className="font-headline-lg text-2xl text-on-surface font-bold tracking-tight">Choose your own password</h1>
        <p className="text-xs text-on-surface-variant mt-1 mb-5">
          You signed in with a temporary password issued by your administrator. Set a new password to continue.
        </p>

        {error && (
          <div role="alert" className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container text-xs border border-error/20">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          <div>
            <label htmlFor="current-password" className="block text-xs font-semibold text-on-surface mb-1">Temporary password</label>
            <input id="current-password" type={show ? "text" : "password"} required maxLength={256} value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className={field} />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-xs font-semibold text-on-surface mb-1">New password</label>
            <div className="relative">
              <input id="new-password" type={show ? "text" : "password"} required minLength={10} maxLength={128} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="At least 10 characters" className={field} />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide passwords" : "Show passwords"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1">
                <span className="material-symbols-outlined text-[18px]">{show ? "visibility_off" : "visibility"}</span>
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-xs font-semibold text-on-surface mb-1">Confirm new password</label>
            <input id="confirm-password" type={show ? "text" : "password"} required minLength={10} maxLength={128} value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className={field} />
          </div>
          <button type="submit" disabled={submitting || done}
            className="w-full h-11 inline-flex items-center justify-center rounded-lg bg-secondary text-on-secondary font-semibold text-sm hover:bg-secondary/90 disabled:opacity-50">
            {submitting ? "Saving..." : done ? "Password changed" : "Set new password"}
          </button>
        </form>
      </div>
    </main>
  );
}
