"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PRIMARY_NAV } from "../lib/constants";
import { useKeyboardShortcuts } from "../lib/hooks/useKeyboardShortcuts";
import { useAuth } from "../lib/auth/useAuth";
import { useDashboard } from "../lib/repositories/repositoryContext";
import { QuickCaptureDialog } from "./QuickCaptureDialog";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";

type NavItem = (typeof PRIMARY_NAV)[number];

function NavIcon({ label }: { label: NavItem["label"] }) {
  if (label === "Home") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m3 11 9-8 9 8" />
        <path d="M5.5 9.5V21h13V9.5" />
      </svg>
    );
  }

  if (label === "Projects") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 6.5h7l2 2h9v10.5H3z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 3.5h8v17H8z" />
      <path d="M5 7h3M16 7h3M5 12h3M16 12h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const dashboard = useDashboard();

  const {
    beginMigrationImport,
    beginMigrationKeepCloud,
    migrationState,
    repositoryMode,
    localPersistenceStatus,
    localPersistenceError,
    syncStatus,
    lastActionError,
    clearLastActionError,
  } = dashboard;

  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureProjectId, setQuickCaptureProjectId] = useState<string | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const quickCaptureLauncher = useRef<HTMLButtonElement | null>(null);

  const currentProjectId = useMemo(() => {
    if (!pathname.startsWith("/projects/")) return undefined;
    return pathname.split("/")[2];
  }, [pathname]);

  const quickCaptureFromUrl = searchParams.get("quickCapture") === "1";
  const quickCaptureProjectFromUrl = searchParams.get("qcProject") || undefined;
  const effectiveQuickCaptureOpen = quickCaptureOpen || quickCaptureFromUrl;
  const effectiveQuickCaptureProjectId = quickCaptureFromUrl
    ? quickCaptureProjectFromUrl
    : quickCaptureProjectId || currentProjectId || undefined;

  const openQuickCapture = useCallback(
    (projectId?: string, trigger?: HTMLButtonElement | null) => {
      setQuickCaptureProjectId(projectId || currentProjectId || undefined);
      setQuickCaptureOpen(true);
      quickCaptureLauncher.current = trigger instanceof HTMLButtonElement ? trigger : null;
    },
    [currentProjectId],
  );

  const closeQuickCapture = useCallback(() => {
    if (effectiveQuickCaptureOpen) {
      window.dispatchEvent(new Event("developer-dashboard:quick-capture-close"));
    }
  }, [effectiveQuickCaptureOpen]);

  const clearQuickCaptureUrl = useCallback(() => {
    if (!searchParams.has("quickCapture")) return;

    const next = new URLSearchParams(Array.from(searchParams.entries()));
    next.delete("quickCapture");
    next.delete("qcProject");
    router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
  }, [pathname, router, searchParams]);

  const runQuickCaptureSave = useCallback(() => {
    if (effectiveQuickCaptureOpen) {
      window.dispatchEvent(new Event("developer-dashboard:quick-capture-save"));
    }
  }, [effectiveQuickCaptureOpen]);

  const openSearch = useCallback(() => {
    router.push("/search");
  }, [router]);

  useKeyboardShortcuts({
    handlers: {
      openQuickCapture,
      openSearch,
      saveCurrent: runQuickCaptureSave,
      closeActive: () => {
        if (effectiveQuickCaptureOpen) {
          closeQuickCapture();
        } else {
          setHelpOpen(false);
        }
      },
      help: () => setHelpOpen(true),
      navigate: (path) => router.push(path),
    },
  });

  const isActive = useCallback(
    (item: NavItem) => {
      if (item.href === "/") return pathname === "/";
      if (item.href === "/projects") return pathname.startsWith("/projects");
      return pathname === item.href;
    },
    [pathname],
  );

  const syncLabel = useMemo(() => {
    if (syncStatus === "saving") return "Saving";
    if (syncStatus === "offline") return "Offline";
    if (syncStatus === "error") return "Sync error";
    if (syncStatus === "loading") return "Loading";
    return "Synced";
  }, [syncStatus]);

  const migrationNotice = useMemo(() => {
    if (auth.status !== "authenticated" || !auth.user || migrationState.phase !== "required") {
      return null;
    }

    const cloudCount = Object.values(migrationState.cloudRecordCounts)
      .reduce((total, value) => total + value, 0);
    const hasCloud = cloudCount > 0;
    const isUnassignedLegacyRecovery = migrationState.markerStatus === "legacy_recovery_unassigned";

    return {
      hasCloud,
      label: isUnassignedLegacyRecovery
        ? "Legacy recovery is local-only until you explicitly associate it with this account."
        : hasCloud
          ? "Cloud already has data. Review before you merge."
          : "Cloud is empty. Import local data to start cloud sync.",
      importLabel: isUnassignedLegacyRecovery
        ? "Associate recovery and import"
        : "Import local backup",
      keepCloudLabel: isUnassignedLegacyRecovery
        ? "Associate recovery, then keep cloud"
        : "Keep cloud data",
    };
  }, [auth.status, auth.user, migrationState]);

  const isAuthenticated = auth.status === "authenticated" && Boolean(auth.user);
  const storageLabel = isAuthenticated && repositoryMode === "cloud"
    ? `Cloud sync: ${syncLabel}`
    : localPersistenceStatus === "degraded"
      ? "Local mode · Persistence degraded"
      : isAuthenticated
        ? `Local mode · Cloud sync ${syncLabel.toLowerCase()}`
        : auth.status === "loading"
          ? "Local mode · Checking cloud sign-in"
          : "Local mode";

  const issueMessages = useMemo(() => {
    const messages: string[] = [];
    if (localPersistenceStatus === "degraded") {
      messages.push(localPersistenceError
        ?? "Local persistence is degraded. Latest work is visible only in this tab and is not durably stored.");
    }
    if (!isAuthenticated && auth.lastError) {
      messages.push(`Cloud sign-in unavailable: ${auth.lastError} Local data remains available.`);
    }
    if (isAuthenticated && repositoryMode === "cloud" && ["offline", "error"].includes(syncStatus)) {
      messages.push(syncStatus === "offline" ? "Cloud sync is offline." : "Cloud sync needs attention.");
    }
    if (lastActionError) messages.push("A recent cloud action needs attention. Your local work is still available.");
    if (migrationNotice) messages.push(migrationNotice.label);
    return [...new Set(messages)];
  }, [
    auth.lastError,
    isAuthenticated,
    lastActionError,
    localPersistenceError,
    localPersistenceStatus,
    migrationNotice,
    repositoryMode,
    syncStatus,
  ]);

  const accountInitial = auth.user?.displayName?.trim().charAt(0)
    || auth.user?.email?.trim().charAt(0)
    || "A";

  const startImport = useCallback(async () => {
    setIsImporting(true);
    try {
      await beginMigrationImport();
    } finally {
      setIsImporting(false);
    }
  }, [beginMigrationImport]);

  const keepCloud = useCallback(async () => {
    setIsImporting(true);
    try {
      await beginMigrationKeepCloud();
    } finally {
      setIsImporting(false);
    }
  }, [beginMigrationKeepCloud]);

  return (
    <div className="dd-page-shell dd-surface">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[var(--container-max-width)] items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            href="/"
            className="min-w-0 shrink text-sm font-semibold tracking-tight text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:text-base"
          >
            <span className="hidden sm:inline">Developer Dashboard</span>
            <span className="sm:hidden">Dashboard</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isActive(item) ? "bg-slate-100 text-slate-950" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={openSearch}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Search"
              title="Search"
            >
              <SearchIcon />
            </button>
            <div className="hidden md:block">
              <button
                type="button"
                onClick={(event) => openQuickCapture(currentProjectId, event.currentTarget)}
                className="dd-btn dd-btn--primary"
                aria-label="Open quick capture"
              >
                + Add idea
              </button>
            </div>

            <details className="relative">
              <summary
                className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full bg-slate-950 text-sm font-semibold uppercase text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                aria-label="Open account menu"
              >
                {isAuthenticated ? accountInitial : "A"}
              </summary>
              <div className="absolute right-0 mt-3 w-[min(21rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                {isAuthenticated && auth.user ? (
                  <div>
                    <p className="font-semibold text-slate-950">{auth.user.displayName || "Signed in"}</p>
                    {auth.user.email ? <p className="mt-0.5 truncate text-sm text-slate-500">{auth.user.email}</p> : null}
                  </div>
                ) : (
                  <div>
                    <p className="font-semibold text-slate-950">Local workspace</p>
                    <p className="mt-1 text-sm text-slate-500">Sign in only when you want cloud sync.</p>
                  </div>
                )}

                <div className="mt-4 rounded-xl bg-slate-50 p-3">
                  <p id="dashboard-storage-mode" className="text-sm font-medium text-slate-800" role="status">
                    {storageLabel}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {repositoryMode === "cloud" && isAuthenticated
                      ? "Your dashboard is connected to your account."
                      : "Your dashboard remains fully usable on this device."}
                  </p>
                </div>

                {migrationNotice ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm leading-5 text-amber-900">{migrationNotice.label}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {migrationNotice.hasCloud ? (
                        <button
                          type="button"
                          onClick={() => void keepCloud()}
                          className="dd-btn dd-btn--secondary min-h-10 px-3 py-1.5 text-xs"
                          disabled={isImporting || migrationState.phase !== "required"}
                        >
                          {migrationNotice.keepCloudLabel}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void startImport()}
                        className="dd-btn dd-btn--primary min-h-10 px-3 py-1.5 text-xs"
                        disabled={isImporting || migrationState.phase !== "required"}
                      >
                        {isImporting ? "Working..." : migrationNotice.importLabel}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    className="min-h-11 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    Keyboard shortcuts
                  </button>
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => void auth.signOut()}
                      className="min-h-11 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      Sign out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void auth.signInWithGoogle()}
                      className="dd-btn dd-btn--secondary justify-start"
                      disabled={auth.status === "loading"}
                      aria-describedby="dashboard-storage-mode"
                    >
                      {auth.status === "loading" ? "Checking sign-in..." : "Sign in to sync"}
                    </button>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>

        {issueMessages.length > 0 ? (
          <div className="border-t border-amber-200 bg-amber-50" role="alert">
            <div className="mx-auto flex w-full max-w-[var(--container-max-width)] items-start justify-between gap-3 px-4 py-2.5 text-sm text-amber-950 sm:px-6">
              <div className="space-y-1">
                {issueMessages.map((message) => <p key={message}>{message}</p>)}
              </div>
              {lastActionError ? (
                <button
                  type="button"
                  onClick={clearLastActionError}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[var(--content-max-width)] px-4 py-8 pb-28 sm:px-6 sm:py-10 md:pb-12">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Mobile navigation"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-4 items-stretch">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item) ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isActive(item) ? "text-slate-950" : "text-slate-500"
              }`}
            >
              <NavIcon label={item.label} />
              <span>{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={(event) => openQuickCapture(currentProjectId, event.currentTarget)}
            className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Open quick capture"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-700 text-base leading-none text-white">+</span>
            <span>Add</span>
          </button>
        </div>
      </nav>

      <QuickCaptureDialog
        key={`qc-${effectiveQuickCaptureOpen ? `open-${effectiveQuickCaptureProjectId ?? "none"}` : "closed"}`}
        open={effectiveQuickCaptureOpen}
        onClose={() => {
          setQuickCaptureOpen(false);
          clearQuickCaptureUrl();
          const restoreFocus = quickCaptureLauncher.current;
          if (restoreFocus && restoreFocus.isConnected) {
            restoreFocus.focus({ preventScroll: true });
          }
          quickCaptureLauncher.current = null;
        }}
        projectId={effectiveQuickCaptureProjectId}
      />

      <ShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
