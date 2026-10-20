"use client";

import React, { useEffect } from "react";
import { SERVICE_BUSY_MESSAGE, isServiceBusyDigest } from "@/lib/firebase/firestore-errors";

/**
 * Error page for portal pages. One of its cases is the database being temporarily unavailable
 * (Firestore daily quota exhausted / backend unreachable), where the role layouts refuse access
 * (fail closed) by throwing instead of redirecting to /login.
 *
 * It used to say "Service is temporarily busy" for EVERY error — including ordinary client-side
 * exceptions on a page — so a real bug looked like a quota problem and could never be told apart
 * from one. The busy wording is now used only for a real outage (a ServiceUnavailableError,
 * recognised by its digest prefix in production, where Next.js hides server error messages).
 * Anything else says honestly that the page couldn't load and shows the digest, which matches the
 * server log line for the same failure.
 */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Production server errors arrive with a generic message; a real outage is recognised by the
  // digest ServiceUnavailableError carries (see SERVICE_BUSY_DIGEST_PREFIX).
  const busy =
    isServiceBusyDigest(error?.digest) ||
    error?.message === SERVICE_BUSY_MESSAGE ||
    error?.name === "ServiceUnavailableError";

  useEffect(() => {
    console.error("[PortalError]", error?.name, error?.message, error?.digest ? `digest=${error.digest}` : "");
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-secondary">{busy ? "schedule" : "error"}</span>
        <h1 className="mt-2 text-lg font-bold text-on-surface">
          {busy ? "Service is temporarily busy" : "This page couldn't be loaded"}
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          {busy
            ? `${SERVICE_BUSY_MESSAGE} You are still signed in.`
            : "Something went wrong while loading this page. It may be temporary — please try again. You are still signed in."}
        </p>
        {error?.digest ? (
          <p className="mt-2 text-[11px] text-on-surface-variant font-mono">Reference: {error.digest}</p>
        ) : null}
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
