import assert from "node:assert/strict";
import test from "node:test";
import { toSafeHttpsError } from "../src/github/auth";
import { SAFE_FIREBASE_CONFIG_PATHS } from "../src/github/firebaseDetection";
import { hasSuccessfulImportResult, isLeaseActive, isScheduledDayComplete, isScheduledSyncEnabled, toGithubRepositoryImport, type GithubPersistencePort, type PersistRepositoriesInput } from "../src/github/persistence";
import { mergeRateLimitState } from "../src/github/rateLimit";
import { GithubSyncService } from "../src/github/syncService";
import { GithubApiError, SYNC_LEASE_TTL_MS, type GitHubApiRepository, type GithubSyncCounts, type LeaseResult, type SyncStateRecord } from "../src/github/types";

class FakePersistence implements GithubPersistencePort {
  lease: LeaseResult = { acquired: true, duplicateScheduledRun: false };
  persisted: PersistRepositoriesInput | null = null;
  failed: Parameters<GithubPersistencePort["failRun"]>[0] | null = null;
  async getState() { return null; }
  async acquireLease() { return this.lease; }
  async persistRepositories(input: PersistRepositoriesInput): Promise<GithubSyncCounts> {
    this.persisted = input;
    return { created: input.repositories.length, updated: 0, unchanged: 0, unavailable: 0, failed: 0 };
  }
  async completeRun() { return; }
  async failRun(input: Parameters<GithubPersistencePort["failRun"]>[0]) { this.failed = input; }
}
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const repository = {
  id: 1, name: "private", full_name: "owner/private", owner: { login: "owner" }, html_url: "https://github.com/owner/private",
  private: true, visibility: "private", archived: false, fork: false, default_branch: "main", description: "private description",
  language: "TypeScript", topics: [], created_at: "2025-01-01T00:00:00.000Z", updated_at: "2025-01-02T00:00:00.000Z",
  pushed_at: "2025-01-02T00:00:00.000Z", open_issues_count: 2,
};
const publicRepository = {
  ...repository,
  id: 1251546307,
  name: "timelefttolive",
  full_name: "owner/timelefttolive",
  html_url: "https://github.com/owner/timelefttolive",
  private: false,
  visibility: "public",
};

test("prevents concurrent manual synchronization", async () => {
  const persistence = new FakePersistence();
  persistence.lease = { acquired: false, duplicateScheduledRun: false };
  const service = new GithubSyncService({ persistence, now: () => new Date("2025-01-02T00:00:00.000Z") });
  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }));
});

test("scheduled duplicate is idempotent and performs no API request", async () => {
  const persistence = new FakePersistence();
  persistence.lease = { acquired: false, duplicateScheduledRun: true };
  let calls = 0;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async () => { calls += 1; return response({}); },
    now: () => new Date("2025-01-02T00:00:00.000Z"),
    generateRunId: () => "duplicate-attempt",
  });
  const result = await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(calls, 0);
  assert.equal(result.created, 0);
  assert.equal(result.runId, "scheduled-2025-01-02-duplicate-attempt");
});

test("preserves a repository with personal-commit and config partial failures", async () => {
  const persistence = new FakePersistence();
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/user")) return response({ login: "owner" });
    if (url.includes("/user/repos")) return response([repository]);
    if (url.includes("/users/owner/repos")) return response([]);
    if (url.includes("/pulls?")) return response([{}]);
    if (url.includes("/commits?")) return response({}, 500);
    if (url.includes("/contents/")) return response({}, 500);
    return response({}, 404);
  };
  const times = ["2025-01-03T00:00:00.000Z", "2025-01-03T00:00:01.000Z", "2025-01-03T00:00:02.000Z", "2025-01-03T00:00:03.000Z"];
  let index = 0;
  const service = new GithubSyncService({ persistence, fetchImplementation, now: () => new Date(times[Math.min(index++, times.length - 1)]), generateRunId: () => "run" });
  const result = await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(persistence.persisted?.repositories.length, 1);
  assert.equal(persistence.persisted?.repositories[0].lastWorkedAtSource, "github_repository_pushed_at");
  assert.equal(persistence.persisted?.repositories[0].firebaseAssociations.discoveryStatus, "partial");
  assert.deepEqual(persistence.persisted?.repositories[0].firebaseAssociations.evidence, []);
  assert.equal(toGithubRepositoryImport(persistence.persisted!.repositories[0]).associationStatus, "unknown");
  assert.equal(result.failed, 1);
});

