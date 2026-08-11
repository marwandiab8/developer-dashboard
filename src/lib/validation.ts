import { z } from "zod";
import {
  GITHUB_LAST_WORKED_AT_SOURCES,
  GITHUB_REPOSITORY_VISIBILITIES,
  ActivityType,
  IdeaPriority,
  IdeaSource,
  IdeaStatus,
  BrainDumpStatus,
  ManualProjectStatus,
  ExternalActivityStatus,
  ExternalAssociationStatus,
  ExternalSourceType,
  TaskStatus,
  TaskType,
  ProjectStatus,
  PromptStatus,
  DecisionStatus,
  SessionStatus,
  CaptureClassification,
} from "./models";

const externalSourceTypeSchema = z.enum(["github"] as const satisfies readonly ExternalSourceType[]);
const externalSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) => [...value].every((character) => character >= " " && character !== "\u007f"),
    "Invalid external session ID",
  );
const externalAssociationStatusSchema = z.enum([
  "unknown",
  "not_detected",
  "detected",
  "confirmed",
  "removed",
] as const satisfies readonly ExternalAssociationStatus[]);
const manualProjectStatusSchema = z.enum([
  "planning",
  "active",
  "paused",
  "blocked",
  "completed",
  "archived",
] as const satisfies readonly ManualProjectStatus[]);
const externalActivityStatusSchema = z.enum([
  "active_recently",
  "quiet",
  "stale",
  "never_committed",
  "unavailable",
] as const satisfies readonly ExternalActivityStatus[]);
export const externalSourceAssociationSchema = z.object({
  status: externalAssociationStatusSchema,
  evidence: z.string(),
  detectedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().optional(),
});

export const externalProjectSourceGithubSchema = z.object({
  sourceType: externalSourceTypeSchema,
  externalRepositoryId: z.string(),
  ownerLogin: z.string(),
  repositoryName: z.string(),
  repositoryFullName: z.string(),
  repositoryUrl: z.string().url(),
  defaultBranch: z.string(),
  visibility: z.enum(GITHUB_REPOSITORY_VISIBILITIES),
  isArchived: z.boolean(),
  isFork: z.boolean(),
  description: z.string(),
  primaryLanguage: z.string(),
  topics: z.array(z.string()),
  createdDate: z.string().datetime(),
  updatedDate: z.string().datetime(),
  pushedDate: z.string().datetime(),
  latestKnownPersonalCommitDate: z.string().datetime().nullable(),
  latestKnownPersonalCommitMessage: z.string().nullable(),
  lastWorkedAt: z.string().datetime(),
  lastWorkedAtSource: z.enum(GITHUB_LAST_WORKED_AT_SOURCES),
  openIssueCount: z.number().int().min(0).nullable(),
  openPullRequestCount: z.number().int().min(0).nullable(),
  synchronizationTimestamp: z.string().datetime(),
  synchronizationStatus: z.enum(["success", "failed", "unavailable"]),
  sourceError: z.string().nullable().optional(),
  firebaseAssociation: externalSourceAssociationSchema,
});

