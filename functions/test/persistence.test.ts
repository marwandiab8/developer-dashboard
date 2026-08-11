import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { applyGithubRepositoryImportBatch, type DashboardData } from "../src/githubSyncPolicy";
import { buildFailedRunStateUpdate, buildSuccessfulRunStateUpdate, chunkValues, deterministicActivityId, FirestoreGithubPersistence, isLeaseActive, isScheduledDayComplete, shouldApplyAutomatedAssociation, toGithubRepositoryImport, withoutUndefined } from "../src/github/persistence";
import { mergeRateLimitState } from "../src/github/rateLimit";
import type { NormalizedGithubRepository } from "../src/github/types";

const normalized = (changes: Partial<NormalizedGithubRepository> = {}): NormalizedGithubRepository => ({
  repositoryId: 123, ownerLogin: "owner", name: "repo", fullName: "owner/repo", url: "https://github.com/owner/repo",
  visibility: "private", archived: false, fork: false, defaultBranch: "main", description: "description",
  language: "TypeScript", topics: ["firebase"], repositoryCreatedAt: "2025-01-01T00:00:00.000Z",
  repositoryUpdatedAt: "2025-01-02T00:00:00.000Z", repositoryPushedAt: "2025-01-02T00:00:00.000Z",
  openIssueCount: 2, openPullRequestCount: 1, latestPersonalCommitAt: null, latestPersonalCommitMessage: null,
  lastWorkedAt: "2025-01-02T00:00:00.000Z", lastWorkedAtSource: "github_repository_pushed_at",
  firebaseAssociations: { projectIds: [], evidence: [], discoveryStatus: "complete" }, enrichmentFailureCodes: [],
  syncedAt: "2025-01-03T00:00:00.000Z", ...changes,
});
const empty = (): DashboardData => ({
  schemaVersion: 1, projects: [], ideas: [], tasks: [], brainDumps: [], scratchpads: [], architectureDecisions: [],
  codexPrompts: [], notes: [], importantLinks: [], developmentSessions: [], activities: [],
});

test("immutable numeric identity prevents duplicates and handles rename", () => {
  const first = applyGithubRepositoryImportBatch(empty(), [toGithubRepositoryImport(normalized())], { now: "2025-01-03T00:00:00.000Z", generateProjectId: () => "project-1" });
  const project = { ...first.data.projects[0], currentObjective: "protected objective", currentBlocker: "protected blocker" };
  const second = applyGithubRepositoryImportBatch({ ...first.data, projects: [project] }, [toGithubRepositoryImport(normalized({ name: "renamed", fullName: "owner/renamed", url: "https://github.com/owner/renamed" }))], { now: "2025-01-04T00:00:00.000Z" });
  assert.equal(second.data.projects.length, 1);
  assert.equal(second.data.projects[0].currentObjective, "protected objective");
  assert.equal(second.data.projects[0].currentBlocker, "protected blocker");
  assert.equal(second.reports[0].outcome, "updated");
});

test("retains unknown issue and pull-request counts with safe failure provenance", () => {
  const imported = toGithubRepositoryImport(normalized({
    openIssueCount: null,
    openPullRequestCount: null,
    enrichmentFailureCodes: ["pull_request_count_unavailable"],
  }));
  assert.equal(imported.openIssueCount, null);
  assert.equal(imported.openPullRequestCount, null);
  assert.equal(imported.sourceError, "pull_request_count_unavailable");
});

test("distinguishes complete no-evidence from partial Firebase discovery", () => {
  const complete = toGithubRepositoryImport(normalized());
  const partial = toGithubRepositoryImport(normalized({
    firebaseAssociations: {
      projectIds: [],
      evidence: [],
      discoveryStatus: "partial",
    },
    enrichmentFailureCodes: ["firebase_config_partial"],
  }));

  assert.equal(complete.associationStatus, "not_detected");
  assert.equal(partial.associationStatus, "unknown");
  assert.equal(partial.sourceError, "firebase_config_partial");
});

