"use client";

import React, { useState, Suspense, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type ValidationState =
  | { status: "checking" }
  | { status: "valid"; email?: string; purpose?: string }
  | { status: "invalid"; code: string; message: string }
  | { status: "no_token" };

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token");
  // Firebase Authentication action links (when the project's email action URL points here).
  const mode = searchParams.get("mode");
  const oobCode = mode === "resetPassword" ? searchParams.get("oobCode") : null;
  const credential = token || oobCode;
  const purpose = searchParams.get("purpose");

  const [validation, setValidation] = useState<ValidationState>(
    credential ? { status: "checking" } : { status: "no_token" }
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const validatedRef = useRef(false);

  // Validate the token/oobCode on mount before showing the form.
  // This prevents infinite loading: we use a hard 10-second timeout so that even
  // if the API hangs, the user sees an error rather than an endless spinner.
  useEffect(() => {
    if (!credential || validatedRef.current) return;
    validatedRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 10_000);

    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (oobCode) params.set("oobCode", oobCode);

    fetch(`/api/auth/reset-password?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timeout);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.valid) {
          setValidation({ status: "valid", email: data.email, purpose: data.purpose });
        } else {
          setValidation({
            status: "invalid",
            code: data.code || "INVALID",
            message: data.error || "This password reset link is invalid or has expired.",
          });
        }
      })
      .catch((err) => {
        clearTimeout(timeout);
        if (err?.name === "AbortError") {
          setValidation({
            status: "invalid",
            code: "TIMEOUT",
            message:
              "Validation timed out. Please check your connection and try opening the link again.",
          });
        } else {
          setValidation({
            status: "invalid",
            code: "NETWORK",
            message: "Could not reach the server. Please check your connection and try again.",
          });
        }
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isActivation =
    purpose === "activate" ||
    validation.status === "valid" && validation.purpose === "ACTIVATION";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 10) {
      setError("Password must be at least 10 characters in length.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match. Please re-enter both passwords.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { token, newPassword: password } : { oobCode, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password. The link may have expired.");
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
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
            {isActivation ? "Set Your Password" : "Create New Password"}
          </h1>
          <p className="font-body-md text-xs text-on-surface-variant mt-1">
            Allied School Management System
          </p>
        </div>
      </div>

      {/* ── No Token ────────────────────────────────────────────────── */}
      {validation.status === "no_token" && (
        <LinkErrorCard
          code="MISSING"
          message="No valid reset token was detected in your link. Please check the email you received or request a new reset link."
        />
      )}

      {/* ── Checking (real operation in progress) ───────────────────── */}
      {validation.status === "checking" && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-on-surface-variant">Verifying your reset link…</p>
        </div>
      )}

      {/* ── Invalid / expired / used ─────────────────────────────────── */}
      {validation.status === "invalid" && (
        <LinkErrorCard code={validation.code} message={validation.message} />
      )}

      {/* ── Valid — show form ─────────────────────────────────────────── */}
      {validation.status === "valid" && !success && (
        <>
          {validation.email && (
            <div className="mb-4 p-3 rounded-lg bg-surface-container-low text-xs text-on-surface-variant border border-surface-container-high/40">
              Resetting password for <strong className="text-on-surface">{validation.email}</strong>
            </div>
          )}

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
                  minLength={10}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 10 characters"
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
                minLength={10}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                className="w-full h-11 px-3.5 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant focus:border-secondary focus:outline-none"
              />
            </div>

            <div className="text-[11px] text-on-surface-variant flex items-center gap-1.5 pt-1">
              <span className="material-symbols-outlined text-[15px] text-secondary">info</span>
              <span>Must be at least 10 characters long.</span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-secondary text-on-secondary font-semibold text-sm hover:bg-secondary/90 shadow-sm transition-all disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-on-secondary border-t-transparent rounded-full animate-spin"></div>
                  <span>Updating Password...</span>
                </>
              ) : (
                <span>{isActivation ? "Activate Account" : "Reset Password"}</span>
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

      {/* ── Success ───────────────────────────────────────────────────── */}
      {success && (
        <div className="space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-secondary/10 text-secondary mx-auto flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl font-bold">check_circle</span>
          </div>
          <div>
            <h2 className="font-headline-md text-lg font-bold text-on-surface">
              {isActivation ? "Account Activated" : "Password Updated"}
            </h2>
            <p className="font-body-sm text-xs text-on-surface-variant mt-1">
              {isActivation
                ? "Your password has been set. You can now sign in with your email and new password."
                : "Your password has been changed successfully. You can now use your new password to sign in."}
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

const ERROR_HEADINGS: Record<string, string> = {
  EXPIRED: "Link Expired",
  USED: "Link Already Used",
  INVALID: "Invalid Link",
  MISSING: "Missing Reset Token",
  TIMEOUT: "Validation Timeout",
  NETWORK: "Connection Error",
};

function LinkErrorCard({ code, message }: { code: string; message: string }) {
  const heading = ERROR_HEADINGS[code] || "Link Error";
  return (
    <div className="p-4 rounded-xl bg-error-container text-on-error-container text-xs border border-error/20 mb-6">
      <div className="flex items-center gap-2 font-semibold mb-2">
        <span className="material-symbols-outlined text-[18px]">error</span>
        <span>{heading}</span>
      </div>
      <p className="mb-4">{message}</p>
      <div className="flex flex-col gap-2">
        <div className="text-center">
          <Link
            href="/login?forgot=1"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[15px]">mail</span>
            <span>Request a New Reset Link</span>
          </Link>
        </div>
        <div className="text-center">
          <Link
            href="/login"
            className="text-xs font-semibold hover:underline inline-flex items-center gap-1 opacity-80"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            <span>Return to Login</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-surface-container-low py-12 px-4 sm:px-6">
      <Suspense
        fallback={
          <div className="bg-surface-container-lowest border border-surface-container-high/50 shadow-xl rounded-2xl p-10 w-full max-w-md mx-4 text-center">
            <div className="w-8 h-8 border-[3px] border-secondary border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-xs text-on-surface-variant">Loading…</p>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
