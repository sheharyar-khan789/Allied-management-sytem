"use client";

import React from "react";

/**
 * Error page for server-rendered portal pages. Its main case is the database being temporarily
 * unavailable (Firestore daily quota exhausted / backend unreachable): the role layouts then
 * refuse access (fail closed) by throwing instead of redirecting to /login, which used to bounce
 * between /login and the dashboard because the session cookie itself is still valid.
 */
export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-secondary">schedule</span>
        <h1 className="mt-2 text-lg font-bold text-on-surface">Service is temporarily busy</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Service is temporarily busy. Please try again in a few minutes. You are still signed in.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
