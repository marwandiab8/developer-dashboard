import {
  ActivityEvent,
  ArchitectureDecision,
  BrainDump,
  CodexPrompt,
  DashboardData,
  DecisionStatus,
  DevelopmentSession,
  Idea,
  ImportantLink,
  Note,
  Project,
  Task,
} from "../models";

export type DashboardAction =
  | { type: "seed"; payload: DashboardData }
  | { type: "project_upsert"; payload: Project }
  | {
      type: "project_update";
      payload: {
        id: string;
        updates: Partial<Omit<Project, "id" | "createdAt" | "updatedAt" | "lastWorkedAt">>;
      };
    }
  | { type: "idea_add"; payload: Idea }
  | { type: "idea_update"; payload: { id: string; updates: Partial<Idea> } }
  | { type: "idea_archive"; payload: { id: string } }
  | { type: "idea_to_task"; payload: { ideaId: string; taskId: string; task: Task } }
  | { type: "task_add"; payload: Task }
  | { type: "task_update"; payload: { id: string; updates: Partial<Task> } }
  | { type: "task_start"; payload: { id: string } }
  | { type: "task_block"; payload: { id: string; reason: string } }
  | { type: "task_complete"; payload: { id: string } }
  | { type: "brain_dump_add"; payload: BrainDump }
  | { type: "brain_dump_update"; payload: { id: string; updates: Partial<BrainDump> } }
  | { type: "brain_dump_delete"; payload: { id: string } }
  | { type: "scratchpad_update"; payload: { projectId: string; markdown: string } }
  | { type: "architecture_decision_upsert"; payload: ArchitectureDecision }
  | { type: "architecture_decision_update_status"; payload: { id: string; status: DecisionStatus } }
  | { type: "prompt_upsert"; payload: CodexPrompt }
  | { type: "prompt_mark_used"; payload: { id: string; usedSummary: string } }
  | { type: "note_add"; payload: Note }
  | { type: "note_update"; payload: { id: string; updates: Partial<Note> } }
  | { type: "link_add"; payload: ImportantLink }
  | { type: "link_update"; payload: { id: string; updates: Partial<ImportantLink> } }
  | { type: "session_start"; payload: DevelopmentSession }
  | { type: "session_end"; payload: { id: string; updates: Partial<DevelopmentSession> } }
  | { type: "session_note_append"; payload: { id: string; note: string } }
  | { type: "activity_add"; payload: ActivityEvent };

export type SearchResult = {
  projectId: string;
  projectName: string;
  entityType:
    | "project"
    | "idea"
    | "task"
    | "note"
    | "architecture_decision"
    | "codex_prompt"
    | "brain_dump"
    | "session"
    | "link";
  entityId: string;
  text: string;
  meta?: string;
};

export type DashboardSyncStatus = "loading" | "synced" | "saving" | "offline" | "error";

export type MutationResult =
  | { ok: true }
  | { ok: false; error: string };

export type MigrationPhase = "idle" | "required" | "running" | "complete" | "error";

export interface MigrationState {
  phase: MigrationPhase;
  hasLocalData: boolean;
  hasCloudData: boolean;
  localRecordCounts: Record<string, number>;
  cloudRecordCounts: Record<string, number>;
  importedCounts?: Record<string, number>;
  skippedCounts?: Record<string, number>;
  sourceSchemaVersion?: number;
  migrationVersion?: number;
  markerStatus: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  backupCreated?: boolean;
  sourceDevice?: string;
  localStorageKey?: string;
  reconciliationRequired?: boolean;
  reconciliationReason?: string | null;
  version: number;
}

export interface ProjectRecencyTouch {
  projectId: string;
  updatedAt: string;
  lastWorkedAt: string;
}

export type CloudMutationCollection =
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

export interface CloudMutationFieldState {
  present: boolean;
  value?: unknown;
}

export interface CloudMutationFieldExpectation {
  field: string;
  before: CloudMutationFieldState;
  after: CloudMutationFieldState;
}

export interface CloudMutationDocumentExpectation {
  collection: CloudMutationCollection;
  documentId: string;
  beforeExists: boolean;
  afterExists: boolean;
  fields: CloudMutationFieldExpectation[];
}

/**
 * Durable compare-and-set information for one optimistic Dashboard action.
 * It is written to the device-local recovery journal before cloud I/O starts.
 */
export interface CloudMutationContract {
  version: 1;
  fingerprint: string;
  documents: CloudMutationDocumentExpectation[];
}

export interface PendingCloudReconciliationAction {
  id: string;
  ownerScope?: string;
  action: DashboardAction;
  activity?: ActivityEvent;
  projectRecency?: ProjectRecencyTouch;
  mutation?: CloudMutationContract;
  recordedAt: string;
}

export interface DashboardRepository {
  load: () => Promise<DashboardData>;
  save: (data: DashboardData) => Promise<void>;
  applyAction: (
    action: DashboardAction,
    activity?: ActivityEvent,
    projectRecency?: ProjectRecencyTouch,
    operationId?: string,
    mutation?: CloudMutationContract,
  ) => Promise<void>;
  subscribe: (onChange: (data: DashboardData) => void, onError?: (error: unknown) => void) => () => void;
  hasData: () => Promise<boolean>;
  getCounts: () => Promise<Record<string, number>>;
  getMigrationState: () => Promise<MigrationState>;
  setMigrationState: (next: MigrationState) => Promise<void>;
  importData: (data: DashboardData) => Promise<MigrationState>;
  exportData: () => Promise<DashboardData>;
}
