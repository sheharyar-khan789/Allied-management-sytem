// Same fix as src/app/login/layout.tsx and src/app/reset-password/page.tsx. The registration
// page is a Client Component, so it cannot export route segment config itself; without this,
// Next.js prerenders it statically at build time with no CSP nonce on its <script> tags. The
// middleware serves this route with a nonce-based script-src ('strict-dynamic', under which
// browsers ignore 'self'), so the browser would block every script and the form would never
// hydrate. Rendering per request lets Next.js put the per-request nonce on its own scripts.
// The security policy itself is unchanged.
export const dynamic = "force-dynamic";

export default function RegisterInstitutionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
