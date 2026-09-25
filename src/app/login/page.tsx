"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login, sendPasswordReset } = useAuth();

  const [role, setRole] = useState<"admin" | "teacher" | "student" | "parent">("admin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Forgot Password modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const handleRoleChange = (selectedRole: "admin" | "teacher" | "student" | "parent") => {
    setRole(selectedRole);
    setError("");
    setSuccessMessage("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);

    try {
      let idToken: string | undefined;

      // 1. Attempt client Firebase Auth if live credentials exist
      try {
        const prof = await login(identifier, password);
        if (prof) {
          const { auth } = await import("@/lib/firebase/config");
          if (auth.currentUser) {
            idToken = await auth.currentUser.getIdToken();
          }
        }
      } catch (clientErr: any) {
        // Fallback to server auth bridge (handles server-side REST auth or dev fallback)
      }

      // 2. Establish server session via API bridge
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, idToken, role }),
      });

      let data: any = {};
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        try {
          data = await res.json();
        } catch {
          data = {};
        }
      } else {
        await res.text().catch(() => "");
        throw new Error(
          res.status >= 500
            ? "Authentication service is currently unavailable. Please try again later."
            : `Authentication server returned unexpected response (${res.status}).`
        );
      }

      if (!res.ok) {
        throw new Error(data?.error || "Login failed. Please verify credentials.");
      }

      router.push(data.redirectUrl || "/");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMessage("");
    if (!resetEmail) return;

    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResetMessage(data.message || "If this email is registered, instructions have been dispatched.");
      } else {
        setResetMessage(data.error || "Unable to process password reset request.");
      }
    } catch (err: any) {
      setResetMessage("If this email is registered, instructions have been dispatched.");
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <main className="w-full min-h-screen flex items-center justify-center p-space-sm sm:p-space-lg bg-background relative overflow-hidden">
      {/* Ambient background cones */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-surface-container-high/60 blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-[30rem] h-[30rem] rounded-full bg-secondary-container/10 blur-3xl pointer-events-none"></div>
      <div className="absolute top-1/4 right-10 w-64 h-64 rounded-full bg-surface-variant/40 blur-2xl pointer-events-none"></div>

      {/* Main Container Card */}
      <div className="relative z-10 w-full max-w-xl bg-surface-container-lowest rounded-xl shadow-xl overflow-hidden border border-surface-container-high/20">
        {/* Top institutional color ribbon */}
        <div className="h-1.5 w-full bg-secondary"></div>

        <div className="p-space-lg sm:p-space-xl flex flex-col">
          {/* Header Branding */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="h-16 flex items-center justify-center">
              <img
                src="/images/logo.png"
                alt="Allied School Logo"
                className="h-14 w-auto object-contain drop-shadow-sm"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = "none";
                }}
              />
            </div>
            <div className="space-y-1">
              <h1 className="font-headline-lg text-2xl sm:text-3xl text-on-surface font-bold tracking-tight">
                Sign in to School Portal
              </h1>
              <p className="font-body-md text-sm text-on-surface-variant font-medium">
                Allied School Management System
              </p>
            </div>
          </div>

          {/* Error & Success Alerts */}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-error-container text-on-error-container text-xs flex items-center gap-2 border border-error/20">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="mt-4 p-3 rounded-lg bg-secondary-container/30 text-secondary text-xs flex items-center gap-2 border border-secondary/20">
              <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Academic Role Selection Tabs */}
          <div className="mt-space-md">
                {/* A <label> is for a single form control; this heads a group of toggle
                    buttons, so it had no control to name and announced nothing. Replaced with a
                    real labelled group, and each button reports its own pressed state. */}
                <span
                  id="portal-role-label"
                  className="block font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider mb-2 font-semibold text-center sm:text-left"
                >
                  Select Portal Role
                </span>
                <div
                  role="group"
                  aria-labelledby="portal-role-label"
                  className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-surface-container-low rounded-lg border border-surface-container-high/40"
                >
                  <button
                    type="button"
                    onClick={() => handleRoleChange("admin")}
                    aria-pressed={role === "admin"}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "admin"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">shield_person</span>
                    <span className="truncate">Admin</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRoleChange("teacher")}
                    aria-pressed={role === "teacher"}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "teacher"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">school</span>
                    <span className="truncate">Teacher</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRoleChange("student")}
                    aria-pressed={role === "student"}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "student"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">person</span>
                    <span className="truncate">Student</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRoleChange("parent")}
                    aria-pressed={role === "parent"}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "parent"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">family_restroom</span>
                    <span className="truncate">Parent</span>
                  </button>
                </div>
              </div>

              {/* Authentication Form */}
              <form onSubmit={handleLogin} className="mt-space-md space-y-space-md">
                {/* Identity / Email Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="login-identifier" className="font-label-lg text-xs font-semibold text-on-surface flex items-center gap-1">
                      <span>Username or Institutional Email</span>
                      <span className="text-error font-body-sm">*</span>
                    </label>
                    <span className="font-label-sm text-[11px] text-secondary bg-surface-container-low px-2 py-0.5 rounded-full font-medium">
                      {role === "admin"
                        ? "Admin Scope"
                        : role === "teacher"
                        ? "Faculty Scope"
                        : role === "parent"
                        ? "Guardian Scope"
                        : "Student Scope"}
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3 text-outline text-[20px] pointer-events-none">
                      account_circle
                    </span>
                    <input
                      id="login-identifier"
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. admin@alliedschool.edu"
                      className="w-full h-11 pl-10 pr-4 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="login-password" className="font-label-lg text-xs font-semibold text-on-surface flex items-center gap-1">
                      <span>Password</span>
                      <span className="text-error font-body-sm">*</span>
                    </label>
                  </div>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3 text-outline text-[20px] pointer-events-none">
                      lock
                    </span>
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full h-11 pl-10 pr-12 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 p-1 text-outline hover:text-on-surface transition-colors focus:outline-none"
                      title="Toggle password visibility"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? "visibility" : "visibility_off"}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Utilities Row */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="w-4 h-4 rounded text-secondary bg-surface-container-low accent-secondary cursor-pointer"
                    />
                    <span className="font-body-sm text-xs text-on-surface-variant font-medium">
                      Remember this workstation
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => { setResetEmail(identifier); setShowForgotModal(true); }}
                    className="font-label-md text-xs text-secondary hover:underline font-semibold"
                  >
                    Forgot Password?
                  </button>
                </div>

                {/* Primary Submit CTA Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 flex items-center justify-center gap-2 font-label-lg text-sm font-semibold text-on-primary bg-secondary hover:bg-secondary/90 active:bg-primary-container rounded-lg shadow-md transition-all duration-150 disabled:opacity-50"
                  >
                    {loading ? (
                      <span>Authenticating...</span>
                    ) : (
                      <>
                        <span>Sign In to Dashboard</span>
                        <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

          {/* Footnote */}
          <div className="mt-space-md pt-space-xs flex items-center justify-center gap-2 text-[11px] text-on-surface-variant font-medium">
            <span className="material-symbols-outlined text-[16px] text-on-tertiary-container">verified_user</span>
            <span>Secure Cloud-Based Platform</span>
            <span>•</span>
            <span>Allied School System</span>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-2xl border border-surface-container-high/30"
          >
            <h3 id="reset-password-heading" className="font-headline-sm text-lg font-bold text-on-surface mb-2">Reset Password</h3>
            <p className="font-body-sm text-xs text-on-surface-variant mb-4">
              Enter your registered email address to receive a secure password reset link.
            </p>
            {resetMessage && (
              <div className="mb-4 p-3 rounded-lg bg-surface-container-low text-xs text-secondary border border-surface-container-high">
                {resetMessage}
              </div>
            )}
            <form onSubmit={handleResetPassword} className="space-y-4">
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="e.g. user@alliedschool.edu"
                className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface text-sm rounded-lg border border-outline-variant focus:border-secondary focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowForgotModal(false); setResetMessage(""); }}
                  className="px-4 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-4 py-2 text-xs font-semibold text-on-primary bg-secondary hover:bg-secondary/90 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {resetLoading ? "Sending..." : "Send Reset Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
