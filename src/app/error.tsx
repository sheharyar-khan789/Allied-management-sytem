"use client";

import React, { useEffect } from "react";

/**
 * Error page for server-rendered portal pages. The one confirmed, expected case — the database
 * being temporarily unavailable (Firestore daily quota exhausted / backend unreachable) — is now
 * caught inline by each role layout (see admin/layout.tsx) and shown with ServiceBusyNotice
 * instead of reaching here, so this boundary's own message no longer needs to (and must not)
 * blame quota exhaustion for an error it can't actually identify: Next.js redacts the real
 * server-side error message/type in production, leaving only `error.digest` — a hash you can
 * search for in the Vercel function logs, where the real cause (and its own specific message)
 * was already logged by whichever call actually threw it.
 */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[PortalError] Unexpected error rendering this page. Digest:", error.digest, error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-error">error</span>
        <h1 className="mt-2 text-lg font-bold text-on-surface">Something went wrong</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          This page ran into an unexpected error. You are still signed in — try again, or go back
          and retry the action.
          {error.digest && (
            <>
              {" "}
              <span className="font-mono text-[11px]">(Reference: {error.digest})</span>
            </>
          )}
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
