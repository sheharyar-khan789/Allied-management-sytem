import React, { Suspense } from "react";
import { getAuthenticatedUser } from "@/lib/firebase/server-auth";
import ParentNav from "@/components/ParentNav";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuthenticatedUser();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 bg-surface-container-lowest border-b border-surface-container-low" />}>
        <ParentNav parentName={session?.name || "Parent / Guardian"} />
      </Suspense>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">{children}</main>
    </div>
  );
}
