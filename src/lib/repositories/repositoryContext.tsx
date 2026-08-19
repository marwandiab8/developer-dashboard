"use client";

import {
  ActivityType,
  type ActivityEvent,
  type ArchitectureDecision,
  type BrainDump,
  type CodexPrompt,
  type DashboardData,
  type DevelopmentSession,
  type Idea,
  type ImportantLink,
  type Note,
  type Project,
  type Scratchpad,
  type Task,
  type CaptureClassification,
} from "../models";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  quickCaptureSchema,
  scratchpadSchema,
  taskSchema,
} from "../validation";
import { nowIso } from "../utils/time";
import { seedDashboardData } from "../seed";
import {
  appendPendingCloudReconciliationAction,
  claimLegacyCloudRecovery,
  cloudRecoveryScopeForUid,
  clearCloudRecoveryDashboardData,
  clearPendingCloudReconciliationActions,
  createLocalDashboardBackup,
  createLocalRepository,
  ensureLocalDashboardBackup,
  ensurePreCloudFallbackBackup,
  hasUserLocalData,
  hasUnacknowledgedLocalData,
  hasUntrackedLegacyLocalBaseline,
  getLocalDataOwnership,
  getLocalDataReconciliationState,
  getPendingCloudReconciliationActions,
  isSeedDashboardData,
  loadCloudRecoveryDashboardData,
  markLocalDataCloudAcknowledged,
  markLocalDataReconciliationRequired,
  removePendingCloudReconciliationAction,
  saveCloudRecoveryDashboardData,
  searchDashboard,
} from "./localAdapter";
import { dashboardReducer } from "./reducer";
import { createFirestoreRepository } from "./firestoreAdapter";
import { createCloudMutationContract } from "./cloudMutationContract";
import { buildRecoveryProjection } from "./recoveryProjection";
import {
  type DashboardRepository,
  type DashboardSyncStatus,
  type DashboardAction,
  type SearchResult,
  type MigrationState,
  type MutationResult,
  type PendingCloudReconciliationAction,
} from "./types";
import { useAuth } from "../auth/useAuth";
import { SCHEMA_VERSION, STORAGE_KEY } from "../constants";
import { normalizeTaskStatus } from "../workflow";

type TaskGeneratedFields =
  | "id"
  | "createdAt"
  | "updatedAt"
  | "readyAt"
  | "lastWorkedAt"
  | "totalActiveDurationMs"
  | "promptRecordIds"
  | "workSessionIds"
  | "recommendedNextStep"
  | "githubBranch"
  | "githubCommit"
  | "githubPullRequest"
  | "legacyStatus";
type NewTaskInput = Omit<Task, TaskGeneratedFields> & Partial<Pick<Task,
  "readyAt" | "lastWorkedAt" | "recommendedNextStep" | "githubBranch" | "githubCommit" | "githubPullRequest"
>>;

type PromptGeneratedFields =
  | "id"
  | "createdAt"
  | "updatedAt"
  | "lastUsedAt"
  | "sequenceNumber"
  | "promptSummary"
  | "requestedChange"
  | "createdBy"
  | "completedWork"
  | "unfinishedWork"
  | "problemsDiscovered"
  | "decisionsMade"
  | "filesModified"
  | "commits"
  | "branch"
  | "blocker"
  | "recommendedNextStep"
  | "activeDurationMs"
  | "testResults"
  | "buildResults"
  | "deploymentStatus"
  | "legacyStatus"
  | "source"
  | "relatedSessionId";
type NewPromptInput = Omit<CodexPrompt, PromptGeneratedFields> & Partial<Pick<CodexPrompt,
  "sequenceNumber" | "promptSummary" | "requestedChange" | "createdBy" | "completedWork"
  | "unfinishedWork" | "problemsDiscovered" | "decisionsMade" | "filesModified" | "commits"
  | "branch" | "blocker" | "recommendedNextStep" | "activeDurationMs" | "testResults" | "buildResults"
  | "deploymentStatus" | "source" | "relatedSessionId"
>>;

type SessionGeneratedFields =
  | "id"
  | "startedAt"
  | "endedAt"
  | "status"
  | "activeStartedAt"
  | "activeDurationMs"
  | "taskId"
  | "promptRecordId"
  | "source"
  | "resumeFromNote"
  | "blocker"
  | "nextStep"
  | "testResults"
  | "buildResults"
  | "deploymentStatus";
type NewSessionInput = Omit<DevelopmentSession, SessionGeneratedFields> & Partial<Pick<DevelopmentSession,
  "activeDurationMs" | "taskId" | "promptRecordId" | "source" | "resumeFromNote" | "blocker" | "nextStep"
  | "testResults" | "buildResults" | "deploymentStatus"
>>;

const ActivityTypeSet = new Set<ActivityType>([
  "project_created",
  "idea_captured",
  "idea_converted",
  "idea_updated",
  "task_created",
  "task_started",
  "task_status_changed",
  "task_blocked",
  "task_reopened",
  "task_completed",
  "prompt_prepared",
  "prompt_started",
  "prompt_completed",
  "prompt_failed",
  "work_summary_added",
  "blocker_recorded",
  "decision_accepted",
  "prompt_used",
  "session_started",
  "session_paused",
  "session_resumed",
  "session_corrected",
  "session_completed",
  "resume_generated",
  "ai_context_generated",
  "github_repository_imported",
  "github_repository_updated",
  "github_repository_unavailable",
]);

const makeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const emptyMigrationState: MigrationState = {
  phase: "idle",
  hasLocalData: false,
  hasCloudData: false,
  localRecordCounts: {},
  cloudRecordCounts: {},
  markerStatus: "not_started",
  error: null,
  startedAt: null,
  completedAt: null,
  reconciliationRequired: false,
  reconciliationReason: null,
  version: 1,
};

const ensureActivityType = (value: string): ActivityType => {
  if (ActivityTypeSet.has(value as ActivityType)) {
    return value as ActivityType;
  }

  return "project_created";
};

const normalizeText = (value: string) => value.trim();

const countFromDashboard = (data: DashboardData) => ({
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
});

const hasCloudCounts = (counts: Record<string, number>) =>
  Object.values(counts).some((value) => typeof value === "number" && value > 0);

const hasSkippedRecords = (counts: Record<string, number> | undefined) =>
  counts !== undefined
  && Object.values(counts).some((value) => typeof value === "number" && value > 0);

const completedMigrationMarkers = new Set(["import_complete", "keep-cloud"]);
const localReconciliationMarkerStatus = "local_reconciliation_required";
const cloudReconciliationMarkerStatuses = new Set([
  "reconciliation_pending",
  "reconciliation_required",
  localReconciliationMarkerStatus,
]);

type RepositorySyncResult =
  | { ok: true }
  | {
      ok: false;
      reason: "cancelled" | "load_failed" | "local_changed";
      status: DashboardSyncStatus;
    };

type RepositoryOperationGuard = () => boolean;

const isCompletedMigration = (state: MigrationState) =>
  state.phase === "complete"
  && state.completedAt !== null
  && completedMigrationMarkers.has(state.markerStatus);

const isCloudReconciliationPending = (state: MigrationState) =>
  state.reconciliationRequired === true
  || cloudReconciliationMarkerStatuses.has(state.markerStatus)
  || state.phase === "running"
  || state.markerStatus === "import_failed";

const updatesProjectRecency = (action: DashboardAction) =>
  action.type !== "seed"
  && action.type !== "project_upsert"
  && action.type !== "activity_add";

const protectedProjectUpdateFields = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "lastWorkedAt",
]);

const deriveProjectRecencyTouch = (
  previousData: DashboardData,
  projectedData: DashboardData,
  action: DashboardAction,
) => {
  if (!updatesProjectRecency(action)) {
    return undefined;
  }

  const previousProjects = new Map(previousData.projects.map((project) => [project.id, project]));
  const touchedProject = projectedData.projects.find((project) => {
    const previous = previousProjects.get(project.id);
    return previous !== undefined && previous !== project;
  });

  if (!touchedProject?.lastWorkedAt) {
    return undefined;
  }

  return {
    projectId: touchedProject.id,
    updatedAt: touchedProject.updatedAt,
    lastWorkedAt: touchedProject.lastWorkedAt,
  };
};

const buildActivityFromInput = (event: {
  projectId: string;
  type: string;
  summary: string;
  entityType: string;
  entityId: string;
  metadata: string;
  actor?: ActivityEvent["actor"];
  taskId?: string | null;
  promptRecordId?: string | null;
  workSessionId?: string | null;
}) =>
  activityEventSchema.parse({
    id: makeId(),
    projectId: event.projectId,
    type: ensureActivityType(event.type),
    summary: event.summary,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata,
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.taskId !== undefined ? { taskId: event.taskId } : {}),
    ...(event.promptRecordId !== undefined ? { promptRecordId: event.promptRecordId } : {}),
    ...(event.workSessionId !== undefined ? { workSessionId: event.workSessionId } : {}),
    createdAt: nowIso(),
  });

export interface DashboardContextValue {
  data: DashboardData;
  repositoryMode: "local" | "cloud";
  localPersistenceStatus: "durable" | "degraded";
  localPersistenceError: string | null;
  isMutationReady: boolean;
  lastActionError: string | null;
  clearLastActionError: () => void;
  syncStatus: DashboardSyncStatus;
  migrationState: MigrationState;
  beginMigrationImport: (mode?: "import" | "keep-cloud") => Promise<MigrationState | null>;
  exportLocalData: () => Promise<DashboardData>;
  beginMigrationKeepCloud: () => Promise<MigrationState | null>;

  createProject: (title: string, purpose: string) => Promise<Project>;
  updateProject: (
    id: string,
    updates: Partial<Omit<Project, "id" | "createdAt" | "updatedAt" | "lastWorkedAt">>,
  ) => void;
  runQuickCapture: (
    payload: { projectId: string; text: string; classification: CaptureClassification },
  ) => Promise<MutationResult>;

  addIdea: (idea: Omit<Idea, "id" | "createdAt" | "updatedAt" | "linkedTaskId" | "convertedAt" | "legacyStatus">) => Idea;
  updateIdea: (id: string, updates: Partial<Idea>) => void;
  archiveIdea: (id: string) => void;
  convertIdeaToTask: (ideaId: string) => Task | null;

  addTask: (task: NewTaskInput) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  startTask: (id: string) => void;
  blockTask: (id: string, reason: string) => void;
  completeTask: (id: string) => void;
  setTaskStatus: (id: string, status: Task["status"], blocker?: string) => void;

  addBrainDump: (payload: Omit<BrainDump, "id" | "createdAt" | "updatedAt" | "status" | "convertedEntityType" | "convertedEntityId">) => BrainDump;
  updateBrainDump: (id: string, updates: Partial<BrainDump>) => void;
  deleteBrainDump: (id: string) => void;
  convertBrainDumpToIdea: (id: string) => void;
  convertBrainDumpToTask: (id: string) => void;

  updateScratchpad: (projectId: string, markdown: string) => void;
  getProjectScratchpad: (projectId: string) => Scratchpad | null;

  upsertDecision: (
    decision: Omit<ArchitectureDecision, "id" | "createdAt" | "updatedAt"> & { decidedAt?: string },
  ) => ArchitectureDecision;
  updateDecisionStatus: (id: string, status: ArchitectureDecision["status"]) => void;

  upsertPrompt: (
    prompt: NewPromptInput,
  ) => CodexPrompt;
  markPromptUsed: (id: string, summary: string) => void;
  createTaskPromptRecord: (payload: {
    taskId: string;
    summary: string;
    requestedChange: string;
    prompt?: string;
    source?: CodexPrompt["source"];
    workSessionId?: string | null;
  }) => CodexPrompt | null;

  addNote: (note: Omit<Note, "id" | "createdAt" | "updatedAt">) => Note;
  updateNote: (id: string, updates: Partial<Note>) => void;

  addLink: (link: Omit<ImportantLink, "id" | "createdAt" | "updatedAt">) => ImportantLink;
  updateLink: (id: string, updates: Partial<ImportantLink>) => void;

  startSession: (session: NewSessionInput) => DevelopmentSession;
  endSession: (id: string, updates: Partial<DevelopmentSession>) => void;
  appendSessionNote: (id: string, note: string) => void;
  startTaskWorkSession: (payload: {
    taskId: string;
    promptRecordId?: string | null;
    source?: DevelopmentSession["source"];
    resumeFromNote?: string;
  }) => DevelopmentSession | null;
  pauseTaskWorkSession: (id: string, nextStep?: string) => void;
  resumeTaskWorkSession: (id: string, resumeFromNote?: string) => void;
  finishTaskWorkSession: (
    id: string,
    updates?: Partial<DevelopmentSession>,
    status?: "completed" | "abandoned",
  ) => void;
  correctTaskWorkSession: (id: string, activeDurationMs: number) => void;

  search: (query: string) => SearchResult[];
}

