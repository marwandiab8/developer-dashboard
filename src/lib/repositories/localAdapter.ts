"use client";

import { DashboardData, ImportantLink, Project } from "../models";
import {
  type DashboardRepository,
  type MigrationState,
  type PendingCloudReconciliationAction,
  type SearchResult,
} from "./types";
import { SCHEMA_VERSION, STORAGE_KEY } from "../constants";
import { nowIso } from "../utils/time";
import { dashboardDataSchema } from "../validation";
import { seedDashboardData } from "../seed";
import {
  normalizeIdeaStatus,
  normalizePromptStatus,
  normalizeTaskStatus,
} from "../workflow";

const LOCAL_STATE_KEY = `${STORAGE_KEY}:state`;
const LOCAL_BACKUP_KEY = `${STORAGE_KEY}:migration-backup`;
const LOCAL_PRE_CLOUD_FALLBACK_BACKUP_KEY = `${STORAGE_KEY}:pre-cloud-fallback-backup`;
const LOCAL_RECONCILIATION_ACTIONS_KEY = `${STORAGE_KEY}:reconciliation-actions`;
const LOCAL_CLOUD_RECOVERY_KEY = `${STORAGE_KEY}:cloud-recovery`;

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const makeReconciliationActionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const fallbackDashboard = seedDashboardData();
const SEED_TIMESTAMP_SENTINEL = "__seed_generated_timestamp__";
const fallbackSeedTimestamp = fallbackDashboard.projects[0]?.createdAt ?? "";
const LEGACY_SEED_ANCHOR_FIELDS = new Set([
  "createdAt",
  "startedAt",
  "completedAt",
  "decidedAt",
  "endedAt",
]);

type LocalDashboardBackup = {
  createdAt: string;
  sourceDevice: string;
  sourceSchemaVersion: number;
  dashboardData: DashboardData;
};

type LocalCloudRecoverySnapshot = {
  updatedAt: string;
  ownerScope?: string;
  dashboardData: DashboardData;
};

export const cloudRecoveryScopeForUid = (uid: string): string => {
  // This opaque token is only a localStorage routing key. Firestore rules and
  // authenticated UIDs remain the authorization boundary.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < uid.length; index += 1) {
    const code = uid.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }

  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

const cloudRecoveryStorageKey = (ownerScope?: string) =>
  ownerScope ? `${LOCAL_CLOUD_RECOVERY_KEY}:${ownerScope}` : LOCAL_CLOUD_RECOVERY_KEY;

type LocalDataMarkerState = {
  hasUserData: boolean;
  updatedAt: string;
  source: "seed" | "user";
  /**
   * Opaque, device-local routing scope for a dashboard projection retained
   * after a cloud write failure. This is not an authorization boundary and
   * must never contain the raw authenticated UID.
   */
  ownerScope?: string;
  revision?: number;
  acknowledgedRevision?: number;
  reconciliationRequired?: boolean;
  reconciliationReason?: string;
  legacyBaselineUntracked?: boolean;
};

type PendingLocalDataWrite = {
  payloadFingerprint: string;
  marker: LocalDataMarkerState;
};

export type LocalDataMarker = LocalDataMarkerState & {
  pendingWrite?: PendingLocalDataWrite;
};

export type LocalDataOwnership = "unscoped" | "current-owner" | "different-owner";

export type ClaimLegacyCloudRecoveryResult =
  | {
      ok: true;
      status: "claimed" | "nothing-to-claim";
      snapshotClaimed: boolean;
      claimedActionCount: number;
    }
  | {
      ok: false;
      status: "conflict";
      reason:
        | "invalid-owner-scope"
        | "invalid-legacy-snapshot"
        | "invalid-scoped-snapshot"
        | "scoped-snapshot-conflict"
        | "invalid-reconciliation-journal";
    };

export type LocalDataReconciliationState = {
  required: boolean;
  reason: string | null;
};

const emptyMarker: LocalDataMarkerState = {
  hasUserData: false,
  updatedAt: nowIso(),
  source: "seed",
  revision: 0,
  acknowledgedRevision: 0,
  reconciliationRequired: false,
};

const parseMarkerState = (parsed: Record<string, unknown>): LocalDataMarkerState => ({
  hasUserData: parsed.hasUserData === true,
  updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
  source: parsed.source === "user" ? "user" : "seed",
  ownerScope:
    typeof parsed.ownerScope === "string" && parsed.ownerScope.length > 0
      ? parsed.ownerScope
      : undefined,
  revision: typeof parsed.revision === "number" ? parsed.revision : undefined,
  acknowledgedRevision:
    typeof parsed.acknowledgedRevision === "number" ? parsed.acknowledgedRevision : undefined,
  reconciliationRequired: parsed.reconciliationRequired === true,
  reconciliationReason:
    typeof parsed.reconciliationReason === "string" ? parsed.reconciliationReason : undefined,
  legacyBaselineUntracked: parsed.legacyBaselineUntracked === true,
});

const fingerprintSerializedPayload = (serialized: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${serialized.length.toString(16)}:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
};

const readPersistedMarker = (): LocalDataMarker => {
  if (!isBrowser()) return emptyMarker;

  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return emptyMarker;

    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return emptyMarker;

    const marker: LocalDataMarker = parseMarkerState(parsed);
    if (
      isObject(parsed.pendingWrite)
      && typeof parsed.pendingWrite.payloadFingerprint === "string"
      && isObject(parsed.pendingWrite.marker)
    ) {
      marker.pendingWrite = {
        payloadFingerprint: parsed.pendingWrite.payloadFingerprint,
        marker: parseMarkerState(parsed.pendingWrite.marker),
      };
    }
    return marker;
  } catch {
    return emptyMarker;
  }
};

