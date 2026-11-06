import React from "react";

// Rendered per request so the CSP nonce is applied to the page's scripts (a prerendered page has no
// nonce and would never hydrate under the site's strict-dynamic CSP).
export const dynamic = "force-dynamic";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background print:bg-white">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 print:max-w-none print:px-0 print:py-0">{children}</main>
    </div>
  );
}