test("persists a listed repository when pull-request enrichment is unavailable", async () => {
  const persistence = new FakePersistence();
  const fetchImplementation = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/user")) return response({ login: "owner" });
    if (url.includes("/user/repos")) return response([]);
    if (url.includes("/users/owner/repos")) return response([publicRepository]);
    if (url.includes("/pulls?")) return response({}, 500);
    if (url.includes("/commits?")) return response([]);
    if (url.includes("/git/trees/")) throw new Error("Recursive tree enumeration must not be requested.");
    return response({}, 404);
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation,
    now: () => new Date("2025-01-03T00:00:00.000Z"),
    generateRunId: () => "pull-enrichment-failure",
  });

  const result = await service.synchronize({ uid: "owner", credential: "credential", mode: "manual" });
  assert.equal(persistence.persisted?.repositories.length, 1);
  assert.equal(persistence.persisted?.repositories[0].openIssueCount, null);
  assert.equal(persistence.persisted?.repositories[0].openPullRequestCount, null);
  assert.deepEqual(persistence.persisted?.repositories[0].enrichmentFailureCodes, ["pull_request_count_unavailable"]);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 1);
});

test("recovers Firebase association evidence for an authenticated-listed public repository", async () => {
  const persistence = new FakePersistence();
  const firebaserc = JSON.stringify({ projects: { default: "timelefttolive" } });
  const contentAuthorizations: Array<string | null> = [];
  const contentPaths: string[] = [];
  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/user") return response({ login: "owner" });
    if (url.pathname === "/user/repos") return response([publicRepository]);
    if (url.pathname === "/users/owner/repos") {
      assert.equal(authorization, null);
      return response([publicRepository]);
    }
    if (url.pathname.endsWith("/pulls")) {
      assert.equal(authorization, "Bearer credential");
      return response([]);
    }
    if (url.pathname.endsWith("/commits")) {
      assert.equal(authorization, "Bearer credential");
      return response([]);
    }
    if (url.pathname.includes("/git/trees/")) throw new Error("Recursive tree enumeration must not be requested.");
    if (url.pathname.includes("/contents/")) {
      const path = url.pathname.split("/contents/")[1].split("/").map(decodeURIComponent).join("/");
      contentPaths.push(path);
      if (path === ".firebaserc") {
        contentAuthorizations.push(authorization);
        if (authorization !== null) return response({}, 403);
        return response({ type: "file", encoding: "base64", content: Buffer.from(firebaserc).toString("base64"), size: firebaserc.length });
      }
      return response({}, 404);
    }
    return response({}, 404);
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation,
    now: () => new Date("2025-01-03T00:00:00.000Z"),
    generateRunId: () => "public-timeleft-import",
  });

  const result = await service.synchronize({ uid: "owner", credential: "credential", mode: "manual" });
  assert.equal(persistence.persisted?.repositories.length, 1);
  assert.equal(persistence.persisted?.repositories[0].repositoryId, 1251546307);
  assert.deepEqual(persistence.persisted?.repositories[0].firebaseAssociations.projectIds, ["timelefttolive"]);
  assert.equal(persistence.persisted?.repositories[0].firebaseAssociations.evidence[0]?.filePath, ".firebaserc");
  assert.equal(persistence.persisted?.repositories[0].firebaseAssociations.discoveryStatus, "complete");
  assert.deepEqual(contentAuthorizations, ["Bearer credential", null]);
  assert.deepEqual([...new Set(contentPaths)].sort(), [...SAFE_FIREBASE_CONFIG_PATHS].sort());
  assert.equal(contentPaths.some((path) => path.startsWith("src/")), false);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);
});

class StatefulLeasePersistence implements GithubPersistencePort {
  state: Partial<SyncStateRecord> | null = null;
  persisted: PersistRepositoriesInput | null = null;
  readonly runs = new Map<string, { mode: string; scheduledKey: string | null; status: string }>();
  acquisitions = 0;
  completions = 0;
  failures = 0;
  hardFailCleanup = false;

  async getState() {
    return this.state;
  }

  async acquireLease(input: Parameters<GithubPersistencePort["acquireLease"]>[0]) {
    if (input.mode === "scheduled" && !isScheduledSyncEnabled(this.state)) {
      return { acquired: false, duplicateScheduledRun: false, scheduledDisabled: true };
    }
    if (input.mode === "scheduled" && input.scheduledKey && isScheduledDayComplete(this.state, input.scheduledKey)) {
      return { acquired: false, duplicateScheduledRun: true };
    }
    if (isLeaseActive(this.state, input.now)) {
      return { acquired: false, duplicateScheduledRun: false };
    }
    this.acquisitions += 1;
    this.state = {
      ...this.state,
      status: "running",
      leaseOwner: input.runId,
      leaseExpiresAt: new Date(input.now.getTime() + SYNC_LEASE_TTL_MS).toISOString(),
      lastRunId: input.runId,
      lastStartedAt: input.now.toISOString(),
    };
    return { acquired: true, duplicateScheduledRun: false };
  }

