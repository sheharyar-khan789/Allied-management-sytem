// Same fix as src/app/reset-password/layout.tsx: this Client Component page was prerendered
// statically, so its scripts had no CSP nonce and were blocked by the nonce-based policy
// (browser never hydrates the page). Rendering per request lets Next.js apply the nonce.
export const dynamic = "force-dynamic";

export default function RegisterInstitutionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
