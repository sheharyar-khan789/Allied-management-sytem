"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";

export default function RegisterInstitutionPage() {
  const router = useRouter();
  const { signup } = useAuth();

  const [fullName, setFullName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [registrationSecret, setRegistrationSecret] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!registrationSecret.trim()) {
      setError("Registration Authorization Secret Code is required.");
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (signupPassword.length < 10) {
      setError("Administrator password must be at least 10 characters.");
      return;
    }

    setLoading(true);

    try {
      await signup(
        fullName.trim(),
        signupEmail.trim().toLowerCase(),
        signupPassword,
        schoolName.trim(),
        registrationSecret.trim()
      );
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
                Register New Institution
              </h1>
              <p className="font-body-md text-sm text-on-surface-variant font-medium">
                Authorized Provisioning of School Administrator & Campus Profile
              </p>
            </div>
          </div>

          {/* Security Notice Banner */}
          <div className="mt-4 p-3 bg-surface-container-low rounded-lg border border-surface-container-high/40 text-xs text-on-surface-variant flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-secondary shrink-0 mt-0.5">verified_user</span>
            <div>
              <strong className="text-secondary font-semibold">Restricted Access:</strong> This registration portal is reserved for authorized system deployers. A valid Registration Authorization Secret is required to provision a school.
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

          {/* Registration Form */}
          <form onSubmit={handleRegister} className="mt-space-md space-y-space-md">
            <div className="space-y-1">
              <label htmlFor="reg-secret" className="font-label-lg text-xs font-semibold text-on-surface flex items-center gap-1">
                <span>Registration Authorization Secret *</span>
                <span className="material-symbols-outlined text-[14px] text-secondary">lock</span>
              </label>
              <input
                id="reg-secret"
                type="password"
                required
                value={registrationSecret}
                onChange={(e) => setRegistrationSecret(e.target.value)}
                placeholder="Enter authorized registration secret key"
                className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-secondary/40 focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="signup-school-name" className="font-label-lg text-xs font-semibold text-on-surface">School / Campus Name *</label>
              <input
                id="signup-school-name"
                type="text"
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="e.g. Allied School Model Town Campus"
                className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="signup-full-name" className="font-label-lg text-xs font-semibold text-on-surface">Administrator Full Name *</label>
              <input
                id="signup-full-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. Tariq Mehmood"
                className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="signup-email" className="font-label-lg text-xs font-semibold text-on-surface">Official Admin Email *</label>
              <input
                id="signup-email"
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
                <label htmlFor="signup-password" className="font-label-lg text-xs font-semibold text-on-surface">Master Password *</label>
                <input
                  id="signup-password"
                  type="password"
                  required
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  minLength={10}
                  placeholder="Min 10 characters"
                  className="w-full h-11 px-3 bg-surface-container-lowest text-on-surface font-body-md text-sm rounded-lg border border-outline-variant focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="signup-confirm-password" className="font-label-lg text-xs font-semibold text-on-surface">Confirm Password *</label>
                <input
                  id="signup-confirm-password"
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
                  <span>Setting up your school...</span>
                ) : (
                  <>
                    <span>Complete School Registration</span>
                    <span className="material-symbols-outlined text-[20px]">domain_add</span>
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
    </main>
  );
}