  async persistRepositories(input: PersistRepositoriesInput): Promise<GithubSyncCounts> {
    this.persisted = input;
    return { created: input.repositories.length, updated: 0, unchanged: 0, unavailable: 0, failed: 0 };
  }

  async completeRun(input: Parameters<GithubPersistencePort["completeRun"]>[0]) {
    this.completions += 1;
    const qualifiesAsFirstImport = input.mode === "manual" && hasSuccessfulImportResult(input.counts);
    this.state = {
      ...this.state,
      status: "succeeded",
      syncEnabled: qualifiesAsFirstImport ? true : this.state?.syncEnabled,
      firstSuccessfulManualImportAt: this.state?.firstSuccessfulManualImportAt ??
        (qualifiesAsFirstImport ? input.completedAt : undefined),
      lastSuccessfulScheduledDayKey: input.mode === "scheduled"
        ? input.scheduledKey
        : this.state?.lastSuccessfulScheduledDayKey ?? this.state?.lastScheduledKey,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastRunId: input.runId,
      lastScheduledKey: input.mode === "scheduled" ? input.scheduledKey : this.state?.lastScheduledKey,
      lastCompletedAt: input.completedAt,
      lastSuccessfulSyncAt: input.completedAt,
      connectedOwnerLogin: input.ownerLogin,
      lastCounts: input.counts,
      lastRateLimit: mergeRateLimitState(this.state?.lastRateLimit, input.rateLimit),
    };
    this.runs.set(input.runId, { mode: input.mode, scheduledKey: input.scheduledKey, status: "succeeded" });
  }

  async failRun(input: Parameters<GithubPersistencePort["failRun"]>[0]) {
    this.failures += 1;
    if (this.hardFailCleanup) throw new Error("simulated cleanup failure");
    this.state = {
      ...this.state,
      status: "failed",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastRunId: input.runId,
      lastCompletedAt: input.failedAt,
      lastErrorCode: input.errorCode,
      lastRateLimit: mergeRateLimitState(this.state?.lastRateLimit, input.rateLimit),
    };
    this.runs.set(input.runId, { mode: input.mode, scheduledKey: input.scheduledKey, status: "failed" });
  }
}

const successfulEmptyFetch = async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith("/user")) return response({ login: "owner" });
  if (url.includes("/user/repos") || url.includes("/users/owner/repos")) return response([]);
  return response({}, 404);
};

const successfulSingleRepositoryFetch = async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith("/user")) return response({ login: "owner" });
  if (url.includes("/user/repos")) return response([repository]);
  if (url.includes("/users/owner/repos")) return response([]);
  if (url.includes("/pulls?")) return response([]);
  if (url.includes("/commits?")) return response([]);
  if (url.includes("/git/trees/")) throw new Error("Recursive tree enumeration must not be requested.");
  return response({}, 404);
};