const pendingWriteMatchesStoredPayload = (pendingWrite: PendingLocalDataWrite): boolean => {
  if (!isBrowser()) return false;

  try {
    const payload = localStorage.getItem(STORAGE_KEY);
    return Boolean(
      payload
      && fingerprintSerializedPayload(payload) === pendingWrite.payloadFingerprint,
    );
  } catch {
    return false;
  }
};

const readMarker = (): LocalDataMarker => {
  const persisted = readPersistedMarker();
  if (!isBrowser() || !persisted.pendingWrite) {
    return persisted;
  }

  if (pendingWriteMatchesStoredPayload(persisted.pendingWrite)) {
    return {
      ...persisted.pendingWrite.marker,
      pendingWrite: persisted.pendingWrite,
    };
  }

  // Fall through to the last fully committed marker. The retained pending
  // record still prevents the payload from looking acknowledged.
  return persisted;
};

const writeMarker = (marker: LocalDataMarker) => {
  if (!isBrowser()) return;
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(marker));
};

const withoutPendingWrite = (marker: LocalDataMarker): LocalDataMarkerState => {
  const stable = { ...marker };
  delete stable.pendingWrite;
  return stable;
};

const restoreStorageValue = (key: string, previous: string | null) => {
  if (previous === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, previous);
  }
};

const persistDashboardDataWithMarker = (
  data: DashboardData,
  nextMarker: LocalDataMarkerState,
): void => {
  if (!isBrowser()) return;

  const serializedPayload = JSON.stringify(data);
  const previousMarker = localStorage.getItem(LOCAL_STATE_KEY);
  const currentMarker = withoutPendingWrite(readMarker());
  const finalMarker = { ...nextMarker };
  const preparationMarker: LocalDataMarker = {
    ...currentMarker,
    pendingWrite: {
      payloadFingerprint: fingerprintSerializedPayload(serializedPayload),
      marker: finalMarker,
    },
  };

  // The intention marker must be durable before the payload changes. If the
  // final marker write later fails, the matching pending record remains an
  // explicit, reload-safe signal that the new payload is unacknowledged.
  writeMarker(preparationMarker);
  try {
    localStorage.setItem(STORAGE_KEY, serializedPayload);
  } catch (error) {
    try {
      restoreStorageValue(LOCAL_STATE_KEY, previousMarker);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Unable to persist the local dashboard payload or restore its prior marker.",
      );
    }
    throw error;
  }

  // Never roll the payload back after this point. A failed final marker leaves
  // the preparation marker in place, so the newly durable payload cannot be
  // mistaken for an already acknowledged revision.
  writeMarker(finalMarker);
};