const localRepository = createLocalRepository();
const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const renderedAuthStatus = auth.status;
  const renderedAuthUid = auth.user?.uid ?? null;
  const seedData = useMemo(() => seedDashboardData(), []);

  const [data, dispatch] = useReducer(dashboardReducer, seedData);
  const dataRef = useRef(seedData);
  const [syncStatus, setSyncStatus] = useState<DashboardSyncStatus>("loading");
  const [repositoryMode, setRepositoryMode] = useState<"local" | "cloud">("local");
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastActionError, setLastActionError] = useState<string | null>(null);
  const [localPersistenceStatus, setLocalPersistenceStatus] = useState<"durable" | "degraded">("durable");
  const [localPersistenceError, setLocalPersistenceError] = useState<string | null>(null);
  const [migrationState, setMigrationState] = useState<MigrationState>(emptyMigrationState);
  const repositoryRef = useRef<DashboardRepository>(localRepository);
  const firestoreRepositoryRef = useRef<DashboardRepository | null>(null);
  const firestoreRepositoryUidRef = useRef<string | null>(null);
  const lastCloudRepositoryUidRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const activeSyncRef = useRef(0);
  const pendingActivitiesRef = useRef(new Map<string, ActivityEvent>());
  const persistenceQueuesRef = useRef(new Map<DashboardRepository, Promise<void>>());
  const pendingPersistenceCountsRef = useRef(new Map<DashboardRepository, number>());
  const deferredSnapshotRef = useRef<{
    repository: DashboardRepository;
    rawData: DashboardData;
    version: number;
  } | null>(null);
  const repositorySnapshotVersionsRef = useRef(new Map<DashboardRepository, number>());
  const projectionRevisionRef = useRef(0);
  const cloudRecoveryProjectionRef = useRef<DashboardData>(seedData);
  const failedCloudRepositoriesRef = useRef(new Set<DashboardRepository>());
  const unsettledCloudMutationsRef = useRef(
    new Map<DashboardRepository, PendingCloudReconciliationAction[]>(),
  );
  const acknowledgedCloudMutationsRef = useRef(
    new Map<DashboardRepository, Array<{
      pending: PendingCloudReconciliationAction;
      acknowledgedAfterVersion: number;
    }>>(),
  );
  const localReconciliationOwnerScopeRef = useRef<string | null>(null);
  const legacyRecoveryWorkspaceRef = useRef(false);
  const isolatesSharedLocalDataRef = useRef(false);
  const authGenerationRef = useRef(0);
  const localPersistenceErrorRef = useRef<string | null>(null);
  // This slot is exclusively for the active, unscoped local workspace. Cloud
  // projections and account-scoped recovery data must continue to use their
  // scoped recovery storage so an auth transition cannot expose another UID's
  // data. Keep the latest local projection here until one full save succeeds.
  const unpersistedLocalProjectionRef = useRef<DashboardData | null>(null);
  type ActiveDataIdentity = {
    status: "loading" | "authenticated" | "unauthenticated";
    uid: string | null;
    generation: number;
    ready: boolean;
  };
  const initialActiveDataIdentity: ActiveDataIdentity = {
    status: renderedAuthStatus,
    uid: renderedAuthStatus === "authenticated" ? renderedAuthUid : null,
    generation: 0,
    ready: false,
  };
  const activeDataIdentityRef = useRef<ActiveDataIdentity>(initialActiveDataIdentity);
  const [activeDataIdentity, setActiveDataIdentity] = useState<ActiveDataIdentity>(
    initialActiveDataIdentity,
  );
  const authIdentityRef = useRef<{
    status: "loading" | "authenticated" | "unauthenticated";
    uid: string | null;
  }>({
    status: renderedAuthStatus,
    uid: renderedAuthStatus === "authenticated" ? renderedAuthUid : null,
  });
  useLayoutEffect(() => {
    authIdentityRef.current = {
      status: renderedAuthStatus,
      uid: renderedAuthStatus === "authenticated" ? renderedAuthUid : null,
    };
  }, [renderedAuthStatus, renderedAuthUid]);

  const replaceData = useCallback((nextData: DashboardData) => {
    dataRef.current = nextData;
    dispatch({ type: "seed", payload: nextData });
  }, []);

  const reconcileRepositorySnapshot = useCallback((nextData: DashboardData) => {
    const persistedActivityIds = new Set(nextData.activities.map((activity) => activity.id));
    persistedActivityIds.forEach((id) => pendingActivitiesRef.current.delete(id));
    const pendingActivities = Array.from(pendingActivitiesRef.current.values()).filter(
      (activity) => !persistedActivityIds.has(activity.id),
    );

    return pendingActivities.length > 0
      ? { ...nextData, activities: [...pendingActivities, ...nextData.activities] }
      : nextData;
  }, []);

  const projectRepositorySnapshot = useCallback((
    nextRepo: DashboardRepository,
    remoteBase: DashboardData,
    snapshotVersion = repositorySnapshotVersionsRef.current.get(nextRepo) ?? 0,
  ) => {
    if (nextRepo === localRepository) {
      return remoteBase;
    }

    const acknowledgedRecords = acknowledgedCloudMutationsRef.current.get(nextRepo) ?? [];
    const retainedAcknowledged = acknowledgedRecords.filter(
      (entry) => snapshotVersion <= entry.acknowledgedAfterVersion,
    );
    if (retainedAcknowledged.length === 0) {
      acknowledgedCloudMutationsRef.current.delete(nextRepo);
    } else if (retainedAcknowledged.length !== acknowledgedRecords.length) {
      acknowledgedCloudMutationsRef.current.set(nextRepo, retainedAcknowledged);
    }
    const acknowledged = retainedAcknowledged.map((entry) => entry.pending);

    const repositoryUid = firestoreRepositoryRef.current === nextRepo
      ? firestoreRepositoryUidRef.current
      : null;
    const ownerScope = repositoryUid ? cloudRecoveryScopeForUid(repositoryUid) : null;
    const unsettled = ownerScope
      ? getPendingCloudReconciliationActions(ownerScope)
      : [];
    const inMemoryUnsettled = unsettledCloudMutationsRef.current.get(nextRepo) ?? [];
    const acknowledgedIds = new Set(acknowledged.map((entry) => entry.id));
    const durableIds = new Set(unsettled.map((entry) => entry.id));
    const orderedMutations = [
      ...acknowledged,
      ...unsettled.filter((entry) => !acknowledgedIds.has(entry.id)),
      ...inMemoryUnsettled.filter(
        (entry) => !acknowledgedIds.has(entry.id) && !durableIds.has(entry.id),
      ),
    ];
    const projected = buildRecoveryProjection(remoteBase, orderedMutations);
    cloudRecoveryProjectionRef.current = projected;
    return projected;
  }, []);

  const rememberAcknowledgedCloudMutation = useCallback((
    repository: DashboardRepository,
    pending: PendingCloudReconciliationAction,
  ) => {
    const acknowledged = acknowledgedCloudMutationsRef.current.get(repository) ?? [];
    if (acknowledged.some((entry) => entry.pending.id === pending.id)) return;
    acknowledgedCloudMutationsRef.current.set(repository, [
      ...acknowledged,
      {
        pending,
        acknowledgedAfterVersion:
          repositorySnapshotVersionsRef.current.get(repository) ?? 0,
      },
    ]);
  }, []);

  const rememberUnsettledCloudMutation = useCallback((
    repository: DashboardRepository,
    pending: PendingCloudReconciliationAction,
  ) => {
    const unsettled = unsettledCloudMutationsRef.current.get(repository) ?? [];
    if (unsettled.some((entry) => entry.id === pending.id)) return;
    unsettledCloudMutationsRef.current.set(repository, [...unsettled, pending]);
  }, []);

  const forgetUnsettledCloudMutation = useCallback((
    repository: DashboardRepository,
    pendingId: string,
  ) => {
    const unsettled = unsettledCloudMutationsRef.current.get(repository) ?? [];
    const remaining = unsettled.filter((entry) => entry.id !== pendingId);
    if (remaining.length === 0) {
      unsettledCloudMutationsRef.current.delete(repository);
    } else {
      unsettledCloudMutationsRef.current.set(repository, remaining);
    }
  }, []);

  const normalizeSyncError = useCallback((error: unknown): DashboardSyncStatus => {
    if (!error) return "synced";
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "unavailable") {
      return "offline";
    }

    return "error";
  }, []);

  const markLocalPersistenceDegraded = useCallback((error: unknown) => {
    const detail = error instanceof Error && error.message
      ? ` ${error.message}`
      : "";
    const message =
      `Local persistence is degraded.${detail} Latest work remains visible only in this tab and is not durably stored.`;
    localPersistenceErrorRef.current = message;
    setLocalPersistenceStatus("degraded");
    setLocalPersistenceError(message);
    setLastActionError(message);
    setSyncStatus("error");
    return message;
  }, []);

  const markLocalPersistenceRecovered = useCallback((persistedFullLocalProjection = false) => {
    if (persistedFullLocalProjection) {
      unpersistedLocalProjectionRef.current = null;
    } else if (unpersistedLocalProjectionRef.current) {
      // A scoped recovery write or another unrelated storage operation cannot
      // establish durability for the active unscoped local projection.
      return;
    }

    const previousError = localPersistenceErrorRef.current;
    localPersistenceErrorRef.current = null;
    setLocalPersistenceStatus("durable");
    setLocalPersistenceError(null);
    if (previousError) {
      setLastActionError((current) => current === previousError ? null : current);
    }
  }, []);

  const clearListeners = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, []);

  const acceptRepositorySnapshot = useCallback(
    (
      nextRepo: DashboardRepository,
      nextData: DashboardData,
      version: number,
      rawData = nextData,
    ) => {
      const reconciled = reconcileRepositorySnapshot(nextData);
      const pendingCount = pendingPersistenceCountsRef.current.get(nextRepo) ?? 0;
      if (pendingCount > 0) {
        const deferred = deferredSnapshotRef.current;
        if (!deferred || deferred.repository !== nextRepo || deferred.version < version) {
          deferredSnapshotRef.current = { repository: nextRepo, rawData, version };
        }
        return;
      }

      deferredSnapshotRef.current = null;
      replaceData(reconciled);
      setSyncStatus("synced");
    },
    [reconcileRepositorySnapshot, replaceData],
  );

  const recordRepositorySnapshot = useCallback(
    (nextRepo: DashboardRepository, nextData: DashboardData) => {
      const version = (repositorySnapshotVersionsRef.current.get(nextRepo) ?? 0) + 1;
      repositorySnapshotVersionsRef.current.set(nextRepo, version);
      acceptRepositorySnapshot(
        nextRepo,
        projectRepositorySnapshot(nextRepo, nextData, version),
        version,
        nextData,
      );
      return version;
    },
    [acceptRepositorySnapshot, projectRepositorySnapshot],
  );

  const subscribeToRepository = useCallback(
    (nextRepo: DashboardRepository, isCurrent?: RepositoryOperationGuard) => {
      if (isCurrent && !isCurrent()) {
        return;
      }

      unsubscribeRef.current = nextRepo.subscribe(
        (nextData) => {
          if ((isCurrent && !isCurrent()) || repositoryRef.current !== nextRepo) {
            return;
          }

          recordRepositorySnapshot(nextRepo, nextData);
        },
        (error) => {
          if (isCurrent && !isCurrent()) {
            return;
          }

          const status = normalizeSyncError(error);
          setSyncStatus(status);
          setLastActionError(error instanceof Error ? error.message : "Sync error.");
        },
      );
    },
    [normalizeSyncError, recordRepositorySnapshot],
  );

  const syncFromRepository = useCallback(
    async (nextRepo: DashboardRepository, isCurrent?: RepositoryOperationGuard) => {
      if (isCurrent && !isCurrent()) {
        return { ok: false, reason: "cancelled", status: "loading" } satisfies RepositorySyncResult;
      }

      const syncId = activeSyncRef.current + 1;
      const startingRepository = repositoryRef.current;
      const startingRevision = projectionRevisionRef.current;
      const startingSnapshotVersion = repositorySnapshotVersionsRef.current.get(nextRepo) ?? 0;
      activeSyncRef.current = syncId;
      clearListeners();
      pendingActivitiesRef.current.clear();
      deferredSnapshotRef.current = null;
      setSyncStatus("loading");

      let realtimeSnapshotAccepted = false;
      let subscriptionError: unknown = null;
      try {
        unsubscribeRef.current = nextRepo.subscribe(
          (nextData) => {
            if ((isCurrent && !isCurrent()) || activeSyncRef.current !== syncId) {
              return;
            }
            if (
              nextRepo !== startingRepository
              && repositoryRef.current !== nextRepo
              && projectionRevisionRef.current !== startingRevision
            ) {
              return;
            }

            realtimeSnapshotAccepted = true;
            repositoryRef.current = nextRepo;
            setRepositoryMode(nextRepo === localRepository ? "local" : "cloud");
            recordRepositorySnapshot(nextRepo, nextData);
            setIsHydrated(true);
          },
          (error) => {
            if ((isCurrent && !isCurrent()) || activeSyncRef.current !== syncId) {
              return;
            }

            const status = normalizeSyncError(error);
            setSyncStatus(status);
            setLastActionError(error instanceof Error ? error.message : "Sync error.");
          },
        );
      } catch (error) {
        subscriptionError = error;
      }

      try {
        const nextData = await nextRepo.load();
        if ((isCurrent && !isCurrent()) || activeSyncRef.current !== syncId) {
          return { ok: false, reason: "cancelled", status: "loading" } satisfies RepositorySyncResult;
        }

        if (
          realtimeSnapshotAccepted
          || (repositorySnapshotVersionsRef.current.get(nextRepo) ?? 0) > startingSnapshotVersion
        ) {
          return { ok: true } satisfies RepositorySyncResult;
        }

        if (subscriptionError) {
          const status = normalizeSyncError(subscriptionError);
          setSyncStatus(status);
          setLastActionError(
            subscriptionError instanceof Error
              ? subscriptionError.message
              : "Unable to subscribe to dashboard updates.",
          );
          return { ok: false, reason: "load_failed", status } satisfies RepositorySyncResult;
        }

        if (
          nextRepo !== startingRepository
          && projectionRevisionRef.current !== startingRevision
        ) {
          return { ok: false, reason: "local_changed", status: "saving" } satisfies RepositorySyncResult;
        }

        repositoryRef.current = nextRepo;
        const projectedData = projectRepositorySnapshot(nextRepo, nextData);
        if (nextRepo !== localRepository) {
          failedCloudRepositoriesRef.current.delete(nextRepo);
        }
        setRepositoryMode(nextRepo === localRepository ? "local" : "cloud");
        replaceData(projectedData);
        setSyncStatus("synced");
        setIsHydrated(true);
        return { ok: true } satisfies RepositorySyncResult;
      } catch (error) {
        if ((isCurrent && !isCurrent()) || activeSyncRef.current !== syncId) {
          return { ok: false, reason: "cancelled", status: "loading" } satisfies RepositorySyncResult;
        }

        if (
          realtimeSnapshotAccepted
          || (repositorySnapshotVersionsRef.current.get(nextRepo) ?? 0) > startingSnapshotVersion
        ) {
          return { ok: true } satisfies RepositorySyncResult;
        }

        if (nextRepo === localRepository) {
          unpersistedLocalProjectionRef.current = dataRef.current;
          clearListeners();
          deferredSnapshotRef.current = null;
          repositoryRef.current = localRepository;
          setRepositoryMode("local");
          setIsHydrated(true);
          markLocalPersistenceDegraded(error);
          return { ok: true } satisfies RepositorySyncResult;
        }

        const status = normalizeSyncError(error);
        clearListeners();
        setSyncStatus(status);
        setLastActionError(error instanceof Error ? error.message : "Unable to load dashboard data.");
        return { ok: false, reason: "load_failed", status } satisfies RepositorySyncResult;
      }
    },
    [
      clearListeners,
      markLocalPersistenceDegraded,
      normalizeSyncError,
      projectRepositorySnapshot,
      recordRepositorySnapshot,
      replaceData,
    ],
  );

  const activateCloudRepository = useCallback(
    async (firestoreRepository: DashboardRepository, isCurrent?: RepositoryOperationGuard) => {
      if (isCurrent && !isCurrent()) {
        return { ok: false, reason: "cancelled", status: "loading" } satisfies RepositorySyncResult;
      }

      const cloudFailure = await syncFromRepository(firestoreRepository, isCurrent);
      if (isCurrent && !isCurrent()) {
        return { ok: false, reason: "cancelled", status: "loading" } satisfies RepositorySyncResult;
      }
      if (cloudFailure.ok || cloudFailure.reason !== "load_failed") {
        return cloudFailure;
      }

      // The caller already prepared an authoritative local workspace before
      // attempting cloud activation. Reloading the shared local repository here
      // could expose another account's quarantined fallback projection.
      setSyncStatus(cloudFailure.status);
      return cloudFailure;
    },
    [syncFromRepository],
  );

  const persistCloudRecoveryLocally = useCallback(
    async (
      reason: string,
      projection = cloudRecoveryProjectionRef.current,
      isCurrent?: RepositoryOperationGuard,
      ownerScope?: string,
    ) => {
      if (isCurrent && !isCurrent()) {
        return false;
      }

      cloudRecoveryProjectionRef.current = projection;
      saveCloudRecoveryDashboardData(projection, ownerScope);
      if (ownerScope) {
        // This projection is already isolated from the shared signed-out
        // dashboard, so a shared-data backup is neither necessary nor a valid
        // reason to block account-scoped recovery.
        return true;
      }

      const retainedLocalData = await localRepository.load();
      if (isCurrent && !isCurrent()) {
        return false;
      }

      const backupKey = ensurePreCloudFallbackBackup({
        data: retainedLocalData,
        sourceDevice: "web-cloud-fallback",
      });
      if (!backupKey) {
        throw new Error("Unable to preserve the existing local dashboard before cloud fallback.");
      }

      await localRepository.save(projection);
      if (isCurrent && !isCurrent()) {
        return false;
      }
      markLocalDataReconciliationRequired(reason, null);
      return true;
    },
    [],
  );

  const applyAction = useCallback(
    async (
      action: DashboardAction,
      activity?: {
        projectId: string;
        type: string;
        summary: string;
        entityType: string;
        entityId: string;
        metadata: string;
        actor?: ActivityEvent["actor"];
        taskId?: string | null;
        promptRecordId?: string | null;
        workSessionId?: string | null;
      },
    ): Promise<MutationResult> => {
      if (action.type === "seed") {
        return { ok: true };
      }

      const invocationIdentity = authIdentityRef.current;
      const callbackUid = renderedAuthStatus === "authenticated" ? renderedAuthUid : null;
      if (renderedAuthStatus !== invocationIdentity.status || callbackUid !== invocationIdentity.uid) {
        const error = "Authentication is changing. Wait for dashboard data to finish loading and try again.";
        setLastActionError(error);
        return { ok: false, error };
      }
      const activeDataIdentity = activeDataIdentityRef.current;
      if (
        !activeDataIdentity.ready
        || activeDataIdentity.generation !== authGenerationRef.current
        || activeDataIdentity.status !== renderedAuthStatus
        || activeDataIdentity.uid !== callbackUid
      ) {
        const error = "Dashboard data is still loading for the current account. Try again when loading finishes.";
        setLastActionError(error);
        return { ok: false, error };
      }
      if (
        repositoryRef.current !== localRepository
        && (
          invocationIdentity.status !== "authenticated"
          || firestoreRepositoryUidRef.current !== invocationIdentity.uid
        )
      ) {
        const error = "Authentication is changing. Wait for local data to finish loading and try again.";
        setLastActionError(error);
        return { ok: false, error };
      }

      const previousData = dataRef.current;
      const activityRecord = activity ? buildActivityFromInput(activity) : undefined;
      let projected = dashboardReducer(previousData, action);
      if (activityRecord) {
        projected = dashboardReducer(projected, {
          type: "activity_add",
          payload: activityRecord,
        });
      }
      const mutation = createCloudMutationContract(previousData, projected);

      const projectRecencyTouch = deriveProjectRecencyTouch(previousData, projected, action);
      projectionRevisionRef.current += 1;
      replaceData(projected);
      if (activityRecord) {
        pendingActivitiesRef.current.set(activityRecord.id, activityRecord);
      }

      setLastActionError(null);
      setSyncStatus("saving");
      const activeRepositoryBelongsToCurrentUser =
        renderedAuthStatus === "authenticated"
        && renderedAuthUid !== null
        && firestoreRepositoryUidRef.current === renderedAuthUid
        && firestoreRepositoryRef.current === repositoryRef.current;
      const targetRepository = activeRepositoryBelongsToCurrentUser
        ? repositoryRef.current
        : localRepository;
      const targetsCloud = targetRepository !== localRepository;
      const cloudOwnerUid = targetsCloud ? firestoreRepositoryUidRef.current : null;
      const cloudOwnerScope = cloudOwnerUid ? cloudRecoveryScopeForUid(cloudOwnerUid) : null;
      const cloudAuthGeneration = authGenerationRef.current;
      const cloudAuthIsCurrent = () => {
        const currentIdentity = authIdentityRef.current;
        return targetsCloud
          && cloudOwnerUid !== null
          && authGenerationRef.current === cloudAuthGeneration
          && currentIdentity.status === "authenticated"
          && currentIdentity.uid === cloudOwnerUid;
      };
      const cloudOperationIsCurrent = () => {
        return cloudAuthIsCurrent()
          && firestoreRepositoryUidRef.current === cloudOwnerUid
          && firestoreRepositoryRef.current === targetRepository
          && repositoryRef.current === targetRepository;
      };
      const startsLocalFallback = !targetsCloud && repositoryRef.current !== localRepository;
      const recoveryWorkspaceOwnerScope = targetsCloud
        ? null
        : localReconciliationOwnerScopeRef.current;
      const usesIsolatedRecoveryWorkspace = !targetsCloud
        && isolatesSharedLocalDataRef.current;
      const usesLegacyRecoveryWorkspace = !targetsCloud
        && legacyRecoveryWorkspaceRef.current;
      const usesOrdinaryLocalWorkspace = !targetsCloud
        && !startsLocalFallback
        && !usesIsolatedRecoveryWorkspace;
      if (usesOrdinaryLocalWorkspace) {
        // Hold every optimistic local projection until the queued full save
        // completes. This also protects an in-flight action if auth changes
        // before browser storage reports that the write failed.
        unpersistedLocalProjectionRef.current = projected;
      }
      let writeAheadEntry = null as ReturnType<typeof appendPendingCloudReconciliationAction>;
      let writeAheadError: unknown = null;

      if (targetsCloud) {
        cloudRecoveryProjectionRef.current = projected;
        try {
          // Persist both the latest projection and its ordered mutation before
          // starting network I/O. An auth transition or a tab close can then
          // recover work even while the Firestore promise is unresolved.
          saveCloudRecoveryDashboardData(projected, cloudOwnerScope ?? undefined);
          writeAheadEntry = appendPendingCloudReconciliationAction({
            ...(cloudOwnerScope ? { ownerScope: cloudOwnerScope } : {}),
            action,
            activity: activityRecord,
            projectRecency: projectRecencyTouch,
            mutation,
          });
          if (!writeAheadEntry) {
            throw new Error("Unable to create the cloud recovery journal entry.");
          }
          rememberUnsettledCloudMutation(targetRepository, writeAheadEntry);
        } catch (error) {
          writeAheadError = error;
          failedCloudRepositoriesRef.current.add(targetRepository);
        }
      }

      const targetPendingCount = pendingPersistenceCountsRef.current.get(targetRepository) ?? 0;
      pendingPersistenceCountsRef.current.set(targetRepository, targetPendingCount + 1);
      const persist = async () => {
        if (targetsCloud) {
          if (writeAheadError) {
            throw writeAheadError;
          }
          if (failedCloudRepositoriesRef.current.has(targetRepository)) {
            throw Object.assign(
              new Error("Cloud writes paused after an earlier queued write failed."),
              { code: "unavailable" },
            );
          }

          try {
            await targetRepository.applyAction(
              action,
              activityRecord,
              projectRecencyTouch,
              writeAheadEntry!.id,
              mutation,
            );
          } catch (error) {
            // Set this inside the queued operation, before its rejection releases
            // the next action. Later actions stay local and replay in order.
            failedCloudRepositoriesRef.current.add(targetRepository);
            throw error;
          }

          const pendingForOwner = cloudOwnerScope
            ? getPendingCloudReconciliationActions(cloudOwnerScope)
            : [];
          const completesOwnerRecovery = cloudOwnerScope
            && pendingForOwner.length === 1
            && pendingForOwner[0]?.id === writeAheadEntry!.id;
          if (completesOwnerRecovery) {
            // Clear the full projection first. A crash between these two
            // synchronous removals leaves a replayable journal entry, never an
            // ambiguous snapshot-only artifact from an already-successful write.
            clearCloudRecoveryDashboardData(cloudOwnerScope);
          }
          rememberAcknowledgedCloudMutation(targetRepository, writeAheadEntry!);
          removePendingCloudReconciliationAction(writeAheadEntry!.id);
          forgetUnsettledCloudMutation(targetRepository, writeAheadEntry!.id);
          if (completesOwnerRecovery) {
            if (
              cloudAuthIsCurrent()
              && repositoryRef.current === localRepository
              && localReconciliationOwnerScopeRef.current === cloudOwnerScope
            ) {
              localReconciliationOwnerScopeRef.current = null;
              legacyRecoveryWorkspaceRef.current = false;
              isolatesSharedLocalDataRef.current = false;
            }
          }
        } else if (usesIsolatedRecoveryWorkspace) {
          cloudRecoveryProjectionRef.current = projected;
          saveCloudRecoveryDashboardData(
            projected,
            recoveryWorkspaceOwnerScope ?? undefined,
          );
          const pending = appendPendingCloudReconciliationAction({
            ...(recoveryWorkspaceOwnerScope
              ? { ownerScope: recoveryWorkspaceOwnerScope }
              : {}),
            action,
            activity: activityRecord,
            projectRecency: projectRecencyTouch,
            mutation,
          });
          if (!pending) {
            throw new Error("Unable to preserve the local recovery action.");
          }
          setMigrationState((current) => ({
            ...current,
            phase: "required",
            hasLocalData: true,
            localRecordCounts: countFromDashboard(projected),
            markerStatus: usesLegacyRecoveryWorkspace
              ? "legacy_recovery_unassigned"
              : localReconciliationMarkerStatus,
            reconciliationRequired: true,
            reconciliationReason: usesLegacyRecoveryWorkspace
              ? "This recovery predates account scoping and will not synchronize until you explicitly associate it with the signed-in account."
              : current.reconciliationReason
                ?? "Local recovery must be reconciled before cloud data becomes active.",
          }));
          if (activityRecord) {
            pendingActivitiesRef.current.delete(activityRecord.id);
          }
          markLocalPersistenceRecovered();
        } else {
          await targetRepository.applyAction(action, activityRecord, projectRecencyTouch);
          if (startsLocalFallback) {
            const reason = "Authentication changed while cloud work was pending. Cloud reconciliation is required.";
            await persistCloudRecoveryLocally(reason, projected);
          } else {
            await targetRepository.save(projected);
          }

          // Ordinary local-first work must continue through the explicit,
          // create-if-absent migration path. Only extend the replay journal
          // after a cloud-intended write has already failed and established a
          // durable reconciliation requirement.
          if (getLocalDataReconciliationState().required) {
            const reconciliationOwnerScope = localReconciliationOwnerScopeRef.current;
            appendPendingCloudReconciliationAction({
              ...(reconciliationOwnerScope ? { ownerScope: reconciliationOwnerScope } : {}),
              action,
              activity: activityRecord,
              projectRecency: projectRecencyTouch,
              mutation,
            });
            cloudRecoveryProjectionRef.current = projected;
            saveCloudRecoveryDashboardData(projected, reconciliationOwnerScope ?? undefined);
          }
          if (activityRecord) {
            pendingActivitiesRef.current.delete(activityRecord.id);
          }
          markLocalPersistenceRecovered();
        }
      };

      const priorPersistence = persistenceQueuesRef.current.get(targetRepository) ?? Promise.resolve();
      const persistence = priorPersistence.then(persist, persist);
      const settledPersistence = persistence.catch(() => {
        return;
      });
      persistenceQueuesRef.current.set(targetRepository, settledPersistence);

      let succeeded = false;
      let mutationResult: MutationResult = { ok: true };
      try {
        await persistence;
        succeeded = true;
      } catch (error) {
        if (activityRecord) {
          pendingActivitiesRef.current.delete(activityRecord.id);
        }
        const failureStatus = normalizeSyncError(error);
        const failureMessage = error instanceof Error ? error.message : "Unable to persist change.";

        if (targetsCloud) {
          if (!cloudOperationIsCurrent()) {
            return {
              ok: false,
              error: "Authentication changed before the capture could be confirmed. Review recovered local work and try again.",
            };
          }
          const fallbackProjection = cloudRecoveryProjectionRef.current;
          const durableFallbackProjection = fallbackProjection;
          const reconciliationReason = `${failureMessage} The change was saved locally; cloud reconciliation is required.`;
          const visibleMessage = reconciliationReason;

          try {
            const preserved = await persistCloudRecoveryLocally(
              reconciliationReason,
              fallbackProjection,
              cloudAuthIsCurrent,
              cloudOwnerScope ?? undefined,
            );
            if (!preserved || !cloudAuthIsCurrent()) {
              return {
                ok: false,
                error: "Authentication changed before the capture could be confirmed. Review recovered local work and try again.",
              };
            }
            markLocalPersistenceRecovered();
            localReconciliationOwnerScopeRef.current = cloudOwnerScope;
            legacyRecoveryWorkspaceRef.current = false;
            isolatesSharedLocalDataRef.current = true;
            activeSyncRef.current += 1;
            clearListeners();
            deferredSnapshotRef.current = null;
            repositoryRef.current = localRepository;
            setRepositoryMode("local");
            replaceData(fallbackProjection);
            setIsHydrated(true);

            setMigrationState((current) => ({
              ...current,
              phase: "required",
              hasLocalData: true,
              localRecordCounts: countFromDashboard(durableFallbackProjection),
              markerStatus: localReconciliationMarkerStatus,
              error: visibleMessage,
              reconciliationRequired: true,
              reconciliationReason,
            }));
            setSyncStatus(failureStatus);
            setLastActionError(visibleMessage);
          } catch (localError) {
            if (!cloudAuthIsCurrent()) {
              return {
                ok: false,
                error: "Authentication changed before the capture could be confirmed. Review recovered local work and try again.",
              };
            }
            const localFailureMessage = localError instanceof Error
              ? localError.message
              : "Unable to save the local fallback.";
            const reconciliationFailureMessage =
              `${failureMessage} Local recovery storage also failed: ${localFailureMessage}. `
              + "This change remains visible in this tab; export it before closing and reconcile it before returning to cloud mode.";
            markLocalPersistenceDegraded(localError);
            localReconciliationOwnerScopeRef.current = cloudOwnerScope;
            legacyRecoveryWorkspaceRef.current = false;
            isolatesSharedLocalDataRef.current = true;
            activeSyncRef.current += 1;
            clearListeners();
            deferredSnapshotRef.current = null;
            repositoryRef.current = localRepository;
            setRepositoryMode("local");
            replaceData(fallbackProjection);
            setIsHydrated(true);
            setMigrationState((current) => ({
              ...current,
              phase: "required",
              hasLocalData: true,
              localRecordCounts: countFromDashboard(fallbackProjection),
              markerStatus: localReconciliationMarkerStatus,
              error: reconciliationFailureMessage,
              reconciliationRequired: true,
              reconciliationReason: reconciliationFailureMessage,
            }));
            setSyncStatus("error");
            setLastActionError(reconciliationFailureMessage);
            mutationResult = { ok: false, error: reconciliationFailureMessage };
          }
        } else {
          const visibleProjection = usesOrdinaryLocalWorkspace
            ? unpersistedLocalProjectionRef.current ?? projected
            : dataRef.current;
          if (usesOrdinaryLocalWorkspace) {
            unpersistedLocalProjectionRef.current = visibleProjection;
            activeSyncRef.current += 1;
            clearListeners();
            deferredSnapshotRef.current = null;
            repositoryRef.current = localRepository;
            setRepositoryMode("local");
            replaceData(visibleProjection);
          }
          const persistenceFailureMessage = markLocalPersistenceDegraded(error);
          mutationResult = { ok: false, error: persistenceFailureMessage };

          if (usesIsolatedRecoveryWorkspace) {
            // Never reload the shared local slot here: it may intentionally be
            // quarantined because it belongs to another account. The projected
            // action remains visible, and either the snapshot or journal write
            // above preserves the best recoverable form available.
            setMigrationState((current) => ({
              ...current,
              phase: "required",
              hasLocalData: true,
              localRecordCounts: countFromDashboard(visibleProjection),
              markerStatus: usesLegacyRecoveryWorkspace
                ? "legacy_recovery_unassigned"
                : localReconciliationMarkerStatus,
              error: `${persistenceFailureMessage} The isolated recovery workspace remains active.`,
              reconciliationRequired: true,
              reconciliationReason:
                "The isolated recovery workspace could not persist its latest full snapshot. Export or retry before reconciling cloud data.",
            }));
          }
        }
      } finally {
        const remainingForTarget = Math.max(
          0,
          (pendingPersistenceCountsRef.current.get(targetRepository) ?? 1) - 1,
        );
        if (remainingForTarget === 0) {
          pendingPersistenceCountsRef.current.delete(targetRepository);
          if (persistenceQueuesRef.current.get(targetRepository) === settledPersistence) {
            persistenceQueuesRef.current.delete(targetRepository);
          }
        } else {
          pendingPersistenceCountsRef.current.set(targetRepository, remainingForTarget);
        }

        if (
          succeeded
          && remainingForTarget === 0
          && targetRepository === localRepository
          && usesOrdinaryLocalWorkspace
        ) {
          const restoresLocalSubscription = localPersistenceErrorRef.current !== null;
          markLocalPersistenceRecovered(true);
          if (restoresLocalSubscription && repositoryRef.current === localRepository) {
            activeSyncRef.current += 1;
            clearListeners();
            subscribeToRepository(localRepository);
          }
        }

        if (
          succeeded
          && remainingForTarget === 0
          && repositoryRef.current === targetRepository
        ) {
          if (targetRepository !== localRepository) {
            const deferred = deferredSnapshotRef.current;
            if (deferred?.repository === targetRepository) {
              acceptRepositorySnapshot(
                targetRepository,
                projectRepositorySnapshot(
                  targetRepository,
                  deferred.rawData,
                  deferred.version,
                ),
                deferred.version,
                deferred.rawData,
              );
            }
            setSyncStatus("synced");
          } else {
            deferredSnapshotRef.current = null;
            setSyncStatus("synced");
          }
        }
      }
      return mutationResult;
    },
    [
      renderedAuthStatus,
      renderedAuthUid,
      clearListeners,
      acceptRepositorySnapshot,
      normalizeSyncError,
      persistCloudRecoveryLocally,
      markLocalPersistenceDegraded,
      markLocalPersistenceRecovered,
      forgetUnsettledCloudMutation,
      rememberAcknowledgedCloudMutation,
      rememberUnsettledCloudMutation,
      projectRepositorySnapshot,
      replaceData,
      subscribeToRepository,
    ],
  );

  const clearLastActionError = useCallback(() => {
    setLastActionError(null);
  }, []);

  const createMigrationStateSnapshot = useCallback(
    async (): Promise<{ hasLocalData: boolean; localRecordCounts: Record<string, number>; localData: DashboardData | null }> => {
      const unpersistedLocalProjection = unpersistedLocalProjectionRef.current;
      if (unpersistedLocalProjection) {
        const hasUnpersistedUserData = !isSeedDashboardData(unpersistedLocalProjection);
        return {
          hasLocalData: hasUnpersistedUserData,
          localRecordCounts: hasUnpersistedUserData
            ? countFromDashboard(unpersistedLocalProjection)
            : {},
          localData: unpersistedLocalProjection,
        };
      }

      if (isolatesSharedLocalDataRef.current) {
        const recoveryOwnerScope = localReconciliationOwnerScopeRef.current;
        const recoveryData = loadCloudRecoveryDashboardData(
          recoveryOwnerScope ?? undefined,
        );
        const isolatedData = recoveryData ?? dataRef.current;
        const hasIsolatedData = recoveryData !== null || !isSeedDashboardData(isolatedData);
        return {
          hasLocalData: hasIsolatedData,
          localRecordCounts: hasIsolatedData ? countFromDashboard(isolatedData) : {},
          localData: hasIsolatedData ? isolatedData : null,
        };
      }

      const hasUserData = hasUserLocalData();
      if (!hasUserData) {
        return { hasLocalData: false, localRecordCounts: {}, localData: null };
      }

      const localData = await localRepository.load();
      return {
        hasLocalData: hasUserData,
        localRecordCounts: countFromDashboard(localData),
        localData,
      };
    },
    [],
  );

  const createStableMigrationStateSnapshot = useCallback(async () => {
    while (true) {
      const pendingLocalPersistence = persistenceQueuesRef.current.get(localRepository);
      if (pendingLocalPersistence) {
        await pendingLocalPersistence;
      }

      const revision = projectionRevisionRef.current;
      const snapshot = await createMigrationStateSnapshot();
      if (
        revision === projectionRevisionRef.current
        && !persistenceQueuesRef.current.has(localRepository)
      ) {
        return snapshot;
      }
    }
  }, [createMigrationStateSnapshot]);

  const syncFromActiveLocalState = useCallback(
    async (isCurrent?: RepositoryOperationGuard): Promise<RepositorySyncResult> => {
      const unpersistedLocalProjection = unpersistedLocalProjectionRef.current;
      if (unpersistedLocalProjection) {
        if (isCurrent && !isCurrent()) {
          return { ok: false, reason: "cancelled", status: "loading" };
        }

        activeSyncRef.current += 1;
        clearListeners();
        deferredSnapshotRef.current = null;
        repositoryRef.current = localRepository;
        setRepositoryMode("local");
        replaceData(unpersistedLocalProjection);
        if (localPersistenceErrorRef.current) {
          setLastActionError(localPersistenceErrorRef.current);
          setSyncStatus("error");
        } else {
          setSyncStatus("saving");
        }
        setIsHydrated(true);
        return { ok: true };
      }

      if (!isolatesSharedLocalDataRef.current) {
        return syncFromRepository(localRepository, isCurrent);
      }
      if (isCurrent && !isCurrent()) {
        return { ok: false, reason: "cancelled", status: "loading" };
      }

      const ownerScope = localReconciliationOwnerScopeRef.current;
      const recovered = loadCloudRecoveryDashboardData(ownerScope ?? undefined)
        ?? dataRef.current;
      activeSyncRef.current += 1;
      clearListeners();
      deferredSnapshotRef.current = null;
      repositoryRef.current = localRepository;
      setRepositoryMode("local");
      replaceData(recovered);
      setSyncStatus("synced");
      setIsHydrated(true);
      return { ok: true };
    },
    [clearListeners, replaceData, syncFromRepository],
  );

  const authenticatedUid = renderedAuthStatus === "authenticated" ? renderedAuthUid : null;

  useEffect(() => {
    const generation = authGenerationRef.current + 1;
    authGenerationRef.current = generation;
    const nextDataIdentity: ActiveDataIdentity = {
      status: renderedAuthStatus,
      uid: authenticatedUid,
      generation,
      ready: false,
    };
    activeDataIdentityRef.current = nextDataIdentity;
    let cancelled = false;
    const isCurrent = () => {
      const currentIdentity = authIdentityRef.current;
      return !cancelled
        && authGenerationRef.current === generation
        && currentIdentity.status === renderedAuthStatus
        && currentIdentity.uid === authenticatedUid;
    };
    const markCurrentDataReady = () => {
      if (!isCurrent()) {
        return false;
      }

      const readyDataIdentity: ActiveDataIdentity = {
        status: renderedAuthStatus,
        uid: authenticatedUid,
        generation,
        ready: true,
      };
      activeDataIdentityRef.current = readyDataIdentity;
      setActiveDataIdentity(readyDataIdentity);
      return true;
    };
    const pendingActivities = pendingActivitiesRef.current;
    const previousCloudUid = firestoreRepositoryUidRef.current
      ?? lastCloudRepositoryUidRef.current;
    const identityChanged = previousCloudUid !== null
      && previousCloudUid !== authenticatedUid;
    const recoveryUid = authenticatedUid
      ?? (renderedAuthStatus === "unauthenticated" ? previousCloudUid : null);
    const recoveryOwnerScope = authenticatedUid
      ? cloudRecoveryScopeForUid(authenticatedUid)
      : renderedAuthStatus === "unauthenticated"
        ? localReconciliationOwnerScopeRef.current
          ?? (recoveryUid ? cloudRecoveryScopeForUid(recoveryUid) : null)
        : null;

    localReconciliationOwnerScopeRef.current = null;
    legacyRecoveryWorkspaceRef.current = false;
    isolatesSharedLocalDataRef.current = false;

    // An auth transition immediately invalidates the prior account's active
    // repository and any load that was still in flight. The local repository
    // remains the safe boundary until this generation finishes initialization.
    activeSyncRef.current += 1;
    clearListeners();
    firestoreRepositoryRef.current = null;
    firestoreRepositoryUidRef.current = null;
    unsettledCloudMutationsRef.current.clear();
    acknowledgedCloudMutationsRef.current.clear();
    if (identityChanged && !unpersistedLocalProjectionRef.current) {
      // Do not retain the previous account's cloud projection during the next
      // identity's asynchronous initialization.
      dataRef.current = seedData;
      localReconciliationOwnerScopeRef.current = null;
    }
    if (repositoryRef.current !== localRepository) {
      repositoryRef.current = localRepository;
    }

    const initialize = async () => {
      // Yield before React state updates so the effect remains an external
      // synchronization boundary while still invalidating refs immediately.
      await Promise.resolve();
      if (!isCurrent()) {
        return;
      }
      setActiveDataIdentity(nextDataIdentity);
      setRepositoryMode("local");
      if (identityChanged && !unpersistedLocalProjectionRef.current) {
        replaceData(seedData);
        setIsHydrated(true);
      }
      setSyncStatus("loading");

      const scopedRecoveryActions = recoveryOwnerScope
        ? getPendingCloudReconciliationActions(recoveryOwnerScope)
        : [];
      const legacyRecoveryActions = getPendingCloudReconciliationActions().filter(
        (entry) => entry.ownerScope === undefined,
      );
      const scopedRecoverySnapshot = recoveryOwnerScope
        ? loadCloudRecoveryDashboardData(recoveryOwnerScope)
        : null;
      const legacyRecoverySnapshot = loadCloudRecoveryDashboardData();
      const hasScopedRecovery = scopedRecoveryActions.length > 0
        || scopedRecoverySnapshot !== null;
      const hasLegacyRecovery = legacyRecoveryActions.length > 0
        || legacyRecoverySnapshot !== null;
      let inMemoryRecovery: DashboardData | null = null;
      let recoveryPreparationError: string | null = null;
      let recoveryRequiresReconciliation = false;
      let activeRecoveryReason: string | null = null;
      if (!unpersistedLocalProjectionRef.current && (hasScopedRecovery || hasLegacyRecovery)) {
        const usesScopedRecovery = hasScopedRecovery;
        const storedRecovery = usesScopedRecovery
          ? scopedRecoverySnapshot
          : legacyRecoverySnapshot;
        const recoveryReason = usesScopedRecovery
          ? "Cloud writes were interrupted. The recovered local projection must be reconciled before cloud data becomes active."
          : "This recovery predates account scoping. It remains local and will not synchronize until you explicitly associate it with the signed-in account.";
        recoveryRequiresReconciliation = true;
        activeRecoveryReason = recoveryReason;
        localReconciliationOwnerScopeRef.current = usesScopedRecovery
          ? recoveryOwnerScope
          : null;
        legacyRecoveryWorkspaceRef.current = !usesScopedRecovery;
        isolatesSharedLocalDataRef.current = true;
        inMemoryRecovery = storedRecovery;
        if (storedRecovery) {
          cloudRecoveryProjectionRef.current = storedRecovery;
        } else {
          recoveryPreparationError = `${recoveryReason} This device has no valid recovery projection.`;
        }
      } else if (
        !unpersistedLocalProjectionRef.current
        && authenticatedUid
        && recoveryOwnerScope
        && getLocalDataOwnership(recoveryOwnerScope) === "different-owner"
      ) {
        // Older builds wrote an authenticated fallback projection into the
        // shared local slot. Quarantine it from this account. New local work is
        // routed to this account's scoped recovery workspace instead.
        localReconciliationOwnerScopeRef.current = recoveryOwnerScope;
        isolatesSharedLocalDataRef.current = true;
      }

      if (recoveryPreparationError) {
        const visibleRecovery = inMemoryRecovery
          ?? (isolatesSharedLocalDataRef.current
            ? seedData
            : await localRepository.load().catch(() => dataRef.current));
        if (!isCurrent()) {
          return;
        }
        const message = `${recoveryPreparationError} Recovered work remains visible in memory, but durable local reconciliation is required.`;
        activeSyncRef.current += 1;
        clearListeners();
        deferredSnapshotRef.current = null;
        repositoryRef.current = localRepository;
        setRepositoryMode("local");
        replaceData(visibleRecovery);
        if (!isolatesSharedLocalDataRef.current) {
          subscribeToRepository(localRepository, isCurrent);
        }
        setMigrationState({
          ...emptyMigrationState,
          phase: "required",
          hasLocalData: true,
          localRecordCounts: countFromDashboard(visibleRecovery),
          markerStatus: localReconciliationMarkerStatus,
          error: message,
          reconciliationRequired: true,
          reconciliationReason: message,
        });
        setLastActionError(message);
        setSyncStatus("error");
        markCurrentDataReady();
        setIsHydrated(true);
        return;
      }

      let localSnapshot: Awaited<ReturnType<typeof createStableMigrationStateSnapshot>>;
      try {
        localSnapshot = await createStableMigrationStateSnapshot();
      } catch (error) {
        markLocalPersistenceDegraded(error);
        let inMemoryLocalData = dataRef.current;
        try {
          inMemoryLocalData = await localRepository.load();
        } catch {
          // Browser persistence can be entirely unavailable. The current-tab
          // projection remains the authoritative local workspace in that case.
        }
        unpersistedLocalProjectionRef.current = inMemoryLocalData;
        const hasInMemoryUserData = !isSeedDashboardData(inMemoryLocalData);
        localSnapshot = {
          hasLocalData: hasInMemoryUserData,
          localRecordCounts: hasInMemoryUserData ? countFromDashboard(inMemoryLocalData) : {},
          localData: inMemoryLocalData,
        };
      }
      const localHasUserData = localSnapshot.hasLocalData;
      const localRecordCounts = localSnapshot.localRecordCounts;

      if (!isCurrent()) {
        return;
      }

      const baseMigrationState: MigrationState = {
        ...emptyMigrationState,
        hasLocalData: localHasUserData,
        localRecordCounts,
        hasCloudData: false,
        phase: recoveryRequiresReconciliation ? "required" : "idle",
        markerStatus: recoveryRequiresReconciliation
          ? legacyRecoveryWorkspaceRef.current
            ? "legacy_recovery_unassigned"
            : localReconciliationMarkerStatus
          : emptyMigrationState.markerStatus,
        error: recoveryRequiresReconciliation ? activeRecoveryReason : null,
        reconciliationRequired: recoveryRequiresReconciliation,
        reconciliationReason: recoveryRequiresReconciliation ? activeRecoveryReason : null,
      };

      let authoritativeLocalData = localSnapshot.localData ?? seedData;
      if (!localSnapshot.localData && !isolatesSharedLocalDataRef.current) {
        try {
          authoritativeLocalData = await localRepository.load();
        } catch (error) {
          markLocalPersistenceDegraded(error);
          authoritativeLocalData = dataRef.current;
          unpersistedLocalProjectionRef.current = authoritativeLocalData;
        }
      }
      if (!isCurrent()) {
        return;
      }
      repositoryRef.current = localRepository;
      setRepositoryMode("local");
      replaceData(authoritativeLocalData);
      setMigrationState(baseMigrationState);
      if (!localPersistenceErrorRef.current) {
        setLastActionError(null);
      }
      markCurrentDataReady();
      setIsHydrated(true);

      if (renderedAuthStatus === "loading") {
        await syncFromActiveLocalState(isCurrent);
        return;
      }

      if (renderedAuthStatus === "unauthenticated" || !authenticatedUid) {
        await syncFromActiveLocalState(isCurrent);
        if (!isCurrent()) {
          return;
        }
        return;
      }

      try {
        const firestoreRepository = await createFirestoreRepository(authenticatedUid);
        if (!isCurrent()) {
          return;
        }
        firestoreRepositoryRef.current = firestoreRepository;
        firestoreRepositoryUidRef.current = authenticatedUid;
        lastCloudRepositoryUidRef.current = authenticatedUid;

        const cloudRecordCounts = await firestoreRepository.getCounts();
        if (!isCurrent()) {
          return;
        }
        const migrationFromCloud = await firestoreRepository.getMigrationState();
        if (!isCurrent()) {
          return;
        }
        const hasCloudData = hasCloudCounts(cloudRecordCounts);
        const latestLocalSnapshot = await createStableMigrationStateSnapshot();
        if (!isCurrent()) {
          return;
        }
        const latestLocalHasUserData = latestLocalSnapshot.hasLocalData;
        const latestLocalRecordCounts = latestLocalSnapshot.localRecordCounts;
        const localReconciliation = getLocalDataReconciliationState();

        if (isCloudReconciliationPending(migrationFromCloud)) {
          const recoveryMessage = latestLocalSnapshot.localData
            ? migrationFromCloud.reconciliationReason
              ?? migrationFromCloud.error
              ?? "Cloud migration is waiting for local reconciliation."
            : "Cloud migration is incomplete and no local recovery payload is available on this device.";
          setMigrationState({
            ...migrationFromCloud,
            hasLocalData: latestLocalHasUserData,
            localRecordCounts: latestLocalRecordCounts,
            cloudRecordCounts,
            hasCloudData,
            phase: "required",
            error: recoveryMessage,
            reconciliationRequired: true,
            reconciliationReason: recoveryMessage,
          });
          setLastActionError(recoveryMessage);
          await syncFromActiveLocalState(isCurrent);
          return;
        }

        if (isCompletedMigration(migrationFromCloud)) {
          const hasUnpersistedLocalProjection = unpersistedLocalProjectionRef.current !== null;
          if (
            latestLocalHasUserData
            && (
              hasUnpersistedLocalProjection
              || isolatesSharedLocalDataRef.current
              || hasUnacknowledgedLocalData(migrationFromCloud.completedAt)
            )
          ) {
            const recoveryReason = legacyRecoveryWorkspaceRef.current
              ? "This recovery predates account scoping. It remains local until you explicitly associate it with this account."
              : isolatesSharedLocalDataRef.current
                ? "Recovered account-scoped work must be reconciled before cloud data becomes active."
                : hasUnpersistedLocalProjection
                  ? localPersistenceErrorRef.current
                    ?? "Current-tab local work has not been durably stored and must be reviewed before cloud data becomes active."
                  : null;
            setMigrationState({
              ...migrationFromCloud,
              hasLocalData: true,
              localRecordCounts: latestLocalRecordCounts,
              cloudRecordCounts,
              hasCloudData,
              phase: "required",
              markerStatus: legacyRecoveryWorkspaceRef.current
                ? "legacy_recovery_unassigned"
                : isolatesSharedLocalDataRef.current || localReconciliation.required
                  ? localReconciliationMarkerStatus
                  : migrationFromCloud.markerStatus,
              error: recoveryReason
                ?? localReconciliation.reason
                ?? "New local changes need review before cloud data becomes active.",
              reconciliationRequired: true,
              reconciliationReason: recoveryReason ?? localReconciliation.reason,
            });
            await syncFromActiveLocalState(isCurrent);
            return;
          }

          const activation = await activateCloudRepository(firestoreRepository, isCurrent);
          if (!isCurrent()) {
            return;
          }

          if (!activation.ok && activation.reason === "local_changed") {
            const changedLocalSnapshot = await createStableMigrationStateSnapshot();
            if (!isCurrent()) {
              return;
            }
            setMigrationState({
              ...migrationFromCloud,
              hasLocalData: changedLocalSnapshot.hasLocalData,
              localRecordCounts: changedLocalSnapshot.localRecordCounts,
              cloudRecordCounts,
              hasCloudData,
              phase: "required",
              error: "Local data changed while cloud synchronization was starting.",
            });
            await syncFromActiveLocalState(isCurrent);
            return;
          }

          if (activation.ok && isCurrent()) {
            const ownerScope = cloudRecoveryScopeForUid(authenticatedUid);
            clearPendingCloudReconciliationActions(ownerScope);
            clearCloudRecoveryDashboardData(ownerScope);
            localReconciliationOwnerScopeRef.current = null;
            legacyRecoveryWorkspaceRef.current = false;
            const usedIsolatedRecovery = isolatesSharedLocalDataRef.current;
            isolatesSharedLocalDataRef.current = false;
            if (!usedIsolatedRecovery) {
              markLocalDataCloudAcknowledged();
            }
          }

          if (!isCurrent()) {
            return;
          }
          setMigrationState({
            ...migrationFromCloud,
            hasLocalData: latestLocalHasUserData,
            localRecordCounts: latestLocalRecordCounts,
            cloudRecordCounts,
            hasCloudData,
            phase: "complete",
            reconciliationRequired: false,
            reconciliationReason: null,
          });
          return;
        }

        if (latestLocalHasUserData && hasCloudData) {
          setMigrationState({
            ...migrationFromCloud,
            hasLocalData: true,
            localRecordCounts: latestLocalRecordCounts,
            cloudRecordCounts,
            hasCloudData: true,
            phase: "required",
          });
          await syncFromActiveLocalState(isCurrent);
          return;
        }

        if (latestLocalHasUserData && !hasCloudData) {
          setMigrationState({
            ...migrationFromCloud,
            hasLocalData: true,
            localRecordCounts: latestLocalRecordCounts,
            cloudRecordCounts,
            hasCloudData: false,
            phase: "required",
          });
          await syncFromActiveLocalState(isCurrent);
          return;
        }

        const activation = await activateCloudRepository(firestoreRepository, isCurrent);
        if (!isCurrent()) {
          return;
        }
        if (!activation.ok && activation.reason === "local_changed") {
          const changedLocalSnapshot = await createStableMigrationStateSnapshot();
          if (!isCurrent()) {
            return;
          }
          setMigrationState({
            ...migrationFromCloud,
            hasLocalData: changedLocalSnapshot.hasLocalData,
            localRecordCounts: changedLocalSnapshot.localRecordCounts,
            cloudRecordCounts,
            hasCloudData,
            phase: "required",
            error: "Local data changed while cloud synchronization was starting.",
          });
          await syncFromActiveLocalState(isCurrent);
          return;
        }
        setMigrationState({
          ...migrationFromCloud,
          hasLocalData: false,
          localRecordCounts: {},
          cloudRecordCounts,
          hasCloudData,
          phase: hasCloudData ? "complete" : "idle",
        });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        const status = normalizeSyncError(error);
        const message = error instanceof Error ? error.message : "Unable to initialize Firestore repository.";
        setMigrationState({
          ...baseMigrationState,
          phase: "error",
          error: message,
        });
        setLastActionError(message);
        await syncFromActiveLocalState(isCurrent);
        if (!isCurrent()) {
          return;
        }
        setSyncStatus(status);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (authGenerationRef.current === generation) {
        authGenerationRef.current += 1;
      }
      activeSyncRef.current += 1;
      firestoreRepositoryRef.current = null;
      firestoreRepositoryUidRef.current = null;
      clearListeners();
      pendingActivities.clear();
    };
  }, [
    renderedAuthStatus,
    authenticatedUid,
    activateCloudRepository,
    clearListeners,
    createStableMigrationStateSnapshot,
    markLocalPersistenceDegraded,
    normalizeSyncError,
    persistCloudRecoveryLocally,
    replaceData,
    seedData,
    subscribeToRepository,
    syncFromActiveLocalState,
  ]);

  const beginMigrationImport = useCallback(
    async (mode?: "import" | "keep-cloud") => {
      const operationIdentity = authIdentityRef.current;
      const callbackUid = renderedAuthStatus === "authenticated" ? renderedAuthUid : null;
      if (renderedAuthStatus !== operationIdentity.status || callbackUid !== operationIdentity.uid) {
        return null;
      }
      const operationUid = operationIdentity.status === "authenticated"
        ? operationIdentity.uid
        : null;
      const operationGeneration = authGenerationRef.current;
      const isCurrentMigration = () => {
        const currentIdentity = authIdentityRef.current;
        return operationUid !== null
          && authGenerationRef.current === operationGeneration
          && currentIdentity.status === "authenticated"
          && currentIdentity.uid === operationUid;
      };

      if (!operationUid) {
        setLastActionError("Sign in to perform migration.");
        return null;
      }

      const ownerScope = cloudRecoveryScopeForUid(operationUid);
      if (legacyRecoveryWorkspaceRef.current) {
        try {
          const claim = claimLegacyCloudRecovery(ownerScope);
          if (!claim.ok) {
            setLastActionError(
              "Legacy recovery could not be associated because an account-scoped recovery already exists. Resolve or export both recovery copies first.",
            );
            return null;
          }
          legacyRecoveryWorkspaceRef.current = false;
          localReconciliationOwnerScopeRef.current = ownerScope;
          isolatesSharedLocalDataRef.current = true;
          const claimedRecovery = loadCloudRecoveryDashboardData(ownerScope);
          if (claimedRecovery) {
            cloudRecoveryProjectionRef.current = claimedRecovery;
            replaceData(claimedRecovery);
          }
        } catch {
          setLastActionError(
            "Legacy recovery could not be associated safely. The original local recovery remains unchanged.",
          );
          return null;
        }
      }

      const existingRepository = firestoreRepositoryUidRef.current === operationUid
        ? firestoreRepositoryRef.current
        : null;
      const firestoreRepository = existingRepository
        ?? (await createFirestoreRepository(operationUid).catch(() => null));
      if (!isCurrentMigration()) {
        return null;
      }
      if (!firestoreRepository) {
        setLastActionError("Unable to initialize Firestore repository.");
        return null;
      }

      firestoreRepositoryRef.current = firestoreRepository;
      firestoreRepositoryUidRef.current = operationUid;
      lastCloudRepositoryUidRef.current = operationUid;
      const clearMigrationRecovery = () => {
        clearPendingCloudReconciliationActions(ownerScope);
        clearCloudRecoveryDashboardData(ownerScope);
      };

      const persistReconciliationRequired = async (
        base: MigrationState,
        message: string,
        localSnapshot?: Awaited<ReturnType<typeof createStableMigrationStateSnapshot>>,
      ) => {
        const snapshot = localSnapshot ?? (await createStableMigrationStateSnapshot());
        if (!isCurrentMigration()) {
          return null;
        }
        const requiredState: MigrationState = {
          ...base,
          phase: "required",
          markerStatus: "reconciliation_required",
          completedAt: null,
          hasLocalData: snapshot.hasLocalData,
          localRecordCounts: snapshot.localRecordCounts,
          error: message,
          reconciliationRequired: true,
          reconciliationReason: message,
        };
        await firestoreRepository.setMigrationState(requiredState);
        if (!isCurrentMigration()) {
          return null;
        }
        if (!isolatesSharedLocalDataRef.current) {
          markLocalDataReconciliationRequired(message, null);
        }
        localReconciliationOwnerScopeRef.current = ownerScope;
        setMigrationState(requiredState);
        setLastActionError(message);
        return requiredState;
      };

      if (mode === "keep-cloud") {
        let pendingState: MigrationState | null = null;
        try {
          const localDataSnapshot = await createStableMigrationStateSnapshot();
          if (!isCurrentMigration()) {
            return null;
          }
          const pendingRecoveryActions = getPendingCloudReconciliationActions(ownerScope);
          if (
            isolatesSharedLocalDataRef.current
            && localDataSnapshot.localData === null
            && pendingRecoveryActions.length > 0
          ) {
            const message =
              "The recovery journal is available, but its full local projection is not. Import the journal into cloud before choosing keep-cloud.";
            setMigrationState((current) => ({
              ...current,
              phase: "required",
              hasLocalData: true,
              markerStatus: "reconciliation_required",
              error: message,
              reconciliationRequired: true,
              reconciliationReason: message,
            }));
            setLastActionError(message);
            return null;
          }
          const migrationRevision = projectionRevisionRef.current;
          const keepCloudData = localDataSnapshot.localData
            ?? (localDataSnapshot.hasLocalData ? await localRepository.exportData() : null);
          if (!isCurrentMigration()) {
            return null;
          }
          const keepCloudBackupKey = localDataSnapshot.hasLocalData
            ? createLocalDashboardBackup({
                data: keepCloudData!,
                sourceDevice: "web-keep-cloud",
              })
            : null;
          if (localDataSnapshot.hasLocalData && !keepCloudBackupKey) {
            throw new Error("Unable to back up local data before keeping cloud data.");
          }
          const cloudRecordCounts = await firestoreRepository.getCounts();
          if (!isCurrentMigration()) {
            return null;
          }
          pendingState = {
            ...emptyMigrationState,
            phase: "running",
            hasLocalData: localDataSnapshot.hasLocalData,
            localRecordCounts: localDataSnapshot.localRecordCounts,
            cloudRecordCounts,
            hasCloudData: true,
            markerStatus: "reconciliation_pending",
            error: null,
            startedAt: nowIso(),
            completedAt: null,
            backupCreated: Boolean(keepCloudBackupKey),
            sourceDevice: "web",
            sourceSchemaVersion: SCHEMA_VERSION,
            migrationVersion: 1,
            localStorageKey: keepCloudBackupKey ?? STORAGE_KEY,
            reconciliationRequired: true,
            reconciliationReason: "Keep-cloud activation is pending.",
          };

          await firestoreRepository.setMigrationState(pendingState);
          if (!isCurrentMigration()) {
            return null;
          }
          if (projectionRevisionRef.current !== migrationRevision) {
            const changedLocalSnapshot = await createStableMigrationStateSnapshot();
            if (!isCurrentMigration()) {
              return null;
            }
            await persistReconciliationRequired(
              pendingState,
              "Local data changed while the migration choice was being saved.",
              changedLocalSnapshot,
            );
            if (!isCurrentMigration()) {
              return null;
            }
            await syncFromActiveLocalState(isCurrentMigration);
            return null;
          }

          const activation = await activateCloudRepository(firestoreRepository, isCurrentMigration);
          if (!isCurrentMigration()) {
            return null;
          }
          if (!activation.ok) {
            const changedLocalSnapshot = await createStableMigrationStateSnapshot();
            if (!isCurrentMigration()) {
              return null;
            }
            await persistReconciliationRequired(
              pendingState,
              activation.reason === "local_changed"
                ? "Local data changed while cloud synchronization was starting."
                : "Cloud data could not be loaded. The keep-cloud choice remains pending locally.",
              changedLocalSnapshot,
            );
            if (!isCurrentMigration()) {
              return null;
            }
            if (activation.reason === "local_changed") {
              await syncFromActiveLocalState(isCurrentMigration);
            }
            return null;
          }

          const finalState: MigrationState = {
            ...pendingState,
            phase: "complete",
            markerStatus: "keep-cloud",
            completedAt: nowIso(),
            error: null,
            reconciliationRequired: false,
            reconciliationReason: null,
          };
          await firestoreRepository.setMigrationState(finalState);
          if (!isCurrentMigration()) {
            return null;
          }
          clearMigrationRecovery();
          localReconciliationOwnerScopeRef.current = null;
          legacyRecoveryWorkspaceRef.current = false;
          const usedIsolatedRecovery = isolatesSharedLocalDataRef.current;
          isolatesSharedLocalDataRef.current = false;
          if (!usedIsolatedRecovery) {
            markLocalDataCloudAcknowledged();
          }
          setMigrationState(finalState);
          return finalState;
        } catch (error) {
          if (!isCurrentMigration()) {
            return null;
          }
          const message = error instanceof Error ? error.message : "Unable to keep cloud data.";
          if (pendingState) {
            try {
              await persistReconciliationRequired(pendingState, message);
              if (!isCurrentMigration()) {
                return null;
              }
              await syncFromActiveLocalState(isCurrentMigration);
            } catch {
              if (!isCurrentMigration()) {
                return null;
              }
              setMigrationState((current) => ({
                ...current,
                phase: "required",
                markerStatus: "reconciliation_required",
                completedAt: null,
                error: message,
                reconciliationRequired: true,
                reconciliationReason: message,
              }));
            }
          } else {
            setMigrationState((current) => ({ ...current, phase: "required", error: message }));
          }
          setLastActionError(message);
          return null;
        }
      }

      const localSnapshot = await createStableMigrationStateSnapshot();
      if (!isCurrentMigration()) {
        return null;
      }
      const migrationRevision = projectionRevisionRef.current;
      const pendingReconciliationActions = getPendingCloudReconciliationActions(ownerScope);
      const isolatedWithoutSnapshot = isolatesSharedLocalDataRef.current
        && localSnapshot.localData === null;
      if (isolatedWithoutSnapshot && pendingReconciliationActions.length === 0) {
        const message =
          "No account-scoped recovery payload is available to import. Export any visible work or explicitly choose keep-cloud; shared local data will not be imported into this account.";
        setMigrationState((current) => ({
          ...current,
          phase: "required",
          markerStatus: "reconciliation_required",
          error: message,
          reconciliationRequired: true,
          reconciliationReason: message,
        }));
        setLastActionError(message);
        return null;
      }
      const journalOnlyRecovery = isolatedWithoutSnapshot
        && pendingReconciliationActions.length > 0;
      const localData = journalOnlyRecovery
        ? null
        : localSnapshot.localData ?? (await localRepository.exportData());
      if (!isCurrentMigration()) {
        return null;
      }
      const backupKey = localData
        ? ensureLocalDashboardBackup({
            data: localData,
            sourceDevice: "web",
          })
        : null;

      let nextState: MigrationState | null = null;
      try {
        if (journalOnlyRecovery) {
          const cloudRecordCounts = await firestoreRepository.getCounts();
          if (!isCurrentMigration()) {
            return null;
          }
          nextState = {
            ...emptyMigrationState,
            phase: "running",
            hasLocalData: true,
            localRecordCounts: localSnapshot.localRecordCounts,
            cloudRecordCounts,
            hasCloudData: hasCloudCounts(cloudRecordCounts),
            markerStatus: "reconciliation_pending",
            error: null,
            startedAt: nowIso(),
            completedAt: null,
            backupCreated: false,
            sourceDevice: "web",
            sourceSchemaVersion: SCHEMA_VERSION,
            migrationVersion: 1,
            localStorageKey: STORAGE_KEY,
            reconciliationRequired: true,
            reconciliationReason: "Recovery journal replay is pending.",
          };
          await firestoreRepository.setMigrationState(nextState);
        } else {
          nextState = await firestoreRepository.importData(localData!);
        }
        if (!isCurrentMigration()) {
          return null;
        }
        if (projectionRevisionRef.current !== migrationRevision) {
          const changedLocalSnapshot = await createStableMigrationStateSnapshot();
          if (!isCurrentMigration()) {
            return null;
          }
          await persistReconciliationRequired(
            nextState,
            "Local data changed while the migration import was running.",
            changedLocalSnapshot,
          );
          if (!isCurrentMigration()) {
            return null;
          }
          await syncFromActiveLocalState(isCurrentMigration);
          return null;
        }

        if (
          !journalOnlyRecovery
          && hasSkippedRecords(nextState.skippedCounts)
          && (
            pendingReconciliationActions.length === 0
            || hasUntrackedLegacyLocalBaseline()
          )
        ) {
          const skippedMessage =
            "Cloud import skipped existing record IDs. Local edits remain unacknowledged until they are reviewed or explicitly kept in cloud.";
          await persistReconciliationRequired(nextState, skippedMessage, localSnapshot);
          if (!isCurrentMigration()) {
            return null;
          }
          await syncFromActiveLocalState(isCurrentMigration);
          return null;
        }

        for (const pending of pendingReconciliationActions) {
          await firestoreRepository.applyAction(
            pending.action,
            pending.activity,
            pending.projectRecency,
            pending.id,
            pending.mutation,
          );
          if (!isCurrentMigration()) {
            return null;
          }
          // A successful replay is durably complete. Removing it immediately
          // prevents an earlier non-idempotent action from running again when a
          // later journal entry fails.
          rememberAcknowledgedCloudMutation(firestoreRepository, pending);
          removePendingCloudReconciliationAction(pending.id);
          forgetUnsettledCloudMutation(firestoreRepository, pending.id);
        }

        if (projectionRevisionRef.current !== migrationRevision) {
          const changedLocalSnapshot = await createStableMigrationStateSnapshot();
          if (!isCurrentMigration()) {
            return null;
          }
          await persistReconciliationRequired(
            nextState,
            "Local data changed while reconciliation actions were being replayed.",
            changedLocalSnapshot,
          );
          if (!isCurrentMigration()) {
            return null;
          }
          await syncFromActiveLocalState(isCurrentMigration);
          return null;
        }

        const activation = await activateCloudRepository(firestoreRepository, isCurrentMigration);
        if (!isCurrentMigration()) {
          return null;
        }
        if (!activation.ok) {
          const changedLocalSnapshot = await createStableMigrationStateSnapshot();
          if (!isCurrentMigration()) {
            return null;
          }
          await persistReconciliationRequired(
            nextState,
            activation.reason === "local_changed"
              ? "Local data changed while cloud synchronization was starting."
              : "Reconciliation writes completed, but cloud data could not be reloaded safely.",
            changedLocalSnapshot,
          );
          if (!isCurrentMigration()) {
            return null;
          }
          if (activation.reason === "local_changed") {
            await syncFromActiveLocalState(isCurrentMigration);
          }
          return null;
        }

        const finalState: MigrationState = {
          ...nextState,
          phase: "complete",
          markerStatus: "import_complete",
          completedAt: nowIso(),
          backupCreated: Boolean(backupKey),
          localStorageKey: backupKey ? backupKey : nextState.localStorageKey,
          error: null,
          reconciliationRequired: false,
          reconciliationReason: null,
        };
        await firestoreRepository.setMigrationState(finalState);
        if (!isCurrentMigration()) {
          return null;
        }
        clearMigrationRecovery();
        localReconciliationOwnerScopeRef.current = null;
        legacyRecoveryWorkspaceRef.current = false;
        const usedIsolatedRecovery = isolatesSharedLocalDataRef.current;
        isolatesSharedLocalDataRef.current = false;
        if (!usedIsolatedRecovery) {
          markLocalDataCloudAcknowledged();
        }
        setMigrationState(finalState);
        return finalState;
      } catch (error) {
        if (!isCurrentMigration()) {
          return null;
        }
        const message = error instanceof Error ? error.message : "Import failed";
        try {
          const persistedProgress = nextState ?? (await firestoreRepository.getMigrationState());
          if (!isCurrentMigration()) {
            return null;
          }
          await persistReconciliationRequired(
            {
              ...persistedProgress,
              backupCreated: Boolean(backupKey),
              localStorageKey: backupKey ? backupKey : persistedProgress.localStorageKey,
            },
            message,
            localSnapshot,
          );
          if (!isCurrentMigration()) {
            return null;
          }
          await syncFromActiveLocalState(isCurrentMigration);
        } catch {
          if (!isCurrentMigration()) {
            return null;
          }
          setMigrationState({
            ...emptyMigrationState,
            phase: "required",
            hasLocalData: localSnapshot.hasLocalData,
            localRecordCounts: localSnapshot.localRecordCounts,
            hasCloudData: false,
            markerStatus: "reconciliation_required",
            error: message,
            sourceSchemaVersion: SCHEMA_VERSION,
            migrationVersion: 1,
            localStorageKey: STORAGE_KEY,
            startedAt: nowIso(),
            completedAt: null,
            backupCreated: Boolean(backupKey),
            reconciliationRequired: true,
            reconciliationReason: message,
          });
          setLastActionError(message);
        }
        return null;
      }
    },
    [
      activateCloudRepository,
      createStableMigrationStateSnapshot,
      forgetUnsettledCloudMutation,
      syncFromActiveLocalState,
      renderedAuthStatus,
      renderedAuthUid,
      rememberAcknowledgedCloudMutation,
      replaceData,
    ],
  );

  const beginMigrationKeepCloud = useCallback(async () => {
    return beginMigrationImport("keep-cloud");
  }, [beginMigrationImport]);

  const exportLocalData = useCallback(async () => {
    if (isolatesSharedLocalDataRef.current) {
      const ownerScope = localReconciliationOwnerScopeRef.current;
      return loadCloudRecoveryDashboardData(ownerScope ?? undefined) ?? dataRef.current;
    }
    return localRepository.exportData();
  }, []);

  const createProject = useCallback(
    async (title: string, purpose: string): Promise<Project> => {
      const now = nowIso();
      const slug = normalizeText(title)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 64) || "project";

      const parsed = projectSchema.parse({
        id: makeId(),
        title: normalizeText(title),
        slug,
        purpose: normalizeText(purpose),
        status: "active",
        currentBranch: "main",
        currentObjective: "",
        currentBlocker: "",
        nextRecommendedTask: "",
        createdAt: now,
        updatedAt: now,
      });

      await applyAction(
        {
          type: "project_upsert",
          payload: parsed,
        },
        {
          projectId: parsed.id,
          type: "project_created",
          summary: `Created project ${parsed.title}`,
          entityType: "project",
          entityId: parsed.id,
          metadata: "manual",
        },
      );
      return parsed;
    },
    [applyAction],
  );

  const updateProject = useCallback(
    (
      id: string,
      updates: Partial<Omit<Project, "id" | "createdAt" | "updatedAt" | "lastWorkedAt">>,
    ) => {
      const current = dataRef.current.projects.find((project) => project.id === id);
      if (!current) {
        setLastActionError("Project not found.");
        return;
      }

      const safeUpdates = Object.fromEntries(
        Object.entries(updates).filter(
          ([key, value]) => value !== undefined && !protectedProjectUpdateFields.has(key),
        ),
      ) as Partial<Omit<Project, "id" | "createdAt" | "updatedAt" | "lastWorkedAt">>;
      projectSchema.parse({ ...current, ...safeUpdates });
      void applyAction({ type: "project_update", payload: { id, updates: safeUpdates } });
    },
    [applyAction],
  );

  const getProjectScratchpad = useCallback(
    (projectId: string): Scratchpad | null => {
      return dataRef.current.scratchpads.find((item) => item.projectId === projectId) ?? null;
    },
    [],
  );

  const addIdea = useCallback(
    (idea: Omit<Idea, "id" | "createdAt" | "updatedAt" | "linkedTaskId" | "convertedAt" | "legacyStatus">): Idea => {
      const now = nowIso();
      const parsed = ideaSchema.parse({
        ...idea,
        id: makeId(),
        linkedTaskId: null,
        convertedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      void applyAction(
        {
          type: "idea_add",
          payload: parsed,
        },
        {
          projectId: parsed.projectId,
          type: "idea_captured",
          summary: `Captured idea: ${parsed.text}`,
          entityType: "idea",
          entityId: parsed.id,
          metadata: parsed.description,
        },
      );

      return parsed;
    },
    [applyAction],
  );

  const updateIdea = useCallback((id: string, updates: Partial<Idea>) => {
    void applyAction({ type: "idea_update", payload: { id, updates } });
  }, [applyAction]);

  const archiveIdea = useCallback((id: string) => {
    void applyAction({ type: "idea_archive", payload: { id } });
  }, [applyAction]);

  const convertIdeaToTask = useCallback(
    (ideaId: string): Task | null => {
      const source = dataRef.current.ideas.find((idea) => idea.id === ideaId);
      if (!source) {
        setLastActionError("Idea not found.");
        return null;
      }
      if (source.linkedTaskId) {
        const existing = dataRef.current.tasks.find((task) =>
          task.id === source.linkedTaskId && task.projectId === source.projectId);
        if (existing) return existing;
        setLastActionError("This idea already points to a task that is not available in the project.");
        return null;
      }

      const now = nowIso();
      const parsedTask = taskSchema.parse({
        id: makeId(),
        projectId: source.projectId,
        title: source.text,
        details: source.description,
        type: "feature",
        status: "ready",
        priority: source.priority,
        blockedReason: "",
        sourceIdeaId: source.id,
        acceptanceCriteria: "",
        implementationNotes: "",
        startedAt: null,
        completedAt: null,
        readyAt: now,
        lastWorkedAt: null,
        totalActiveDurationMs: 0,
        promptRecordIds: [],
        workSessionIds: [],
        recommendedNextStep: "Review the requested change and acceptance criteria with ChatGPT.",
        githubBranch: "",
        githubCommit: "",
        githubPullRequest: "",
        createdAt: now,
        updatedAt: now,
      });

      void applyAction(
        {
          type: "idea_to_task",
          payload: {
            ideaId: source.id,
            taskId: parsedTask.id,
            task: parsedTask,
            convertedAt: now,
          },
        },
        {
          projectId: source.projectId,
          type: "idea_converted",
          summary: `Converted idea to task: ${source.text}`,
          entityType: "task",
          entityId: parsedTask.id,
          metadata: source.id,
          actor: "marwan",
          taskId: parsedTask.id,
        },
      );

      return parsedTask;
    },
    [applyAction],
  );

  const addTask = useCallback(
    (task: NewTaskInput): Task => {
      const now = nowIso();
      const parsed = taskSchema.parse({
        ...task,
        id: makeId(),
        status: normalizeTaskStatus(task.status),
        readyAt: normalizeTaskStatus(task.status) === "ready" ? task.readyAt ?? now : task.readyAt ?? null,
        lastWorkedAt: task.lastWorkedAt ?? null,
        totalActiveDurationMs: 0,
        promptRecordIds: [],
        workSessionIds: [],
        recommendedNextStep: task.recommendedNextStep ?? "",
        githubBranch: task.githubBranch ?? "",
        githubCommit: task.githubCommit ?? "",
        githubPullRequest: task.githubPullRequest ?? "",
        createdAt: now,
        updatedAt: now,
      });
      void applyAction(
        { type: "task_add", payload: parsed },
        {
          projectId: parsed.projectId,
          type: "task_created",
          summary: `Created task: ${parsed.title}`,
          entityType: "task",
          entityId: parsed.id,
          metadata: parsed.details,
          actor: "marwan",
          taskId: parsed.id,
        },
      );
      return parsed;
    },
    [applyAction],
  );

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    void applyAction({ type: "task_update", payload: { id, updates } });
  }, [applyAction]);

  const startTask = useCallback(
    (id: string) => {
      const task = dataRef.current.tasks.find((entry) => entry.id === id);
      if (!task) {
        setLastActionError("Task not found.");
        return;
      }

      void applyAction(
        {
          type: "task_start",
          payload: { id },
        },
        {
          projectId: task.projectId,
          type: "task_started",
          summary: `Started task: ${task.title}`,
          entityType: "task",
          entityId: task.id,
          metadata: "started",
        },
      );
    },
    [applyAction],
  );

  const blockTask = useCallback(
    (id: string, reason: string) => {
      void applyAction({ type: "task_block", payload: { id, reason } });
    },
    [applyAction],
  );

  const completeTask = useCallback(
    (id: string) => {
      const task = dataRef.current.tasks.find((entry) => entry.id === id);
      if (!task) {
        setLastActionError("Task not found.");
        return;
      }

      void applyAction(
        {
          type: "task_complete",
          payload: { id },
        },
        {
          projectId: task.projectId,
          type: "task_completed",
          summary: `Completed task: ${task.title}`,
          entityType: "task",
          entityId: task.id,
          metadata: "completed",
        },
      );
    },
    [applyAction],
  );

  const setTaskStatus = useCallback(
    (id: string, status: Task["status"], blocker?: string) => {
      const task = dataRef.current.tasks.find((entry) => entry.id === id);
      if (!task) {
        setLastActionError("Task not found.");
        return;
      }
      const previous = normalizeTaskStatus(task.status);
      const next = normalizeTaskStatus(status);
      if (next === "blocked" && !blocker?.trim()) {
        setLastActionError("Describe the blocker before marking this task blocked.");
        return;
      }
      const type = next === "completed"
        ? "task_completed"
        : next === "blocked"
          ? "task_blocked"
          : previous === "completed"
            ? "task_reopened"
            : next === "in_progress"
              ? "task_started"
              : "task_status_changed";
      const label = next.replaceAll("_", " ");
      const at = nowIso();
      void applyAction(
        { type: "task_set_status", payload: { id, status: next, blocker, at } },
        {
          projectId: task.projectId,
          type,
          summary: next === "blocked"
            ? `Blocked task: ${task.title}`
            : `${next === "completed" ? "Completed" : previous === "completed" ? "Reopened" : "Moved"} task: ${task.title}${type === "task_status_changed" ? ` to ${label}` : ""}`,
          entityType: "task",
          entityId: task.id,
          metadata: next === "blocked" ? blocker!.trim() : `${previous} -> ${next}`,
          actor: "marwan",
          taskId: task.id,
        },
      );
    },
    [applyAction],
  );

  const addBrainDump = useCallback(
    (
      payload: Omit<BrainDump, "id" | "createdAt" | "updatedAt" | "status" | "convertedEntityType" | "convertedEntityId">,
    ): BrainDump => {
      const now = nowIso();
      const parsed = brainDumpSchema.parse({
        ...payload,
        id: makeId(),
        status: "active",
        convertedEntityType: null,
        convertedEntityId: null,
        createdAt: now,
        updatedAt: now,
      });
      void applyAction({ type: "brain_dump_add", payload: parsed });
      return parsed;
    },
    [applyAction],
  );

  const updateBrainDump = useCallback((id: string, updates: Partial<BrainDump>) => {
    void applyAction({ type: "brain_dump_update", payload: { id, updates } });
  }, [applyAction]);

  const deleteBrainDump = useCallback((id: string) => {
    void applyAction({ type: "brain_dump_delete", payload: { id } });
  }, [applyAction]);

  const convertBrainDumpToIdea = useCallback(
    (id: string) => {
      const entry = dataRef.current.brainDumps.find((item) => item.id === id);
      if (!entry) {
        setLastActionError("Brain dump entry not found.");
        return;
      }

      const created = addIdea({
        projectId: entry.projectId,
        text: entry.text,
        description: "Converted from brain dump",
        status: "ready_for_review",
        priority: "medium",
        source: "other",
        tags: [],
      });

      void applyAction({
        type: "brain_dump_update",
        payload: {
          id,
          updates: {
            status: "converted",
            convertedEntityType: "idea",
            convertedEntityId: created.id,
            updatedAt: nowIso(),
          },
        },
      });
    },
    [addIdea, applyAction],
  );

  const convertBrainDumpToTask = useCallback(
    (id: string) => {
      const entry = dataRef.current.brainDumps.find((item) => item.id === id);
      if (!entry) {
        setLastActionError("Brain dump entry not found.");
        return;
      }

      const created = addTask({
        projectId: entry.projectId,
        title: entry.text.slice(0, 80),
        details: entry.text,
        type: "feature",
        status: "open",
        priority: "medium",
        blockedReason: "",
        sourceIdeaId: null,
        acceptanceCriteria: "",
        implementationNotes: "",
        startedAt: null,
        completedAt: null,
      });

      void applyAction({
        type: "brain_dump_update",
        payload: {
          id,
          updates: {
            status: "converted",
            convertedEntityType: "task",
            convertedEntityId: created.id,
            updatedAt: nowIso(),
          },
        },
      });
    },
    [addTask, applyAction],
  );

  const updateScratchpad = useCallback(
    (projectId: string, markdown: string) => {
      const parsed = scratchpadSchema.parse({
        projectId,
        markdown,
        updatedAt: nowIso(),
      });
      void applyAction({
        type: "scratchpad_update",
        payload: { projectId: parsed.projectId, markdown: parsed.markdown },
      });
    },
    [applyAction],
  );

  const upsertDecision = useCallback(
    (
      decision: Omit<ArchitectureDecision, "id" | "createdAt" | "updatedAt"> & { decidedAt?: string },
    ): ArchitectureDecision => {
      const now = nowIso();
      const parsed = architectureDecisionSchema.parse({
        ...decision,
        id: makeId(),
        decidedAt: decision.decidedAt || now,
        createdAt: now,
        updatedAt: now,
      });
      void applyAction({ type: "architecture_decision_upsert", payload: parsed });
      return parsed;
    },
    [applyAction],
  );

  const updateDecisionStatus = useCallback((id: string, status: ArchitectureDecision["status"]) => {
    void applyAction({
      type: "architecture_decision_update_status",
      payload: { id, status },
    });
  }, [applyAction]);

  const upsertPrompt = useCallback(
    (prompt: NewPromptInput): CodexPrompt => {
      const now = nowIso();
      const taskPrompts = prompt.relatedTaskId
        ? dataRef.current.codexPrompts.filter((entry) => entry.relatedTaskId === prompt.relatedTaskId)
        : [];
      const parsed = codexPromptSchema.parse({
        ...prompt,
        id: makeId(),
        status: prompt.status || "prepared",
        relatedTaskId: prompt.relatedTaskId || null,
        relatedSessionId: prompt.relatedSessionId ?? null,
        source: prompt.source ?? "manual",
        sequenceNumber: prompt.sequenceNumber ?? taskPrompts.length + 1,
        promptSummary: prompt.promptSummary ?? prompt.purpose,
        requestedChange: prompt.requestedChange ?? prompt.purpose,
        createdBy: prompt.createdBy
          ?? (prompt.source === "chatgpt" ? "chatgpt" : prompt.source === "codex" ? "codex" : "marwan"),
        completedWork: prompt.completedWork ?? [],
        unfinishedWork: prompt.unfinishedWork ?? [],
        problemsDiscovered: prompt.problemsDiscovered ?? [],
        decisionsMade: prompt.decisionsMade ?? [],
        filesModified: prompt.filesModified ?? [],
        commits: prompt.commits ?? [],
        branch: prompt.branch ?? "",
        blocker: prompt.blocker ?? "",
        recommendedNextStep: prompt.recommendedNextStep ?? "",
        activeDurationMs: prompt.activeDurationMs ?? 0,
        testResults: prompt.testResults ?? [],
        buildResults: prompt.buildResults ?? [],
        deploymentStatus: prompt.deploymentStatus ?? "",
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
      });
      void applyAction({ type: "prompt_upsert", payload: parsed });
      return parsed;
    },
    [applyAction],
  );

  const markPromptUsed = useCallback(
    (id: string, summary: string) => {
      const prompt = dataRef.current.codexPrompts.find((entry) => entry.id === id);
      if (!prompt) {
        setLastActionError("Prompt not found.");
        return;
      }

      void applyAction(
        {
          type: "prompt_mark_used",
          payload: { id, usedSummary: summary },
        },
        {
          projectId: prompt.projectId,
          type: "prompt_used",
          summary: `Used prompt: ${prompt.title}`,
          entityType: "prompt",
          entityId: id,
          metadata: summary,
        },
      );
    },
    [applyAction],
  );

  const createTaskPromptRecord = useCallback((payload: {
    taskId: string;
    summary: string;
    requestedChange: string;
    prompt?: string;
    source?: CodexPrompt["source"];
    workSessionId?: string | null;
  }): CodexPrompt | null => {
    const task = dataRef.current.tasks.find((entry) => entry.id === payload.taskId);
    if (!task) {
      setLastActionError("Task not found.");
      return null;
    }
    const source = payload.source ?? "chatgpt";
    const record = upsertPrompt({
      projectId: task.projectId,
      title: payload.summary.slice(0, 160),
      purpose: payload.summary,
      prompt: payload.prompt || payload.requestedChange,
      resultSummary: "",
      status: "prepared",
      relatedTaskId: task.id,
      relatedSessionId: payload.workSessionId ?? null,
      source,
      promptSummary: payload.summary,
      requestedChange: payload.requestedChange,
      createdBy: source === "chatgpt" ? "chatgpt" : source === "codex" ? "codex" : "marwan",
    });
    void applyAction(
      { type: "activity_add", payload: buildActivityFromInput({
        projectId: task.projectId,
        type: "prompt_prepared",
        summary: `Prepared prompt ${record.sequenceNumber} for ${task.title}`,
        entityType: "prompt",
        entityId: record.id,
        metadata: payload.summary,
        actor: record.createdBy,
        taskId: task.id,
        promptRecordId: record.id,
        workSessionId: record.relatedSessionId,
      }) },
    );
    return record;
  }, [applyAction, upsertPrompt]);

  const addNote = useCallback(
    (note: Omit<Note, "id" | "createdAt" | "updatedAt">): Note => {
      const now = nowIso();
      const parsed = noteSchema.parse({
        ...note,
        id: makeId(),
        createdAt: now,
        updatedAt: now,
      });
      void applyAction({ type: "note_add", payload: parsed });
      return parsed;
    },
    [applyAction],
  );

  const updateNote = useCallback((id: string, updates: Partial<Note>) => {
    void applyAction({ type: "note_update", payload: { id, updates } });
  }, [applyAction]);

  const addLink = useCallback(
    (link: Omit<ImportantLink, "id" | "createdAt" | "updatedAt">): ImportantLink => {
      const now = nowIso();
      const parsed = importantLinkSchema.parse({
        ...link,
        id: makeId(),
        createdAt: now,
        updatedAt: now,
      });
      void applyAction({ type: "link_add", payload: parsed });
      return parsed;
    },
    [applyAction],
  );

  const updateLink = useCallback((id: string, updates: Partial<ImportantLink>) => {
    void applyAction({ type: "link_update", payload: { id, updates } });
  }, [applyAction]);

  const startSession = useCallback(
    (session: NewSessionInput): DevelopmentSession => {
      const now = nowIso();
      const parsed = developmentSessionSchema.parse({
        ...session,
        id: makeId(),
        startedAt: now,
        endedAt: null,
        status: "active",
        taskId: session.taskId ?? null,
        promptRecordId: session.promptRecordId ?? null,
        source: session.source ?? "manual",
        summary: session.summary || "",
        objective: session.objective,
        tasksWorkedOn: session.tasksWorkedOn || [],
        tasksCompleted: session.tasksCompleted || [],
        ideasAdded: session.ideasAdded || [],
        problemsDiscovered: session.problemsDiscovered || [],
        decisionsMade: session.decisionsMade || [],
        promptsUsed: session.promptsUsed || [],
        filesModified: session.filesModified || [],
        commits: session.commits || [],
        nextStartingPoint: session.nextStartingPoint || "",
        notes: session.notes || "",
        activeStartedAt: now,
        activeDurationMs: session.activeDurationMs ?? 0,
        resumeFromNote: session.resumeFromNote ?? "",
        blocker: session.blocker ?? "",
        nextStep: session.nextStep ?? session.nextStartingPoint ?? "",
        testResults: session.testResults ?? [],
        buildResults: session.buildResults ?? [],
        deploymentStatus: session.deploymentStatus ?? "",
      });

      void applyAction(
        {
          type: "session_start",
          payload: parsed,
        },
        {
          projectId: parsed.projectId,
          type: "session_started",
          summary: `Started session: ${parsed.objective}`,
          entityType: "session",
          entityId: parsed.id,
          metadata: "started",
          actor: parsed.source === "manual" ? "marwan" : parsed.source,
          taskId: parsed.taskId,
          promptRecordId: parsed.promptRecordId,
          workSessionId: parsed.id,
        },
      );
      return parsed;
    },
    [applyAction],
  );

  const endSession = useCallback(
    (id: string, updates: Partial<DevelopmentSession>) => {
      const session = dataRef.current.developmentSessions.find((entry) => entry.id === id);
      if (!session) {
        setLastActionError("Session not found.");
        return;
      }

      const at = nowIso();
      void applyAction(
        {
          type: "session_finish",
          payload: { id, updates, at, status: "completed" },
        },
        {
          projectId: session.projectId,
          type: "session_completed",
          summary: `Completed session: ${session.objective}`,
          entityType: "session",
          entityId: id,
          metadata: "completed",
          actor: session.source === "manual" ? "marwan" : session.source,
          taskId: session.taskId,
          promptRecordId: session.promptRecordId,
          workSessionId: session.id,
        },
      );
    },
    [applyAction],
  );

  const appendSessionNote = useCallback((id: string, note: string) => {
    void applyAction({ type: "session_note_append", payload: { id, note } });
  }, [applyAction]);

  const startTaskWorkSession = useCallback((payload: {
    taskId: string;
    promptRecordId?: string | null;
    source?: DevelopmentSession["source"];
    resumeFromNote?: string;
  }): DevelopmentSession | null => {
    const task = dataRef.current.tasks.find((entry) => entry.id === payload.taskId);
    if (!task) {
      setLastActionError("Task not found.");
      return null;
    }
    const existingActive = dataRef.current.developmentSessions.find((session) =>
      session.taskId === task.id && session.status === "active");
    if (existingActive) return existingActive;
    return startSession({
      projectId: task.projectId,
      taskId: task.id,
      promptRecordId: payload.promptRecordId ?? null,
      source: payload.source ?? "manual",
      objective: task.title,
      summary: "",
      branch: task.githubBranch || undefined,
      completedItems: [],
      unfinishedItems: [],
      currentBlocker: task.blockedReason,
      tasksWorkedOn: [task.id],
      tasksCompleted: [],
      ideasAdded: [],
      problemsDiscovered: [],
      decisionsMade: [],
      promptsUsed: payload.promptRecordId ? [payload.promptRecordId] : [],
      filesModified: [],
      commits: [],
      nextStartingPoint: task.recommendedNextStep,
      notes: "",
      resumeFromNote: payload.resumeFromNote ?? task.recommendedNextStep,
      blocker: task.blockedReason,
      nextStep: task.recommendedNextStep,
    });
  }, [startSession]);

  const pauseTaskWorkSession = useCallback((id: string, nextStep?: string) => {
    const session = dataRef.current.developmentSessions.find((entry) => entry.id === id);
    if (!session) {
      setLastActionError("Work session not found.");
      return;
    }
    const at = nowIso();
    void applyAction(
      { type: "session_pause", payload: { id, at, nextStep } },
      {
        projectId: session.projectId,
        type: "session_paused",
        summary: `Paused work on ${session.objective}`,
        entityType: "session",
        entityId: session.id,
        metadata: nextStep ?? session.nextStep,
        actor: session.source === "manual" ? "marwan" : session.source,
        taskId: session.taskId,
        promptRecordId: session.promptRecordId,
        workSessionId: session.id,
      },
    );
  }, [applyAction]);

  const resumeTaskWorkSession = useCallback((id: string, resumeFromNote?: string) => {
    const session = dataRef.current.developmentSessions.find((entry) => entry.id === id);
    if (!session) {
      setLastActionError("Work session not found.");
      return;
    }
    const at = nowIso();
    void applyAction(
      { type: "session_resume", payload: { id, at, resumeFromNote } },
      {
        projectId: session.projectId,
        type: "session_resumed",
        summary: `Resumed work on ${session.objective}`,
        entityType: "session",
        entityId: session.id,
        metadata: resumeFromNote ?? session.resumeFromNote,
        actor: session.source === "manual" ? "marwan" : session.source,
        taskId: session.taskId,
        promptRecordId: session.promptRecordId,
        workSessionId: session.id,
      },
    );
  }, [applyAction]);

  const finishTaskWorkSession = useCallback((
    id: string,
    updates: Partial<DevelopmentSession> = {},
    status: "completed" | "abandoned" = "completed",
  ) => {
    const session = dataRef.current.developmentSessions.find((entry) => entry.id === id);
    if (!session) {
      setLastActionError("Work session not found.");
      return;
    }
    const at = nowIso();
    void applyAction(
      { type: "session_finish", payload: { id, at, status, updates } },
      {
        projectId: session.projectId,
        type: "session_completed",
        summary: `${status === "abandoned" ? "Stopped" : "Finished"} work on ${session.objective}`,
        entityType: "session",
        entityId: session.id,
        metadata: updates.summary ?? session.summary,
        actor: session.source === "manual" ? "marwan" : session.source,
        taskId: session.taskId,
        promptRecordId: session.promptRecordId,
        workSessionId: session.id,
      },
    );
  }, [applyAction]);

  const correctTaskWorkSession = useCallback((id: string, activeDurationMs: number) => {
    const session = dataRef.current.developmentSessions.find((entry) => entry.id === id);
    if (!session || !Number.isSafeInteger(activeDurationMs) || activeDurationMs < 0) {
      setLastActionError("Enter a valid corrected active duration.");
      return;
    }
    const at = nowIso();
    void applyAction(
      { type: "session_correct", payload: { id, activeDurationMs, at } },
      {
        projectId: session.projectId,
        type: "session_corrected",
        summary: `Corrected active time for ${session.objective}`,
        entityType: "session",
        entityId: session.id,
        metadata: "Manual time correction recorded.",
        actor: "marwan",
        taskId: session.taskId,
        promptRecordId: session.promptRecordId,
        workSessionId: session.id,
      },
    );
  }, [applyAction]);

  const runQuickCapture = useCallback(
    async (
      payload: { projectId: string; text: string; classification: CaptureClassification },
    ): Promise<MutationResult> => {
      const validation = quickCaptureSchema.safeParse(payload);
      if (!validation.success) {
        const error = validation.error.issues[0]?.message ?? "Quick capture is invalid.";
        setLastActionError(error);
        return { ok: false, error };
      }

      const parsed = validation.data;
      const text = parsed.text;
      if (!text.trim()) {
        const error = "Quick capture requires text.";
        setLastActionError(error);
        return { ok: false, error };
      }
      if (!dataRef.current.projects.some((project) => project.id === parsed.projectId)) {
        const error = "Choose an available project before saving the capture.";
        setLastActionError(error);
        return { ok: false, error };
      }

      try {
        if (parsed.classification === "idea") {
          const now = nowIso();
          const idea = ideaSchema.parse({
            id: makeId(),
            projectId: parsed.projectId,
            text,
            description: "",
            status: "inbox",
            priority: "medium",
            source: "other",
            tags: [],
            linkedTaskId: null,
            createdAt: now,
            updatedAt: now,
          });
          return await applyAction(
            { type: "idea_add", payload: idea },
            {
              projectId: idea.projectId,
              type: "idea_captured",
              summary: `Captured idea: ${idea.text}`,
              entityType: "idea",
              entityId: idea.id,
              metadata: idea.description,
            },
          );
        }

        if (parsed.classification === "brain_dump") {
          const now = nowIso();
          const brainDump = brainDumpSchema.parse({
            id: makeId(),
            projectId: parsed.projectId,
            text,
            status: "active",
            convertedEntityType: null,
            convertedEntityId: null,
            createdAt: now,
            updatedAt: now,
          });
          return await applyAction({ type: "brain_dump_add", payload: brainDump });
        }

        if (parsed.classification === "scratchpad") {
          const existing = dataRef.current.scratchpads.find(
            (item) => item.projectId === parsed.projectId,
          );
          const nextMarkdown = existing?.markdown ? `${existing.markdown}\n\n${text}` : text;
          const scratchpad = scratchpadSchema.parse({
            projectId: parsed.projectId,
            markdown: nextMarkdown,
            updatedAt: nowIso(),
          });
          return await applyAction({
            type: "scratchpad_update",
            payload: { projectId: scratchpad.projectId, markdown: scratchpad.markdown },
          });
        }

        if (parsed.classification === "task" || parsed.classification === "bug") {
          const now = nowIso();
          const task = taskSchema.parse({
            id: makeId(),
            projectId: parsed.projectId,
            title: text,
            details: "",
            type: parsed.classification === "bug" ? "bug" : "feature",
            status: "open",
            priority: "medium",
            blockedReason: "",
            sourceIdeaId: null,
            acceptanceCriteria: "",
            implementationNotes: "",
            startedAt: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          });
          return await applyAction({ type: "task_add", payload: task });
        }

        const now = nowIso();
        const note = noteSchema.parse({
          id: makeId(),
          projectId: parsed.projectId,
          title: text.slice(0, 80) || "Quick note",
          section: "capture",
          tags: [],
          markdown: text,
          createdAt: now,
          updatedAt: now,
        });
        return await applyAction({ type: "note_add", payload: note });
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : "Quick capture could not be saved.";
        setLastActionError(error);
        return { ok: false, error };
      }
    },
    [applyAction],
  );

  const renderedAuthenticatedUid = renderedAuthStatus === "authenticated" ? renderedAuthUid : null;
  const currentDataIsReady = activeDataIdentity.ready
    && activeDataIdentity.status === renderedAuthStatus
    && activeDataIdentity.uid === renderedAuthenticatedUid;
  const visibleData = currentDataIsReady ? data : seedData;
  const visibleRepositoryMode = currentDataIsReady ? repositoryMode : "local";
  const visibleLocalPersistenceStatus = currentDataIsReady ? localPersistenceStatus : "durable";
  const visibleLocalPersistenceError = currentDataIsReady ? localPersistenceError : null;
  const visibleLastActionError = currentDataIsReady ? lastActionError : null;
  const visibleSyncStatus = currentDataIsReady ? syncStatus : "loading";
  const visibleMigrationState = currentDataIsReady ? migrationState : emptyMigrationState;

  const search = useCallback(
    (query: string) => searchDashboard(visibleData, query),
    [visibleData],
  );

  const contextValue = useMemo<DashboardContextValue>(
    () => ({
      data: visibleData,
      repositoryMode: visibleRepositoryMode,
      localPersistenceStatus: visibleLocalPersistenceStatus,
      localPersistenceError: visibleLocalPersistenceError,
      isMutationReady: currentDataIsReady,
      lastActionError: visibleLastActionError,
      clearLastActionError,
      syncStatus: visibleSyncStatus,
      migrationState: visibleMigrationState,
      beginMigrationImport,
      beginMigrationKeepCloud,
      exportLocalData,

      createProject,
      updateProject,
      runQuickCapture,

      addIdea,
      updateIdea,
      archiveIdea,
      convertIdeaToTask,

      addTask,
      updateTask,
      startTask,
      blockTask,
      completeTask,
      setTaskStatus,

      addBrainDump,
      updateBrainDump,
      deleteBrainDump,
      convertBrainDumpToIdea,
      convertBrainDumpToTask,

      updateScratchpad,
      getProjectScratchpad,

      upsertDecision,
      updateDecisionStatus,

      upsertPrompt,
      markPromptUsed,
      createTaskPromptRecord,

      addNote,
      updateNote,

      addLink,
      updateLink,

      startSession,
      endSession,
      appendSessionNote,
      startTaskWorkSession,
      pauseTaskWorkSession,
      resumeTaskWorkSession,
      finishTaskWorkSession,
      correctTaskWorkSession,

      search,
    }),
    [
      visibleData,
      visibleRepositoryMode,
      visibleLocalPersistenceStatus,
      visibleLocalPersistenceError,
      currentDataIsReady,
      visibleLastActionError,
      visibleSyncStatus,
      visibleMigrationState,
      beginMigrationImport,
      beginMigrationKeepCloud,
      exportLocalData,
      clearLastActionError,
      createProject,
      updateProject,
      runQuickCapture,
      addIdea,
      updateIdea,
      archiveIdea,
      convertIdeaToTask,
      addTask,
      updateTask,
      startTask,
      blockTask,
      completeTask,
      setTaskStatus,
      addBrainDump,
      updateBrainDump,
      deleteBrainDump,
      convertBrainDumpToIdea,
      convertBrainDumpToTask,
      updateScratchpad,
      getProjectScratchpad,
      upsertDecision,
      updateDecisionStatus,
      upsertPrompt,
      markPromptUsed,
      createTaskPromptRecord,
      addNote,
      updateNote,
      addLink,
      updateLink,
      startSession,
      endSession,
      appendSessionNote,
      startTaskWorkSession,
      pauseTaskWorkSession,
      resumeTaskWorkSession,
      finishTaskWorkSession,
      correctTaskWorkSession,
      search,
    ],
  );

  if (!isHydrated) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600" role="status" aria-live="polite">
        Loading dashboard data...
      </section>
    );
  }

  return <DashboardContext.Provider value={contextValue}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }

  return context;
}
