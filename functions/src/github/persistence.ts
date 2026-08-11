import { createHash } from "node:crypto";
import { Timestamp, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import {
  applyGithubRepositoryImportBatch,
  markMissingRepositoriesUnavailable,
  type DashboardData,
  type GithubRepositoryImport,
  type GithubSyncReport,
  type Project,
} from "../githubSyncPolicy";
import {
  FIRESTORE_BATCH_SIZE,
  SYNC_LEASE_TTL_MS,
  type GithubSyncCounts,
  type GithubSyncMode,
  type LeaseResult,
  type NormalizedGithubRepository,
  type RateLimitState,
  type SyncFailureStage,
  type SyncStateRecord,
} from "./types";
import { mergeRateLimitState } from "./rateLimit";

const statePath = (uid: string) => `users/${uid}/githubSync/state`;
const projectsPath = (uid: string) => `users/${uid}/projects`;
const activityPath = (uid: string) => `users/${uid}/activity`;
const runsPath = (uid: string) => `users/${uid}/githubSyncRuns`;
const EMPTY_COUNTS: GithubSyncCounts = { created: 0, updated: 0, unchanged: 0, unavailable: 0, failed: 0 };

const decode = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, decode(nested)]));
  }
  return value;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const withoutUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined)
      .map((entry) => withoutUndefined(entry)) as unknown as T;
  }
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, withoutUndefined(entry)]),
  ) as T;
};

export const buildFailedRunStateUpdate = (
  input: {
    runId: string;
    failedAt: string;
    errorCode: string;
    failureStage: SyncFailureStage;
    rateLimit: RateLimitState | null;
  },
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const previousRateLimit = previous?.lastRateLimit as RateLimitState | null | undefined;
  return withoutUndefined({
    status: "failed",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastRunId: input.runId,
    lastCompletedAt: input.failedAt,
    lastErrorCode: input.errorCode,
    lastFailureStage: input.failureStage,
    lastRateLimit: mergeRateLimitState(previousRateLimit, input.rateLimit) ?? undefined,
    updatedAt: input.failedAt,
  });
};

const dashboardWithProjects = (projects: Project[]): DashboardData => ({
  schemaVersion: 1,
  projects,
  ideas: [],
  tasks: [],
  brainDumps: [],
  scratchpads: [],
  architectureDecisions: [],
  codexPrompts: [],
  notes: [],
  importantLinks: [],
  developmentSessions: [],
  activities: [],
});

export const toGithubRepositoryImport = (repository: NormalizedGithubRepository): GithubRepositoryImport => {
  const lastWorkedAtSource: GithubRepositoryImport["lastWorkedAtSource"] =
    repository.lastWorkedAtSource === "github_personal_commit"
      ? "personal_commit"
      : repository.lastWorkedAtSource === "github_repository_pushed_at"
        ? "repository_pushed"
        : "repository_updated";
  return {
    sourceType: "github",
    externalRepositoryId: String(repository.repositoryId),
    ownerLogin: repository.ownerLogin,
    repositoryName: repository.name,
    repositoryFullName: repository.fullName,
    repositoryUrl: repository.url,
    defaultBranch: repository.defaultBranch,
    visibility: repository.visibility,
    isArchived: repository.archived,
    isFork: repository.fork,
    description: repository.description ?? "",
    primaryLanguage: repository.language ?? "",
    topics: repository.topics,
    createdDate: repository.repositoryCreatedAt,
    updatedDate: repository.repositoryUpdatedAt,
    pushedDate: repository.repositoryPushedAt ?? repository.repositoryUpdatedAt,
    latestKnownPersonalCommitDate: repository.latestPersonalCommitAt,
    latestKnownPersonalCommitMessage: repository.latestPersonalCommitMessage,
    lastWorkedAt: repository.lastWorkedAt,
    lastWorkedAtSource,
    openIssueCount: repository.openIssueCount,
    openPullRequestCount: repository.openPullRequestCount,
    synchronizationTimestamp: repository.syncedAt,
    synchronizationStatus: "success",
    sourceError: repository.enrichmentFailureCodes.length ? repository.enrichmentFailureCodes.join(",") : null,
    associationStatus: repository.firebaseAssociations.evidence.length > 0
      ? "detected"
      : repository.firebaseAssociations.discoveryStatus === "partial"
        ? "unknown"
        : "not_detected",
    ...(repository.firebaseAssociations.evidence.length
      ? { associationEvidence: JSON.stringify(repository.firebaseAssociations.evidence) }
      : {}),
  };
};

