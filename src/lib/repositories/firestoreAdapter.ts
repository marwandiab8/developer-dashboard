import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
  type Unsubscribe,
  type WriteBatch,
  writeBatch,
} from "firebase/firestore";
import {
  type ActivityType,
  type ActivityEvent,
  type ArchitectureDecision,
  type BrainDump,
  type CodexPrompt,
  type DashboardData,
  type DecisionStatus,
  type DevelopmentSession,
  type Idea,
  type ImportantLink,
  type Note,
  type Project,
  type Scratchpad,
  type Task,
} from "../models";
import {
  activityEventSchema,
  architectureDecisionSchema,
  brainDumpSchema,
  codexPromptSchema,
  developmentSessionSchema,
  ideaSchema,
  importantLinkSchema,
  noteSchema,
  projectSchema,
  scratchpadSchema,
  taskSchema,
} from "../validation";
import { SCHEMA_VERSION, STORAGE_KEY } from "../constants";
import { nowIso } from "../utils/time";
import type {
  DashboardAction,
  DashboardRepository,
  CloudMutationContract,
  CloudMutationDocumentExpectation,
  MigrationState,
  ProjectRecencyTouch,
} from "./types";
import {
  canonicalCloudMutationValue,
  isCloudMutationContract,
} from "./cloudMutationContract";
import {
  getFirebaseClient,
  initializeFirebaseFirestorePersistence,
} from "../firebase/client";

type CollectionName =
  | "projects"
  | "ideas"
  | "tasks"
  | "brainDumps"
  | "scratchpads"
  | "architectureDecisions"
  | "codexPrompts"
  | "notes"
  | "links"
  | "sessions"
  | "activity";

const COLLECTIONS: Record<string, CollectionName> = {
  projects: "projects",
  ideas: "ideas",
  tasks: "tasks",
  brainDumps: "brainDumps",
  scratchpads: "scratchpads",
  architectureDecisions: "architectureDecisions",
  codexPrompts: "codexPrompts",
  notes: "notes",
  links: "links",
  sessions: "sessions",
  activities: "activity",
};

const MIGRATION_STATE_DOC_ID = "localStorageV1";
const FIRESTORE_TRANSACTION_CHUNK_LIMIT = 400;

type RowMap<T> = (id: string, snapshot: Record<string, unknown>) => T | null;

type SnapshotRecord = Record<string, unknown>;

const isObject = (value: unknown): value is SnapshotRecord =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const asAuthoredString = (value: unknown): string => (typeof value === "string" ? value : "");