const readStoredDashboardPayload = (): unknown | null => {
  if (!isBrowser()) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const inferHasUserLocalDataFromStoredPayload = (payload: unknown): boolean => {
  if (!isObject(payload)) {
    return false;
  }

  return !isSeedDashboardData(createMigrationLayer(payload));
};

const writeUntrackedLegacyMarker = () => {
  writeMarker({
    hasUserData: true,
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    acknowledgedRevision: 0,
    reconciliationRequired: false,
    legacyBaselineUntracked: true,
  });
};

export const createDefaultDashboardData = () => {
  return seedDashboardData();
};

const normaliseLinks = (raw: unknown): ImportantLink[] => {
  if (!Array.isArray(raw)) return [];

  const fallback = nowIso();

  return raw
    .map((value) => {
      if (!isObject(value)) return null;
      const row = value as Partial<ImportantLink>;
      const id = row.id && typeof row.id === "string" ? row.id : makeFallbackId();

      const title = row.title && typeof row.title === "string" ? row.title : "Untitled link";
      const projectId = row.projectId && typeof row.projectId === "string" ? row.projectId : "";
      const url = row.url && typeof row.url === "string" ? row.url : "https://example.com";

      if (!projectId || !url) {
        return null;
      }

      return {
        id,
        projectId,
        title,
        url,
        notes: row.notes && typeof row.notes === "string" ? row.notes : "",
        section: row.section && typeof row.section === "string" ? row.section : "General",
        tags: Array.isArray(row.tags) ? row.tags.filter((item): item is string => typeof item === "string") : [],
        createdAt: row.createdAt && typeof row.createdAt === "string" ? row.createdAt : fallback,
        updatedAt: row.updatedAt && typeof row.updatedAt === "string" ? row.updatedAt : fallback,
      };
    })
    .filter((item): item is ImportantLink => item !== null);
};

const makeFallbackId = () =>
  `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.replace(/[^a-z0-9]/g, "").slice(0, 32);

const GENERATED_RECORD_TIMESTAMPS = new Set(["createdAt", "updatedAt"]);

const omitKeys = (record: object, keys: ReadonlySet<string>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.has(key)),
  );

const canonicalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeValue(value[key])]),
  );
};

const serializeCanonicalValue = (value: unknown): string =>
  JSON.stringify(canonicalizeValue(value));

const canonicalizeCollection = <T extends object>(
  records: T[],
  normalize: (record: T) => Record<string, unknown>,
): unknown[] =>
  records
    .map((record) => canonicalizeValue(normalize(record)))
    .sort((left, right) => serializeCanonicalValue(left).localeCompare(serializeCanonicalValue(right)));

const canonicalizeProject = (project: Project): Record<string, unknown> => {
  const normalized = omitKeys(
    project,
    new Set([
      ...GENERATED_RECORD_TIMESTAMPS,
      // Project recency is automatically touched by child actions and persistence hydration.
      "lastWorkedAt",
      // This mirrors the external synchronization timestamp and is bookkeeping, not manual data.
      "externalActivityUpdatedAt",
    ]),
  );

  const github = project.externalSources?.github;
  if (!github) {
    return normalized;
  }

  const association = omitKeys(
    github.firebaseAssociation,
    new Set(["detectedAt", "confirmedAt"]),
  );
  const normalizedGithub = {
    ...omitKeys(github, new Set(["synchronizationTimestamp"])),
    firebaseAssociation: association,
  };

  return {
    ...normalized,
    externalSources: {
      ...project.externalSources,
      github: normalizedGithub,
    },
  };
};

const seedRecordCollections = (data: DashboardData): Array<Array<Record<string, unknown>>> => [
  data.projects as unknown as Array<Record<string, unknown>>,
  data.ideas as unknown as Array<Record<string, unknown>>,
  data.tasks as unknown as Array<Record<string, unknown>>,
  data.brainDumps as unknown as Array<Record<string, unknown>>,
  data.architectureDecisions as unknown as Array<Record<string, unknown>>,
  data.codexPrompts as unknown as Array<Record<string, unknown>>,
  data.notes as unknown as Array<Record<string, unknown>>,
  data.importantLinks as unknown as Array<Record<string, unknown>>,
  data.developmentSessions as unknown as Array<Record<string, unknown>>,
  data.activities as unknown as Array<Record<string, unknown>>,
];

const legacySeedTimestampAnchor = (data: DashboardData): string | null => {
  const fallbackCollections = seedRecordCollections(fallbackDashboard);
  const actualCollections = seedRecordCollections(data);
  const observedTimestamps: string[] = [];

  for (let collectionIndex = 0; collectionIndex < fallbackCollections.length; collectionIndex += 1) {
    const fallbackRecords = fallbackCollections[collectionIndex];
    const actualRecords = actualCollections[collectionIndex];

    for (const fallbackRecord of fallbackRecords) {
      const fallbackId = fallbackRecord.id;
      const actualRecord = actualRecords.find((record) => record.id === fallbackId);
      if (!actualRecord) {
        return null;
      }

      for (const [key, fallbackValue] of Object.entries(fallbackRecord)) {
        if (!LEGACY_SEED_ANCHOR_FIELDS.has(key) || fallbackValue !== fallbackSeedTimestamp) {
          continue;
        }

        const actualValue = actualRecord[key];
        if (typeof actualValue !== "string") {
          return null;
        }
        observedTimestamps.push(actualValue);
      }
    }
  }

  const candidate = observedTimestamps[0];
  return candidate && observedTimestamps.every((timestamp) => timestamp === candidate)
    ? candidate
    : null;
};

const normalizeSeedLifecycleTimestamp = (value: string | null, anchor: string | null) =>
  value === fallbackSeedTimestamp || (anchor !== null && value === anchor)
    ? SEED_TIMESTAMP_SENTINEL
    : value;

const canonicalizeDashboardData = (data: DashboardData): Record<string, unknown> => {
  const lifecycleAnchor = legacySeedTimestampAnchor(data);

  return {
    schemaVersion: data.schemaVersion,
    projects: canonicalizeCollection(data.projects, canonicalizeProject),
    ideas: canonicalizeCollection(data.ideas, (record) => omitKeys(record, GENERATED_RECORD_TIMESTAMPS)),
    tasks: canonicalizeCollection(data.tasks, (record) => ({
      ...omitKeys(record, GENERATED_RECORD_TIMESTAMPS),
      startedAt: normalizeSeedLifecycleTimestamp(record.startedAt, lifecycleAnchor),
      completedAt: normalizeSeedLifecycleTimestamp(record.completedAt, lifecycleAnchor),
    })),
    brainDumps: canonicalizeCollection(data.brainDumps, (record) =>
      omitKeys(record, GENERATED_RECORD_TIMESTAMPS),
    ),
    scratchpads: canonicalizeCollection(data.scratchpads, (record) =>
      omitKeys(record, new Set(["updatedAt"])),
    ),
    architectureDecisions: canonicalizeCollection(data.architectureDecisions, (record) => ({
      ...omitKeys(record, GENERATED_RECORD_TIMESTAMPS),
      decidedAt: normalizeSeedLifecycleTimestamp(record.decidedAt, lifecycleAnchor),
    })),
    codexPrompts: canonicalizeCollection(data.codexPrompts, (record) =>
      omitKeys(record, GENERATED_RECORD_TIMESTAMPS),
    ),
    notes: canonicalizeCollection(data.notes, (record) => omitKeys(record, GENERATED_RECORD_TIMESTAMPS)),
    importantLinks: canonicalizeCollection(data.importantLinks, (record) =>
      omitKeys(record, GENERATED_RECORD_TIMESTAMPS),
    ),
    developmentSessions: canonicalizeCollection(data.developmentSessions, (record) => ({
      ...record,
      startedAt: normalizeSeedLifecycleTimestamp(record.startedAt, lifecycleAnchor),
      endedAt: normalizeSeedLifecycleTimestamp(record.endedAt, lifecycleAnchor),
    })),
    activities: canonicalizeCollection(data.activities, (record) =>
      omitKeys(record, new Set(["createdAt"])),
    ),
  };
};

/**
 * Compare persisted local data with the complete canonical seed snapshot.
 *
 * Collection ordering and generated bookkeeping timestamps do not represent user
 * edits. Every other persisted value does, including edits to an existing seeded
 * entity, so an upgrade cannot hide local work merely because IDs/counts match.
 */
export const isSeedDashboardData = (data: DashboardData) =>
  serializeCanonicalValue(canonicalizeDashboardData(data)) ===
  serializeCanonicalValue(canonicalizeDashboardData(fallbackDashboard));

export const createMigrationLayer = (raw: unknown): DashboardData => {
  if (!raw || typeof raw !== "object") {
    return { ...fallbackDashboard, schemaVersion: SCHEMA_VERSION };
  }

  const parsed = dashboardDataSchema.safeParse(raw);
  if (parsed.success) {
    const source = parsed.data;
    const sessions = source.developmentSessions.map((session) => {
      const relatedPrompt = source.codexPrompts.find((prompt) => prompt.relatedSessionId === session.id);
      return {
        ...session,
        taskId: session.taskId ?? session.tasksWorkedOn[0] ?? null,
        promptRecordId: session.promptRecordId ?? relatedPrompt?.id ?? null,
        source: session.source ?? "manual" as const,
        activeStartedAt: session.status === "active"
          ? session.activeStartedAt ?? session.startedAt
          : null,
      };
    });
    const promptsByTask = new Map<string, typeof source.codexPrompts>();
    source.codexPrompts.forEach((prompt) => {
      if (!prompt.relatedTaskId) return;
      promptsByTask.set(prompt.relatedTaskId, [
        ...(promptsByTask.get(prompt.relatedTaskId) ?? []),
        prompt,
      ]);
    });
    const promptSequences = new Map<string, number>();
    promptsByTask.forEach((prompts) => {
      [...prompts]
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .forEach((prompt, index) => promptSequences.set(prompt.id, index + 1));
    });
    const prompts = source.codexPrompts.map((prompt) => {
      const normalizedStatus = normalizePromptStatus(prompt.status);
      return {
        ...prompt,
        status: normalizedStatus,
        ...(normalizedStatus !== prompt.status && !prompt.legacyStatus
          ? { legacyStatus: prompt.status }
          : {}),
        source: prompt.source ?? "manual" as const,
        createdBy: prompt.createdBy ?? (prompt.source === "codex" ? "codex" : "marwan"),
        sequenceNumber: promptSequences.get(prompt.id) ?? prompt.sequenceNumber ?? 1,
        promptSummary: prompt.promptSummary || prompt.purpose || prompt.title,
        requestedChange: prompt.requestedChange || prompt.purpose,
      };
    });
    const ideas = source.ideas.map((idea) => {
      const normalizedStatus = normalizeIdeaStatus(idea.status);
      return {
        ...idea,
        status: normalizedStatus,
        ...(normalizedStatus !== idea.status && !idea.legacyStatus
          ? { legacyStatus: idea.status }
          : {}),
        convertedAt: normalizedStatus === "converted"
          ? idea.convertedAt ?? idea.updatedAt
          : idea.convertedAt,
      };
    });
    const tasks = source.tasks.map((task) => {
      const normalizedStatus = normalizeTaskStatus(task.status);
      const promptRecordIds = prompts
        .filter((prompt) => prompt.relatedTaskId === task.id)
        .map((prompt) => prompt.id);
      const workSessionIds = sessions
        .filter((session) => session.taskId === task.id || session.tasksWorkedOn.includes(task.id))
        .map((session) => session.id);
      return {
        ...task,
        status: normalizedStatus,
        ...(normalizedStatus !== task.status && !task.legacyStatus
          ? { legacyStatus: task.status }
          : {}),
        readyAt: normalizedStatus === "ready" ? task.readyAt ?? task.updatedAt : task.readyAt,
        lastWorkedAt: task.lastWorkedAt ?? task.startedAt ?? null,
        promptRecordIds: [...new Set([...task.promptRecordIds, ...promptRecordIds])],
        workSessionIds: [...new Set([...task.workSessionIds, ...workSessionIds])],
      };
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      projects: source.projects,
      ideas,
      tasks,
      brainDumps: source.brainDumps,
      scratchpads: source.scratchpads,
      architectureDecisions: source.architectureDecisions,
      codexPrompts: prompts,
      notes: source.notes,
      importantLinks: normaliseLinks(source.importantLinks),
      developmentSessions: sessions,
      activities: source.activities,
    };
  }

  return fallbackDashboard;
};

export const loadDashboardData = (): DashboardData => {
  if (!isBrowser()) {
    return fallbackDashboard;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = createDefaultDashboardData();
    persistDashboardDataWithMarker(seeded, {
      hasUserData: false,
      updatedAt: nowIso(),
      source: "seed",
      revision: 0,
      acknowledgedRevision: 0,
    });
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    return createMigrationLayer(parsed);
  } catch {
    const seeded = createDefaultDashboardData();
    persistDashboardDataWithMarker(seeded, {
      hasUserData: false,
      updatedAt: nowIso(),
      source: "seed",
      revision: 0,
      acknowledgedRevision: 0,
    });
    return seeded;
  }
};

export const localStorageDataExists = (): boolean => {
  if (!isBrowser()) return false;
  return Boolean(localStorage.getItem(STORAGE_KEY));
};

export const hasUserLocalData = (): boolean => {
  if (!isBrowser()) return false;

  const hasMarker = Boolean(localStorage.getItem(LOCAL_STATE_KEY));
  const marker = readMarker();
  if (marker.hasUserData) {
    return true;
  }

  const inferredUserData = inferHasUserLocalDataFromStoredPayload(readStoredDashboardPayload());
  if (inferredUserData && !hasMarker) {
    writeUntrackedLegacyMarker();
  }
  return inferredUserData;
};

export const hasUnacknowledgedLocalData = (completedAt: string | null | undefined): boolean => {
  if (!isBrowser()) {
    return false;
  }

  if (!localStorage.getItem(LOCAL_STATE_KEY)) {
    // Phase 1A wrote DashboardData before revision markers existed. Semantically
    // meaningful legacy payloads must be reviewed once rather than silently
    // hidden behind a completed cloud marker.
    const hasLegacyUserData = inferHasUserLocalDataFromStoredPayload(readStoredDashboardPayload());
    if (hasLegacyUserData) {
      writeUntrackedLegacyMarker();
    }
    return hasLegacyUserData;
  }

  const marker = readMarker();
  if (marker.reconciliationRequired) {
    return true;
  }
  if (marker.pendingWrite) {
    // The payload may or may not match after a failed rollback, but either case
    // is intentionally conservative: no incomplete local transaction may look
    // acknowledged merely because its visible payload resembles the seed.
    return true;
  }

  const hasUserData = marker.hasUserData
    || inferHasUserLocalDataFromStoredPayload(readStoredDashboardPayload());
  if (!hasUserData) {
    return false;
  }

  if (typeof marker.revision === "number" && typeof marker.acknowledgedRevision === "number") {
    return marker.revision > marker.acknowledgedRevision;
  }

  const markerTime = Date.parse(marker.updatedAt);
  const completedTime = completedAt ? Date.parse(completedAt) : Number.NaN;
  if (!Number.isNaN(markerTime) && !Number.isNaN(completedTime)) {
    return markerTime > completedTime;
  }

  return true;
};

/**
 * Describe whether the shared local dashboard payload was retained for the
 * current authenticated account, another authenticated account, or predates
 * owner scoping entirely.
 *
 * `unscoped` is intentionally not treated as a match. It includes ordinary
 * signed-out local work and markerless Phase 1A payloads, both of which must
 * continue through the existing explicit migration decision.
 */
export const getLocalDataOwnership = (currentOwnerScope: string): LocalDataOwnership => {
  if (!isBrowser()) {
    return "unscoped";
  }

  const storedOwnerScope = readMarker().ownerScope;
  if (!storedOwnerScope) {
    return "unscoped";
  }

  return storedOwnerScope === currentOwnerScope ? "current-owner" : "different-owner";
};

export const markLocalDataCloudAcknowledged = (): void => {
  if (!isBrowser()) return;

  const marker = readMarker();
  if (
    marker.pendingWrite
    && !pendingWriteMatchesStoredPayload(marker.pendingWrite)
  ) {
    // A failed payload write followed by a failed marker rollback is ambiguous.
    // Only a payload that matches the prepared fingerprint may promote and
    // acknowledge the pending revision automatically.
    return;
  }
  const stableMarker = withoutPendingWrite(marker);
  const hasUserData = marker.hasUserData
    || inferHasUserLocalDataFromStoredPayload(readStoredDashboardPayload());
  const revision = marker.revision ?? (hasUserData ? 1 : 0);
  writeMarker({
    ...stableMarker,
    hasUserData,
    source: hasUserData ? "user" : "seed",
    revision,
    acknowledgedRevision: revision,
    reconciliationRequired: false,
    reconciliationReason: undefined,
    legacyBaselineUntracked: false,
    ownerScope: undefined,
  });
};

export const hasUntrackedLegacyLocalBaseline = (): boolean =>
  isBrowser() && readMarker().legacyBaselineUntracked === true;

export const markLocalDataReconciliationRequired = (
  reason: string,
  ownerScope?: string | null,
): void => {
  if (!isBrowser()) return;

  const marker = readMarker();
  const hasUserData = marker.hasUserData
    || inferHasUserLocalDataFromStoredPayload(readStoredDashboardPayload());
  const nextMarker: LocalDataMarkerState = {
    ...withoutPendingWrite(marker),
    hasUserData,
    source: hasUserData ? "user" : marker.source,
    reconciliationRequired: true,
    reconciliationReason: reason,
    ownerScope: ownerScope === null ? undefined : ownerScope ?? marker.ownerScope,
  };
  const pendingMarker = marker.pendingWrite
    ? {
        ...marker.pendingWrite.marker,
        reconciliationRequired: true,
        reconciliationReason: reason,
        ownerScope:
          ownerScope === null
            ? undefined
            : ownerScope ?? marker.pendingWrite.marker.ownerScope,
      }
    : null;
  writeMarker(marker.pendingWrite
    ? {
        ...nextMarker,
        pendingWrite: {
          ...marker.pendingWrite,
          marker: pendingMarker ?? nextMarker,
        },
      }
    : nextMarker);
};

/**
 * Persist the shared local fallback projection and its owner-scoped marker as
 * one logical operation. localStorage does not provide transactions, so the
 * shared prepare/payload/final protocol either restores a failed payload
 * attempt or retains an explicit pending marker for a durably written payload.
 */
export const saveCloudFallbackDashboardData = (
  data: DashboardData,
  reason: string,
  ownerScope: string,
): void => {
  if (!isBrowser()) return;
  if (!ownerScope) {
    throw new Error("Cloud fallback requires an opaque owner scope.");
  }

  const current = withoutPendingWrite(readMarker());
  const nextMarker: LocalDataMarkerState = {
    hasUserData: true,
    updatedAt: nowIso(),
    source: "user",
    ownerScope,
    revision: (current.revision ?? 0) + 1,
    acknowledgedRevision: current.acknowledgedRevision ?? 0,
    reconciliationRequired: true,
    reconciliationReason: reason,
    legacyBaselineUntracked: current.legacyBaselineUntracked,
  };
  persistDashboardDataWithMarker(data, nextMarker);
};

export const getLocalDataReconciliationState = (): LocalDataReconciliationState => {
  if (!isBrowser()) {
    return { required: false, reason: null };
  }

  const marker = readMarker();
  return {
    required: marker.reconciliationRequired === true,
    reason: marker.reconciliationReason ?? null,
  };
};

export const getPendingCloudReconciliationActions = (
  ownerScope?: string,
): PendingCloudReconciliationAction[] => {
  if (!isBrowser()) return [];

  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(LOCAL_RECONCILIATION_ACTIONS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];

    const valid = parsed.filter((candidate): candidate is PendingCloudReconciliationAction =>
      isObject(candidate)
      && typeof candidate.id === "string"
      && typeof candidate.recordedAt === "string"
      && (candidate.ownerScope === undefined || typeof candidate.ownerScope === "string")
      && isObject(candidate.action)
      && typeof candidate.action.type === "string");
    return ownerScope ? valid.filter((entry) => entry.ownerScope === ownerScope) : valid;
  } catch {
    return [];
  }
};

export const appendPendingCloudReconciliationAction = (
  entry: Omit<PendingCloudReconciliationAction, "id" | "recordedAt">,
): PendingCloudReconciliationAction | null => {
  if (!isBrowser()) return null;

  const next: PendingCloudReconciliationAction = {
    ...entry,
    id: makeReconciliationActionId(),
    recordedAt: nowIso(),
  };
  const pending = getPendingCloudReconciliationActions();
  localStorage.setItem(LOCAL_RECONCILIATION_ACTIONS_KEY, JSON.stringify([...pending, next]));
  return next;
};

export const clearPendingCloudReconciliationActions = (ownerScope?: string): void => {
  if (!isBrowser()) return;
  if (!ownerScope) {
    localStorage.removeItem(LOCAL_RECONCILIATION_ACTIONS_KEY);
    return;
  }

  const remaining = getPendingCloudReconciliationActions().filter(
    (entry) => entry.ownerScope !== ownerScope,
  );
  if (remaining.length === 0) {
    localStorage.removeItem(LOCAL_RECONCILIATION_ACTIONS_KEY);
    return;
  }
  localStorage.setItem(LOCAL_RECONCILIATION_ACTIONS_KEY, JSON.stringify(remaining));
};

export const removePendingCloudReconciliationAction = (id: string): void => {
  if (!isBrowser()) return;

  const pending = getPendingCloudReconciliationActions();
  localStorage.setItem(
    LOCAL_RECONCILIATION_ACTIONS_KEY,
    JSON.stringify(pending.filter((entry) => entry.id !== id)),
  );
};

const parseCloudRecoverySnapshot = (
  raw: string,
  expectedOwnerScope: string | null,
): LocalCloudRecoverySnapshot | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isObject(parsed)
      || typeof parsed.updatedAt !== "string"
      || !isObject(parsed.dashboardData)
    ) {
      return null;
    }
    if (
      expectedOwnerScope === null
        ? parsed.ownerScope !== undefined
        : parsed.ownerScope !== expectedOwnerScope
    ) {
      return null;
    }

    const validated = dashboardDataSchema.safeParse(parsed.dashboardData);
    if (!validated.success) {
      return null;
    }
    return {
      updatedAt: parsed.updatedAt,
      ...(expectedOwnerScope ? { ownerScope: expectedOwnerScope } : {}),
      dashboardData: validated.data,
    };
  } catch {
    return null;
  }
};

const isPendingCloudReconciliationAction = (
  candidate: unknown,
): candidate is PendingCloudReconciliationAction =>
  isObject(candidate)
  && typeof candidate.id === "string"
  && typeof candidate.recordedAt === "string"
  && (candidate.ownerScope === undefined || typeof candidate.ownerScope === "string")
  && isObject(candidate.action)
  && typeof candidate.action.type === "string";

/**
 * Explicitly associate legacy, ownerless cloud recovery with one account.
 *
 * The scoped snapshot is written before either the legacy snapshot or journal
 * is changed. A crash at any later point therefore leaves enough information
 * for an idempotent retry. Existing, different scoped recovery is never
 * overwritten.
 */
export const claimLegacyCloudRecovery = (
  ownerScope: string,
): ClaimLegacyCloudRecoveryResult => {
  if (!isBrowser()) {
    return {
      ok: true,
      status: "nothing-to-claim",
      snapshotClaimed: false,
      claimedActionCount: 0,
    };
  }
  if (!ownerScope) {
    return { ok: false, status: "conflict", reason: "invalid-owner-scope" };
  }

  const legacySnapshotRaw = localStorage.getItem(LOCAL_CLOUD_RECOVERY_KEY);
  const scopedSnapshotKey = cloudRecoveryStorageKey(ownerScope);
  const scopedSnapshotRaw = localStorage.getItem(scopedSnapshotKey);
  const journalRaw = localStorage.getItem(LOCAL_RECONCILIATION_ACTIONS_KEY);

  const legacySnapshot = legacySnapshotRaw === null
    ? null
    : parseCloudRecoverySnapshot(legacySnapshotRaw, null);
  if (legacySnapshotRaw !== null && !legacySnapshot) {
    return { ok: false, status: "conflict", reason: "invalid-legacy-snapshot" };
  }

  const scopedSnapshot = scopedSnapshotRaw === null
    ? null
    : parseCloudRecoverySnapshot(scopedSnapshotRaw, ownerScope);
  if (scopedSnapshotRaw !== null && !scopedSnapshot) {
    return { ok: false, status: "conflict", reason: "invalid-scoped-snapshot" };
  }
  if (
    legacySnapshot
    && scopedSnapshot
    && serializeCanonicalValue(legacySnapshot.dashboardData)
      !== serializeCanonicalValue(scopedSnapshot.dashboardData)
  ) {
    return { ok: false, status: "conflict", reason: "scoped-snapshot-conflict" };
  }

  let journal: PendingCloudReconciliationAction[] = [];
  if (journalRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(journalRaw);
      if (!Array.isArray(parsed) || !parsed.every(isPendingCloudReconciliationAction)) {
        return {
          ok: false,
          status: "conflict",
          reason: "invalid-reconciliation-journal",
        };
      }
      journal = parsed;
    } catch {
      return {
        ok: false,
        status: "conflict",
        reason: "invalid-reconciliation-journal",
      };
    }
  }

  const claimedActionCount = journal.filter((entry) => entry.ownerScope === undefined).length;
  if (!legacySnapshot && claimedActionCount === 0) {
    return {
      ok: true,
      status: "nothing-to-claim",
      snapshotClaimed: false,
      claimedActionCount: 0,
    };
  }

  if (legacySnapshot && !scopedSnapshot) {
    const claimedSnapshot: LocalCloudRecoverySnapshot = {
      ...legacySnapshot,
      ownerScope,
    };
    localStorage.setItem(scopedSnapshotKey, JSON.stringify(claimedSnapshot));
  }

  if (claimedActionCount > 0) {
    const claimedJournal = journal.map((entry) =>
      entry.ownerScope === undefined ? { ...entry, ownerScope } : entry);
    localStorage.setItem(
      LOCAL_RECONCILIATION_ACTIONS_KEY,
      JSON.stringify(claimedJournal),
    );
  }

  if (legacySnapshot) {
    localStorage.removeItem(LOCAL_CLOUD_RECOVERY_KEY);
  }

  return {
    ok: true,
    status: "claimed",
    snapshotClaimed: legacySnapshot !== null,
    claimedActionCount,
  };
};

export const saveCloudRecoveryDashboardData = (
  data: DashboardData,
  ownerScope?: string,
): void => {
  if (!isBrowser()) return;

  const snapshot: LocalCloudRecoverySnapshot = {
    updatedAt: nowIso(),
    ...(ownerScope ? { ownerScope } : {}),
    dashboardData: data,
  };
  localStorage.setItem(cloudRecoveryStorageKey(ownerScope), JSON.stringify(snapshot));
};

export const loadCloudRecoveryDashboardData = (ownerScope?: string): DashboardData | null => {
  if (!isBrowser()) return null;

  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(cloudRecoveryStorageKey(ownerScope)) ?? "null",
    );
    if (!isObject(parsed) || !isObject(parsed.dashboardData)) {
      return null;
    }
    if (ownerScope && parsed.ownerScope !== ownerScope) {
      return null;
    }

    const validated = dashboardDataSchema.safeParse(parsed.dashboardData);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
};

export const clearCloudRecoveryDashboardData = (ownerScope?: string): void => {
  if (!isBrowser()) return;
  localStorage.removeItem(cloudRecoveryStorageKey(ownerScope));
};

export const createLocalDashboardBackup = (params?: {
  data?: DashboardData;
  sourceDevice?: string;
}): string | null => {
  if (!isBrowser()) return null;

  const dashboardData = params?.data ?? loadDashboardData();
  const payload: LocalDashboardBackup = {
    createdAt: nowIso(),
    sourceDevice: params?.sourceDevice ?? "web",
    sourceSchemaVersion: SCHEMA_VERSION,
    dashboardData,
  };

  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(payload));
    return LOCAL_BACKUP_KEY;
  } catch {
    return null;
  }
};

export const ensureLocalDashboardBackup = (params?: {
  data?: DashboardData;
  sourceDevice?: string;
}): string | null => {
  if (!isBrowser()) return null;
  if (localStorage.getItem(LOCAL_BACKUP_KEY)) {
    return LOCAL_BACKUP_KEY;
  }

  return createLocalDashboardBackup(params);
};

export const ensurePreCloudFallbackBackup = (params: {
  data: DashboardData;
  sourceDevice?: string;
}): string | null => {
  if (!isBrowser()) return null;
  if (localStorage.getItem(LOCAL_PRE_CLOUD_FALLBACK_BACKUP_KEY)) {
    return LOCAL_PRE_CLOUD_FALLBACK_BACKUP_KEY;
  }

  const payload: LocalDashboardBackup = {
    createdAt: nowIso(),
    sourceDevice: params.sourceDevice ?? "web-cloud-fallback",
    sourceSchemaVersion: SCHEMA_VERSION,
    dashboardData: params.data,
  };
  try {
    localStorage.setItem(LOCAL_PRE_CLOUD_FALLBACK_BACKUP_KEY, JSON.stringify(payload));
    return LOCAL_PRE_CLOUD_FALLBACK_BACKUP_KEY;
  } catch {
    return null;
  }
};

export const getPreCloudFallbackBackupInfo = (): string | null => {
  if (!isBrowser()) return null;
  return localStorage.getItem(LOCAL_PRE_CLOUD_FALLBACK_BACKUP_KEY);
};

export const getLocalDashboardBackupInfo = (): string | null => {
  if (!isBrowser()) return null;

  return localStorage.getItem(LOCAL_BACKUP_KEY);
};

export const getLocalDashboardRecordCounts = (): Record<string, number> => {
  const data = createMigrationLayer(loadDashboardData());
  return {
    projects: data.projects.length,
    ideas: data.ideas.length,
    tasks: data.tasks.length,
    brainDumps: data.brainDumps.length,
    scratchpads: data.scratchpads.length,
    architectureDecisions: data.architectureDecisions.length,
    codexPrompts: data.codexPrompts.length,
    notes: data.notes.length,
    importantLinks: data.importantLinks.length,
    developmentSessions: data.developmentSessions.length,
    activities: data.activities.length,
  };
};

export const saveDashboardData = (data: DashboardData): void => {
  if (!isBrowser()) return;

  const current = withoutPendingWrite(readMarker());
  persistDashboardDataWithMarker(data, {
    hasUserData: true,
    updatedAt: nowIso(),
    source: "user",
    revision: (current.revision ?? 0) + 1,
    acknowledgedRevision: current.acknowledgedRevision ?? 0,
    reconciliationRequired: current.reconciliationRequired,
    reconciliationReason: current.reconciliationReason,
    legacyBaselineUntracked: current.legacyBaselineUntracked,
    ownerScope: current.ownerScope,
  });
};

export const searchDashboard = (data: DashboardData, query: string): SearchResult[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const projectMatches = data.projects
    .filter((project) => project.title.toLowerCase().includes(normalized))
    .map((project) => ({
      projectId: project.id,
      projectName: project.title,
      entityType: "project" as const,
      entityId: project.id,
      text: project.title,
    }));

  const ideaMatches = data.ideas
    .filter((idea) => idea.text.toLowerCase().includes(normalized) || idea.description.toLowerCase().includes(normalized))
    .map((idea) => {
      const projectName = data.projects.find((project) => project.id === idea.projectId)?.title ?? "Unknown project";
      return {
        projectId: idea.projectId,
        projectName,
        entityType: "idea" as const,
        entityId: idea.id,
        text: idea.text,
        meta: idea.description,
      };
    });

  const taskMatches = data.tasks
    .filter((task) => task.title.toLowerCase().includes(normalized) || task.details.toLowerCase().includes(normalized))
    .map((task) => {
      const projectName = data.projects.find((project) => project.id === task.projectId)?.title ?? "Unknown project";
      return {
        projectId: task.projectId,
        projectName,
        entityType: "task" as const,
        entityId: task.id,
        text: task.title,
        meta: task.details,
      };
    });

  const noteMatches = data.notes
    .filter((note) => note.title.toLowerCase().includes(normalized) || note.markdown.toLowerCase().includes(normalized))
    .map((note) => {
      const projectName = data.projects.find((project) => project.id === note.projectId)?.title ?? "Unknown project";
      return {
        projectId: note.projectId,
        projectName,
        entityType: "note" as const,
        entityId: note.id,
        text: note.title,
        meta: note.section,
      };
    });

  const decisionMatches = data.architectureDecisions
    .filter((item) => item.title.toLowerCase().includes(normalized) || item.decision.toLowerCase().includes(normalized))
    .map((decision) => {
      const projectName = data.projects.find((project) => decision.projectId === project.id)?.title ?? "Unknown project";
      return {
        projectId: decision.projectId,
        projectName,
        entityType: "architecture_decision" as const,
        entityId: decision.id,
        text: decision.title,
        meta: decision.decision,
      };
    });

  const promptMatches = data.codexPrompts
    .filter((prompt) => prompt.title.toLowerCase().includes(normalized) || prompt.prompt.toLowerCase().includes(normalized))
    .map((prompt) => {
      const projectName = data.projects.find((project) => prompt.projectId === project.id)?.title ?? "Unknown project";
      return {
        projectId: prompt.projectId,
        projectName,
        entityType: "codex_prompt" as const,
        entityId: prompt.id,
        text: prompt.title,
        meta: prompt.purpose,
      };
    });

  const brainDumpMatches = data.brainDumps
    .filter((entry) => entry.text.toLowerCase().includes(normalized))
    .map((entry) => {
      const projectName = data.projects.find((project) => entry.projectId === project.id)?.title ?? "Unknown project";
      return {
        projectId: entry.projectId,
        projectName,
        entityType: "brain_dump" as const,
        entityId: entry.id,
        text: entry.text,
      };
    });

  const sessionMatches = data.developmentSessions
    .filter((session) => session.objective.toLowerCase().includes(normalized) || session.summary.toLowerCase().includes(normalized))
    .map((session) => {
      const projectName = data.projects.find((project) => session.projectId === project.id)?.title ?? "Unknown project";
      return {
        projectId: session.projectId,
        projectName,
        entityType: "session" as const,
        entityId: session.id,
        text: session.objective,
        meta: session.summary,
      };
    });

  const linkMatches = data.importantLinks
    .filter((link) => link.title.toLowerCase().includes(normalized) || link.url.toLowerCase().includes(normalized))
    .map((link) => {
      const projectName = data.projects.find((project) => link.projectId === project.id)?.title ?? "Unknown project";
      return {
        projectId: link.projectId,
        projectName,
        entityType: "link" as const,
        entityId: link.id,
        text: link.title,
        meta: link.url,
      };
    });

  return [
    ...projectMatches,
    ...ideaMatches,
    ...taskMatches,
    ...noteMatches,
    ...decisionMatches,
    ...promptMatches,
    ...brainDumpMatches,
    ...sessionMatches,
    ...linkMatches,
  ];
};

const createPlaceholderMigrationState = (): MigrationState => ({
  phase: "idle",
  hasLocalData: hasUserLocalData(),
  hasCloudData: false,
  localRecordCounts: getLocalDashboardRecordCounts(),
  cloudRecordCounts: {},
  markerStatus: "not_started",
  error: null,
  startedAt: null,
  completedAt: null,
  version: 1,
});

export const createLocalRepository = (): DashboardRepository => {
  return {
    load: async () => {
      return loadDashboardData();
    },
    save: async (data) => {
      saveDashboardData(data);
    },
    applyAction: async () => {
      return;
    },
    subscribe: () => {
      return () => {
        return;
      };
    },
    hasData: async () => hasUserLocalData() || localStorageDataExists(),
    getCounts: async () => getLocalDashboardRecordCounts(),
    getMigrationState: async () => createPlaceholderMigrationState(),
    setMigrationState: async () => {
      return;
    },
    importData: async () => {
      const data = loadDashboardData();
      const hasUserData = hasUserLocalData() || !isSeedDashboardData(data);
      return {
        ...createPlaceholderMigrationState(),
        hasLocalData: hasUserData,
        localRecordCounts: {
          projects: data.projects.length,
          ideas: data.ideas.length,
          tasks: data.tasks.length,
          brainDumps: data.brainDumps.length,
          scratchpads: data.scratchpads.length,
          architectureDecisions: data.architectureDecisions.length,
          codexPrompts: data.codexPrompts.length,
          notes: data.notes.length,
          importantLinks: data.importantLinks.length,
          developmentSessions: data.developmentSessions.length,
          activities: data.activities.length,
        },
        cloudRecordCounts: {},
        phase: "complete",
        hasCloudData: true,
        markerStatus: "local_backup_only",
        completedAt: nowIso(),
      } as MigrationState;
    },
    exportData: async () => loadDashboardData(),
  };
};

export const getProjectOrThrow = (data: DashboardData, id: string, projects: Project[]): Project => {
  const found = projects.find((project) => project.id === id);
  if (!found) {
    throw new Error(`Project not found: ${id}`);
  }
  return found;
};

export const resetLocalMigrationMarker = () => {
  if (!isBrowser()) return;
  localStorage.removeItem(LOCAL_STATE_KEY);
};
