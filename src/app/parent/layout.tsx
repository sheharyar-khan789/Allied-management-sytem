import React, { Suspense } from "react";
import { requirePageRole } from "@/lib/page-auth";
import ParentNav from "@/components/ParentNav";
import ServiceBusyNotice from "@/components/ServiceBusyNotice";
import { ServiceUnavailableError } from "@/lib/firebase/firestore-errors";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  // See admin/layout.tsx for why this catches only a confirmed Firestore outage: that message
  // must not be shown for an unrelated, unexpected error.
  let session;
  try {
    session = await requirePageRole("PARENT");
  } catch (e) {
    if (e instanceof ServiceUnavailableError) return <ServiceBusyNotice />;
    throw e;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Suspense fallback={<div className="h-16 bg-surface-container-lowest border-b border-surface-container-low" />}>
        <ParentNav parentName={session?.name || "Parent / Guardian"} />
      </Suspense>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">{children}</main>
    </div>
  );
}