const asNullableString = (value: unknown): string | null => {
  const candidate = asString(value);
  return candidate.length > 0 ? candidate : null;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const toIsoString = (value: unknown): string => {
  if (!value) return nowIso();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (isObject(value)) {
    const legacy = value as { seconds?: unknown; _seconds?: unknown };
    if (typeof legacy.seconds === "number") return new Date(legacy.seconds * 1000).toISOString();
    if (typeof legacy._seconds === "number") return new Date(legacy._seconds * 1000).toISOString();
  }

  return nowIso();
};

const parseIfValid = <T,>(schemaName: string, payload: unknown): T | null => {
  if (!isObject(payload)) return null;

  try {
    switch (schemaName) {
      case "project":
        return projectSchema.parse(payload) as T;
      case "idea":
        return ideaSchema.parse(payload) as T;
      case "task":
        return taskSchema.parse(payload) as T;
      case "brainDump":
        return brainDumpSchema.parse(payload) as T;
      case "scratchpad":
        return scratchpadSchema.parse(payload) as T;
      case "architectureDecision":
        return architectureDecisionSchema.parse(payload) as T;
      case "codexPrompt":
        return codexPromptSchema.parse(payload) as T;
      case "note":
        return noteSchema.parse(payload) as T;
      case "link":
        return importantLinkSchema.parse(payload) as T;
      case "session":
        return developmentSessionSchema.parse(payload) as T;
      case "activity":
        return activityEventSchema.parse(payload) as T;
      default:
        return null;
    }
  } catch {
    return null;
  }
};

const legacyGithubPurposeFallback = (snapshot: SnapshotRecord): string => {
  if (!isObject(snapshot.externalSources) || !isObject(snapshot.externalSources.github)) {
    return "";
  }

  const github = snapshot.externalSources.github;
  if (asString(github.sourceType) !== "github") {
    return "";
  }

  const description = asString(github.description);
  if (description) {
    return description;
  }

  const repositoryFullName = asString(github.repositoryFullName);
  return repositoryFullName ? `GitHub repository ${repositoryFullName}.` : "GitHub repository.";
};

export const mapProject = (id: string, snapshot: SnapshotRecord): Project | null =>
  parseIfValid<Project>(
    "project",
    {
      id,
      title: asAuthoredString(snapshot.title),
      slug: asString(snapshot.slug),
      purpose: asAuthoredString(snapshot.purpose) || legacyGithubPurposeFallback(snapshot),
      status: asString(snapshot.status),
      ...(asString(snapshot.manualStatus) ? { manualStatus: asString(snapshot.manualStatus) } : {}),
      currentBranch: asString(snapshot.currentBranch),
      currentObjective: asAuthoredString(snapshot.currentObjective),
      currentBlocker: asAuthoredString(snapshot.currentBlocker),
      nextRecommendedTask: asAuthoredString(snapshot.nextRecommendedTask),
      ...(isObject(snapshot.externalSources) ? { externalSources: snapshot.externalSources } : {}),
      ...(asString(snapshot.externalActivityStatus)
        ? { externalActivityStatus: asString(snapshot.externalActivityStatus) }
        : {}),
      ...(snapshot.externalActivityUpdatedAt
        ? { externalActivityUpdatedAt: toIsoString(snapshot.externalActivityUpdatedAt) }
        : {}),
      ...(snapshot.lastWorkedAt ? { lastWorkedAt: toIsoString(snapshot.lastWorkedAt) } : {}),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
    },
  );

export const mapIdea = (id: string, snapshot: SnapshotRecord): Idea | null =>
  parseIfValid<Idea>(
    "idea",
    {
      id,
      projectId: asString(snapshot.projectId),
      text: asAuthoredString(snapshot.text),
      description: asAuthoredString(snapshot.description),
      status: asString(snapshot.status),
      priority: asString(snapshot.priority),
      source: asString(snapshot.source),
      ...(asString(snapshot.externalSessionId)
        ? { externalSessionId: asString(snapshot.externalSessionId) }
        : {}),
      tags: toStringArray(snapshot.tags),
      linkedTaskId: asNullableString(snapshot.linkedTaskId),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
    },
  );

const mapTask = (id: string, snapshot: SnapshotRecord): Task | null =>
  parseIfValid<Task>(
    "task",
    {
      id,
      projectId: asString(snapshot.projectId),
      title: asAuthoredString(snapshot.title),
      details: asAuthoredString(snapshot.details),
      type: asString(snapshot.type),
      status: asString(snapshot.status),
      priority: asString(snapshot.priority),
      blockedReason: asAuthoredString(snapshot.blockedReason),
      sourceIdeaId: asNullableString(snapshot.sourceIdeaId),
      acceptanceCriteria: asAuthoredString(snapshot.acceptanceCriteria),
      implementationNotes: asAuthoredString(snapshot.implementationNotes),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
      startedAt: snapshot.startedAt ? toIsoString(snapshot.startedAt) : null,
      completedAt: snapshot.completedAt ? toIsoString(snapshot.completedAt) : null,
    },
  );

const mapBrainDump = (id: string, snapshot: SnapshotRecord): BrainDump | null =>
  parseIfValid<BrainDump>(
    "brainDump",
    {
      id,
      projectId: asString(snapshot.projectId),
      text: asAuthoredString(snapshot.text),
      status: asString(snapshot.status),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
      convertedEntityType: asNullableString(snapshot.convertedEntityType) as BrainDump["convertedEntityType"],
      convertedEntityId: asNullableString(snapshot.convertedEntityId),
    },
  );

const mapScratchpad = (id: string, snapshot: SnapshotRecord): Scratchpad | null =>
  parseIfValid<Scratchpad>(
    "scratchpad",
    {
      projectId: id,
      markdown: asAuthoredString(snapshot.markdown),
      updatedAt: toIsoString(snapshot.updatedAt),
    },
  );

const mapArchitectureDecision = (id: string, snapshot: SnapshotRecord): ArchitectureDecision | null =>
  parseIfValid<ArchitectureDecision>(
    "architectureDecision",
    {
      id,
      projectId: asString(snapshot.projectId),
      title: asAuthoredString(snapshot.title),
      context: asAuthoredString(snapshot.context),
      decision: asAuthoredString(snapshot.decision),
      alternatives: asAuthoredString(snapshot.alternatives),
      consequences: asAuthoredString(snapshot.consequences),
      status: asString(snapshot.status) as DecisionStatus,
      decidedAt: toIsoString(snapshot.decidedAt),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
    },
  );

export const mapCodexPrompt = (id: string, snapshot: SnapshotRecord): CodexPrompt | null =>
  parseIfValid<CodexPrompt>(
    "codexPrompt",
    {
      id,
      projectId: asString(snapshot.projectId),
      title: asAuthoredString(snapshot.title),
      purpose: asAuthoredString(snapshot.purpose),
      prompt: asAuthoredString(snapshot.prompt),
      resultSummary: asAuthoredString(snapshot.resultSummary),
      status: asString(snapshot.status),
      relatedTaskId: asNullableString(snapshot.relatedTaskId),
      ...(snapshot.relatedSessionId === null
        ? { relatedSessionId: null }
        : asString(snapshot.relatedSessionId)
          ? { relatedSessionId: asString(snapshot.relatedSessionId) }
          : {}),
      ...(asString(snapshot.source) === "codex" ? { source: "codex" as const } : {}),
      ...(asString(snapshot.externalSessionId)
        ? { externalSessionId: asString(snapshot.externalSessionId) }
        : {}),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
      lastUsedAt: snapshot.lastUsedAt ? toIsoString(snapshot.lastUsedAt) : null,
    },
  );

const mapNote = (id: string, snapshot: SnapshotRecord): Note | null =>
  parseIfValid<Note>(
    "note",
    {
      id,
      projectId: asString(snapshot.projectId),
      title: asAuthoredString(snapshot.title),
      section: asAuthoredString(snapshot.section),
      tags: toStringArray(snapshot.tags),
      markdown: asAuthoredString(snapshot.markdown),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
    },
  );

const mapLink = (id: string, snapshot: SnapshotRecord): ImportantLink | null =>
  parseIfValid<ImportantLink>(
    "link",
    {
      id,
      projectId: asString(snapshot.projectId),
      title: asAuthoredString(snapshot.title),
      url: asString(snapshot.url),
      notes: asAuthoredString(snapshot.notes),
      section: asAuthoredString(snapshot.section),
      tags: toStringArray(snapshot.tags),
      createdAt: toIsoString(snapshot.createdAt),
      updatedAt: toIsoString(snapshot.updatedAt),
    },
  );

export const mapSession = (id: string, snapshot: SnapshotRecord): DevelopmentSession | null =>
  parseIfValid<DevelopmentSession>(
    "session",
    {
      id,
      projectId: asString(snapshot.projectId),
      startedAt: toIsoString(snapshot.startedAt),
      endedAt: snapshot.endedAt ? toIsoString(snapshot.endedAt) : null,
      objective: asAuthoredString(snapshot.objective),
      summary: asAuthoredString(snapshot.summary),
      ...(asString(snapshot.source) === "codex" ? { source: "codex" as const } : {}),
      ...(asString(snapshot.externalSessionId)
        ? { externalSessionId: asString(snapshot.externalSessionId) }
        : {}),
      ...(asString(snapshot.branch) ? { branch: asString(snapshot.branch) } : {}),
      ...(Array.isArray(snapshot.completedItems)
        ? { completedItems: toStringArray(snapshot.completedItems) }
        : {}),
      ...(Array.isArray(snapshot.unfinishedItems)
        ? { unfinishedItems: toStringArray(snapshot.unfinishedItems) }
        : {}),
      ...(typeof snapshot.currentBlocker === "string"
        ? { currentBlocker: asAuthoredString(snapshot.currentBlocker) }
        : {}),
      tasksWorkedOn: toStringArray(snapshot.tasksWorkedOn),
      tasksCompleted: toStringArray(snapshot.tasksCompleted),
      ideasAdded: toStringArray(snapshot.ideasAdded),
      problemsDiscovered: toStringArray(snapshot.problemsDiscovered),
      decisionsMade: toStringArray(snapshot.decisionsMade),
      promptsUsed: toStringArray(snapshot.promptsUsed),
      filesModified: toStringArray(snapshot.filesModified),
      commits: toStringArray(snapshot.commits),
      nextStartingPoint: asAuthoredString(snapshot.nextStartingPoint),
      status: asString(snapshot.status) as DevelopmentSession["status"],
      notes: asAuthoredString(snapshot.notes),
    },
  );

export const mapActivity = (id: string, snapshot: SnapshotRecord): ActivityEvent | null =>
  parseIfValid<ActivityEvent>(
    "activity",
    {
      id,
      projectId: asString(snapshot.projectId),
      type: asString(snapshot.type) as ActivityType,
      summary: asAuthoredString(snapshot.summary),
      entityType: asString(snapshot.entityType),
      entityId: asString(snapshot.entityId),
      metadata: asAuthoredString(snapshot.metadata),
      ...(asString(snapshot.source) === "codex" ? { source: "codex" as const } : {}),
      ...(asString(snapshot.externalSessionId)
        ? { externalSessionId: asString(snapshot.externalSessionId) }
        : {}),
      createdAt: toIsoString(snapshot.createdAt),
    },
  );

const collectionRef = (uid: string, name: CollectionName) => {
  const { db } = getFirebaseClient();
  return collection(db, "users", uid, name);
};

const docRef = (uid: string, name: CollectionName, id: string) => {
  const { db } = getFirebaseClient();
  return doc(db, "users", uid, name, id);
};

const migrationStateRef = (uid: string) => {
  const { db } = getFirebaseClient();
  return doc(db, "users", uid, "migrationState", MIGRATION_STATE_DOC_ID);
};

const reconciliationReceiptRef = (
  uid: string,
  sessionId: string,
  operationId: string,
) => {
  const { db } = getFirebaseClient();
  return doc(
    db,
    "users",
    uid,
    COLLECTIONS.sessions,
    sessionId,
    "reconciliationReceipts",
    operationId,
  );
};

const mutationReceiptRef = (uid: string, operationId: string) => {
  const { db } = getFirebaseClient();
  return doc(db, "users", uid, "reconciliationReceipts", operationId);
};

export class CloudMutationConflictError extends Error {
  readonly code = "reconciliation-conflict";

  constructor(message: string) {
    super(message);
    this.name = "CloudMutationConflictError";
  }
}

const normalizeFirestoreComparable = (value: unknown): unknown => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeFirestoreComparable);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, candidate]) => [
        key,
        normalizeFirestoreComparable(candidate),
      ]),
    );
  }
  return value;
};

