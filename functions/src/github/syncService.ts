import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { safeErrorCode } from "./auth";
import { enrichWithBoundedConcurrency, GithubClient, type FetchImplementation } from "./client";
import { normalizeGithubRepository } from "./normalize";
import { isLeaseActive, scheduledKeyFor, type GithubPersistencePort } from "./persistence";
import { mergeRateLimitState } from "./rateLimit";
import { GithubApiError, type GithubConnectionResponse, type GithubSyncCounts, type GithubSyncMode, type GithubSyncResponse, type NormalizedGithubRepository, type SyncFailureStage } from "./types";

type SafeLogger = { info(message: string, details?: Record<string, unknown>): void; warn(message: string, details?: Record<string, unknown>): void };
const silentLogger: SafeLogger = { info: () => undefined, warn: () => undefined };

const settleUnlessRateLimited = async <T>(request: Promise<T>): Promise<PromiseSettledResult<T>> => {
  try {
    return { status: "fulfilled", value: await request };
  } catch (error) {
    if (error instanceof GithubApiError && error.safeCode === "rate_limited") throw error;
    return { status: "rejected", reason: error };
  }
};

export class GithubSyncService {
  private readonly now: () => Date;
  private readonly runId: () => string;
  private readonly logger: SafeLogger;

  constructor(private readonly options: {
    persistence: GithubPersistencePort;
    fetchImplementation?: FetchImplementation;
    now?: () => Date;
    generateRunId?: () => string;
    logger?: SafeLogger;
  }) {
    this.now = options.now ?? (() => new Date());
    this.runId = options.generateRunId ?? randomUUID;
    this.logger = options.logger ?? silentLogger;
  }

  private client(credential: string) {
    return new GithubClient(credential, this.options.fetchImplementation);
  }

  async getConnectionStatus(uid: string, credential: string | null): Promise<GithubConnectionResponse> {
    const state = await this.options.persistence.getState(uid);
    const status = state?.status === "running" || state?.status === "succeeded" || state?.status === "failed" ? state.status : "never";
    const running = isLeaseActive(state, this.now());
    if (!credential) return {
      configured: false, connected: false, ownerLogin: null,
      lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null, lastSyncStatus: status,
      synchronizationInProgress: running, rateLimit: state?.lastRateLimit ?? null,
      statusMessage: "GitHub connection is not configured.",
    };
    const client = this.client(credential);
    try {
      const user = await client.getAuthenticatedUser();
      return {
        configured: true, connected: true, ownerLogin: user.login,
        lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null, lastSyncStatus: status,
        synchronizationInProgress: running,
        rateLimit: mergeRateLimitState(state?.lastRateLimit, client.rateLimit),
        statusMessage: "GitHub connection is available.",
      };
    } catch (error) {
      return {
        configured: true, connected: false, ownerLogin: state?.connectedOwnerLogin ?? null,
        lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? null, lastSyncStatus: status,
        synchronizationInProgress: running,
        rateLimit: mergeRateLimitState(state?.lastRateLimit, client.rateLimit),
        statusMessage: error instanceof GithubApiError && error.safeCode === "rate_limited"
          ? "GitHub rate limit reached."
          : "GitHub authorization is unavailable.",
      };
    }
  }

