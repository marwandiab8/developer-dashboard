import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "../components/AppShell";
import { AuthProvider } from "../lib/auth/AuthProvider";
import { DashboardProvider } from "../lib/repositories/repositoryContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Developer Dashboard",
  description: "External development brain for ideas, tasks, prompts, and resume",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <AuthProvider>
          <DashboardProvider>
            <Suspense fallback={<main className="min-h-screen bg-slate-50" aria-label="Loading dashboard" />}>
              <AppShell>{children}</AppShell>
            </Suspense>
          </DashboardProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
