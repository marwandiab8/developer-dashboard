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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
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
  } = useDashboard();

  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureProjectId, setQuickCaptureProjectId] = useState<string | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const quickCaptureLauncher = useRef<HTMLButtonElement | null>(null);

  const currentProjectId = useMemo(() => {
    const match = pathname.match(/^\/projects\/([^/]+)/);
    return match?.[1];
  }, [pathname]);

  const quickCaptureFromUrl = searchParams.get("quickCapture") === "1";
  const quickCaptureProjectFromUrl = searchParams.get("qcProject") || undefined;
  const effectiveQuickCaptureOpen = quickCaptureOpen || quickCaptureFromUrl;
  const effectiveQuickCaptureProjectId = quickCaptureFromUrl
    ? quickCaptureProjectFromUrl
    : quickCaptureProjectId || currentProjectId;

  const openQuickCapture = useCallback(
    (projectId?: string, trigger?: HTMLButtonElement | null) => {
      setQuickCaptureProjectId(projectId || currentProjectId);
      setQuickCaptureOpen(true);
      quickCaptureLauncher.current = trigger instanceof HTMLButtonElement ? trigger : null;
    },
    [currentProjectId],
  );

  const clearQuickCaptureUrl = useCallback(() => {
    if (!searchParams.has("quickCapture")) return;
    const next = new URLSearchParams(Array.from(searchParams.entries()));
    next.delete("quickCapture");
    next.delete("qcProject");
    router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
  }, [pathname, router, searchParams]);

  const closeQuickCapture = useCallback(() => {
    if (effectiveQuickCaptureOpen) {
      window.dispatchEvent(new Event("developer-dashboard:quick-capture-close"));
    }
  }, [effectiveQuickCaptureOpen]);

  const closeDialogs = useCallback(() => {
    if (effectiveQuickCaptureOpen) {
      closeQuickCapture();
      return;
    }
    setHelpOpen(false);
  }, [closeQuickCapture, effectiveQuickCaptureOpen]);

  const runQuickCaptureSave = useCallback(() => {
    if (effectiveQuickCaptureOpen) {
      window.dispatchEvent(new Event("developer-dashboard:quick-capture-save"));
    }
  }, [effectiveQuickCaptureOpen]);

  const navigate = useCallback((path: string) => router.push(path), [router]);

  useKeyboardShortcuts({
    handlers: {
      openQuickCapture,
      openSearch: () => router.push("/search"),
      saveCurrent: runQuickCaptureSave,
      closeActive: closeDialogs,
      help: () => setHelpOpen(true),
      navigate,
    },
  });

  const isActive = useCallback(
    (item: NavItem) => {
      if (item.href === "/") return pathname === "/";
      return pathname.startsWith(item.href);
    },
    [pathname],
  );

  const navLinks = PRIMARY_NAV.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item) ? "page" : undefined}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium transition ${
        isActive(item)
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {item.label}
    </Link>
  ));

  const syncLabel = useMemo(() => {
    if (syncStatus === "saving") return "Saving changes";
    if (syncStatus === "offline") return "Offline";
    if (syncStatus === "error") return "Sync problem";
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
    const isRecovery = migrationState.markerStatus === "legacy_recovery_unassigned";

    return {
      hasCloud,
      label: isRecovery
        ? "A local recovery is waiting to be connected to this account."
        : hasCloud
          ? "Local and cloud data are both available. Choose which data to keep."
          : "Your local work is ready to be added to cloud sync.",
      importLabel: isRecovery ? "Connect and import" : "Import local work",
      keepCloudLabel: isRecovery ? "Connect and keep cloud" : "Keep cloud work",
    };
  }, [auth.status, auth.user, migrationState]);

  const isAuthenticated = auth.status === "authenticated" && Boolean(auth.user);
  const accountInitial = auth.user?.displayName?.trim().charAt(0)
    || auth.user?.email?.trim().charAt(0)
    || "M";

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
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-2 px-4">
          <Link href="/" className="mr-2 whitespace-nowrap text-base font-bold tracking-tight text-slate-950">
            Dev Home
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {navLinks}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => router.push("/search")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-lg text-slate-600 hover:bg-slate-100"
              aria-label="Search"
              title="Search"
            >
              ⌕
            </button>
            <button
              type="button"
              ref={(button) => {
                quickCaptureLauncher.current = button;
              }}
              onClick={(event) => openQuickCapture(currentProjectId, event.currentTarget)}
              className="hidden h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500 sm:inline-flex"
              aria-label="Open quick capture"
            >
              + Add idea
            </button>

            <details className="group relative">
              <summary
                className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full bg-slate-900 text-sm font-bold uppercase text-white marker:content-none"
                aria-label="Account and settings"
              >
                {accountInitial}
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-xl">
                {isAuthenticated && auth.user ? (
                  <>
                    <p className="font-semibold text-slate-900">{auth.user.displayName || "Signed in"}</p>
                    <p className="truncate text-xs text-slate-500">{auth.user.email || ""}</p>
                    <p className="mt-3 text-xs text-slate-500">
                      {repositoryMode === "cloud" ? syncLabel : `Local mode · ${syncLabel}`}
                    </p>
                    <div className="mt-3 grid gap-2">
                      <button
                        type="button"
                        onClick={() => setHelpOpen(true)}
                        className="dd-btn dd-btn--secondary w-full"
                      >
                        Keyboard shortcuts
                      </button>
                      <button
                        type="button"
                        onClick={() => void auth.signOut()}
                        className="dd-btn dd-btn--secondary w-full"
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-900">Working locally</p>
                    <p className="mt-1 text-xs text-slate-500">Sign in only when you want cloud sync.</p>
                    <button
                      type="button"
                      onClick={() => void auth.signInWithGoogle()}
                      className="dd-btn dd-btn--primary mt-3 w-full"
                      disabled={auth.status === "loading"}
                    >
                      {auth.status === "loading" ? "Checking sign-in…" : "Sign in to sync"}
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>
        </div>

      </header>

      {localPersistenceStatus === "degraded" ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-800" role="alert">
          {localPersistenceError || "Your latest changes are visible here but are not stored safely yet."}
        </div>
      ) : null}

      {!isAuthenticated && auth.lastError ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800" role="alert">
          Cloud sign-in is unavailable. Your local data remains available.
        </div>
      ) : null}

      {lastActionError ? (
        <button
          type="button"
          onClick={clearLastActionError}
          className="block w-full border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-800"
        >
          A change could not be synced. Tap to dismiss.
        </button>
      ) : null}

      {migrationNotice ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
            <p>{migrationNotice.label}</p>
            <div className="flex gap-2">
              {migrationNotice.hasCloud ? (
                <button
                  type="button"
                  onClick={() => void keepCloud()}
                  className="dd-btn dd-btn--secondary"
                  disabled={isImporting}
                >
                  {migrationNotice.keepCloudLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void startImport()}
                className="dd-btn dd-btn--primary"
                disabled={isImporting}
              >
                {isImporting ? "Working…" : migrationNotice.importLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-6xl px-4 py-6 pb-24 sm:py-8 md:pb-8">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur md:hidden"
        aria-label="Quick navigation"
      >
        {navLinks}
        <button
          type="button"
          onClick={(event) => openQuickCapture(currentProjectId, event.currentTarget)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-emerald-700"
          aria-label="Open quick capture"
        >
          + Add
        </button>
      </nav>

      <QuickCaptureDialog
        key={`qc-${effectiveQuickCaptureOpen ? `open-${effectiveQuickCaptureProjectId ?? "none"}` : "closed"}`}
        open={effectiveQuickCaptureOpen}
        onClose={() => {
          setQuickCaptureOpen(false);
          clearQuickCaptureUrl();
          const restoreFocus = quickCaptureLauncher.current;
          if (restoreFocus?.isConnected) {
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