test("partial discovery cannot downgrade detected or confirmed Firebase evidence", () => {
  const unknown = {
    status: "unknown" as const,
    evidence: "",
    detectedAt: "2025-01-04T00:00:00.000Z",
  };

  assert.equal(shouldApplyAutomatedAssociation({
    status: "detected",
    evidence: ".firebaserc",
    detectedAt: "2025-01-03T00:00:00.000Z",
  }, unknown), false);
  assert.equal(shouldApplyAutomatedAssociation({
    status: "confirmed",
    evidence: "owner confirmed",
    detectedAt: "2025-01-03T00:00:00.000Z",
    confirmedAt: "2025-01-03T12:00:00.000Z",
  }, unknown), false);
  assert.equal(shouldApplyAutomatedAssociation({
    status: "not_detected",
    evidence: "",
    detectedAt: "2025-01-03T00:00:00.000Z",
  }, unknown), true);
});

test("uses safe batch chunks and deterministic activity identifiers", () => {
  assert.deepEqual(chunkValues(Array.from({ length: 801 }, (_, index) => index)).map((chunk) => chunk.length), [400, 400, 1]);
  const activityId = deterministicActivityId("123", "updated", "2025-01-02T00:00:00.000Z");
  assert.equal(activityId, deterministicActivityId("123", "updated", "2025-01-02T00:00:00.000Z"));
  assert.match(activityId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("detects an active synchronization lease", () => {
  assert.equal(isLeaseActive({ status: "running", leaseOwner: "run", leaseExpiresAt: "2025-01-02T00:10:00.000Z" }, new Date("2025-01-02T00:00:00.000Z")), true);
});

test("failure completion preserves prior rate limits and never emits undefined", () => {
  const previousRateLimit = {
    limit: 5000,
    remaining: 4990,
    used: 10,
    resetAt: "2025-01-03T01:00:00.000Z",
    resource: "core",
  };
  const input = {
    runId: "failed-run",
    failedAt: "2025-01-03T00:01:00.000Z",
    errorCode: "github_unavailable",
    failureStage: "repository_list_and_enrichment" as const,
    rateLimit: null,
  };
  const preserved = buildFailedRunStateUpdate(input, { lastRateLimit: previousRateLimit });
  assert.deepEqual(preserved.lastRateLimit, previousRateLimit);

  const omitted = buildFailedRunStateUpdate(input, {});
  assert.equal(Object.hasOwn(omitted, "lastRateLimit"), false);
  assert.equal(Object.values(omitted).includes(undefined), false);

  const allNullHeaders = buildFailedRunStateUpdate({
    ...input,
    rateLimit: { limit: null, remaining: null, used: null, resetAt: null, resource: null },
  }, { lastRateLimit: previousRateLimit });
  assert.deepEqual(allNullHeaders.lastRateLimit, previousRateLimit);
});

const completedRun = (changes: Partial<Parameters<typeof buildSuccessfulRunStateUpdate>[0]> = {}) => ({
  runId: "run",
  mode: "manual" as const,
  scheduledKey: null,
  completedAt: "2025-01-03T00:01:00.000Z",
  ownerLogin: "owner",
  counts: { created: 1, updated: 0, unchanged: 0, unavailable: 0, failed: 0 },
  rateLimit: null,
  ...changes,
});

test("the first-import gate requires a non-empty successful manual result and is write-once", () => {
  const first = buildSuccessfulRunStateUpdate(completedRun(), {});
  assert.equal(first.syncEnabled, true);
  assert.equal(first.firstSuccessfulManualImportAt, "2025-01-03T00:01:00.000Z");

  const empty = buildSuccessfulRunStateUpdate(completedRun({
    counts: { created: 0, updated: 0, unchanged: 0, unavailable: 0, failed: 0 },
  }), {});
  assert.equal(Object.hasOwn(empty, "syncEnabled"), false);
  assert.equal(Object.hasOwn(empty, "firstSuccessfulManualImportAt"), false);

  const failedResult = buildSuccessfulRunStateUpdate(completedRun({
    counts: { created: 0, updated: 0, unchanged: 0, unavailable: 0, failed: 1 },
  }), {});
  assert.equal(Object.hasOwn(failedResult, "syncEnabled"), false);
  assert.equal(Object.hasOwn(failedResult, "firstSuccessfulManualImportAt"), false);

  const scheduled = buildSuccessfulRunStateUpdate(completedRun({ mode: "scheduled", scheduledKey: "2025-01-03" }), {});
  assert.equal(Object.hasOwn(scheduled, "syncEnabled"), false);
  assert.equal(Object.hasOwn(scheduled, "firstSuccessfulManualImportAt"), false);
  assert.equal(scheduled.lastSuccessfulScheduledDayKey, "2025-01-03");
  assert.equal(isScheduledDayComplete(scheduled, "2025-01-03"), true);

  const laterManual = buildSuccessfulRunStateUpdate(completedRun({
    completedAt: "2025-01-03T12:00:00.000Z",
  }), scheduled);
  assert.equal(laterManual.lastSuccessfulScheduledDayKey, "2025-01-03");

  assert.equal(isScheduledDayComplete({ lastScheduledKey: "2025-01-03" }, "2025-01-03"), true);

  const subsequent = buildSuccessfulRunStateUpdate(completedRun({
    completedAt: "2025-01-04T00:01:00.000Z",
    counts: { created: 0, updated: 1, unchanged: 0, unavailable: 0, failed: 0 },
  }), {
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-03T00:01:00.000Z",
  });
  assert.equal(subsequent.syncEnabled, true);
  assert.equal(subsequent.firstSuccessfulManualImportAt, "2025-01-03T00:01:00.000Z");
});

test("rate-limit merging keeps the strongest observation regardless of completion order", () => {
  const newerObservation = {
    limit: 5000,
    remaining: 4975,
    used: 25,
    resetAt: "2025-01-03T01:00:00.000Z",
    resource: "core",
  };
  const laterFinishingButOlderObservation = {
    limit: 5000,
    remaining: 4990,
    used: 10,
    resetAt: "2025-01-03T01:00:00.000Z",
    resource: "core",
  };
  assert.deepEqual(
    mergeRateLimitState(newerObservation, laterFinishingButOlderObservation),
    newerObservation,
  );
  assert.deepEqual(
    mergeRateLimitState(newerObservation, { limit: null, remaining: null, used: null, resetAt: null, resource: null }),
    newerObservation,
  );
});

type StoredDocument = Record<string, unknown>;

const clone = <T>(value: T): T => structuredClone(value);

class FakeDocumentReference {
  constructor(readonly path: string, private readonly database: FakeFirestore) {}

  async get() {
    const value = this.database.documents.get(this.path);
    return { exists: Boolean(value), data: () => value ? clone(value) : undefined };
  }

  async set(data: StoredDocument) {
    this.database.documents.set(this.path, clone(data));
  }

  async create(data: StoredDocument) {
    if (this.database.documents.has(this.path)) throw new Error("create precondition failed");
    this.database.documents.set(this.path, clone(data));
  }
}

const applyFieldUpdate = (target: StoredDocument, fields: StoredDocument): void => {
  for (const [path, value] of Object.entries(fields)) {
    const segments = path.split(".");
    let cursor = target;
    for (const segment of segments.slice(0, -1)) {
      const nested = cursor[segment];
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) cursor[segment] = {};
      cursor = cursor[segment] as StoredDocument;
    }
    cursor[segments.at(-1) as string] = clone(value);
  }
};

class FakeWriteBatch {
  private readonly operations: Array<() => void> = [];

  constructor(private readonly database: FakeFirestore) {}

  update(reference: FakeDocumentReference, data: StoredDocument) {
    this.database.writes.push({ kind: "update", path: reference.path, data: clone(data) });
    this.operations.push(() => {
      const existing = this.database.documents.get(reference.path);
      if (!existing) throw new Error("update precondition failed");
      applyFieldUpdate(existing, data);
    });
    return this;
  }

  create(reference: FakeDocumentReference, data: StoredDocument) {
    this.database.writes.push({ kind: "create", path: reference.path, data: clone(data) });
    this.operations.push(() => {
      if (this.database.documents.has(reference.path)) throw new Error("create precondition failed");
      this.database.documents.set(reference.path, clone(data));
    });
    return this;
  }

  set(reference: FakeDocumentReference, data: StoredDocument) {
    this.database.writes.push({ kind: "set", path: reference.path, data: clone(data) });
    this.operations.push(() => this.database.documents.set(reference.path, clone(data)));
    return this;
  }

  async commit() {
    this.operations.forEach((operation) => operation());
  }
}

class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>();
  readonly writes: Array<{ kind: "create" | "set" | "update"; path: string; data: StoredDocument }> = [];
  afterProjectRead: (() => void) | null = null;

  doc(path: string) {
    return new FakeDocumentReference(path, this);
  }

  collection(path: string) {
    return {
      get: async () => {
        const prefix = `${path}/`;
        const docs = [...this.documents.entries()]
          .filter(([documentPath]) => documentPath.startsWith(prefix) && !documentPath.slice(prefix.length).includes("/"))
          .map(([documentPath, data]) => ({
            id: documentPath.slice(prefix.length),
            data: () => clone(data),
          }));
        this.afterProjectRead?.();
        this.afterProjectRead = null;
        return { docs };
      },
    };
  }

  batch() {
    return new FakeWriteBatch(this);
  }

  async runTransaction<T>(callback: (transaction: {
    get: (reference: FakeDocumentReference) => ReturnType<FakeDocumentReference["get"]>;
    create: (reference: FakeDocumentReference, data: StoredDocument) => void;
    set: (reference: FakeDocumentReference, data: StoredDocument, options?: { merge?: boolean }) => void;
    update: (reference: FakeDocumentReference, data: StoredDocument) => void;
  }) => Promise<T>): Promise<T> {
    const pending: Array<() => void> = [];
    const result = await callback({
      get: (reference) => reference.get(),
      create: (reference, data) => {
        this.writes.push({ kind: "create", path: reference.path, data: clone(data) });
        pending.push(() => {
          if (this.documents.has(reference.path)) throw new Error("transaction create precondition failed");
          this.documents.set(reference.path, clone(data));
        });
      },
      set: (reference, data, options) => {
        this.writes.push({ kind: "set", path: reference.path, data: clone(data) });
        pending.push(() => {
          if (!options?.merge) {
            this.documents.set(reference.path, clone(data));
            return;
          }
          const existing = this.documents.get(reference.path) ?? {};
          applyFieldUpdate(existing, data);
          this.documents.set(reference.path, existing);
        });
      },
      update: (reference, data) => {
        this.writes.push({ kind: "update", path: reference.path, data: clone(data) });
        pending.push(() => {
          const existing = this.documents.get(reference.path);
          if (!existing) throw new Error("transaction update precondition failed");
          applyFieldUpdate(existing, data);
        });
      },
    });
    pending.forEach((operation) => operation());
    return result;
  }
}

test("scheduled completion remains independent after a manual failure and preserves immutable audits", async () => {
  const database = new FakeFirestore();
  const persistence = new FirestoreGithubPersistence(database as unknown as Firestore);
  const statePath = "users/owner/githubSync/state";
  const scheduledRunPath = "users/owner/githubSyncRuns/scheduled-day-d-attempt";
  const manualRunPath = "users/owner/githubSyncRuns/manual-failure";
  database.documents.set(statePath, {
    status: "succeeded",
    syncEnabled: true,
    firstSuccessfulManualImportAt: "2025-01-02T00:00:00.000Z",
    leaseOwner: null,
    leaseExpiresAt: null,
  });

  const scheduledLease = await persistence.acquireLease({
    uid: "owner",
    runId: "scheduled-day-d-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-03",
    now: new Date("2025-01-03T00:00:00.000Z"),
  });
  assert.deepEqual(scheduledLease, { acquired: true, duplicateScheduledRun: false });
  await persistence.completeRun({
    uid: "owner",
    runId: "scheduled-day-d-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-03",
    startedAt: "2025-01-03T00:00:00.000Z",
    completedAt: "2025-01-03T00:01:00.000Z",
    ownerLogin: "owner",
    counts: { created: 0, updated: 0, unchanged: 1, unavailable: 0, failed: 0 },
    rateLimit: null,
  });
  const originalScheduledAudit = clone(database.documents.get(scheduledRunPath));
  assert.equal(database.documents.get(statePath)?.lastSuccessfulScheduledDayKey, "2025-01-03");
  assert.deepEqual(originalScheduledAudit, {
    mode: "scheduled",
    scheduledKey: "2025-01-03",
    status: "succeeded",
    startedAt: "2025-01-03T00:00:00.000Z",
    completedAt: "2025-01-03T00:01:00.000Z",
    counts: { created: 0, updated: 0, unchanged: 1, unavailable: 0, failed: 0 },
    rateLimit: null,
  });

  await persistence.acquireLease({
    uid: "owner",
    runId: "manual-failure",
    mode: "manual",
    scheduledKey: null,
    now: new Date("2025-01-03T02:00:00.000Z"),
  });
  await persistence.failRun({
    uid: "owner",
    runId: "manual-failure",
    mode: "manual",
    scheduledKey: null,
    startedAt: "2025-01-03T02:00:00.000Z",
    failedAt: "2025-01-03T02:01:00.000Z",
    errorCode: "github_unavailable",
    failureStage: "repository_list_and_enrichment",
    rateLimit: null,
  });
  assert.equal(database.documents.get(statePath)?.status, "failed");
  assert.equal(database.documents.get(statePath)?.lastSuccessfulScheduledDayKey, "2025-01-03");
  assert.equal(database.documents.get(manualRunPath)?.status, "failed");

  const duplicate = await persistence.acquireLease({
    uid: "owner",
    runId: "duplicate-day-d-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-03",
    now: new Date("2025-01-03T03:00:00.000Z"),
  });
  assert.deepEqual(duplicate, { acquired: false, duplicateScheduledRun: true });
  assert.equal(database.documents.has("users/owner/githubSyncRuns/duplicate-day-d-attempt"), false);
  assert.deepEqual(database.documents.get(scheduledRunPath), originalScheduledAudit);
  assert.equal(database.documents.get(manualRunPath)?.status, "failed");

  await persistence.failRun({
    uid: "owner",
    runId: "scheduled-day-d-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-03",
    startedAt: "2025-01-03T00:00:00.000Z",
    failedAt: "2025-01-03T03:01:00.000Z",
    errorCode: "internal",
    failureStage: "run_completion",
    rateLimit: null,
  });
  assert.deepEqual(database.documents.get(scheduledRunPath), originalScheduledAudit);
});

test("scheduled days allow the next day, retry failures, and reject concurrent delivery", async () => {
  const database = new FakeFirestore();
  const persistence = new FirestoreGithubPersistence(database as unknown as Firestore);
  const statePath = "users/owner/githubSync/state";
  database.documents.set(statePath, {
    status: "succeeded",
    syncEnabled: true,
    lastSuccessfulScheduledDayKey: "2025-01-03",
    leaseOwner: null,
    leaseExpiresAt: null,
  });

  const nextDay = await persistence.acquireLease({
    uid: "owner",
    runId: "next-day-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-04",
    now: new Date("2025-01-04T00:00:00.000Z"),
  });
  const concurrent = await persistence.acquireLease({
    uid: "owner",
    runId: "concurrent-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-04",
    now: new Date("2025-01-04T00:00:01.000Z"),
  });
  assert.deepEqual(nextDay, { acquired: true, duplicateScheduledRun: false });
  assert.deepEqual(concurrent, { acquired: false, duplicateScheduledRun: false });

  await persistence.failRun({
    uid: "owner",
    runId: "next-day-attempt",
    mode: "scheduled",
    scheduledKey: "2025-01-04",
    startedAt: "2025-01-04T00:00:00.000Z",
    failedAt: "2025-01-04T00:01:00.000Z",
    errorCode: "github_unavailable",
    failureStage: "repository_list_and_enrichment",
    rateLimit: null,
  });
  assert.equal(database.documents.get(statePath)?.lastSuccessfulScheduledDayKey, "2025-01-03");
  assert.equal(database.documents.get("users/owner/githubSyncRuns/next-day-attempt")?.status, "failed");

  const retry = await persistence.acquireLease({
    uid: "owner",
    runId: "next-day-retry",
    mode: "scheduled",
    scheduledKey: "2025-01-04",
    now: new Date("2025-01-04T00:02:00.000Z"),
  });
  assert.deepEqual(retry, { acquired: true, duplicateScheduledRun: false });
  assert.equal(database.documents.get("users/owner/githubSyncRuns/next-day-attempt")?.status, "failed");
});

test("an external-only update cannot revert a manual edit made after the sync read", async () => {
  const initial = applyGithubRepositoryImportBatch(empty(), [toGithubRepositoryImport(normalized())], {
    now: "2025-01-03T00:00:00.000Z",
    generateProjectId: () => "project-1",
  }).data.projects[0];
  const database = new FakeFirestore();
  const initialPayload = { ...initial } as StoredDocument;
  delete initialPayload.id;
  const projectPath = "users/owner/projects/project-1";
  database.documents.set(projectPath, initialPayload);
  database.afterProjectRead = () => {
    const concurrent = database.documents.get(projectPath);
    assert.ok(concurrent);
    concurrent.purpose = "manual purpose saved after synchronization read";
    concurrent.currentObjective = "manual objective saved after synchronization read";
    concurrent.lastWorkedAt = "2025-01-03T23:59:00.000Z";
  };

  const persistence = new FirestoreGithubPersistence(database as unknown as Firestore);
  const counts = await persistence.persistRepositories({
    uid: "owner",
    repositories: [normalized({
      description: "new GitHub description",
      syncedAt: "2025-01-04T00:00:00.000Z",
    })],
    visibleRepositoryIds: new Set(["123"]),
    listingComplete: true,
    syncedAt: "2025-01-04T00:00:00.000Z",
  });

  const persisted = database.documents.get(projectPath);
  assert.ok(persisted);
  assert.equal(counts.updated, 1);
  assert.equal(persisted.purpose, "manual purpose saved after synchronization read");
  assert.equal(persisted.currentObjective, "manual objective saved after synchronization read");
  assert.equal(persisted.lastWorkedAt, "2025-01-03T23:59:00.000Z");
  const github = (persisted.externalSources as { github: { description: string } }).github;
  assert.equal(github.description, "new GitHub description");
  const projectWrite = database.writes.find((write) => write.path === projectPath);
  assert.equal(projectWrite?.kind, "update");
  const writtenFields = Object.keys(projectWrite?.data ?? {});
  assert.ok(writtenFields.includes("externalSources.github.description"));
  assert.ok(writtenFields.includes("externalSources.github.synchronizationTimestamp"));
  assert.equal(writtenFields.includes("externalSources.github"), false);
  assert.equal(writtenFields.some((field) => field.includes("firebaseAssociation")), false);
  assert.equal(writtenFields.includes("purpose"), false);
  assert.equal(writtenFields.includes("currentObjective"), false);
  assert.equal(writtenFields.includes("lastWorkedAt"), false);
  assert.equal(writtenFields.includes("updatedAt"), false);
});

test("a Firebase association confirmed after the sync read is not downgraded by partial discovery", async () => {
  const initial = applyGithubRepositoryImportBatch(empty(), [toGithubRepositoryImport(normalized())], {
    now: "2025-01-03T00:00:00.000Z",
    generateProjectId: () => "project-1",
  }).data.projects[0];
  const database = new FakeFirestore();
  const initialPayload = { ...initial } as StoredDocument;
  delete initialPayload.id;
  const projectPath = "users/owner/projects/project-1";
  database.documents.set(projectPath, initialPayload);
  database.afterProjectRead = () => {
    const concurrent = database.documents.get(projectPath) as {
      externalSources: { github: { firebaseAssociation: StoredDocument } };
    };
    concurrent.externalSources.github.firebaseAssociation = {
      status: "confirmed",
      evidence: "owner-confirmed Firebase project",
      detectedAt: "2025-01-03T00:00:00.000Z",
      confirmedAt: "2025-01-03T12:00:00.000Z",
    };
  };

  const persistence = new FirestoreGithubPersistence(database as unknown as Firestore);
  await persistence.persistRepositories({
    uid: "owner",
    repositories: [normalized({
      firebaseAssociations: {
        projectIds: [],
        evidence: [],
        discoveryStatus: "partial",
      },
      enrichmentFailureCodes: ["firebase_config_partial"],
      syncedAt: "2025-01-04T00:00:00.000Z",
    })],
    visibleRepositoryIds: new Set(["123"]),
    listingComplete: true,
    syncedAt: "2025-01-04T00:00:00.000Z",
  });

  const persisted = database.documents.get(projectPath) as {
    externalSources: { github: { firebaseAssociation: StoredDocument } };
  };
  assert.deepEqual(persisted.externalSources.github.firebaseAssociation, {
    status: "confirmed",
    evidence: "owner-confirmed Firebase project",
    detectedAt: "2025-01-03T00:00:00.000Z",
    confirmedAt: "2025-01-03T12:00:00.000Z",
  });
});

test("an unchanged repository advances sync bookkeeping without adding duplicate GitHub activity", async () => {
  const database = new FakeFirestore();
  const persistence = new FirestoreGithubPersistence(database as unknown as Firestore);
  const firstInput = {
    uid: "owner",
    repositories: [normalized()],
    visibleRepositoryIds: new Set(["123"]),
    listingComplete: true,
    syncedAt: "2025-01-03T00:00:00.000Z",
  };
  const first = await persistence.persistRepositories(firstInput);
  const second = await persistence.persistRepositories({
    ...firstInput,
    repositories: [normalized({ syncedAt: "2025-01-04T00:00:00.000Z" })],
    syncedAt: "2025-01-04T00:00:00.000Z",
  });

  assert.equal(first.created, 1);
  assert.equal(second.unchanged, 1);
  const projects = [...database.documents.entries()].filter(([path]) => path.startsWith("users/owner/projects/"));
  const activities = [...database.documents.entries()].filter(([path]) => path.startsWith("users/owner/activity/"));
  assert.equal(projects.length, 1);
  assert.equal(activities.length, 1);
  const github = (projects[0][1].externalSources as { github: { synchronizationTimestamp: string } }).github;
  assert.equal(github.synchronizationTimestamp, "2025-01-04T00:00:00.000Z");
});

test("recursively removes undefined without altering defined or Firestore-native values", () => {
  class FirestoreNativeValue {
    constructor(readonly value: string) {}
  }
  const native = new FirestoreNativeValue("preserved");
  const sanitized = withoutUndefined({
    remove: undefined,
    nullValue: null,
    falseValue: false,
    zeroValue: 0,
    emptyValue: "",
    nested: { remove: undefined, keep: "value" },
    array: [undefined, null, false, 0, "", { remove: undefined, keep: "nested" }],
    native,
  });

  assert.deepEqual(sanitized, {
    nullValue: null,
    falseValue: false,
    zeroValue: 0,
    emptyValue: "",
    nested: { keep: "value" },
    array: [null, false, 0, "", { keep: "nested" }],
    native,
  });
  assert.equal(sanitized.native, native);
});