const comparableEquals = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalCloudMutationValue(normalizeFirestoreComparable(left)))
  === JSON.stringify(canonicalCloudMutationValue(normalizeFirestoreComparable(right)));

const fieldStateMatches = (
  data: SnapshotRecord,
  field: string,
  expected: { present: boolean; value?: unknown },
) => {
  const present = Object.prototype.hasOwnProperty.call(data, field) && data[field] !== undefined;
  if (present !== expected.present) return false;
  return !present || comparableEquals(data[field], expected.value);
};

type MutationDocumentEvaluation = {
  expectation: CloudMutationDocumentExpectation;
  reference: ReturnType<typeof docRef>;
  snapshot: DocumentSnapshot;
  state: "base" | "desired";
};

const evaluateMutationDocument = (
  expectation: CloudMutationDocumentExpectation,
  reference: ReturnType<typeof docRef>,
  snapshot: DocumentSnapshot,
): MutationDocumentEvaluation => {
  const exists = snapshot.exists();
  const data = exists ? (snapshot.data() as SnapshotRecord) : {};
  const desiredMatches = exists === expectation.afterExists
    && (!exists || expectation.fields.every((field) =>
      fieldStateMatches(data, field.field, field.after)));
  if (desiredMatches) {
    return { expectation, reference, snapshot, state: "desired" };
  }

  const recordedBaseFields = new Set(
    expectation.fields
      .filter((field) => field.before.present)
      .map((field) => field.field),
  );
  // A delete removes the entire remote document, not only the guarded fields.
  // Reject it conservatively if the remote document contains any field that
  // was not represented in the journal's original base state.
  const deleteBaseCoversRemoteDocument = expectation.afterExists
    || !exists
    || Object.entries(data).every(([field, value]) =>
      value === undefined || recordedBaseFields.has(field));
  const baseMatches = exists === expectation.beforeExists
    && deleteBaseCoversRemoteDocument
    && (!exists || expectation.fields.every((field) =>
      fieldStateMatches(data, field.field, field.before)));
  if (baseMatches) {
    return { expectation, reference, snapshot, state: "base" };
  }

  throw new CloudMutationConflictError(
    `Recovery conflict for ${expectation.collection}/${expectation.documentId}; newer cloud data was preserved.`,
  );
};

const applyMutationDocumentWrites = (
  transaction: Transaction,
  evaluations: MutationDocumentEvaluation[],
) => {
  evaluations.forEach(({ expectation, reference, state }) => {
    if (state === "desired") return;
    if (!expectation.afterExists) {
      transaction.delete(reference);
      return;
    }

    const payload = Object.fromEntries(
      expectation.fields
        .filter((field) => field.after.present)
        .map((field) => [field.field, field.after.value]),
    );
    transaction.set(reference, payload, { merge: true });
  });
};

const requireValidMutationContract = (
  mutation: CloudMutationContract | undefined,
): CloudMutationContract => {
  if (!isCloudMutationContract(mutation)) {
    throw new CloudMutationConflictError(
      "Recovery journal entry has no valid base-state contract; automatic replay was stopped.",
    );
  }
  return mutation;
};

const loadCollection = async <T,>(uid: string, name: CollectionName, map: RowMap<T>): Promise<T[]> => {
  const snapshot = await getDocs(collectionRef(uid, name));
  const rows: T[] = [];

  snapshot.forEach((entry) => {
    const mapped = map(entry.id, entry.data() as Record<string, unknown>);
    if (mapped) {
      rows.push(mapped);
    }
  });

  return rows;
};