const rateLimitedEnrichmentScenario = () => {
  const repositories: GitHubApiRepository[] = Array.from({ length: 8 }, (_, offset) => ({
    ...repository,
    id: offset + 1,
    name: `private-${offset + 1}`,
    full_name: `owner/private-${offset + 1}`,
    html_url: `https://github.com/owner/private-${offset + 1}`,
    visibility: "private" as const,
  }));
  const resetEpoch = "1735866000";
  let releaseRateLimit!: (value: Response) => void;
  const rateLimitResponse = new Promise<Response>((resolve) => { releaseRateLimit = resolve; });
  let repositoryOneRequests = 0;
  let rateLimitObserved = false;
  let callsAfterRateLimit = 0;
  const requestedRepositories = new Set<string>();
  const heldResponses: Array<(value: Response) => void> = [];

  const fetchImplementation = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (rateLimitObserved) callsAfterRateLimit += 1;
    if (url.pathname === "/user") return response({ login: "owner" });
    if (url.pathname === "/user/repos") return response(repositories);
    if (url.pathname === "/users/owner/repos") return response([]);

    const repositoryName = url.pathname.match(/^\/repos\/owner\/([^/]+)/)?.[1] ?? "";
    if (repositoryName) requestedRepositories.add(repositoryName);
    if (repositoryName === "private-1") {
      repositoryOneRequests += 1;
      if (repositoryOneRequests === 8) {
        releaseRateLimit(response({}, 403, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-used": "5000",
          "x-ratelimit-reset": resetEpoch,
          "x-ratelimit-resource": "core",
        }));
      }
    }
    if (repositoryName === "private-2" && url.pathname.endsWith("/commits")) {
      const limited = await rateLimitResponse;
      rateLimitObserved = true;
      setTimeout(() => heldResponses.splice(0).forEach((resolve) => resolve(response([]))), 0);
      return limited;
    }
    if ((repositoryName === "private-3" || repositoryName === "private-4") && url.pathname.endsWith("/pulls")) {
      return new Promise<Response>((resolve) => heldResponses.push(resolve));
    }
    if (url.pathname.endsWith("/pulls") || url.pathname.endsWith("/commits")) return response([]);
    if (url.pathname.includes("/contents/")) return response({}, 404);
    return response({}, 404);
  };

  return {
    fetchImplementation,
    resetAt: new Date(Number(resetEpoch) * 1000).toISOString(),
    repositoryOneRequests: () => repositoryOneRequests,
    callsAfterRateLimit: () => callsAfterRateLimit,
    requestedRepositories: () => [...requestedRepositories].sort(),
  };
};

test("aborts a manual import when later repository enrichment exhausts the rate limit", async () => {
  const persistence = new StatefulLeasePersistence();
  const scenario = rateLimitedEnrichmentScenario();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: scenario.fetchImplementation,
    now: () => new Date("2025-01-03T00:00:00.000Z"),
    generateRunId: () => "manual-enrichment-rate-limit",
  });

  let failure: unknown;
  try {
    await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof GithubApiError);
  assert.equal(failure.safeCode, "rate_limited");
  assert.equal(failure.rateLimit?.remaining, 0);
  assert.equal(failure.rateLimit?.resetAt, scenario.resetAt);
  const callableError = toSafeHttpsError(failure);
  assert.equal(callableError.code, "resource-exhausted");
  assert.equal((callableError.details as { resetAt?: string } | undefined)?.resetAt, scenario.resetAt);
  assert.equal(scenario.repositoryOneRequests(), 8);
  assert.equal(scenario.callsAfterRateLimit(), 0);
  assert.deepEqual(scenario.requestedRepositories(), ["private-1", "private-2", "private-3", "private-4"]);
  assert.equal(persistence.persisted, null);
  assert.equal(persistence.completions, 0);
  assert.equal(persistence.failures, 1);
  assert.equal(persistence.state?.status, "failed");
  assert.equal(persistence.state?.syncEnabled, undefined);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, undefined);
  assert.equal(persistence.state?.lastErrorCode, "github_rate_limited");
  assert.equal(persistence.state?.lastRateLimit?.resetAt, scenario.resetAt);
  assert.equal(persistence.state?.leaseOwner, null);
  assert.equal(persistence.state?.leaseExpiresAt, null);
});

test("propagates safe-config rate exhaustion through synchronization", async () => {
  const persistence = new StatefulLeasePersistence();
  const resetEpoch = "1735866000";
  const resetAt = new Date(Number(resetEpoch) * 1000).toISOString();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/user") return response({ login: "owner" });
      if (url.pathname === "/user/repos") return response([repository]);
      if (url.pathname === "/users/owner/repos") return response([]);
      if (url.pathname.endsWith("/pulls") || url.pathname.endsWith("/commits")) return response([]);
      if (url.pathname.endsWith("/contents/.firebaserc")) {
        return response({}, 429, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-used": "5000",
          "x-ratelimit-reset": resetEpoch,
          "x-ratelimit-resource": "core",
        });
      }
      if (url.pathname.includes("/contents/")) return response({}, 404);
      return response({}, 404);
    },
    now: () => new Date("2025-01-03T00:00:00.000Z"),
    generateRunId: () => "safe-config-rate-limit",
  });

  await assert.rejects(
    () => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }),
    (error) => error instanceof GithubApiError &&
      error.safeCode === "rate_limited" && error.rateLimit?.resetAt === resetAt,
  );
  assert.equal(persistence.persisted, null);
  assert.equal(persistence.completions, 0);
  assert.equal(persistence.failures, 1);
  assert.equal(persistence.state?.lastErrorCode, "github_rate_limited");
  assert.equal(persistence.state?.lastRateLimit?.resetAt, resetAt);
});

