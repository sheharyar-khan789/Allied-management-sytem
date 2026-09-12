"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login, signup, sendPasswordReset } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [role, setRole] = useState<"admin" | "teacher" | "student">("admin");
  const [identifier, setIdentifier] = useState("admin@alliedschool.edu");
  const [password, setPassword] = useState("AdminSecure2025#");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Signup fields
  const [fullName, setFullName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  // Forgot Password modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const handleRoleChange = (selectedRole: "admin" | "teacher" | "student") => {
    setRole(selectedRole);
    setError("");
    setSuccessMessage("");
    if (selectedRole === "admin") {
      setIdentifier("admin@alliedschool.edu");
      setPassword("AdminSecure2025#");
    } else if (selectedRole === "teacher") {
      setIdentifier("teacher@alliedschool.edu");
      setPassword("TeacherSecure2025#");
    } else if (selectedRole === "student") {
      setIdentifier("student@alliedschool.edu");
      setPassword("StudentSecure2025#");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);

    try {
      // First try via client/server auth API bridge
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, role }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Login failed. Please verify credentials.");
      }

      // Sync with client auth context
      try {
        await login(identifier, password);
      } catch (fbErr) {
        // Fallback for demo users
      }

      router.push(data.redirectUrl || (role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/student"));
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (signupPassword !== signupConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (signupPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      await signup(fullName, signupEmail, signupPassword, schoolName);
      setSuccessMessage("School administration account created successfully! Redirecting...");
      setTimeout(() => {
        router.push("/admin");
        router.refresh();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Failed to create school account.");
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
      await sendPasswordReset(resetEmail);
      setResetMessage("Password reset email sent. Please check your inbox.");
    } catch (err: any) {
      setResetMessage("Notice: If this email is registered, instructions have been dispatched.");
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
                {mode === "login" ? "Sign in to School Portal" : "Register New Institution"}
              </h1>
              <p className="font-body-md text-sm text-on-surface-variant font-medium">
                {mode === "login"
                  ? "Allied School Management System — Firebase Production"
                  : "Create Initial School Administrator & Campus Profile"}
              </p>
            </div>
          </div>

          {/* Mode Switcher (Sign In / Register Institution) */}
          <div className="mt-4 flex rounded-lg p-1 bg-surface-container-low border border-surface-container-high/40">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(""); setSuccessMessage(""); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all ${
                mode === "login"
                  ? "bg-surface-container-lowest text-secondary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Sign In to Existing Account
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(""); setSuccessMessage(""); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all ${
                mode === "signup"
                  ? "bg-surface-container-lowest text-secondary shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Register School (Admin Only)
            </button>
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

          {/* ---------------- LOGIN MODE ---------------- */}
          {mode === "login" ? (
            <>
              {/* Academic Role Selection Tabs */}
              <div className="mt-space-md">
                <label className="block font-label-sm text-[11px] text-on-surface-variant uppercase tracking-wider mb-2 font-semibold text-center sm:text-left">
                  Select Portal Role
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-surface-container-low rounded-lg border border-surface-container-high/40">
                  <button
                    type="button"
                    onClick={() => handleRoleChange("admin")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "admin"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">shield_person</span>
                    <span className="truncate">Admin / Principal</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRoleChange("teacher")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "teacher"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">school</span>
                    <span className="truncate">Teacher / Staff</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRoleChange("student")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 text-center font-label-md text-xs font-semibold rounded transition-all ${
                      role === "student"
                        ? "bg-surface-container-lowest text-secondary shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">person</span>
                    <span className="truncate">Student / Parent</span>
                  </button>
                </div>
              </div>

              {/* Authentication Form */}
              <form onSubmit={handleLogin} className="mt-space-md space-y-space-md">
                {/* Identity / Email Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-label-lg text-xs font-semibold text-on-surface flex items-center gap-1">
                      <span>Username or Institutional Email</span>
                      <span className="text-error font-body-sm">*</span>
                    </label>
                    <span className="font-label-sm text-[11px] text-secondary bg-surface-container-low px-2 py-0.5 rounded-full font-medium">
                      {role === "admin"
                        ? "Superadmin Scope"
                        : role === "teacher"
                        ? "Faculty Scope"
                        : "Student Scope"}
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3 text-outline text-[20px] pointer-events-none">
                      account_circle
                    </span>
                    <input
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
                    <label className="font-label-lg text-xs font-semibold text-on-surface flex items-center gap-1">
                      <span>Password</span>
                      <span className="text-error font-body-sm">*</span>
                    </label>
                    <span className="font-label-sm text-[11px] text-on-tertiary-container font-semibold">
                      Firebase Passphrase
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3 text-outline text-[20px] pointer-events-none">
                      lock
                    </span>
                    <input
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
                      <span>Authenticating with Firebase...</span>
                    ) : (
                      <>
                        <span>Sign In to Dashboard</span>
                        <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Quick Demo Credential Helper Banner */}
              <div className="mt-space-md p-3 bg-surface-container-low rounded-lg flex items-center justify-between gap-2 border border-surface-container-high/40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-secondary text-[20px] shrink-0">info</span>
                  <div className="font-body-sm text-xs text-on-surface truncate">
                    <span className="font-semibold text-primary capitalize">{role}:</span> {identifier}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRoleChange(role)}
                  className="shrink-0 px-2.5 py-1 font-label-sm text-xs font-semibold bg-surface-container-lowest hover:bg-surface-container-high text-secondary rounded shadow-sm transition-colors border border-surface-container-high"
                >
                  Auto Fill
                </button>
              </div>
            </>
          ) : (
            /* ---------------- SIGNUP / REGISTER SCHOOL MODE ---------------- */
            <form onSubmit={handleSignup} className="mt-space-md space-y-space-md">
              <div className="p-3 bg-surface-container-low rounded-lg border border-surface-container-high/40 text-xs text-on-surface-variant">
                <strong className="text-secondary font-semibold">Institutional Setup:</strong> Public registration provisions the primary School Administrator account and creates the school’s isolated Firestore database domain.
              </div>

              <div className="space-y-1">
                <label className="font-label-lg text-xs font-semibold text-on-surface">School / Campus Name *</label>
                <input
                  type="text"
                  required
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  placeholder="e.g. Allied School Model Town Campus"
                  className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-label-lg text-xs font-semibold text-on-surface">Administrator Full Name *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Dr. Tariq Mehmood"
                  className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-label-lg text-xs font-semibold text-on-surface">Official Admin Email *</label>
                <input
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="e.g. principal@alliedschool.edu"
                  className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-label-lg text-xs font-semibold text-on-surface">Master Password *</label>
                  <input
                    type="password"
                    required
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-label-lg text-xs font-semibold text-on-surface">Confirm Password *</label>
                  <input
                    type="password"
                    required
                    value={signupConfirmPassword}
                    onChange={(e) => setSignupConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 flex items-center justify-center gap-2 font-label-lg text-sm font-semibold text-on-primary bg-secondary hover:bg-secondary/90 active:bg-primary-container rounded-lg shadow-md transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <span>Registering School in Firestore...</span>
                  ) : (
                    <>
                      <span>Complete School Registration</span>
                      <span className="material-symbols-outlined text-[20px]">domain_add</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Footnote */}
          <div className="mt-space-md pt-space-xs flex items-center justify-center gap-2 text-[11px] text-on-surface-variant font-medium">
            <span className="material-symbols-outlined text-[16px] text-on-tertiary-container">verified_user</span>
            <span>Firebase Auth & Cloud Firestore</span>
            <span>•</span>
            <span>Allied School System</span>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-2xl border border-surface-container-high/30">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface mb-2">Reset Password</h3>
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