  private async retrieve(client: GithubClient, login: string, syncedAt: string) {
    const listed = await client.listAllRepositories(login);
    const visibleRepositoryIds = new Set(listed.map((repository) => String(repository.id)));
    const results = await enrichWithBoundedConcurrency(listed, async (repository) => {
      const failures: string[] = [];
      const pullsRequest = client.getOpenPullRequestCount(repository);
      const commitRequest = client.getLatestPersonalCommit(repository, login);
      const configRequest = client.getSafeFirebaseConfigFiles(repository);
      let pulls: PromiseSettledResult<Awaited<typeof pullsRequest>>;
      let commit: PromiseSettledResult<Awaited<typeof commitRequest>>;
      let config: PromiseSettledResult<Awaited<typeof configRequest>>;
      try {
        [pulls, commit, config] = await Promise.all([
          settleUnlessRateLimited(pullsRequest),
          settleUnlessRateLimited(commitRequest),
          settleUnlessRateLimited(configRequest),
        ]);
      } catch (error) {
        // Do not schedule more work, but allow already-started requests to settle
        // so their rate metadata can contribute to the sanitized failure record.
        await Promise.allSettled([pullsRequest, commitRequest, configRequest]);
        throw client.rateLimitError ?? error;
      }
      if (pulls.status === "rejected") failures.push("pull_request_count_unavailable");
      if (commit.status === "rejected") failures.push("personal_commit_unavailable");
      if (config.status === "rejected") failures.push("firebase_detection_unavailable");
      try {
        const normalized = normalizeGithubRepository({
          repository,
          openPullRequestCount: pulls.status === "fulfilled" ? pulls.value : null,
          latestPersonalCommit: commit.status === "fulfilled" ? commit.value : null,
          // An unexpected discovery failure cannot support a definitive no-evidence result.
          configFiles: config.status === "fulfilled" ? config.value : { files: [], failedFileCount: 1 },
          failureCodes: failures,
          syncedAt,
        });
        return { normalized, failed: failures.length > 0 || (config.status === "fulfilled" && config.value.failedFileCount > 0) };
      } catch {
        return { normalized: null, failed: true };
      }
    }, () => client.rateLimitError);
    return {
      repositories: results.map((item) => item.normalized).filter((item): item is NormalizedGithubRepository => item !== null),
      visibleRepositoryIds,
      failed: results.filter((item) => item.failed).length,
    };
  }

  async synchronize(input: { uid: string; credential: string; mode: GithubSyncMode }): Promise<GithubSyncResponse> {
    const started = this.now();
    const scheduledKey = input.mode === "scheduled" ? scheduledKeyFor(started) : null;
    const generatedRunId = this.runId();
    const runId = input.mode === "scheduled" ? `scheduled-${scheduledKey}-${generatedRunId}` : generatedRunId;
    const lease = await this.options.persistence.acquireLease({ uid: input.uid, runId, mode: input.mode, scheduledKey, now: started });
    if (!lease.acquired) {
      if (input.mode === "manual") throw new HttpsError("aborted", "A GitHub synchronization is already running.");
      return { runId, startedAt: started.toISOString(), completedAt: this.now().toISOString(), created: 0, updated: 0, unchanged: 0, unavailable: 0, failed: 0, rateLimit: null };
    }
    const client = this.client(input.credential);
    let failureStage: SyncFailureStage = "github_authentication";
    try {
      const user = await client.getAuthenticatedUser();
      const syncedAt = this.now().toISOString();
      failureStage = "repository_list_and_enrichment";
      const normalized = await this.retrieve(client, user.login, syncedAt);
      failureStage = "contract_normalization";
      const persisted = await this.options.persistence.persistRepositories({
        uid: input.uid, repositories: normalized.repositories,
        visibleRepositoryIds: normalized.visibleRepositoryIds, listingComplete: true, syncedAt,
        reportStage: (stage) => {
          failureStage = stage;
        },
      });
      const counts: GithubSyncCounts = { ...persisted, failed: persisted.failed + normalized.failed };
      const completedAt = this.now().toISOString();
      failureStage = "run_completion";
      await this.options.persistence.completeRun({
        uid: input.uid, runId, mode: input.mode, scheduledKey,
        startedAt: started.toISOString(), completedAt, ownerLogin: user.login,
        counts, rateLimit: client.rateLimit,
      });
      this.logger.info("GitHub synchronization completed.", { runId, mode: input.mode, counts });
      return { runId, startedAt: started.toISOString(), completedAt, ...counts, rateLimit: client.rateLimit };
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const failureRateLimit = error instanceof GithubApiError
        ? mergeRateLimitState(client.rateLimit, error.rateLimit)
        : client.rateLimit;
      await this.options.persistence.failRun({
        uid: input.uid, runId, mode: input.mode, scheduledKey, startedAt: started.toISOString(),
        failedAt: this.now().toISOString(), errorCode, failureStage, rateLimit: failureRateLimit,
      });
      this.logger.warn("GitHub synchronization failed.", { runId, mode: input.mode, errorCode, failureStage });
      throw error;
    }
  }
}
