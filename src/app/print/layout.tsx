import React from "react";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background print:bg-white">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 print:max-w-none print:px-0 print:py-0">{children}</main>
    </div>
  );
}
