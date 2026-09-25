"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Password reset token is missing from the URL. Please use the complete link provided in your email.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters in length.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please re-enter both passwords.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password. The link may have expired.");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-container-lowest border border-surface-container-high/50 shadow-xl rounded-2xl p-6 sm:p-10 w-full max-w-md mx-4">
      {/* Brand Header */}
      <div className="flex flex-col items-center text-center space-y-2 mb-6">
        <div className="h-14 flex items-center justify-center">
          <img
            src="/images/logo.png"
            alt="Allied School Logo"
            className="h-12 w-auto object-contain drop-shadow-sm"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
            }}
          />
        </div>
        <div>
          <h1 className="font-headline-lg text-2xl text-on-surface font-bold tracking-tight">
            Create New Password
          </h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-1">
            Allied School Management System
          </p>
        </div>
      </div>

      {!token && (
        <div className="p-4 rounded-xl bg-error-container text-on-error-container text-xs border border-error/20 mb-6">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>Missing Reset Token</span>
          </div>
          <p>
            No valid reset token was detected in your link. Please check the email you received or request a new reset link.
          </p>
          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm transition-all"
            >
              <span>Return to Login</span>
            </Link>
          </div>
        </div>
      )}

      {token && !success && (
        <>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-error-container text-on-error-container text-xs flex items-center gap-2 border border-error/20">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-xs font-semibold text-on-surface mb-1">
                New Password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full h-11 px-3.5 pr-10 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant focus:border-secondary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-xs font-semibold text-on-surface mb-1">
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                className="w-full h-11 px-3.5 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant focus:border-secondary focus:outline-none"
              />
            </div>

            <div className="text-[11px] text-on-surface-variant flex items-center gap-1.5 pt-1">
              <span className="material-symbols-outlined text-[15px] text-secondary">info</span>
              <span>Must be at least 8 characters long.</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-secondary text-on-secondary font-semibold text-sm hover:bg-secondary/90 shadow-sm transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-on-secondary border-t-transparent rounded-full animate-spin"></div>
                  <span>Updating Password...</span>
                </>
              ) : (
                <span>Reset Password</span>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-surface-container-high/40 text-center">
            <Link
              href="/login"
              className="text-xs font-semibold text-secondary hover:underline inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">arrow_back</span>
              <span>Back to Login</span>
            </Link>
          </div>
        </>
      )}

      {success && (
        <div className="space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-secondary/10 text-secondary mx-auto flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl font-bold">check_circle</span>
          </div>
          <div>
            <h2 className="font-headline-md text-lg font-bold text-on-surface">Password Updated</h2>
            <p className="font-body-sm text-xs text-on-surface-variant mt-1">
              Your password has been changed successfully. You can now use your new password to sign in.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-secondary text-on-secondary font-semibold text-sm hover:bg-secondary/90 shadow-sm transition-all"
          >
            <span>Proceed to Login</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-surface-container-low py-12 px-4 sm:px-6">
      <Suspense
        fallback={
          <div className="bg-surface-container-lowest border border-surface-container-high/50 shadow-xl rounded-2xl p-10 w-full max-w-md mx-4 text-center">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-xs text-on-surface-variant">Loading password reset...</p>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