const withCollectionCount = async (uid: string, name: CollectionName): Promise<number> => {
  const snapshot = await getDocs(collectionRef(uid, name));
  return snapshot.size;
};

const getCounts = async (uid: string) => {
  const [projects, ideas, tasks, brainDumps, scratchpads, architectureDecisions, codexPrompts, notes, links, sessions, activities] =
    await Promise.all([
      withCollectionCount(uid, COLLECTIONS.projects),
      withCollectionCount(uid, COLLECTIONS.ideas),
      withCollectionCount(uid, COLLECTIONS.tasks),
      withCollectionCount(uid, COLLECTIONS.brainDumps),
      withCollectionCount(uid, COLLECTIONS.scratchpads),
      withCollectionCount(uid, COLLECTIONS.architectureDecisions),
      withCollectionCount(uid, COLLECTIONS.codexPrompts),
      withCollectionCount(uid, COLLECTIONS.notes),
      withCollectionCount(uid, COLLECTIONS.links),
      withCollectionCount(uid, COLLECTIONS.sessions),
      withCollectionCount(uid, COLLECTIONS.activities),
    ]);

  return {
    projects,
    ideas,
    tasks,
    brainDumps,
    scratchpads,
    architectureDecisions,
    codexPrompts,
    notes,
    links,
    developmentSessions: sessions,
    activities,
  };
};