export const isLeaseActive = (state: Partial<SyncStateRecord> | null | undefined, now: Date): boolean => {
  if (state?.status !== "running" || !state.leaseOwner || !state.leaseExpiresAt) return false;
  return new Date(state.leaseExpiresAt).getTime() > now.getTime();
};

export const isScheduledSyncEnabled = (state: Partial<SyncStateRecord> | null | undefined): boolean => {
  return state?.syncEnabled === true;
};

export const isScheduledDayComplete = (
  state: Partial<SyncStateRecord> | null | undefined,
  scheduledKey: string,
): boolean => {
  return state?.lastSuccessfulScheduledDayKey === scheduledKey || state?.lastScheduledKey === scheduledKey;
};

export const scheduledKeyFor = (date: Date) => date.toISOString().slice(0, 10);
export const deterministicActivityId = (id: string, outcome: string, timestamp: string): string => {
  const hash = createHash("sha256").update(`${id}:${outcome}:${timestamp}`).digest("hex").slice(0, 32);
  const versioned = `${hash.slice(0, 12)}5${hash.slice(13, 16)}`;
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const canonical = `${versioned}${variant}${hash.slice(17)}`;
  return `${canonical.slice(0, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}-${canonical.slice(16, 20)}-${canonical.slice(20)}`;
};

export const hasSuccessfulImportResult = (counts: GithubSyncCounts): boolean =>
  counts.created + counts.updated + counts.unchanged > 0;

type SuccessfulRunStateInput = {
  runId: string;
  mode: GithubSyncMode;
  scheduledKey: string | null;
  completedAt: string;
  ownerLogin: string;
  counts: GithubSyncCounts;
  rateLimit: RateLimitState | null;
};

export const buildSuccessfulRunStateUpdate = (
  input: SuccessfulRunStateInput,
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const qualifiesAsFirstImport = input.mode === "manual" && hasSuccessfulImportResult(input.counts);
  const previousRateLimit = previous?.lastRateLimit as RateLimitState | null | undefined;
  return withoutUndefined({
    status: "succeeded",
    leaseOwner: null,
    leaseExpiresAt: null,
    lastRunId: input.runId,
    syncEnabled: qualifiesAsFirstImport ? true : previous?.syncEnabled,
    firstSuccessfulManualImportAt: previous?.firstSuccessfulManualImportAt ??
      (qualifiesAsFirstImport ? input.completedAt : undefined),
    lastSuccessfulScheduledDayKey: input.mode === "scheduled"
      ? input.scheduledKey
      : previous?.lastSuccessfulScheduledDayKey ?? previous?.lastScheduledKey,
    lastScheduledKey: input.mode === "scheduled" ? input.scheduledKey : previous?.lastScheduledKey,
    lastCompletedAt: input.completedAt,
    lastSuccessfulSyncAt: input.completedAt,
    connectedOwnerLogin: input.ownerLogin,
    lastCounts: input.counts,
    lastRateLimit: mergeRateLimitState(previousRateLimit, input.rateLimit) ?? undefined,
    updatedAt: input.completedAt,
  });
};

type GithubAssociation = NonNullable<NonNullable<Project["externalSources"]>["github"]>["firebaseAssociation"];