test("records scheduled enrichment rate exhaustion as a failed released attempt", async () => {
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "succeeded",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-01T00:00:00.000Z",
  };
  const scenario = rateLimitedEnrichmentScenario();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: scenario.fetchImplementation,
    now: () => new Date("2025-01-03T00:00:00.000Z"),
    generateRunId: () => "scheduled-enrichment-rate-limit",
  });

  await assert.rejects(
    () => service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" }),
    (error) => error instanceof GithubApiError && error.safeCode === "rate_limited",
  );

  const runId = "scheduled-2025-01-03-scheduled-enrichment-rate-limit";
  assert.equal(persistence.persisted, null);
  assert.equal(persistence.completions, 0);
  assert.equal(persistence.failures, 1);
  assert.equal(persistence.state?.status, "failed");
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-01T00:00:00.000Z");
  assert.equal(persistence.state?.lastSuccessfulScheduledDayKey, undefined);
  assert.equal(persistence.state?.lastErrorCode, "github_rate_limited");
  assert.equal(persistence.state?.lastRateLimit?.resetAt, scenario.resetAt);
  assert.equal(persistence.state?.leaseOwner, null);
  assert.equal(persistence.state?.leaseExpiresAt, null);
  assert.deepEqual(persistence.runs.get(runId), {
    mode: "scheduled", scheduledKey: "2025-01-03", status: "failed",
  });
  assert.equal(scenario.callsAfterRateLimit(), 0);
});

test("attributes persistence failures without retaining raw exception details", async () => {
  const persistence = new FakePersistence();
  const warnings: Record<string, unknown>[] = [];
  const rawFailure = "sensitive database implementation detail";
  persistence.persistRepositories = async (input) => {
    input.reportStage?.("project_persistence");
    throw new Error(rawFailure);
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulEmptyFetch,
    now: () => new Date("2025-01-02T00:00:00.000Z"),
    generateRunId: () => "persistence-failure-run",
    logger: { info: () => undefined, warn: (_message, details) => warnings.push(details ?? {}) },
  });

  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "credential", mode: "manual" }));
  assert.equal(persistence.failed?.failureStage, "project_persistence");
  assert.equal(persistence.failed?.errorCode, "internal");
  assert.equal(JSON.stringify(persistence.failed).includes(rawFailure), false);
  assert.deepEqual(warnings, [{
    runId: "persistence-failure-run",
    mode: "manual",
    errorCode: "internal",
    failureStage: "project_persistence",
  }]);
  assert.equal(JSON.stringify(warnings).includes(rawFailure), false);
});

test("does not schedule a first import before synchronization is enabled", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  let requests = 0;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      requests += 1;
      return successfulEmptyFetch(input);
    },
    now: () => now,
  });
  const result = await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(requests, 0);
  assert.equal(persistence.acquisitions, 0);
  assert.equal(persistence.completions, 0);
  assert.equal(await persistence.getState(), null);
  assert.equal(persistence.state, null);
  assert.equal(result.created, 0);
});

test("scheduled synchronization cannot enable itself", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "failed",
    syncEnabled: false,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
  let requests = 0;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      requests += 1;
      return successfulEmptyFetch(input);
    },
    now: () => now,
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(requests, 0);
  assert.equal(persistence.acquisitions, 0);
  assert.equal(persistence.completions, 0);
  assert.equal(persistence.state?.syncEnabled, false);
});

test("explicit false remains disabled even on an older succeeded state", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "succeeded",
    syncEnabled: false,
    lastSuccessfulSyncAt: "2025-01-01T00:00:00.000Z",
  };
  let requests = 0;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      requests += 1;
      return successfulEmptyFetch(input);
    },
    now: () => now,
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(requests, 0);
  assert.equal(persistence.acquisitions, 0);
  assert.equal(persistence.state?.syncEnabled, false);
});

test("enables scheduled synchronization only after a successful non-empty manual import", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulSingleRepositoryFetch,
    now: () => now,
    generateRunId: () => "manual-first-import",
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(persistence.state?.status, "succeeded");
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-02T00:00:00.000Z");
});

test("an empty successful manual result does not enable scheduled synchronization", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulEmptyFetch,
    now: () => now,
    generateRunId: () => "empty-manual-import",
  });
  const result = await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.unchanged, 0);
  assert.notEqual(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, undefined);
});

