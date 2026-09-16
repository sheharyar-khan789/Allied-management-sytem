// The /login page (src/app/login/page.tsx) is a Client Component, so it cannot itself export
// route segment config. Without this, Next.js statically prerenders /login at build time with
// no CSP nonce baked into its script tags — verified by inspecting the build output
// (.next/server/app/login.html had zero `nonce` attributes on any <script> tag). Once
// middleware starts sending a nonce-based script-src CSP, that static build would fail to
// hydrate (the browser blocks the un-nonce'd bootstrap script), breaking the login page.
// Forcing this one route segment to render per-request lets Next.js apply the real,
// per-request nonce (generated in src/middleware.ts) to its own scripts, the same way it
// already does for every other route in this app (all of which are already dynamic because
// they read the session cookie). No UI or behavior change — this file renders nothing of its
// own beyond passing children through.
export const dynamic = "force-dynamic";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