export const existingProjectExternalUpdate = (project: Project): Record<string, unknown> => {
  const source = project.externalSources?.github;
  if (!source) return {};
  return withoutUndefined({
    "externalSources.github.sourceType": source.sourceType,
    "externalSources.github.externalRepositoryId": source.externalRepositoryId,
    "externalSources.github.ownerLogin": source.ownerLogin,
    "externalSources.github.repositoryName": source.repositoryName,
    "externalSources.github.repositoryFullName": source.repositoryFullName,
    "externalSources.github.repositoryUrl": source.repositoryUrl,
    "externalSources.github.defaultBranch": source.defaultBranch,
    "externalSources.github.visibility": source.visibility,
    "externalSources.github.isArchived": source.isArchived,
    "externalSources.github.isFork": source.isFork,
    "externalSources.github.description": source.description,
    "externalSources.github.primaryLanguage": source.primaryLanguage,
    "externalSources.github.topics": source.topics,
    "externalSources.github.createdDate": source.createdDate,
    "externalSources.github.updatedDate": source.updatedDate,
    "externalSources.github.pushedDate": source.pushedDate,
    "externalSources.github.latestKnownPersonalCommitDate": source.latestKnownPersonalCommitDate,
    "externalSources.github.latestKnownPersonalCommitMessage": source.latestKnownPersonalCommitMessage,
    "externalSources.github.lastWorkedAt": source.lastWorkedAt,
    "externalSources.github.lastWorkedAtSource": source.lastWorkedAtSource,
    "externalSources.github.openIssueCount": source.openIssueCount,
    "externalSources.github.openPullRequestCount": source.openPullRequestCount,
    "externalSources.github.synchronizationTimestamp": source.synchronizationTimestamp,
    "externalSources.github.synchronizationStatus": source.synchronizationStatus,
    "externalSources.github.sourceError": source.sourceError,
    externalActivityStatus: project.externalActivityStatus,
    externalActivityUpdatedAt: project.externalActivityUpdatedAt,
  });
};

export const shouldApplyAutomatedAssociation = (
  current: GithubAssociation | undefined,
  desired: GithubAssociation,
): boolean => {
  if (current?.status === "confirmed" || current?.status === "removed") return false;
  if (
    current?.status === "detected" &&
    (desired.status === "not_detected" || desired.status === "unknown")
  ) return false;
  return JSON.stringify(current) !== JSON.stringify(desired);
};

