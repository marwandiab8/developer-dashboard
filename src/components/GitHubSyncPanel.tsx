"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGitHubConnectionStatus,
  syncGitHubRepositories,
  toGitHubClientError,
  type GitHubConnectionStatus,
  type GitHubRateLimitState,
  type GitHubSyncResult,
} from "../lib/github/client";
import { useAuth } from "../lib/auth/useAuth";

type PanelPhase = "checking" | "ready" | "syncing" | "error";

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

function RateLimitSummary({ rateLimit }: { rateLimit: GitHubRateLimitState | null }) {
  if (!rateLimit) return null;

  return (
    <p className="text-xs text-slate-500">
      GitHub API: {rateLimit.remaining ?? "unknown"}
      {rateLimit.limit !== null ? ` of ${rateLimit.limit}` : ""} requests remaining
      {rateLimit.resetAt ? `; resets ${formatDateTime(rateLimit.resetAt)}` : ""}.
    </p>
  );
}

function GitHubSyncPanelForAuth({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const cloudAvailable = auth.status === "authenticated" && Boolean(auth.user);
  const [phase, setPhase] = useState<PanelPhase>("checking");
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [result, setResult] = useState<GitHubSyncResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadConnectionStatus = useCallback(async () => {
    if (!cloudAvailable) {
      setStatus(null);
      setResult(null);
      setErrorMessage(null);
      setPhase("ready");
      return;
    }

    setPhase("checking");
    setErrorMessage(null);
    try {
      const nextStatus = await getGitHubConnectionStatus();
      setStatus(nextStatus);
      setPhase("ready");
    } catch (error) {
      setStatus(null);
      setErrorMessage(toGitHubClientError(error).message);
      setPhase("error");
    }
  }, [cloudAvailable]);

  useEffect(() => {
    let subscribed = true;

    if (!cloudAvailable) {
      return () => {
        subscribed = false;
      };
    }

    void getGitHubConnectionStatus().then(
      (nextStatus) => {
        if (!subscribed) return;
        setStatus(nextStatus);
        setPhase("ready");
      },
      (error) => {
        if (!subscribed) return;
        setStatus(null);
        setErrorMessage(toGitHubClientError(error).message);
        setPhase("error");
      },
    );

    return () => {
      subscribed = false;
    };
  }, [cloudAvailable]);

  const hasImported = Boolean(status?.lastSuccessfulSyncAt);
  const synchronizationInProgress = phase === "syncing" || Boolean(status?.synchronizationInProgress);
  const actionLabel = !cloudAvailable
    ? "Sign in to sync GitHub"
    : synchronizationInProgress
      ? "Synchronizing GitHub..."
      : hasImported
        ? "Sync GitHub"
        : "Import GitHub Projects";
  const actionDisabled = !cloudAvailable || synchronizationInProgress || !status?.configured || !status.connected;

  const connectionLabel = useMemo(() => {
    if (!cloudAvailable) return auth.status === "loading" ? "Cloud sign-in pending" : "Sign in required";
    if (!status) return "Unavailable";
    if (!status.configured) return "Not configured";
    if (!status.connected) return "Configured, connection unavailable";
    return status.ownerLogin ? `Connected as @${status.ownerLogin}` : "Connected";
  }, [auth.status, cloudAvailable, status]);

  const startSynchronization = async () => {
    if (actionDisabled) return;

    setPhase("syncing");
    setResult(null);
    setErrorMessage(null);
    try {
      const nextResult = await syncGitHubRepositories();
      setResult(nextResult);
      setStatus((current) => current ? {
        ...current,
        connected: true,
        lastSuccessfulSyncAt: nextResult.completedAt,
        lastSyncStatus: "succeeded",
        synchronizationInProgress: false,
        rateLimit: nextResult.rateLimit,
        statusMessage: "GitHub synchronization completed.",
      } : current);
      setPhase("ready");
    } catch (error) {
      setErrorMessage(toGitHubClientError(error).message);
      setPhase("error");
    }
  };

  return (
    <section className="dd-panel space-y-3" aria-labelledby="github-sync-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="dd-subtitle">Server-side read-only connection</p>
          <h1 id="github-sync-heading" className="dd-section-title text-xl">GitHub repository sync</h1>
          <p className="mt-1 text-sm text-slate-600">
            Imports every repository accessible to the configured GitHub account. Dashboard work remains protected.
          </p>
        </div>
        <span className={`dd-badge ${cloudAvailable && status?.connected ? "dd-badge--active" : ""}`}>
          {cloudAvailable && phase === "checking" ? "Checking connection..." : connectionLabel}
        </span>
      </div>

      {cloudAvailable && status ? (
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p><span className="font-medium">Last successful sync:</span> {formatDateTime(status.lastSuccessfulSyncAt)}</p>
          <p><span className="font-medium">Last sync state:</span> {status.lastSyncStatus.replaceAll("_", " ")}</p>
        </div>
      ) : null}

      {!cloudAvailable ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" role="status">
          GitHub synchronization is unavailable in local mode. Sign in to enable cloud synchronization; local projects remain available.
        </p>
      ) : null}

      {cloudAvailable && status && !status.configured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          GitHub synchronization is not configured. Add the server-side secret and owner UID before importing.
        </p>
      ) : null}

      {cloudAvailable && status?.configured && !status.connected ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          {status.statusMessage || "The server could not verify the GitHub connection."}
        </p>
      ) : null}

      {cloudAvailable && errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {cloudAvailable && result ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-5" aria-live="polite">
          <p><span className="block text-xs text-slate-500">Created</span><strong>{result.created}</strong></p>
          <p><span className="block text-xs text-slate-500">Updated</span><strong>{result.updated}</strong></p>
          <p><span className="block text-xs text-slate-500">Unchanged</span><strong>{result.unchanged}</strong></p>
          <p><span className="block text-xs text-slate-500">Unavailable</span><strong>{result.unavailable}</strong></p>
          <p><span className="block text-xs text-slate-500">Failed</span><strong>{result.failed}</strong></p>
        </div>
      ) : null}

      {cloudAvailable ? <RateLimitSummary rateLimit={result?.rateLimit ?? status?.rateLimit ?? null} /> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="dd-btn dd-btn--primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actionDisabled}
          onClick={() => {
            void startSynchronization();
          }}
        >
          {actionLabel}
        </button>
        {cloudAvailable && phase === "error" ? (
          <button type="button" className="dd-btn dd-btn--secondary" onClick={() => void loadConnectionStatus()}>
            Check connection again
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function GitHubSyncPanel() {
  const auth = useAuth();
  const authenticatedUserKey = `${auth.status}:${auth.user?.uid ?? "none"}`;

  return <GitHubSyncPanelForAuth key={authenticatedUserKey} auth={auth} />;
}