const makeRepoState = (): DashboardData => ({
  schemaVersion: SCHEMA_VERSION,
  projects: [],
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

const defaultMigrationState = (): MigrationState => ({
  phase: "idle",
  hasLocalData: false,
  hasCloudData: false,
  localRecordCounts: {},
  cloudRecordCounts: {},
  markerStatus: "not_started",
  error: null,
  startedAt: null,
  completedAt: null,
  migrationVersion: 1,
  sourceSchemaVersion: SCHEMA_VERSION,
  backupCreated: false,
  localStorageKey: STORAGE_KEY,
  version: 1,
});

const parseMigrationState = (raw: unknown): MigrationState => {
  if (!isObject(raw)) {
    return defaultMigrationState();
  }

  return {
    phase: typeof raw.phase === "string" ? (raw.phase as MigrationState["phase"]) : "idle",
    hasLocalData: raw.hasLocalData === true,
    hasCloudData: raw.hasCloudData === true,
    localRecordCounts: isObject(raw.localRecordCounts) ? (raw.localRecordCounts as Record<string, number>) : {},
    cloudRecordCounts: isObject(raw.cloudRecordCounts) ? (raw.cloudRecordCounts as Record<string, number>) : {},
    importedCounts: isObject(raw.importedCounts) ? (raw.importedCounts as Record<string, number>) : undefined,
    skippedCounts: isObject(raw.skippedCounts) ? (raw.skippedCounts as Record<string, number>) : undefined,
    sourceSchemaVersion:
      typeof raw.sourceSchemaVersion === "number" ? raw.sourceSchemaVersion : SCHEMA_VERSION,
    migrationVersion: typeof raw.migrationVersion === "number" ? raw.migrationVersion : 1,
    markerStatus: typeof raw.markerStatus === "string" ? raw.markerStatus : "not_started",
    error: typeof raw.error === "string" ? raw.error : null,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    backupCreated: raw.backupCreated === true,
    sourceDevice: typeof raw.sourceDevice === "string" ? raw.sourceDevice : undefined,
    localStorageKey: typeof raw.localStorageKey === "string" ? raw.localStorageKey : STORAGE_KEY,
    reconciliationRequired:
      typeof raw.reconciliationRequired === "boolean" ? raw.reconciliationRequired : undefined,
    reconciliationReason:
      typeof raw.reconciliationReason === "string" || raw.reconciliationReason === null
        ? raw.reconciliationReason
        : undefined,
    version: typeof raw.version === "number" ? raw.version : 1,
  };
};

const mapToWriteModel = (value: Record<string, unknown>) => {
  const mapped = { ...value } as Record<string, unknown>;
  delete mapped.id;

  Object.entries(mapped).forEach(([key, candidate]) => {
    if (candidate === undefined) {
      delete mapped[key];
    }
  });

  return mapped;
};

const makeWriteDate = () => serverTimestamp();

const normalizeReconciliationOperationId = (operationId: string | undefined) => {
  if (operationId === undefined) {
    return null;
  }

  const normalized = operationId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error("Invalid reconciliation operation ID.");
  }

  return normalized;
};

type CollectionImportProgress = {
  imported: number;
  skipped: number;
};

type MigrationImportProgress = {
  importedCounts: Record<string, number>;
  skippedCounts: Record<string, number>;
};

const createMissingEntities = async (
  uid: string,
  collectionName: CollectionName,
  entities: Array<{ id: string; [key: string]: unknown }>,
  onProgress: (progress: CollectionImportProgress) => Promise<void>,
): Promise<CollectionImportProgress> => {
  const uniqueById = new Map<string, { id: string; [key: string]: unknown }>();
  entities.forEach((entry) => {
    if (!uniqueById.has(entry.id)) {
      uniqueById.set(entry.id, entry);
    }
  });
  const next = Array.from(uniqueById.values());
  let imported = 0;
  let skipped = entities.length - next.length;

  if (next.length === 0) {
    if (entities.length > 0) {
      await onProgress({ imported, skipped });
    }
    return { imported, skipped };
  }

  const chunks = [] as Array<Array<{ id: string; [key: string]: unknown }>>;
  for (let cursor = 0; cursor < next.length; cursor += FIRESTORE_TRANSACTION_CHUNK_LIMIT) {
    chunks.push(next.slice(cursor, cursor + FIRESTORE_TRANSACTION_CHUNK_LIMIT));
  }

  for (const chunk of chunks) {
    const references = chunk.map((entry) => ({
      entry,
      reference: docRef(uid, collectionName, entry.id),
    }));

    const createdInChunk = await runTransaction(getFirebaseClient().db, async (transaction) => {
      // Firestore retries the transaction when a concurrently-created document
      // changes one of these reads. The retry then observes that document and
      // leaves it untouched, making this a true create-if-absent operation.
      const snapshots = await Promise.all(
        references.map(({ reference }) => transaction.get(reference)),
      );
      let createdInTransaction = 0;

      snapshots.forEach((snapshot, index) => {
        if (snapshot.exists()) {
          return;
        }

        const { entry, reference } = references[index];
        const payload = mapToWriteModel({ ...entry });
        transaction.set(reference, {
          ...payload,
          updatedAt: makeWriteDate(),
          createdAt: payload.createdAt ?? makeWriteDate(),
        });
        createdInTransaction += 1;
      });

      return createdInTransaction;
    });
    imported += createdInChunk;
    skipped += chunk.length - createdInChunk;
    await onProgress({ imported, skipped });
  }

  return { imported, skipped };
};

const appendMigrationState = async (uid: string, next: MigrationState) => {
  const payload = mapToWriteModel({
    ...next,
    updatedAt: makeWriteDate(),
    localStorageKey: next.localStorageKey || STORAGE_KEY,
    sourceDevice: next.sourceDevice,
  });

  await setDoc(
    migrationStateRef(uid),
    payload,
    { merge: true },
  );
};

const hasAnyRecords = (counts: Record<string, number>) =>
  Object.values(counts).some((count) => count > 0);

const runMigrationWrites = async (
  uid: string,
  data: DashboardData,
  progress: MigrationImportProgress,
  onProgress: (progress: MigrationImportProgress) => Promise<void>,
) => {
  const importCollection = async (
    countKey: string,
    collectionName: CollectionName,
    entities: Array<{ id: string; [key: string]: unknown }>,
  ) => {
    await createMissingEntities(uid, collectionName, entities, async (collectionProgress) => {
      progress.importedCounts[countKey] = collectionProgress.imported;
      progress.skippedCounts[countKey] = collectionProgress.skipped;
      await onProgress({
        importedCounts: { ...progress.importedCounts },
        skippedCounts: { ...progress.skippedCounts },
      });
    });
  };

  await importCollection("projects", COLLECTIONS.projects, data.projects.map((item) => ({ ...item })));
  await importCollection("ideas", COLLECTIONS.ideas, data.ideas.map((item) => ({ ...item })));
  await importCollection("tasks", COLLECTIONS.tasks, data.tasks.map((item) => ({ ...item })));
  await importCollection(
    "brainDumps",
    COLLECTIONS.brainDumps,
    data.brainDumps.map((item) => ({ ...item })),
  );
  await importCollection(
    "scratchpads",
    COLLECTIONS.scratchpads,
    data.scratchpads.map((item) => ({
      ...item,
      projectId: item.projectId,
      id: item.projectId,
    })),
  );
  await importCollection(
    "architectureDecisions",
    COLLECTIONS.architectureDecisions,
    data.architectureDecisions.map((item) => ({ ...item })),
  );
  await importCollection(
    "codexPrompts",
    COLLECTIONS.codexPrompts,
    data.codexPrompts.map((item) => ({ ...item })),
  );
  await importCollection("notes", COLLECTIONS.notes, data.notes.map((item) => ({ ...item })));
  await importCollection("links", COLLECTIONS.links, data.importantLinks.map((item) => ({ ...item })));
  await importCollection(
    "developmentSessions",
    COLLECTIONS.sessions,
    data.developmentSessions.map((item) => ({ ...item })),
  );
  await importCollection(
    "activities",
    COLLECTIONS.activities,
    data.activities.map((item) => ({ ...item })),
  );

  return progress;
};

const addActivityWrite = (batch: WriteBatch, uid: string, activity: ActivityEvent) => {
  const parsed = activityEventSchema.parse(activity);
  batch.set(
    docRef(uid, COLLECTIONS.activities, parsed.id),
    {
      ...mapToWriteModel(parsed as unknown as Record<string, unknown>),
      createdAt: parsed.createdAt,
      updatedAt: makeWriteDate(),
    },
    { merge: true },
  );
};

const addProjectRecencyWrite = (
  batch: WriteBatch,
  uid: string,
  projectRecency: ProjectRecencyTouch,
) => {
  batch.update(docRef(uid, COLLECTIONS.projects, projectRecency.projectId), {
    updatedAt: projectRecency.updatedAt,
    lastWorkedAt: projectRecency.lastWorkedAt,
  });
};

export const createFirestoreRepository = async (uid: string): Promise<DashboardRepository> => {
  const { auth, db } = getFirebaseClient();
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("Authenticated user does not match repository owner.");
  }

  await initializeFirebaseFirestorePersistence(db);
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("Authentication changed while initializing the repository.");
  }

  const emptyState = makeRepoState();

  const load = async () => {
    const [projects, ideas, tasks, brainDumps, scratchpads, architectureDecisions, codexPrompts, notes, links, developmentSessions, activities] =
      await Promise.all([
        loadCollection(uid, COLLECTIONS.projects, mapProject),
        loadCollection(uid, COLLECTIONS.ideas, mapIdea),
        loadCollection(uid, COLLECTIONS.tasks, mapTask),
        loadCollection(uid, COLLECTIONS.brainDumps, mapBrainDump),
        loadCollection(uid, COLLECTIONS.scratchpads, mapScratchpad),
        loadCollection(uid, COLLECTIONS.architectureDecisions, mapArchitectureDecision),
        loadCollection(uid, COLLECTIONS.codexPrompts, mapCodexPrompt),
        loadCollection(uid, COLLECTIONS.notes, mapNote),
        loadCollection(uid, COLLECTIONS.links, mapLink),
        loadCollection(uid, COLLECTIONS.sessions, mapSession),
        loadCollection(uid, COLLECTIONS.activities, mapActivity),
      ]);

    return {
      schemaVersion: SCHEMA_VERSION,
      projects,
      ideas,
      tasks,
      brainDumps,
      scratchpads,
      architectureDecisions,
      codexPrompts,
      notes,
      importantLinks: links,
      developmentSessions,
      activities,
    };
  };

  const applyGuardedMutation = async (
    action: DashboardAction,
    operationId: string | undefined,
    mutation: CloudMutationContract | undefined,
  ) => {
    const normalizedOperationId = normalizeReconciliationOperationId(operationId);
    if (!normalizedOperationId) {
      throw new CloudMutationConflictError(
        "Conflict-safe cloud writes require a stable operation ID.",
      );
    }
    const contract = requireValidMutationContract(mutation);
    const receipt = mutationReceiptRef(uid, normalizedOperationId);
    const documentReferences = contract.documents.map((expectation) => ({
      expectation,
      reference: docRef(uid, expectation.collection, expectation.documentId),
    }));

    await runTransaction(getFirebaseClient().db, async (transaction) => {
      const [receiptSnapshot, ...documentSnapshots] = await Promise.all([
        transaction.get(receipt),
        ...documentReferences.map(({ reference }) => transaction.get(reference)),
      ]);

      if (receiptSnapshot.exists()) {
        const existing = receiptSnapshot.data() as SnapshotRecord;
        if (
          existing.operationId !== normalizedOperationId
          || existing.actionType !== action.type
          || existing.fingerprint !== contract.fingerprint
        ) {
          throw new CloudMutationConflictError(
            "Recovery receipt does not match the journal mutation; automatic replay was stopped.",
          );
        }
        return;
      }

      const evaluations = documentReferences.map(({ expectation, reference }, index) =>
        evaluateMutationDocument(expectation, reference, documentSnapshots[index]));
      applyMutationDocumentWrites(transaction, evaluations);
      transaction.set(receipt, {
        operationId: normalizedOperationId,
        actionType: action.type,
        fingerprint: contract.fingerprint,
        contractVersion: contract.version,
        createdAt: makeWriteDate(),
      });
    });
  };

  const appendSessionNote = async (
    action: Extract<DashboardAction, { type: "session_note_append" }>,
    activity?: ActivityEvent,
    projectRecency?: ProjectRecencyTouch,
    operationId?: string,
    mutation?: CloudMutationContract,
  ) => {
    const normalizedOperationId = normalizeReconciliationOperationId(operationId);
    const target = docRef(uid, COLLECTIONS.sessions, action.payload.id);
    const receipt = normalizedOperationId
      ? reconciliationReceiptRef(uid, action.payload.id, normalizedOperationId)
      : null;

    const contract = mutation ? requireValidMutationContract(mutation) : null;
    const auxiliaryDocuments = contract?.documents.filter((expectation) =>
      !(expectation.collection === COLLECTIONS.sessions
        && expectation.documentId === action.payload.id)) ?? [];
    const auxiliaryReferences = auxiliaryDocuments.map((expectation) => ({
      expectation,
      reference: docRef(uid, expectation.collection, expectation.documentId),
    }));

    await runTransaction(getFirebaseClient().db, async (transaction) => {
      // All reads precede writes so Firestore can retry concurrent appends.
      // The optional receipt is committed atomically with the append, making an
      // ambiguous client acknowledgement safe to replay with the same ID.
      const [sessionSnapshot, receiptSnapshot, ...auxiliarySnapshots] = await Promise.all([
        transaction.get(target),
        receipt ? transaction.get(receipt) : Promise.resolve(null),
        ...auxiliaryReferences.map(({ reference }) => transaction.get(reference)),
      ]);
      if (receiptSnapshot?.exists()) {
        return;
      }

      const auxiliaryEvaluations = auxiliaryReferences.map(
        ({ expectation, reference }, index) =>
          evaluateMutationDocument(expectation, reference, auxiliarySnapshots[index]),
      );

      const raw = sessionSnapshot.exists()
        ? (sessionSnapshot.data() as SnapshotRecord)
        : undefined;
      const existingNotes = asAuthoredString(raw?.notes);
      const merged = existingNotes.length > 0
        ? `${existingNotes}\n\n${action.payload.note}`
        : action.payload.note;

      transaction.update(target, {
        notes: merged,
        updatedAt: makeWriteDate(),
      });

      if (contract) {
        applyMutationDocumentWrites(transaction, auxiliaryEvaluations);
      } else if (projectRecency) {
        transaction.update(docRef(uid, COLLECTIONS.projects, projectRecency.projectId), {
          updatedAt: projectRecency.updatedAt,
          lastWorkedAt: projectRecency.lastWorkedAt,
        });
      }

      if (!contract && activity) {
        const parsedActivity = activityEventSchema.parse(activity);
        transaction.set(
          docRef(uid, COLLECTIONS.activities, parsedActivity.id),
          {
            ...mapToWriteModel(parsedActivity as unknown as Record<string, unknown>),
            createdAt: parsedActivity.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
      }

      if (receipt && normalizedOperationId) {
        transaction.set(receipt, {
          operationId: normalizedOperationId,
          actionType: action.type,
          sessionId: action.payload.id,
          createdAt: makeWriteDate(),
        });
      }
    });
  };

  const applyAction = async (
    action: DashboardAction,
    activity?: ActivityEvent,
    projectRecency?: ProjectRecencyTouch,
    operationId?: string,
    mutation?: CloudMutationContract,
  ) => {
    if (action.type === "seed") {
      return;
    }

    if (action.type === "session_note_append") {
      await appendSessionNote(action, activity, projectRecency, operationId, mutation);
      return;
    }

    if (operationId !== undefined || mutation !== undefined) {
      await applyGuardedMutation(action, operationId, mutation);
      return;
    }

    const batch = writeBatch(getFirebaseClient().db);

    switch (action.type) {
      case "activity_add":
        addActivityWrite(batch, uid, action.payload);
        break;

      case "project_upsert":
        batch.set(
          docRef(uid, COLLECTIONS.projects, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "project_update": {
        const projectUpdateFields = {
          ...action.payload.updates,
        } as Record<string, unknown>;
        delete projectUpdateFields.id;
        delete projectUpdateFields.createdAt;
        delete projectUpdateFields.updatedAt;
        delete projectUpdateFields.lastWorkedAt;
        const projectedRecency = projectRecency?.projectId === action.payload.id
          ? projectRecency
          : null;
        const fallbackRecency = makeWriteDate();
        batch.update(docRef(uid, COLLECTIONS.projects, action.payload.id), {
          ...mapToWriteModel(projectUpdateFields),
          updatedAt: projectedRecency?.updatedAt ?? fallbackRecency,
          lastWorkedAt: projectedRecency?.lastWorkedAt ?? fallbackRecency,
        });
        break;
      }

      case "idea_add":
        batch.set(
          docRef(uid, COLLECTIONS.ideas, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "idea_update":
        batch.update(docRef(uid, COLLECTIONS.ideas, action.payload.id), {
          ...mapToWriteModel(action.payload.updates as Record<string, unknown>),
          updatedAt: makeWriteDate(),
        });
        break;

      case "idea_archive":
        batch.update(docRef(uid, COLLECTIONS.ideas, action.payload.id), {
          status: "archived",
          updatedAt: makeWriteDate(),
        });
        break;

      case "idea_to_task":
        batch.set(
          docRef(uid, COLLECTIONS.tasks, action.payload.task.id),
          {
            ...mapToWriteModel(action.payload.task as unknown as Record<string, unknown>),
            updatedAt: makeWriteDate(),
            createdAt: action.payload.task.createdAt,
          },
          { merge: true },
        );
        batch.update(docRef(uid, COLLECTIONS.ideas, action.payload.ideaId), {
          status: "converted",
          linkedTaskId: action.payload.task.id,
          updatedAt: makeWriteDate(),
        });
        break;

      case "task_add":
        batch.set(
          docRef(uid, COLLECTIONS.tasks, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "task_update":
        batch.update(docRef(uid, COLLECTIONS.tasks, action.payload.id), {
          ...mapToWriteModel(action.payload.updates as Record<string, unknown>),
          updatedAt: makeWriteDate(),
        });
        break;

      case "task_start":
        batch.update(docRef(uid, COLLECTIONS.tasks, action.payload.id), {
          status: "in_progress",
          startedAt: makeWriteDate(),
          updatedAt: makeWriteDate(),
        });
        break;

      case "task_block":
        batch.update(docRef(uid, COLLECTIONS.tasks, action.payload.id), {
          status: "blocked",
          blockedReason: action.payload.reason,
          updatedAt: makeWriteDate(),
        });
        break;

      case "task_complete":
        batch.update(docRef(uid, COLLECTIONS.tasks, action.payload.id), {
          status: "completed",
          completedAt: nowIso(),
          updatedAt: makeWriteDate(),
        });
        break;

      case "brain_dump_add":
        batch.set(
          docRef(uid, COLLECTIONS.brainDumps, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "brain_dump_update":
        batch.update(docRef(uid, COLLECTIONS.brainDumps, action.payload.id), {
          ...mapToWriteModel(action.payload.updates as Record<string, unknown>),
          updatedAt: makeWriteDate(),
        });
        break;

      case "brain_dump_delete":
        batch.delete(docRef(uid, COLLECTIONS.brainDumps, action.payload.id));
        break;

      case "scratchpad_update":
        batch.set(
          docRef(uid, COLLECTIONS.scratchpads, action.payload.projectId),
          {
            projectId: action.payload.projectId,
            markdown: action.payload.markdown,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "architecture_decision_upsert":
        batch.set(
          docRef(uid, COLLECTIONS.architectureDecisions, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "architecture_decision_update_status":
        batch.update(docRef(uid, COLLECTIONS.architectureDecisions, action.payload.id), {
          status: action.payload.status,
          updatedAt: makeWriteDate(),
        });
        break;

      case "prompt_upsert":
        batch.set(
          docRef(uid, COLLECTIONS.codexPrompts, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "prompt_mark_used":
        batch.update(docRef(uid, COLLECTIONS.codexPrompts, action.payload.id), {
          status: "used",
          resultSummary: action.payload.usedSummary,
          lastUsedAt: makeWriteDate(),
          updatedAt: makeWriteDate(),
        });
        break;

      case "note_add":
        batch.set(
          docRef(uid, COLLECTIONS.notes, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "note_update":
        batch.update(docRef(uid, COLLECTIONS.notes, action.payload.id), {
          ...mapToWriteModel(action.payload.updates as Record<string, unknown>),
          updatedAt: makeWriteDate(),
        });
        break;

      case "link_add":
        batch.set(
          docRef(uid, COLLECTIONS.links, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.createdAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "link_update":
        batch.update(docRef(uid, COLLECTIONS.links, action.payload.id), {
          ...mapToWriteModel(action.payload.updates as Record<string, unknown>),
          updatedAt: makeWriteDate(),
        });
        break;

      case "session_start":
        batch.set(
          docRef(uid, COLLECTIONS.sessions, action.payload.id),
          {
            ...mapToWriteModel(action.payload as unknown as Record<string, unknown>),
            createdAt: action.payload.startedAt,
            updatedAt: makeWriteDate(),
          },
          { merge: true },
        );
        break;

      case "session_end":
        batch.update(docRef(uid, COLLECTIONS.sessions, action.payload.id), {
          ...mapToWriteModel(action.payload.updates as Record<string, unknown>),
          status: "completed",
          endedAt: action.payload.updates.endedAt ?? nowIso(),
          updatedAt: makeWriteDate(),
        });
        break;

    }

    if (projectRecency && action.type !== "project_update") {
      addProjectRecencyWrite(batch, uid, projectRecency);
    }

    if (activity && (action.type !== "activity_add" || action.payload.id !== activity.id)) {
      addActivityWrite(batch, uid, activity);
    }

    await batch.commit();
  };

  const subscribe = (onChange: (data: DashboardData) => void, onError?: (error: unknown) => void) => {
    const state: DashboardData = { ...emptyState };
    const listeners: Unsubscribe[] = [];
    const initializedCollections = new Set<CollectionName>();
    const expectedCollectionCount = new Set(Object.values(COLLECTIONS)).size;
    let isClosed = false;
    let hasCompleteState = false;

    const emit = () => {
      if (isClosed || !hasCompleteState) return;
      onChange({ ...state, schemaVersion: SCHEMA_VERSION });
    };

    const attach = <T,>(name: CollectionName, mapper: RowMap<T>) => {
      const unsubscribe = onSnapshot(
        collectionRef(uid, name),
        (snapshot) => {
          const rows = snapshot.docs
            .map((entry) => mapper(entry.id, entry.data() as Record<string, unknown>))
            .filter((entry): entry is T => entry !== null);

          if (name === COLLECTIONS.projects) state.projects = rows as Project[];
          if (name === COLLECTIONS.ideas) state.ideas = rows as Idea[];
          if (name === COLLECTIONS.tasks) state.tasks = rows as Task[];
          if (name === COLLECTIONS.brainDumps) state.brainDumps = rows as BrainDump[];
          if (name === COLLECTIONS.scratchpads) state.scratchpads = rows as Scratchpad[];
          if (name === COLLECTIONS.architectureDecisions)
            state.architectureDecisions = rows as ArchitectureDecision[];
          if (name === COLLECTIONS.codexPrompts) state.codexPrompts = rows as CodexPrompt[];
          if (name === COLLECTIONS.notes) state.notes = rows as Note[];
          if (name === COLLECTIONS.links) state.importantLinks = rows as ImportantLink[];
          if (name === COLLECTIONS.sessions) state.developmentSessions = rows as DevelopmentSession[];
          if (name === COLLECTIONS.activities) state.activities = rows as ActivityEvent[];

          initializedCollections.add(name);
          if (initializedCollections.size === expectedCollectionCount) {
            hasCompleteState = true;
          }
          emit();
        },
        onError,
      );
      listeners.push(unsubscribe);
    };

    attach(COLLECTIONS.projects, mapProject);
    attach(COLLECTIONS.ideas, mapIdea);
    attach(COLLECTIONS.tasks, mapTask);
    attach(COLLECTIONS.brainDumps, mapBrainDump);
    attach(COLLECTIONS.scratchpads, mapScratchpad);
    attach(COLLECTIONS.architectureDecisions, mapArchitectureDecision);
    attach(COLLECTIONS.codexPrompts, mapCodexPrompt);
    attach(COLLECTIONS.notes, mapNote);
    attach(COLLECTIONS.links, mapLink);
    attach(COLLECTIONS.sessions, mapSession);
    attach(COLLECTIONS.activities, mapActivity);

    return () => {
      isClosed = true;
      listeners.forEach((listener) => listener());
    };
  };

  const getMigrationState = async () => {
    const existing = await getDoc(migrationStateRef(uid));
    if (!existing.exists()) {
      const counts = await getCounts(uid);
      return {
        ...defaultMigrationState(),
        hasCloudData: hasAnyRecords(counts),
        cloudRecordCounts: counts,
        markerStatus: "initialized",
      };
    }

    return parseMigrationState(existing.data());
  };

  const importData = async (data: DashboardData): Promise<MigrationState> => {
    const startingCloudRecordCounts = await getCounts(uid);
    const hasCloudData = hasAnyRecords(startingCloudRecordCounts);
    const localRecordCounts = {
      projects: data.projects.length,
      ideas: data.ideas.length,
      tasks: data.tasks.length,
      brainDumps: data.brainDumps.length,
      scratchpads: data.scratchpads.length,
      architectureDecisions: data.architectureDecisions.length,
      codexPrompts: data.codexPrompts.length,
      notes: data.notes.length,
      links: data.importantLinks.length,
      developmentSessions: data.developmentSessions.length,
      activities: data.activities.length,
    };
    const emptyImportCounts = Object.fromEntries(
      Object.keys(localRecordCounts).map((key) => [key, 0]),
    );
    const progress: MigrationImportProgress = {
      importedCounts: { ...emptyImportCounts },
      skippedCounts: { ...emptyImportCounts },
    };

    const startAt = nowIso();
    const nextState: MigrationState = {
      phase: "running",
      hasLocalData: hasAnyRecords(localRecordCounts),
      hasCloudData,
      localRecordCounts,
      cloudRecordCounts: startingCloudRecordCounts,
      importedCounts: { ...progress.importedCounts },
      skippedCounts: { ...progress.skippedCounts },
      migrationVersion: 1,
      sourceSchemaVersion: SCHEMA_VERSION,
      markerStatus: "importing",
      error: null,
      startedAt: startAt,
      completedAt: null,
      sourceDevice: "web",
      localStorageKey: STORAGE_KEY,
      backupCreated: false,
      reconciliationRequired: true,
      reconciliationReason: "Cloud import is in progress.",
      version: 1,
    };

    await appendMigrationState(uid, nextState);

    try {
      await runMigrationWrites(uid, data, progress, async (currentProgress) => {
        await appendMigrationState(uid, {
          ...nextState,
          hasCloudData: hasCloudData || hasAnyRecords(currentProgress.importedCounts),
          importedCounts: currentProgress.importedCounts,
          skippedCounts: currentProgress.skippedCounts,
        });
      });
      const cloudRecordCounts = await getCounts(uid);
      const reconciliationPending: MigrationState = {
        ...nextState,
        phase: "running",
        hasCloudData: hasAnyRecords(cloudRecordCounts),
        importedCounts: { ...progress.importedCounts },
        skippedCounts: { ...progress.skippedCounts },
        markerStatus: "reconciliation_pending",
        completedAt: null,
        cloudRecordCounts,
        reconciliationRequired: true,
        reconciliationReason: "Cloud import is awaiting local reconciliation and activation.",
      };

      await appendMigrationState(uid, reconciliationPending);
      return reconciliationPending;
    } catch (error) {
      let failedCloudRecordCounts = startingCloudRecordCounts;
      try {
        failedCloudRecordCounts = await getCounts(uid);
      } catch {
        // Preserve the last known counts when Firestore cannot be queried.
      }
      const failed: MigrationState = {
        ...nextState,
        phase: "error",
        hasCloudData: hasAnyRecords(failedCloudRecordCounts),
        cloudRecordCounts: failedCloudRecordCounts,
        importedCounts: { ...progress.importedCounts },
        skippedCounts: { ...progress.skippedCounts },
        markerStatus: "import_failed",
        error: error instanceof Error ? error.message : "Import failed",
        completedAt: null,
        reconciliationRequired: true,
        reconciliationReason: "Cloud import failed before reconciliation completed.",
      };
      await appendMigrationState(uid, failed);
      throw error;
    }
  };

  const getCountsWithFallback = async () => {
    return getCounts(uid);
  };

  const setMigrationState = (next: MigrationState): Promise<void> => appendMigrationState(uid, next);

  return {
    load,
    save: async () => {
      return;
    },
    applyAction,
    subscribe,
    hasData: async () => {
      const counts = await getCounts(uid);
      return hasAnyRecords(counts);
    },
    getCounts: getCountsWithFallback,
    getMigrationState,
    setMigrationState,
    importData,
    exportData: async () => load(),
  };
};