export const chunkValues = <T>(values: readonly T[], size = FIRESTORE_BATCH_SIZE): T[][] => {
  if (size < 1 || size > 500) throw new Error("Invalid Firestore batch size.");
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

export type PersistRepositoriesInput = {
  uid: string;
  repositories: NormalizedGithubRepository[];
  visibleRepositoryIds: Set<string>;
  listingComplete: boolean;
  syncedAt: string;
  reportStage?: (stage: SyncFailureStage) => void;
};

export interface GithubPersistencePort {
  getState(uid: string): Promise<Partial<SyncStateRecord> | null>;
  acquireLease(input: { uid: string; runId: string; mode: GithubSyncMode; scheduledKey: string | null; now: Date }): Promise<LeaseResult>;
  persistRepositories(input: PersistRepositoriesInput): Promise<GithubSyncCounts>;
  completeRun(input: { uid: string; runId: string; mode: GithubSyncMode; scheduledKey: string | null; startedAt: string; completedAt: string; ownerLogin: string; counts: GithubSyncCounts; rateLimit: RateLimitState | null }): Promise<void>;
  failRun(input: { uid: string; runId: string; mode: GithubSyncMode; scheduledKey: string | null; startedAt: string; failedAt: string; errorCode: string; failureStage: SyncFailureStage; rateLimit: RateLimitState | null }): Promise<void>;
}

type BatchOperation = (batch: WriteBatch) => void;

export class FirestoreGithubPersistence implements GithubPersistencePort {
  constructor(private readonly db: Firestore) {}

  async getState(uid: string): Promise<Partial<SyncStateRecord> | null> {
    const snapshot = await this.db.doc(statePath(uid)).get();
    return snapshot.exists ? (decode(snapshot.data()) as Partial<SyncStateRecord>) : null;
  }

  async acquireLease(input: { uid: string; runId: string; mode: GithubSyncMode; scheduledKey: string | null; now: Date }): Promise<LeaseResult> {
    const reference = this.db.doc(statePath(input.uid));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const state = snapshot.exists ? (decode(snapshot.data()) as Partial<SyncStateRecord>) : null;
      if (input.mode === "scheduled" && !isScheduledSyncEnabled(state)) {
        return { acquired: false, duplicateScheduledRun: false, scheduledDisabled: true };
      }
      if (input.mode === "scheduled" && input.scheduledKey && isScheduledDayComplete(state, input.scheduledKey)) {
        return { acquired: false, duplicateScheduledRun: true };
      }
      if (isLeaseActive(state, input.now)) return { acquired: false, duplicateScheduledRun: false };
      transaction.set(reference, {
        status: "running",
        leaseOwner: input.runId,
        leaseExpiresAt: new Date(input.now.getTime() + SYNC_LEASE_TTL_MS).toISOString(),
        lastRunId: input.runId,
        lastStartedAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
      }, { merge: true });
      return { acquired: true, duplicateScheduledRun: false };
    });
  }

  private async loadProjects(uid: string): Promise<Project[]> {
    const snapshot = await this.db.collection(projectsPath(uid)).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...(decode(document.data()) as object) })) as Project[];
  }

  private async persistAssociationIfSafe(
    uid: string,
    projectId: string,
    initial: GithubAssociation | undefined,
    desired: GithubAssociation | undefined,
  ): Promise<void> {
    if (!desired || JSON.stringify(initial) === JSON.stringify(desired)) return;
    const reference = this.db.doc(`${projectsPath(uid)}/${projectId}`);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return;
      const data = snapshot.data() as { externalSources?: { github?: { firebaseAssociation?: GithubAssociation } } } | undefined;
      const current = data?.externalSources?.github?.firebaseAssociation;
      if (!shouldApplyAutomatedAssociation(current, desired)) return;
      transaction.update(reference, {
        "externalSources.github.firebaseAssociation": withoutUndefined(desired),
      });
    });
  }

  async persistRepositories(input: PersistRepositoriesInput): Promise<GithubSyncCounts> {
    input.reportStage?.("contract_normalization");
    const imports = input.repositories.map(toGithubRepositoryImport);
    input.reportStage?.("project_persistence");
    const projectsBeforeImport = await this.loadProjects(input.uid);
    input.reportStage?.("contract_normalization");
    const applied = applyGithubRepositoryImportBatch(dashboardWithProjects(projectsBeforeImport), imports, { now: input.syncedAt });
    const missing = input.listingComplete
      ? markMissingRepositoriesUnavailable(applied.data, input.visibleRepositoryIds, { now: input.syncedAt })
      : { data: applied.data, reports: [] as GithubSyncReport[] };
    const reports = [...applied.reports, ...missing.reports];
    const projects = new Map(missing.data.projects.map((project) => [project.id, project]));
    const existingProjectIds = new Set(projectsBeforeImport.map((project) => project.id));
    const existingProjects = new Map(projectsBeforeImport.map((project) => [project.id, project]));
    const importsById = new Map(imports.map((repository) => [repository.externalRepositoryId, repository]));
    input.reportStage?.("project_persistence");
    const operations: BatchOperation[] = [];

    for (const report of reports) {
      if (!report.projectId) continue;
      const project = projects.get(report.projectId);
      if (!project) continue;
      if (existingProjectIds.has(project.id)) {
        await this.persistAssociationIfSafe(
          input.uid,
          project.id,
          existingProjects.get(project.id)?.externalSources?.github?.firebaseAssociation,
          project.externalSources?.github?.firebaseAssociation,
        );
      }
      operations.push((batch) => {
        const projectReference = this.db.doc(`${projectsPath(input.uid)}/${project.id}`);
        if (existingProjectIds.has(project.id)) {
          batch.update(projectReference, existingProjectExternalUpdate(project));
        } else {
          const payload = { ...project } as Record<string, unknown>;
          delete payload.id;
          batch.create(projectReference, withoutUndefined(payload));
        }

        if (!report.changed || (report.outcome !== "created" && report.outcome !== "updated" && report.outcome !== "unavailable")) {
          return;
        }
        const timestamp = importsById.get(report.externalRepositoryId)?.updatedDate ?? input.syncedAt;
        const eventId = deterministicActivityId(report.externalRepositoryId, report.outcome, timestamp);
        const type = report.outcome === "created"
          ? "github_repository_imported"
          : report.outcome === "updated"
            ? "github_repository_updated"
            : "github_repository_unavailable";
        batch.set(this.db.doc(`${activityPath(input.uid)}/${eventId}`), withoutUndefined({
          projectId: project.id,
          type,
          summary: `GitHub repository ${report.outcome}.`,
          entityType: "project",
          entityId: project.id,
          metadata: JSON.stringify({ source: "github", externalRepositoryId: report.externalRepositoryId, outcome: report.outcome }),
          createdAt: input.syncedAt,
        }), { merge: false });
      });
    }

    for (const chunk of chunkValues(operations, Math.floor(FIRESTORE_BATCH_SIZE / 2))) {
      const batch = this.db.batch();
      chunk.forEach((operation) => operation(batch));
      await batch.commit();
    }
    const counts = { ...EMPTY_COUNTS };
    reports.forEach((report) => { counts[report.outcome] += 1; });
    return counts;
  }

  async completeRun(input: { uid: string; runId: string; mode: GithubSyncMode; scheduledKey: string | null; startedAt: string; completedAt: string; ownerLogin: string; counts: GithubSyncCounts; rateLimit: RateLimitState | null }): Promise<void> {
    const reference = this.db.doc(statePath(input.uid));
    const runReference = this.db.doc(`${runsPath(input.uid)}/${input.runId}`);
    let bestRateLimit = input.rateLimit;
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const runSnapshot = await transaction.get(runReference);
      if (runSnapshot.exists) return;
      if (snapshot.data()?.leaseOwner !== input.runId) return;
      const update = buildSuccessfulRunStateUpdate(input, snapshot.data());
      bestRateLimit = (update.lastRateLimit as RateLimitState | undefined) ?? null;
      transaction.set(reference, update, { merge: true });
      transaction.create(runReference, withoutUndefined({
        mode: input.mode, scheduledKey: input.scheduledKey, status: "succeeded",
        startedAt: input.startedAt, completedAt: input.completedAt,
        counts: input.counts, rateLimit: bestRateLimit,
      }));
    });
  }

  async failRun(input: { uid: string; runId: string; mode: GithubSyncMode; scheduledKey: string | null; startedAt: string; failedAt: string; errorCode: string; failureStage: SyncFailureStage; rateLimit: RateLimitState | null }): Promise<void> {
    const reference = this.db.doc(statePath(input.uid));
    const runReference = this.db.doc(`${runsPath(input.uid)}/${input.runId}`);
    let bestRateLimit = input.rateLimit;
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const runSnapshot = await transaction.get(runReference);
      if (runSnapshot.exists) return;
      if (snapshot.data()?.leaseOwner === input.runId) {
        const update = buildFailedRunStateUpdate(input, snapshot.data());
        bestRateLimit = (update.lastRateLimit as RateLimitState | undefined) ?? null;
        transaction.set(reference, update, { merge: true });
      }
      transaction.create(runReference, withoutUndefined({
        mode: input.mode, scheduledKey: input.scheduledKey, status: "failed",
        startedAt: input.startedAt, completedAt: input.failedAt,
        errorCode: input.errorCode, failureStage: input.failureStage,
        rateLimit: bestRateLimit,
      }));
    });
  }
}
