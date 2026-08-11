export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";

export type IdeaStatus = "inbox" | "reviewed" | "accepted" | "rejected" | "converted" | "archived";
export type IdeaSource = "phone" | "ipad" | "desktop" | "ChatGPT" | "Codex" | "voice" | "other";
export type IdeaPriority = "low" | "medium" | "high" | "critical";

export type TaskStatus = "backlog" | "ready" | "in_progress" | "blocked" | "testing" | "completed" | "cancelled";
export type TaskType = "feature" | "improvement" | "bug" | "research" | "maintenance" | "documentation";

export type DecisionStatus = "proposed" | "accepted" | "replaced" | "deferred" | "rejected";
export type PromptStatus = "draft" | "ready" | "used" | "archived";
export type BrainDumpStatus = "active" | "converted" | "archived";
export type SessionStatus = "active" | "completed";
export type ManualProjectStatus = "planning" | "active" | "paused" | "blocked" | "completed" | "archived";
export type ExternalActivityStatus = "active_recently" | "quiet" | "stale" | "never_committed" | "unavailable";
export type ExternalSyncStatus = "success" | "failed" | "unavailable";
export type ExternalSourceType = "github";
export type ExternalAssociationStatus = "unknown" | "not_detected" | "detected" | "confirmed" | "removed";
export const GITHUB_REPOSITORY_VISIBILITIES = ["public", "private", "internal"] as const;
export type GithubRepositoryVisibility = (typeof GITHUB_REPOSITORY_VISIBILITIES)[number];
export const GITHUB_LAST_WORKED_AT_SOURCES = [
  "personal_commit",
  "repository_pushed",
  "repository_updated",
] as const;
export type GithubLastWorkedAtSource = (typeof GITHUB_LAST_WORKED_AT_SOURCES)[number];

export type ActivityType =
  | "project_created"
  | "idea_captured"
  | "idea_converted"
  | "task_started"
  | "task_completed"
  | "decision_accepted"
  | "prompt_used"
  | "session_started"
  | "session_completed"
  | "resume_generated"
  | "ai_context_generated"
  | "github_repository_imported"
  | "github_repository_updated"
  | "github_repository_unavailable";

export type CaptureClassification =
  | "idea"
  | "brain_dump"
  | "scratchpad"
  | "task"
  | "bug"
  | "note";

export interface ExternalSourceAssociation {
  status: ExternalAssociationStatus;
  evidence: string;
  detectedAt: string;
  confirmedAt?: string;
}

export interface ExternalProjectSourceGithub {
  sourceType: ExternalSourceType;
  externalRepositoryId: string;
  ownerLogin: string;
  repositoryName: string;
  repositoryFullName: string;
  repositoryUrl: string;
  defaultBranch: string;
  visibility: GithubRepositoryVisibility;
  isArchived: boolean;
  isFork: boolean;
  description: string;
  primaryLanguage: string;
  topics: string[];
  createdDate: string;
  updatedDate: string;
  pushedDate: string;
  latestKnownPersonalCommitDate: string | null;
  latestKnownPersonalCommitMessage: string | null;
  lastWorkedAt: string;
  lastWorkedAtSource: GithubLastWorkedAtSource;
  openIssueCount: number | null;
  openPullRequestCount: number | null;
  synchronizationTimestamp: string;
  synchronizationStatus: ExternalSyncStatus;
  sourceError?: string | null;
  firebaseAssociation: ExternalSourceAssociation;
}

export interface ProjectExternalSources {
  github?: ExternalProjectSourceGithub;
}

export interface Project {
  id: string;
  title: string;
  slug: string;
  purpose: string;
  status: ProjectStatus;
  manualStatus?: ManualProjectStatus;
  currentBranch: string;
  currentObjective: string;
  currentBlocker: string;
  nextRecommendedTask: string;
  externalSources?: ProjectExternalSources;
  externalActivityStatus?: ExternalActivityStatus;
  externalActivityUpdatedAt?: string;
  lastWorkedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Idea {
  id: string;
  projectId: string;
  text: string;
  description: string;
  status: IdeaStatus;
  priority: IdeaPriority;
  source: IdeaSource;
  externalSessionId?: string;
  tags: string[];
  linkedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  details: string;
  type: TaskType;
  status: TaskStatus;
  priority: IdeaPriority;
  blockedReason: string;
  sourceIdeaId: string | null;
  acceptanceCriteria: string;
  implementationNotes: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface BrainDump {
  id: string;
  projectId: string;
  text: string;
  status: BrainDumpStatus;
  createdAt: string;
  updatedAt: string;
  convertedEntityType: "idea" | "task" | null;
  convertedEntityId: string | null;
}

export interface Scratchpad {
  projectId: string;
  markdown: string;
  updatedAt: string;
}

export interface ArchitectureDecision {
  id: string;
  projectId: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
  status: DecisionStatus;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodexPrompt {
  id: string;
  projectId: string;
  title: string;
  purpose: string;
  prompt: string;
  resultSummary: string;
  status: PromptStatus;
  relatedTaskId: string | null;
  relatedSessionId?: string | null;
  source?: "codex";
  externalSessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface Note {
  id: string;
  projectId: string;
  title: string;
  section: string;
  tags: string[];
  markdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportantLink {
  id: string;
  projectId: string;
  title: string;
  url: string;
  notes: string;
  section: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DevelopmentSession {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  objective: string;
  summary: string;
  source?: "codex";
  externalSessionId?: string;
  branch?: string;
  completedItems?: string[];
  unfinishedItems?: string[];
  currentBlocker?: string;
  tasksWorkedOn: string[];
  tasksCompleted: string[];
  ideasAdded: string[];
  problemsDiscovered: string[];
  decisionsMade: string[];
  promptsUsed: string[];
  filesModified: string[];
  commits: string[];
  nextStartingPoint: string;
  status: SessionStatus;
  notes: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  type: ActivityType;
  summary: string;
  entityType: string;
  entityId: string;
  metadata: string;
  source?: "codex";
  externalSessionId?: string;
  createdAt: string;
}

export interface DashboardData {
  schemaVersion: number;
  projects: Project[];
  ideas: Idea[];
  tasks: Task[];
  brainDumps: BrainDump[];
  scratchpads: Scratchpad[];
  architectureDecisions: ArchitectureDecision[];
  codexPrompts: CodexPrompt[];
  notes: Note[];
  importantLinks: ImportantLink[];
  developmentSessions: DevelopmentSession[];
  activities: ActivityEvent[];
}

export interface NewProjectInput {
  title: string;
  purpose: string;
}

export interface QuickCapturePayload {
  projectId: string;
  text: string;
  classification: CaptureClassification;
}
