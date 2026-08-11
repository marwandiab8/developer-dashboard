"use client";

import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebaseClient } from "../firebase/client";

const FUNCTIONS_REGION = "us-east4";

export type GitHubLastSyncStatus = "never" | "running" | "succeeded" | "failed";

export interface GitHubRateLimitState {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  resetAt: string | null;
  resource: string | null;
}

export interface GitHubConnectionStatus {
  configured: boolean;
  connected: boolean;
  ownerLogin: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncStatus: GitHubLastSyncStatus;
  synchronizationInProgress: boolean;
  rateLimit: GitHubRateLimitState | null;
  statusMessage: string;
}

export interface GitHubSyncResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  created: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  failed: number;
  rateLimit: GitHubRateLimitState | null;
}

export type GitHubClientErrorKind =
  | "authentication"
  | "authorization"
  | "not_configured"
  | "rate_limit"
  | "in_progress"
  | "unavailable"
  | "unknown";

export class GitHubClientError extends Error {
  readonly kind: GitHubClientErrorKind;
  readonly retryAt: string | null;

  constructor(kind: GitHubClientErrorKind, message: string, retryAt: string | null = null) {
    super(message);
    this.name = "GitHubClientError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

const safeTimestampDetail = (details: unknown): string | null => {
  if (!details || typeof details !== "object") return null;

  const record = details as Record<string, unknown>;
  const candidate = record.retryAt ?? record.resetAt ?? record.rateLimitResetAt;
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) return null;
  return candidate;
};

export function toGitHubClientError(error: unknown): GitHubClientError {
  if (error instanceof GitHubClientError) return error;

  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = typeof candidate.code === "string" ? candidate.code : "";
  const code = rawCode.replace(/^functions\//, "");
  const retryAt = safeTimestampDetail(candidate.details);

  if (code === "unauthenticated") {
    return new GitHubClientError("authentication", "Sign in before using GitHub synchronization.");
  }
  if (code === "permission-denied") {
    return new GitHubClientError("authorization", "This account is not authorized to use GitHub synchronization.");
  }
  if (code === "failed-precondition") {
    return new GitHubClientError(
      "not_configured",
      "GitHub synchronization is not configured on the server.",
    );
  }
  if (code === "resource-exhausted") {
    return new GitHubClientError(
      "rate_limit",
      retryAt ? `GitHub rate limit reached. Retry after ${retryAt}.` : "GitHub rate limit reached. Try again later.",
      retryAt,
    );
  }
  if (code === "aborted" || code === "already-exists") {
    return new GitHubClientError(
      "in_progress",
      "A GitHub synchronization is already running. Try again after it completes.",
    );
  }
  if (code === "unavailable") {
    return new GitHubClientError("unavailable", "GitHub synchronization is temporarily unavailable.");
  }

  return new GitHubClientError("unknown", "GitHub synchronization failed. Try again later.");
}

const callGitHubFunction = async <Response>(name: string): Promise<Response> => {
  try {
    getFirebaseClient();
    const callable = httpsCallable<Record<string, never>, Response>(
      getFunctions(getApp(), FUNCTIONS_REGION),
      name,
    );
    const response = await callable({});
    return response.data;
  } catch (error) {
    throw toGitHubClientError(error);
  }
};

export const getGitHubConnectionStatus = () =>
  callGitHubFunction<GitHubConnectionStatus>("getGitHubConnectionStatus");

export const syncGitHubRepositories = () =>
  callGitHubFunction<GitHubSyncResult>("syncGitHubRepositories");
