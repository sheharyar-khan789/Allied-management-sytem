import React from "react";

/**
 * Rendered in place of a role layout's normal content when Firestore is confirmed unavailable
 * (quota exhausted or unreachable) — never for any other kind of failure. Previously the
 * session-revocation check (requirePageRole) threw this straight past every layout's own
 * try/catch and into the generic app/error.tsx boundary, which blames "Service is temporarily
 * busy" for literally any uncaught error, including ones that have nothing to do with Firestore.
 * Catching the confirmed case here, inline, keeps that message accurate and lets error.tsx stay
 * honest for everything else.
 */
export default function ServiceBusyNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-secondary">schedule</span>
        <h1 className="mt-2 text-lg font-bold text-on-surface">Service is temporarily busy</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Service is temporarily busy. Please try again in a few minutes. You are still signed in.
        </p>
        <a
          href="."
          className="mt-4 inline-block px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold"
        >
          Try again
        </a>
      </div>
    </div>
  );
}
