// ROOT CAUSE of the password-reset link "loading forever": /reset-password (a Client Component page)
// was prerendered statically at build time, so its <script> tags carried no CSP nonce. The
// middleware sends `script-src 'self' 'nonce-…' 'strict-dynamic'`, and with 'strict-dynamic' a
// browser ignores 'self' and blocks every script without the nonce. React therefore never
// hydrated and the page stayed on its static "Loading…" Suspense fallback. Verified on a
// production build: /login (dynamic) had 22/22 nonce'd scripts, /reset-password had 0/21.
//
// Rendering this segment per request lets Next.js stamp the real per-request nonce on its own
// scripts, exactly as src/app/login/layout.tsx already does for /login. Nothing else changes.
export const dynamic = "force-dynamic";

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