export const externalSourcesSchema = z.object({
  github: externalProjectSourceGithubSchema.optional(),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  slug: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(["active", "on_hold", "completed", "archived"] as const satisfies readonly ProjectStatus[]),
  manualStatus: manualProjectStatusSchema.optional(),
  currentBranch: z.string(),
  currentObjective: z.string(),
  currentBlocker: z.string(),
  nextRecommendedTask: z.string(),
  externalSources: externalSourcesSchema.optional(),
  externalActivityStatus: externalActivityStatusSchema.optional(),
  externalActivityUpdatedAt: z.string().datetime().optional(),
  lastWorkedAt: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ideaSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  text: z.string().min(1),
  description: z.string(),
  status: z.enum(["inbox", "reviewed", "accepted", "rejected", "converted", "archived"] as const satisfies readonly IdeaStatus[]),
  priority: z.enum(["low", "medium", "high", "critical"] as const satisfies readonly IdeaPriority[]),
  source: z.enum(["phone", "ipad", "desktop", "ChatGPT", "Codex", "voice", "other"] as const satisfies readonly IdeaSource[]),
  externalSessionId: externalSessionIdSchema.optional(),
  tags: z.array(z.string()),
  linkedTaskId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const taskSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  details: z.string(),
  type: z.enum(["feature", "improvement", "bug", "research", "maintenance", "documentation"] as const satisfies readonly TaskType[]),
  status: z.enum(["backlog", "ready", "in_progress", "blocked", "testing", "completed", "cancelled"] as const satisfies readonly TaskStatus[]),
  priority: z.enum(["low", "medium", "high", "critical"] as const satisfies readonly IdeaPriority[]),
  blockedReason: z.string(),
  sourceIdeaId: z.string().uuid().nullable(),
  acceptanceCriteria: z.string(),
  implementationNotes: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export const brainDumpSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  text: z.string().min(1),
  status: z.enum(["active", "converted", "archived"] as const satisfies readonly BrainDumpStatus[]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  convertedEntityType: z.enum(["idea", "task"]).nullable(),
  convertedEntityId: z.string().uuid().nullable(),
});

export const scratchpadSchema = z.object({
  projectId: z.string().uuid(),
  markdown: z.string(),
  updatedAt: z.string().datetime(),
});

export const architectureDecisionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  context: z.string(),
  decision: z.string(),
  alternatives: z.string(),
  consequences: z.string(),
  status: z.enum(["proposed", "accepted", "replaced", "deferred", "rejected"] as const satisfies readonly DecisionStatus[]),
  decidedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const codexPromptSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  purpose: z.string(),
  prompt: z.string().min(1),
  resultSummary: z.string(),
  status: z.enum(["draft", "ready", "used", "archived"] as const satisfies readonly PromptStatus[]),
  relatedTaskId: z.string().uuid().nullable(),
  relatedSessionId: z.string().uuid().nullable().optional(),
  source: z.literal("codex").optional(),
  externalSessionId: externalSessionIdSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});

export const noteSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  section: z.string(),
  tags: z.array(z.string()),
  markdown: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const importantLinkSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  url: z.string().url(),
  notes: z.string(),
  section: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const developmentSessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  objective: z.string(),
  summary: z.string(),
  source: z.literal("codex").optional(),
  externalSessionId: externalSessionIdSchema.optional(),
  branch: z.string().trim().min(1).max(512).optional(),
  completedItems: z.array(z.string()).max(100).optional(),
  unfinishedItems: z.array(z.string()).max(100).optional(),
  currentBlocker: z.string().optional(),
  tasksWorkedOn: z.array(z.string().uuid()),
  tasksCompleted: z.array(z.string().uuid()),
  ideasAdded: z.array(z.string().uuid()),
  problemsDiscovered: z.array(z.string()),
  decisionsMade: z.array(z.string()),
  promptsUsed: z.array(z.string()),
  filesModified: z.array(z.string()),
  commits: z.array(z.string()),
  nextStartingPoint: z.string(),
  status: z.enum(["active", "completed"] as const satisfies readonly SessionStatus[]),
  notes: z.string(),
});

export const activityEventSchema = z.object({
  id: z.union([
    z.string().uuid(),
    z.string().regex(/^github-[a-f0-9]{32}$/, "Invalid legacy GitHub activity ID"),
  ]),
  projectId: z.string().uuid(),
  type: z.enum(["project_created", "idea_captured", "idea_converted", "task_started", "task_completed", "decision_accepted", "prompt_used", "session_started", "session_completed", "resume_generated", "ai_context_generated", "github_repository_imported", "github_repository_updated", "github_repository_unavailable"] as const satisfies readonly ActivityType[]),
  summary: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  metadata: z.string(),
  source: z.literal("codex").optional(),
  externalSessionId: externalSessionIdSchema.optional(),
  createdAt: z.string().datetime(),
});

export const quickCaptureSchema = z.object({
  projectId: z.string().uuid(),
  text: z.string().min(1),
  classification: z.enum([
    "idea",
    "brain_dump",
    "scratchpad",
    "task",
    "bug",
    "note",
  ] as const satisfies readonly CaptureClassification[]),
});

export const dashboardDataSchema = z.object({
  schemaVersion: z.number(),
  projects: z.array(projectSchema),
  ideas: z.array(ideaSchema),
  tasks: z.array(taskSchema),
  brainDumps: z.array(brainDumpSchema),
  scratchpads: z.array(scratchpadSchema),
  architectureDecisions: z.array(architectureDecisionSchema),
  codexPrompts: z.array(codexPromptSchema),
  notes: z.array(noteSchema),
  importantLinks: z.array(importantLinkSchema),
  developmentSessions: z.array(developmentSessionSchema),
  activities: z.array(activityEventSchema),
});
