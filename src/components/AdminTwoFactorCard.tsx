"use client";

import React, { useEffect, useState } from "react";

/**
 * Admin TOTP enrollment. Renders nothing unless the deployment sets ADMIN_MFA_ENABLED=true.
 * The setup key is shown once; it is entered manually in any authenticator app (no QR library
 * is bundled, to avoid a new dependency).
 */
export default function AdminTwoFactorCard() {
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/mfa", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setFeatureEnabled(Boolean(j.featureEnabled));
        setEnrolled(Boolean(j.enrolled));
      })
      .catch(() => undefined);
  }, []);

  if (!featureEnabled) return null;

  const call = async (payload: Record<string, string>) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Request failed.");
      return j;
    } catch (e: any) {
      setMessage(e.message || "Request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-6 flex flex-col gap-3">
      <h2 className="font-h3 text-sm font-bold text-primary">Two-factor authentication</h2>
      <p className="text-xs text-on-surface-variant">
        {enrolled
          ? "Enabled. Sign-in to this administrator account requires a code from your authenticator app."
          : "Protect this administrator account with a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy)."}
      </p>

      {!enrolled && !secret && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const j = await call({ action: "setup" });
            if (j?.secret) setSecret(j.secret);
          }}
          className="self-start px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs disabled:opacity-50"
        >
          Set up two-factor
        </button>
      )}

      {!enrolled && secret && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-on-surface-variant">
            In your authenticator app choose &quot;Enter a setup key&quot;, use this key (time-based), then enter the 6-digit code it shows:
          </p>
          <code className="text-sm font-mono break-all p-2 rounded bg-surface-container">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="w-40 h-10 px-3 rounded-lg border border-outline-variant text-sm tracking-widest"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="w-48 h-10 px-3 rounded-lg border border-outline-variant text-sm"
          />
          <button
            type="button"
            disabled={busy || code.length !== 6 || !password}
            onClick={async () => {
              const j = await call({ action: "enable", code, password });
              if (j?.enrolled) {
                setEnrolled(true);
                setSecret(null);
                setCode("");
                setPassword("");
                setMessage("Two-factor authentication is now enabled.");
              }
            }}
            className="self-start px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold text-xs disabled:opacity-50"
          >
            Verify and enable
          </button>
        </div>
      )}

      {enrolled && (
        <div className="flex flex-wrap items-end gap-2">
          <input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Current code"
            className="w-36 h-10 px-3 rounded-lg border border-outline-variant text-sm tracking-widest"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="w-48 h-10 px-3 rounded-lg border border-outline-variant text-sm"
          />
          <button
            type="button"
            disabled={busy || code.length !== 6 || !password}
            onClick={async () => {
              const j = await call({ action: "disable", code, password });
              if (j && j.enrolled === false) {
                setEnrolled(false);
                setCode("");
                setPassword("");
                setMessage("Two-factor authentication has been turned off.");
              }
            }}
            className="px-4 py-2 rounded-lg bg-error-container text-on-error-container font-semibold text-xs disabled:opacity-50"
          >
            Turn off
          </button>
        </div>
      )}

      {message && <p className="text-xs text-on-surface-variant">{message}</p>}
    </div>
  );
}