test("a later successful non-empty manual import activates the gate after an empty run", async () => {
  const times = [
    "2025-01-02T00:00:00.000Z",
    "2025-01-03T00:00:00.000Z",
  ];
  let current = 0;
  const persistence = new StatefulLeasePersistence();
  const emptyService = new GithubSyncService({
    persistence,
    fetchImplementation: successfulEmptyFetch,
    now: () => new Date(times[current]),
    generateRunId: () => "empty-run",
  });
  await emptyService.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.notEqual(persistence.state?.syncEnabled, true);

  current = 1;
  const successfulService = new GithubSyncService({
    persistence,
    fetchImplementation: successfulSingleRepositoryFetch,
    now: () => new Date(times[current]),
    generateRunId: () => "first-real-import",
  });
  await successfulService.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-03T00:00:00.000Z");
});

test("subsequent successful manual synchronization preserves the original gate timestamp", async () => {
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "succeeded",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-01T00:00:00.000Z",
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulSingleRepositoryFetch,
    now: () => new Date("2025-01-04T00:00:00.000Z"),
    generateRunId: () => "later-manual-sync",
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-01T00:00:00.000Z");
});

test("a failed manual synchronization does not enable scheduling", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => String(input).endsWith("/user")
      ? response({ login: "owner" })
      : response({}, 500),
    now: () => now,
    generateRunId: () => "failed-manual-import",
  });
  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }));
  assert.equal(persistence.state?.status, "failed");
  assert.notEqual(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, undefined);
});

test("runs a scheduled synchronization after manual enablement without changing the gate", async () => {
  const now = new Date("2025-01-03T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "succeeded",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-02T00:00:00.000Z",
    lastSuccessfulSyncAt: "2025-01-02T00:00:00.000Z",
  };
  let requests = 0;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      requests += 1;
      return successfulEmptyFetch(input);
    },
    now: () => now,
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(requests, 3);
  assert.equal(persistence.acquisitions, 1);
  assert.equal(persistence.completions, 1);
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-02T00:00:00.000Z");
});

test("same-day scheduled completion survives a later manual failure without overwriting either audit", async () => {
  let now = new Date("2025-01-03T00:00:00.000Z");
  let failRequests = false;
  let requests = 0;
  const generatedRunIds = ["first-scheduled-attempt", "manual-attempt", "duplicate-attempt", "next-day-attempt"];
  let generatedRunIdIndex = 0;
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "succeeded",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-02T00:00:00.000Z",
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      requests += 1;
      if (failRequests && !String(input).endsWith("/user")) return response({}, 500);
      return successfulEmptyFetch(input);
    },
    now: () => now,
    generateRunId: () => generatedRunIds[generatedRunIdIndex++],
  });

  const firstScheduled = await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  const firstScheduledAudit = structuredClone(persistence.runs.get(firstScheduled.runId));
  assert.equal(firstScheduled.runId, "scheduled-2025-01-03-first-scheduled-attempt");
  assert.deepEqual(firstScheduledAudit, { mode: "scheduled", scheduledKey: "2025-01-03", status: "succeeded" });
  assert.equal(persistence.state?.lastSuccessfulScheduledDayKey, "2025-01-03");

  failRequests = true;
  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }));
  assert.equal(persistence.state?.status, "failed");
  assert.equal(persistence.state?.lastSuccessfulScheduledDayKey, "2025-01-03");
  assert.deepEqual(persistence.runs.get("manual-attempt"), {
    mode: "manual", scheduledKey: null, status: "failed",
  });

  failRequests = false;
  const requestsBeforeDuplicate = requests;
  const duplicate = await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(duplicate.runId, "scheduled-2025-01-03-duplicate-attempt");
  assert.equal(requests, requestsBeforeDuplicate);
  assert.equal(persistence.completions, 1);
  assert.equal(persistence.runs.has(duplicate.runId), false);
  assert.deepEqual(persistence.runs.get(firstScheduled.runId), firstScheduledAudit);
  assert.deepEqual(persistence.runs.get("manual-attempt"), {
    mode: "manual", scheduledKey: null, status: "failed",
  });

  now = new Date("2025-01-04T00:00:00.000Z");
  const nextDay = await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(nextDay.runId, "scheduled-2025-01-04-next-day-attempt");
  assert.equal(persistence.completions, 2);
  assert.equal(persistence.state?.lastSuccessfulScheduledDayKey, "2025-01-04");
  assert.deepEqual(persistence.runs.get(firstScheduled.runId), firstScheduledAudit);
  assert.equal(persistence.runs.get("manual-attempt")?.status, "failed");
});

