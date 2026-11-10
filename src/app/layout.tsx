import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Allied School Management System",
  description: "Comprehensive SaaS School Management & Academic Operations Platform",
  openGraph: {
    title: "Allied School Management System",
    description: "Secure school operations, academics, attendance, fees, and parent communication.",
    type: "website",
  },
  icons: {
    icon: "/images/logo.png",
  },
};

import { AuthProvider } from "@/lib/firebase/auth-context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background font-body-md text-on-surface antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
