import type { Metadata } from "next";
import { AppShell } from "../components/AppShell";
import { DashboardProvider } from "../lib/repositories/repositoryContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Developer Dashboard",
  description: "Local-first developer brain for ideas, tasks, prompts, and resume",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <DashboardProvider>
          <AppShell>{children}</AppShell>
        </DashboardProvider>
      </body>
    </html>
  );
}