test("a failed scheduled attempt can retry the same day with immutable attempt audits", async () => {
  const now = new Date("2025-01-03T00:00:00.000Z");
  let failRequests = true;
  const generatedRunIds = ["failed-attempt", "retry-attempt"];
  let generatedRunIdIndex = 0;
  const persistence = new StatefulLeasePersistence();
  persistence.state = { status: "succeeded", syncEnabled: true };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      if (failRequests && !String(input).endsWith("/user")) return response({}, 500);
      return successfulEmptyFetch(input);
    },
    now: () => now,
    generateRunId: () => generatedRunIds[generatedRunIdIndex++],
  });

  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" }));
  const failedRunId = "scheduled-2025-01-03-failed-attempt";
  assert.deepEqual(persistence.runs.get(failedRunId), {
    mode: "scheduled", scheduledKey: "2025-01-03", status: "failed",
  });
  assert.equal(persistence.state?.lastSuccessfulScheduledDayKey, undefined);

  failRequests = false;
  const retried = await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(retried.runId, "scheduled-2025-01-03-retry-attempt");
  assert.equal(persistence.state?.lastSuccessfulScheduledDayKey, "2025-01-03");
  assert.equal(persistence.runs.get(failedRunId)?.status, "failed");
  assert.equal(persistence.runs.get(retried.runId)?.status, "succeeded");
});

test("concurrent same-day scheduled delivery remains protected by the shared lease", async () => {
  const now = new Date("2025-01-03T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = { status: "succeeded", syncEnabled: true };

  const first = await persistence.acquireLease({
    uid: "owner", runId: "scheduled-first", mode: "scheduled", scheduledKey: "2025-01-03", now,
  });
  const second = await persistence.acquireLease({
    uid: "owner", runId: "scheduled-second", mode: "scheduled", scheduledKey: "2025-01-03", now,
  });

  assert.deepEqual(first, { acquired: true, duplicateScheduledRun: false });
  assert.deepEqual(second, { acquired: false, duplicateScheduledRun: false });
  assert.equal(persistence.state?.leaseOwner, "scheduled-first");
});

test("an old succeeded state without syncEnabled remains scheduled-disabled", async () => {
  const now = new Date("2025-01-03T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "succeeded",
    lastSuccessfulSyncAt: "2025-01-02T00:00:00.000Z",
  };
  let requests = 0;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => {
      requests += 1;
      return successfulEmptyFetch(input);
    },
    now: () => now,
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "scheduled" });
  assert.equal(requests, 0);
  assert.equal(persistence.acquisitions, 0);
  assert.equal(persistence.completions, 0);
  assert.equal(persistence.state?.syncEnabled, undefined);
});

