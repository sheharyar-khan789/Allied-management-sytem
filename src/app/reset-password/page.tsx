import { Suspense } from "react";
import { ResetPasswordForm } from "./ResetPasswordForm";

// Must render per request, exactly like /login (see src/app/login/layout.tsx). Middleware sends a
// nonce-based CSP (script-src 'nonce-…' 'strict-dynamic', under which browsers ignore 'self'),
// and Next.js can only put that per-request nonce on its <script> tags when the page is rendered
// dynamically. Prerendered statically (the default for this page), it was served with 21 script
// tags and none carrying the nonce — verified against a local `next build && next start` of the
// previous code — so the browser blocked every script, the page never hydrated, and it stayed on
// the Suspense fallback "Loading password reset..." indefinitely. Rendered dynamically, every
// script carries the nonce and the real form (with the token from the URL) is in the HTML.
export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-surface-container-low py-12 px-4 sm:px-6">
      <Suspense
        fallback={
          <div className="bg-surface-container-lowest border border-surface-container-high/50 shadow-xl rounded-2xl p-10 w-full max-w-md mx-4 text-center">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-xs text-on-surface-variant">Loading password reset...</p>
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
