"use client";

import {
  FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const quickCaptureLauncher = useRef<HTMLButtonElement | null>(null);

  const currentProjectId = useMemo(() => {
    if (!pathname.startsWith("/projects/")) return undefined;
    const parts = pathname.split("/");
    return parts[2];
  }, [pathname]);

  const quickCaptureFromUrl = searchParams.get("quickCapture") === "1";
  const quickCaptureProjectFromUrl = searchParams.get("qcProject") || undefined;
  const effectiveQuickCaptureOpen = quickCaptureOpen || quickCaptureFromUrl;
  const effectiveQuickCaptureProjectId = quickCaptureFromUrl
    ? quickCaptureProjectFromUrl
    : quickCaptureProjectId || currentProjectId || undefined;

  const routeLabel = useMemo(() => {
    if (pathname === "/") return "Dashboard";
    if (pathname.startsWith("/projects")) return "Projects";
    if (pathname === "/ideas") return "Ideas Inbox";
    if (pathname === "/tasks") return "Tasks";
    if (pathname === "/sessions") return "Sessions";
    if (pathname === "/search") return "Search";
    return "Developer Dashboard";
  }, [pathname]);

  const openQuickCapture = useCallback(
    (projectId?: string, trigger?: HTMLButtonElement | null) => {
      setQuickCaptureProjectId(projectId || currentProjectId || undefined);
      setQuickCaptureOpen(true);
      setShowMobileNav(false);
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
    if (!searchParams.has("quickCapture")) {
      return;
    }

    const next = new URLSearchParams(Array.from(searchParams.entries()));
    next.delete("quickCapture");
    next.delete("qcProject");
    const nextPath = next.size > 0 ? `${pathname}?${next.toString()}` : pathname;
    router.replace(nextPath);
  }, [pathname, searchParams, router]);

  const closeDialogs = useCallback(() => {
    if (effectiveQuickCaptureOpen) {
      closeQuickCapture();
      return;
    }

    setHelpOpen(false);
  }, [closeQuickCapture, effectiveQuickCaptureOpen]);

  const runQuickCaptureSave = useCallback(() => {
    if (!effectiveQuickCaptureOpen) return;
    window.dispatchEvent(new Event("developer-dashboard:quick-capture-save"));
  }, [effectiveQuickCaptureOpen]);

  const openSearch = useCallback(() => {
    setShowMobileNav(false);
    router.push("/search");
  }, [router]);

  const navigate = useCallback(
    (path: string) => {
      router.push(path);
    },
    [router],
  );

  const closeMobileNav = useCallback(() => {
    setShowMobileNav(false);
  }, []);

  const startSignin = useCallback(async () => {
    await auth.signInWithGoogle();
  }, [auth]);

  const doSignOut = useCallback(async () => {
    await auth.signOut();
  }, [auth]);

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

  useKeyboardShortcuts({
    handlers: {
      openQuickCapture,
      openSearch,
      saveCurrent: runQuickCaptureSave,
      closeActive: closeDialogs,
      help: () => setHelpOpen(true),
      navigate,
    },
  });

  const isActive = useCallback(
    (item: NavItem) => {
      if (item.href === "/" && pathname === "/") return true;
      if (item.href === "/projects" && pathname.startsWith("/projects")) return true;
      return pathname === item.href;
    },
    [pathname],
  );

  const quickCaptureActionLabel = useMemo(
    () => (currentProjectId ? "Continue here" : "Quick Capture"),
    [currentProjectId],
  );

  const desktopLinks = useMemo(
    () =>
      PRIMARY_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-label={item.label}
          aria-current={isActive(item) ? "page" : undefined}
          className={`dd-btn dd-btn--ghost min-h-[44px] min-w-[44px] rounded-lg px-3 py-2 text-sm font-medium transition ${
            isActive(item) ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}
          onClick={closeMobileNav}
        >
          {item.label}
        </Link>
      )),
    [closeMobileNav, isActive],
  );

  const mobileLinks = useMemo(
    () =>
      PRIMARY_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-label={item.label}
          onClick={closeMobileNav}
          aria-current={isActive(item) ? "page" : undefined}
          className={`min-h-[44px] min-w-[44px] rounded-lg border border-transparent px-2.5 py-2 text-center text-[11px] leading-tight ${
            isActive(item) ? "bg-slate-900 text-white" : "text-slate-700"
          } flex flex-1 flex-col items-center justify-center`}
        >
          <span>{item.label}</span>
        </Link>
      )),
    [closeMobileNav, isActive],
  );

  const onSearchSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      openSearch();
    },
    [openSearch],
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

    const localCount = Object.values(migrationState.localRecordCounts).reduce((total, value) => total + value, 0);
    const cloudCount = Object.values(migrationState.cloudRecordCounts).reduce((total, value) => total + value, 0);
    const hasCloud = cloudCount > 0;
    const isUnassignedLegacyRecovery = migrationState.markerStatus === "legacy_recovery_unassigned";

    return {
      localCount,
      cloudCount,
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

  return (
    <div className="dd-page-shell dd-surface">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[var(--container-max-width)] items-center gap-2 px-[var(--container-horizontal-padding)] py-3 sm:px-4">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 md:hidden"
            onClick={() => setShowMobileNav((current) => !current)}
            aria-expanded={showMobileNav}
            aria-controls="mobile-primary-nav"
            aria-label={showMobileNav ? "Close primary navigation" : "Open primary navigation"}
          >
            <span className="text-lg">{showMobileNav ? "✕" : "☰"}</span>
          </button>
          <h1 className="min-w-0 truncate text-sm font-semibold sm:text-base">Developer Dashboard</h1>

          <nav className="ml-1 hidden flex-1 items-center justify-center gap-2 rounded-full bg-slate-50 p-1 md:flex">
            {desktopLinks}
          </nav>

          <button
            type="button"
            onClick={() => {
              void openSearch();
            }}
            className="dd-btn dd-btn--ghost h-11 min-h-[44px] w-11 items-center justify-center rounded-lg border-slate-200 text-sm font-semibold md:flex"
            role="menuitem"
            aria-label="Open search"
            title="Search"
          >
            ⌕
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="dd-btn dd-btn--ghost h-11 min-h-[44px] w-11 items-center justify-center rounded-lg border-slate-200 text-sm font-semibold md:flex"
            role="menuitem"
            title="Keyboard shortcuts"
            aria-label="Open keyboard shortcuts help"
          >
            ?
          </button>
          <button
            type="button"
            ref={(button) => {
              quickCaptureLauncher.current = button;
            }}
            onClick={(event) => openQuickCapture(currentProjectId, event.currentTarget)}
            className="ml-auto h-11 min-h-[44px] min-w-[112px] rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
            aria-label="Open quick capture"
            title="C/N or click to open quick capture"
          >
            {quickCaptureActionLabel}
          </button>

          <div className="ml-2 flex items-center gap-2">
            {isAuthenticated && auth.user ? (
              <>
                <img
                  src={auth.user.photoURL || "https://www.gravatar.com/avatar/?d=mp"}
                  alt=""
                  className="h-8 w-8 rounded-full"
                />
                <div className="hidden max-w-[130px] truncate text-xs text-slate-700 sm:block">
                  <p className="truncate font-medium">{auth.user.displayName || "Signed in"}</p>
                  <p className="truncate text-slate-500">{auth.user.email || ""}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void doSignOut();
                  }}
                  className="dd-btn dd-btn--secondary h-11 min-h-[44px] px-3 text-xs"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void startSignin();
                }}
                className="dd-btn dd-btn--secondary h-11 min-h-[44px] px-3 text-xs"
                disabled={auth.status === "loading"}
                aria-describedby="dashboard-storage-mode"
              >
                {auth.status === "loading" ? "Checking sign-in..." : "Sign in to sync"}
              </button>
            )}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[var(--container-max-width)] items-center justify-between gap-3 px-4 py-2 text-xs text-slate-600">
          <span id="dashboard-storage-mode" className="rounded-full border border-slate-200 px-2 py-1" role="status">
            {isAuthenticated && repositoryMode === "cloud"
              ? `Cloud sync: ${syncLabel}`
              : localPersistenceStatus === "degraded"
                ? "Local mode · Persistence degraded"
              : isAuthenticated
                ? `Local mode · Cloud sync ${syncLabel.toLowerCase()}`
              : auth.status === "loading"
                ? "Local mode · Checking cloud sign-in"
                : "Local mode"}
          </span>
          {localPersistenceStatus === "degraded" ? (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800" role="alert">
              {localPersistenceError
                ?? "Local persistence is degraded. Latest work is visible only in this tab and is not durably stored."}
            </span>
          ) : null}
          {migrationNotice ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{migrationNotice.label}</span>
          ) : null}
          {!isAuthenticated && auth.lastError ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800" role="alert">
              Cloud sign-in unavailable: {auth.lastError} Local data remains available.
            </span>
          ) : null}
          {lastActionError ? (
            <button
              type="button"
              onClick={() => {
                clearLastActionError();
              }}
              className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700"
              title="Clear error"
            >
              Sync error, tap to clear
            </button>
          ) : null}
          {migrationNotice ? (
            <span className="flex items-center gap-2">
              {migrationNotice.hasCloud ? (
                <button
                  type="button"
                  onClick={() => {
                    void keepCloud();
                  }}
                  className="rounded-full border border-slate-300 bg-white px-2 py-1 text-slate-700 disabled:opacity-60"
                  disabled={isImporting || migrationState.phase !== "required"}
                >
                  {migrationNotice.keepCloudLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void startImport();
                }}
                className="rounded-full bg-emerald-700 px-2 py-1 text-white disabled:opacity-60"
                disabled={isImporting || migrationState.phase !== "required"}
              >
                {isImporting ? "Working..." : migrationNotice.importLabel}
              </button>
            </span>
          ) : null}
        </div>

        <div
          id="mobile-primary-nav"
          className={`border-t border-slate-200 bg-white p-3 md:hidden ${showMobileNav ? "block" : "hidden"}`}
        >
          <form onSubmit={onSearchSubmit} className="mb-2 flex gap-2">
            <input
              type="search"
              placeholder="Search ideas, tasks, projects"
              className="dd-input h-11"
              autoComplete="off"
              onFocus={() => setShowMobileNav(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeMobileNav();
                }
              }}
            />
            <button
              type="submit"
              className="dd-btn dd-btn--secondary h-11 px-3 text-sm"
              aria-label="Run global search"
            >
              Search
            </button>
          </form>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              className="min-h-[44px] rounded-lg border border-slate-200 px-2 py-2"
              onClick={() => {
                openSearch();
              }}
            >
              Search
            </button>
            <button
              type="button"
              className="min-h-[44px] rounded-lg border border-slate-200 px-2 py-2"
              onClick={() => {
                if (currentProjectId) {
                  router.push(`/projects/${currentProjectId}`);
                }
                setShowMobileNav(false);
              }}
              disabled={!currentProjectId}
            >
              Current project
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">{mobileLinks}</div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[var(--container-max-width)] gap-4 px-[var(--container-horizontal-padding)] py-4 pb-24 sm:px-4 xl:pb-4">
        <aside className="sticky top-20 hidden h-fit w-52 shrink-0 rounded-[var(--radius-surface)] border border-slate-200 bg-white p-3 md:block lg:w-64">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Navigation</p>
          <div className="space-y-1">{desktopLinks}</div>
        </aside>

        <main className="min-w-0 flex-1 rounded-[var(--radius-surface)] bg-white p-4 shadow-sm sm:p-6">
          <p className="mb-4 text-sm text-slate-500" role="status">
            {routeLabel}
          </p>
          {children}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div
          className="mx-auto flex h-16 max-w-[var(--container-max-width)] items-center gap-2 overflow-x-auto px-2 pb-[env(safe-area-inset-bottom)] pt-2"
          role="navigation"
          aria-label="Primary section shortcuts"
        >
          {mobileLinks}
        </div>
      </div>

      <button
        type="button"
        onClick={(event) => openQuickCapture(currentProjectId, event.currentTarget)}
        className="fixed right-4 bottom-28 z-30 inline-flex h-14 w-14 min-h-[56px] min-w-[56px] items-center justify-center rounded-full bg-emerald-600 text-2xl font-bold text-white shadow-lg transition hover:bg-emerald-500 md:bottom-6"
        aria-label="Open quick capture"
      >
        ＋
      </button>

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

      <ShortcutHelpDialog
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
        }}
      />
    </div>
  );
}