test("lease acquisition preserves enablement and historical metadata", async () => {
  const now = new Date("2025-01-03T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  const previousRateLimit = { limit: 5000, remaining: 4990, used: 10, resetAt: "2025-01-03T01:00:00.000Z", resource: "core" };
  persistence.state = {
    status: "succeeded",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-01T00:00:00.000Z",
    lastSuccessfulSyncAt: "2025-01-02T00:00:00.000Z",
    lastRateLimit: previousRateLimit,
    lastErrorCode: "previous_error",
  };
  await persistence.acquireLease({ uid: "owner", runId: "new-run", mode: "manual", scheduledKey: null, now });
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-01T00:00:00.000Z");
  assert.equal(persistence.state?.lastSuccessfulSyncAt, "2025-01-02T00:00:00.000Z");
  assert.deepEqual(persistence.state?.lastRateLimit, previousRateLimit);
  assert.equal(persistence.state?.lastErrorCode, "previous_error");
});

test("successful lease release preserves gate, first-import, rate, and error metadata", async () => {
  const persistence = new StatefulLeasePersistence();
  const previousRateLimit = { limit: 5000, remaining: 4990, used: 10, resetAt: "2025-01-03T01:00:00.000Z", resource: "core" };
  persistence.state = {
    status: "running",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-01T00:00:00.000Z",
    leaseOwner: "scheduled-run",
    leaseExpiresAt: "2025-01-03T00:12:00.000Z",
    lastRateLimit: previousRateLimit,
    lastErrorCode: "previous_error",
  };
  await persistence.completeRun({
    uid: "owner", runId: "scheduled-run", mode: "scheduled", scheduledKey: "2025-01-03",
    startedAt: "2025-01-03T00:00:00.000Z", completedAt: "2025-01-03T00:01:00.000Z",
    ownerLogin: "owner", counts: { created: 0, updated: 0, unchanged: 1, unavailable: 0, failed: 0 },
    rateLimit: { limit: null, remaining: null, used: null, resetAt: null, resource: null },
  });
  assert.equal(persistence.state?.leaseOwner, null);
  assert.equal(persistence.state?.leaseExpiresAt, null);
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-01T00:00:00.000Z");
  assert.deepEqual(persistence.state?.lastRateLimit, previousRateLimit);
  assert.equal(persistence.state?.lastErrorCode, "previous_error");
});

test("failed lease release preserves gate and history while updating error metadata", async () => {
  const persistence = new StatefulLeasePersistence();
  const previousRateLimit = { limit: 5000, remaining: 4990, used: 10, resetAt: "2025-01-03T01:00:00.000Z", resource: "core" };
  persistence.state = {
    status: "running",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-01T00:00:00.000Z",
    lastSuccessfulSyncAt: "2025-01-02T00:00:00.000Z",
    leaseOwner: "failed-run",
    leaseExpiresAt: "2025-01-03T00:12:00.000Z",
    lastRateLimit: previousRateLimit,
    lastErrorCode: "previous_error",
  };
  await persistence.failRun({
    uid: "owner", runId: "failed-run", mode: "manual", scheduledKey: null,
    startedAt: "2025-01-03T00:00:00.000Z", failedAt: "2025-01-03T00:01:00.000Z",
    errorCode: "github_unavailable", failureStage: "repository_list_and_enrichment", rateLimit: null,
  });
  assert.equal(persistence.state?.leaseOwner, null);
  assert.equal(persistence.state?.leaseExpiresAt, null);
  assert.equal(persistence.state?.syncEnabled, true);
  assert.equal(persistence.state?.firstSuccessfulManualImportAt, "2025-01-01T00:00:00.000Z");
  assert.equal(persistence.state?.lastSuccessfulSyncAt, "2025-01-02T00:00:00.000Z");
  assert.deepEqual(persistence.state?.lastRateLimit, previousRateLimit);
  assert.equal(persistence.state?.lastErrorCode, "github_unavailable");
});

test("rejects a second synchronization while the first lease is active", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "running",
    leaseOwner: "first-run",
    leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_TTL_MS).toISOString(),
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulEmptyFetch,
    now: () => now,
    generateRunId: () => "second-run",
  });
  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }));
  assert.equal(persistence.acquisitions, 0);
  assert.equal(persistence.state.leaseOwner, "first-run");
});

test("recovers an expired lease and safely completes the replacement synchronization", async () => {
  const now = new Date("2025-01-02T00:20:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.state = {
    status: "running",
    leaseOwner: "expired-run",
    leaseExpiresAt: new Date(now.getTime() - 1).toISOString(),
  };
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulEmptyFetch,
    now: () => now,
    generateRunId: () => "replacement-run",
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(persistence.acquisitions, 1);
  assert.equal(persistence.completions, 1);
  assert.equal(persistence.state.leaseOwner, null);
});

test("releases the lease after a successful synchronization", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: successfulEmptyFetch,
    now: () => now,
    generateRunId: () => "successful-run",
  });
  await service.synchronize({ uid: "owner", credential: "secret", mode: "manual" });
  assert.equal(persistence.completions, 1);
  assert.equal(persistence.state?.status, "succeeded");
  assert.equal(persistence.state?.leaseOwner, null);
  assert.equal(persistence.state?.leaseExpiresAt, null);
});

test("releases the lease when a synchronization failure is handled", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => String(input).endsWith("/user")
      ? response({ login: "owner" })
      : response({}, 500),
    now: () => now,
    generateRunId: () => "failed-run",
  });
  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }));
  assert.equal(persistence.failures, 1);
  assert.equal(persistence.state?.status, "failed");
  assert.equal(persistence.state?.leaseOwner, null);
  assert.equal(persistence.state?.leaseExpiresAt, null);
});

test("keeps a hard-failure lease bounded to the twelve-minute safety expiry", async () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const persistence = new StatefulLeasePersistence();
  persistence.hardFailCleanup = true;
  const service = new GithubSyncService({
    persistence,
    fetchImplementation: async (input) => String(input).endsWith("/user")
      ? response({ login: "owner" })
      : response({}, 500),
    now: () => now,
    generateRunId: () => "hard-failed-run",
  });
  await assert.rejects(() => service.synchronize({ uid: "owner", credential: "secret", mode: "manual" }));
  assert.equal(persistence.failures, 1);
  assert.equal(persistence.state?.status, "running");
  assert.equal(
    new Date(persistence.state?.leaseExpiresAt ?? 0).getTime() - now.getTime(),
    12 * 60 * 1000,
  );
});
