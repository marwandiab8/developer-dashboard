import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  GITHUB_LAST_WORKED_AT_SOURCES,
  GITHUB_REPOSITORY_VISIBILITIES,
  type DashboardData,
  type ExternalAssociationStatus,
  type ExternalProjectSourceGithub,
  type ExternalSourceAssociation,
  type Project,
} from "../models";
import { GITHUB_ACTIVITY_DAYS } from "../constants";
import { nowIso } from "../utils/time";

type ExternalActivityStatus = "active_recently" | "quiet" | "stale" | "never_committed" | "unavailable";

const datetimeString = z.string().datetime();
const datetimeOrNull = z.string().datetime().nullable();

export const githubRepositorySourceInputSchema = z.object({
  sourceType: z.literal("github"),
  externalRepositoryId: z.string().regex(/^\d+$/),
  ownerLogin: z.string().min(1),
  repositoryName: z.string().min(1),
  repositoryFullName: z.string().min(1),
  repositoryUrl: z.string().url(),
  defaultBranch: z.string().min(1),
  visibility: z.enum(GITHUB_REPOSITORY_VISIBILITIES),
  isArchived: z.boolean(),
  isFork: z.boolean(),
  description: z.string(),
  primaryLanguage: z.string(),
  topics: z.array(z.string()),
  createdDate: datetimeString,
  updatedDate: datetimeString,
  pushedDate: datetimeString,
  latestKnownPersonalCommitDate: datetimeOrNull,
  latestKnownPersonalCommitMessage: z.string().nullable(),
  lastWorkedAt: datetimeString,
  lastWorkedAtSource: z.enum(GITHUB_LAST_WORKED_AT_SOURCES),
  openIssueCount: z.number().int().min(0).nullable(),
  openPullRequestCount: z.number().int().min(0).nullable(),
  synchronizationTimestamp: datetimeString,
  synchronizationStatus: z.enum(["success", "failed", "unavailable"]),
  sourceError: z.string().nullable().optional(),
  associationStatus: z.enum(["unknown", "not_detected", "detected", "confirmed", "removed"]).optional(),
  associationEvidence: z.string().optional(),
});

export type GithubRepositoryImport = z.infer<typeof githubRepositorySourceInputSchema>;

export type GithubSyncOutcome = "created" | "updated" | "unchanged" | "unavailable" | "failed";

export interface GithubSyncReport {
  externalRepositoryId: string;
  projectId: string | null;
  projectTitle: string | null;
  outcome: GithubSyncOutcome;
  changed: boolean;
  summary: string;
}

export interface GithubSyncBatchResult {
  data: DashboardData;
  reports: GithubSyncReport[];
}

export interface GithubSyncOptions {
  now?: string;
  generateProjectId?: () => string;
}

export const githubImportProtectedPolicy = {
  manualProjectFields: [
    "title",
    "purpose",
    "status",
    "manualStatus",
    "currentBranch",
    "currentObjective",
    "currentBlocker",
    "nextRecommendedTask",
    "lastWorkedAt",
  ] as const,
  manualEntityCollections: [
    "ideas",
    "tasks",
    "notes",
    "importantLinks",
    "developmentSessions",
    "architectureDecisions",
    "codexPrompts",
    "scratchpads",
    "brainDumps",
    "activityEvents",
    "resumeArtifacts",
    "aiContextArtifacts",
  ] as const,
  localProgressFields: ["createdAt", "updatedAt"] as const,
} as const;

const projectShellDefaults = {
  manualStatus: "active" as const,
  currentObjective: "",
  currentBlocker: "",
  nextRecommendedTask: "",
  status: "active" as const,
};

export const mergeGitHubSourcePolicy = {
  projectShellDefaults,
  protectedManualScope: [
    "title",
    "purpose",
    "manualStatus",
    "currentBranch",
    "currentObjective",
    "currentBlocker",
    "nextRecommendedTask",
    "status",
    "lastWorkedAt",
    "ideas",
    "tasks",
    "notes",
    "importantLinks",
    "developmentSessions",
    "architectureDecisions",
    "codexPrompts",
    "scratchpads",
    "brainDumps",
    "activityEvents",
  ],
} as const;

const clampDateString = (value: string, fallback: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return value;
};

const nowOrNowFallback = (now?: string) => {
  if (typeof now === "undefined") return nowIso();
  return clampDateString(now, nowIso());
};

export const inferExternalActivityStatus = (
  importData: GithubRepositoryImport,
  now: string,
): ExternalActivityStatus => {
  if (importData.synchronizationStatus === "unavailable") {
    return "unavailable";
  }

  const commitDate = new Date(importData.lastWorkedAt);
  const reference = new Date(now);
  if (Number.isNaN(commitDate.getTime()) || Number.isNaN(reference.getTime())) {
    return "stale";
  }

  const ageDays = Math.floor((reference.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= GITHUB_ACTIVITY_DAYS.active) {
    return "active_recently";
  }
  if (ageDays <= GITHUB_ACTIVITY_DAYS.quiet) {
    return "quiet";
  }

  return "stale";
};

const buildProjectSlug = (value: string): string => {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64) || "project";
};

const buildGithubAssociation = (
  importData: GithubRepositoryImport,
  now: string,
  existing?: ExternalSourceAssociation,
): ExternalSourceAssociation => {
  const incomingEvidence = importData.associationEvidence?.trim() ?? "";
  const nextAutomatedStatus: ExternalAssociationStatus = importData.associationStatus
    ?? (incomingEvidence.length > 0 ? "detected" : "not_detected");
  const preservesManualDecision =
    (existing?.status === "confirmed" || existing?.status === "removed") &&
    (nextAutomatedStatus === "detected" ||
      nextAutomatedStatus === "not_detected" ||
      nextAutomatedStatus === "unknown");
  const preservesPriorDetection =
    existing?.status === "detected" &&
    (nextAutomatedStatus === "not_detected" || nextAutomatedStatus === "unknown");

  if (preservesManualDecision || preservesPriorDetection) {
    return existing;
  }

  const nextStatus = nextAutomatedStatus;
  const evidence = incomingEvidence
    || (nextStatus === "not_detected" || nextStatus === "unknown"
      ? ""
      : existing?.evidence || `${importData.repositoryFullName} ${nextStatus}`);
  const detectedAt = existing?.detectedAt || now;

  if (nextStatus === "confirmed") {
    return {
      status: nextStatus,
      evidence,
      detectedAt,
      confirmedAt: existing?.status === "confirmed" ? existing.confirmedAt || now : now,
    };
  }

  return {
    status: nextStatus,
    evidence,
    detectedAt,
    confirmedAt: nextStatus === existing?.status ? existing?.confirmedAt : undefined,
  };
};

const buildGithubSource = (
  importData: GithubRepositoryImport,
  now: string,
  existing?: ExternalProjectSourceGithub,
): ExternalProjectSourceGithub => {
  const association = buildGithubAssociation(importData, now, existing?.firebaseAssociation);
  const synchronizationTimestamp = clampDateString(importData.synchronizationTimestamp, now);

  if (!existing || importData.synchronizationStatus === "success") {
    return {
      sourceType: "github",
      externalRepositoryId: importData.externalRepositoryId,
      ownerLogin: importData.ownerLogin,
      repositoryName: importData.repositoryName,
      repositoryFullName: importData.repositoryFullName,
      repositoryUrl: importData.repositoryUrl,
      defaultBranch: importData.defaultBranch,
      visibility: importData.visibility,
      isArchived: importData.isArchived,
      isFork: importData.isFork,
      description: importData.description,
      primaryLanguage: importData.primaryLanguage,
      topics: importData.topics,
      createdDate: clampDateString(importData.createdDate, now),
      updatedDate: clampDateString(importData.updatedDate, now),
      pushedDate: clampDateString(importData.pushedDate, now),
      latestKnownPersonalCommitDate: importData.latestKnownPersonalCommitDate,
      latestKnownPersonalCommitMessage: importData.latestKnownPersonalCommitMessage,
      lastWorkedAt: importData.lastWorkedAt,
      lastWorkedAtSource: importData.lastWorkedAtSource,
      openIssueCount: importData.openIssueCount,
      openPullRequestCount: importData.openPullRequestCount,
      synchronizationTimestamp,
      synchronizationStatus: importData.synchronizationStatus,
      sourceError: importData.sourceError ?? null,
      firebaseAssociation: association,
    };
  }

  return {
    ...existing,
    externalRepositoryId: importData.externalRepositoryId,
    sourceType: "github",
    ownerLogin: existing.ownerLogin,
    repositoryName: existing.repositoryName,
    repositoryFullName: existing.repositoryFullName,
    repositoryUrl: existing.repositoryUrl,
    defaultBranch: existing.defaultBranch,
    visibility: existing.visibility,
    isArchived: existing.isArchived,
    isFork: existing.isFork,
    description: existing.description,
    primaryLanguage: existing.primaryLanguage,
    topics: existing.topics,
    createdDate: existing.createdDate,
    updatedDate: existing.updatedDate,
    pushedDate: existing.pushedDate,
    latestKnownPersonalCommitDate: existing.latestKnownPersonalCommitDate,
    latestKnownPersonalCommitMessage: existing.latestKnownPersonalCommitMessage,
    lastWorkedAt: existing.lastWorkedAt,
    lastWorkedAtSource: existing.lastWorkedAtSource,
    openIssueCount: existing.openIssueCount,
    openPullRequestCount: existing.openPullRequestCount,
    synchronizationTimestamp,
    synchronizationStatus: importData.synchronizationStatus,
    sourceError: importData.sourceError ?? existing.sourceError ?? null,
    firebaseAssociation: association,
  };
};

const buildProjectShellFromImport = (
  importData: GithubRepositoryImport,
  options?: GithubSyncOptions,
): Project => {
  const now = nowOrNowFallback(options?.now);
  const generateProjectId = options?.generateProjectId ?? (() => randomUUID());
  const source = buildGithubSource(importData, now);

  return {
    id: generateProjectId(),
    title: importData.repositoryName,
    slug: buildProjectSlug(importData.repositoryName),
    purpose: importData.description.trim().length > 0
      ? importData.description
      : `GitHub repository ${importData.repositoryFullName}.`,
    status: projectShellDefaults.status,
    manualStatus: projectShellDefaults.manualStatus,
    currentBranch: importData.defaultBranch,
    currentObjective: projectShellDefaults.currentObjective,
    currentBlocker: projectShellDefaults.currentBlocker,
    nextRecommendedTask: projectShellDefaults.nextRecommendedTask,
    externalSources: {
      github: source,
    },
    externalActivityStatus: inferExternalActivityStatus(importData, now),
    externalActivityUpdatedAt: source.synchronizationTimestamp,
    createdAt: now,
    updatedAt: now,
  };
};

const hasExternalGithubSource = (project: Project, externalRepositoryId: string): boolean =>
  project.externalSources?.github?.externalRepositoryId === externalRepositoryId;

const buildNextProjectFromImport = (
  project: Project,
  importData: GithubRepositoryImport,
  now: string,
): Project => {
  const existingSource = project.externalSources?.github;
  const mergedSource = buildGithubSource(importData, now, existingSource);
  const nextActivityStatus =
    importData.synchronizationStatus === "unavailable"
      ? "unavailable"
      : importData.synchronizationStatus === "failed"
        ? project.externalActivityStatus ?? "never_committed"
        : inferExternalActivityStatus(importData, now);
  const nextActivityUpdatedAt =
    importData.synchronizationStatus === "failed" ? project.externalActivityUpdatedAt : mergedSource.synchronizationTimestamp;

  return {
    ...project,
    externalSources: {
      ...project.externalSources,
      github: mergedSource,
    },
    externalActivityStatus: nextActivityStatus,
    externalActivityUpdatedAt: nextActivityUpdatedAt,
    updatedAt: project.updatedAt,
  };
};

const githubSemanticMetadata = (source?: ExternalProjectSourceGithub) => {
  if (!source) return source;

  const semanticMetadata: Partial<ExternalProjectSourceGithub> = { ...source };
  delete semanticMetadata.synchronizationTimestamp;
  return semanticMetadata;
};

const normalizeImport = (raw: unknown): GithubRepositoryImport => {
  return githubRepositorySourceInputSchema.parse(raw);
};

const reportSummaryForOutcome = (
  importData: GithubRepositoryImport,
  projectTitle: string | null,
  outcome: GithubSyncOutcome,
): string => {
  switch (outcome) {
    case "created":
      return `Created new dashboard project shell for ${importData.repositoryFullName} (GitHub ${importData.externalRepositoryId}).`;
    case "updated":
      return `Updated external sync metadata for ${projectTitle ?? importData.repositoryFullName} (GitHub ${importData.externalRepositoryId}).`;
    case "unchanged":
      return `No GitHub metadata changes for ${projectTitle ?? importData.repositoryFullName} (GitHub ${importData.externalRepositoryId}).`;
    case "unavailable":
      return `Marked ${projectTitle ?? importData.repositoryFullName} as unavailable in GitHub sync (GitHub ${importData.externalRepositoryId}).`;
    case "failed":
      return `Synchronization failed for ${projectTitle ?? importData.repositoryFullName} (GitHub ${importData.externalRepositoryId}).`;
    default:
      return `Processed GitHub import for ${projectTitle ?? importData.repositoryFullName} (GitHub ${importData.externalRepositoryId}).`;
  }
};

export const applyGithubRepositoryImport = (
  dashboardData: DashboardData,
  rawData: unknown,
  options?: GithubSyncOptions,
): { data: DashboardData; report: GithubSyncReport } => {
  const importData = normalizeImport(rawData);
  const now = nowOrNowFallback(options?.now);
  const importIndex = dashboardData.projects.findIndex((project) => hasExternalGithubSource(project, importData.externalRepositoryId));

  if (importIndex === -1) {
    if (importData.synchronizationStatus !== "success") {
      const outcome: GithubSyncOutcome =
        importData.synchronizationStatus === "unavailable" ? "unavailable" : "failed";
      return {
        data: dashboardData,
        report: {
          externalRepositoryId: importData.externalRepositoryId,
          projectId: null,
          projectTitle: null,
          outcome,
          changed: false,
          summary: `No existing dashboard project matched GitHub repository ${importData.externalRepositoryId}; no changes applied.`,
        },
      };
    }

    const shell = buildProjectShellFromImport(importData, options);
    const project = {
      ...shell,
      title: importData.repositoryName,
      externalActivityUpdatedAt: shell.externalActivityUpdatedAt,
    };
    return {
      data: {
        ...dashboardData,
        projects: [...dashboardData.projects, project],
      },
      report: {
        externalRepositoryId: importData.externalRepositoryId,
        projectId: project.id,
        projectTitle: project.title,
        outcome: "created",
        changed: true,
        summary: reportSummaryForOutcome(importData, project.title, "created"),
      },
    };
  }

  const current = dashboardData.projects[importIndex];
  const nextProject = buildNextProjectFromImport(current, importData, now);
  const changed =
    JSON.stringify(githubSemanticMetadata(current.externalSources?.github)) !==
      JSON.stringify(githubSemanticMetadata(nextProject.externalSources?.github)) ||
    current.externalActivityStatus !== nextProject.externalActivityStatus;

  const outcome: GithubSyncOutcome =
    changed ? (importData.synchronizationStatus === "failed" ? "failed" : importData.synchronizationStatus === "unavailable" ? "unavailable" : "updated") : "unchanged";
  if (!changed) {
    const nextProjects = dashboardData.projects.map((project, index) =>
      index === importIndex ? nextProject : project,
    );
    return {
      data: {
        ...dashboardData,
        projects: nextProjects,
      },
      report: {
        externalRepositoryId: importData.externalRepositoryId,
        projectId: current.id,
        projectTitle: current.title,
        outcome,
        changed: false,
        summary: reportSummaryForOutcome(importData, current.title, "unchanged"),
      },
    };
  }

  const nextProjects = dashboardData.projects.map((project, index) => (index === importIndex ? nextProject : project));
  return {
    data: {
      ...dashboardData,
      projects: nextProjects,
    },
    report: {
      externalRepositoryId: importData.externalRepositoryId,
      projectId: current.id,
      projectTitle: current.title,
      outcome,
      changed: true,
      summary: reportSummaryForOutcome(importData, current.title, outcome),
    },
  };
};

export const applyGithubRepositoryImportBatch = (
  dashboardData: DashboardData,
  imports: unknown[],
  options?: GithubSyncOptions,
): GithubSyncBatchResult => {
  const nextData: DashboardData = {
    ...dashboardData,
    projects: [...dashboardData.projects],
  };
  const reports: GithubSyncReport[] = [];

  for (const raw of imports) {
    const { data, report } = applyGithubRepositoryImport(nextData, raw, options);
    nextData.projects = data.projects;
    reports.push(report);
  }

  return { data: nextData, reports };
};

const toUnavailableImportCandidate = (
  project: Project,
  now: string,
): GithubRepositoryImport | null => {
  const source = project.externalSources?.github;

  if (!source) {
    return null;
  }

  return {
    sourceType: "github",
    externalRepositoryId: source.externalRepositoryId,
    ownerLogin: source.ownerLogin,
    repositoryName: source.repositoryName,
    repositoryFullName: source.repositoryFullName,
    repositoryUrl: source.repositoryUrl,
    defaultBranch: source.defaultBranch,
    visibility: source.visibility,
    isArchived: source.isArchived,
    isFork: source.isFork,
    description: source.description,
    primaryLanguage: source.primaryLanguage,
    topics: source.topics,
    createdDate: source.createdDate,
    updatedDate: source.updatedDate,
    pushedDate: source.pushedDate,
    latestKnownPersonalCommitDate: source.latestKnownPersonalCommitDate,
    latestKnownPersonalCommitMessage: source.latestKnownPersonalCommitMessage,
    lastWorkedAt: source.lastWorkedAt,
    lastWorkedAtSource: source.lastWorkedAtSource,
    openIssueCount: source.openIssueCount,
    openPullRequestCount: source.openPullRequestCount,
    synchronizationTimestamp: now,
    synchronizationStatus: "unavailable",
    sourceError: "Repository was not included in the latest GitHub repository sweep.",
    associationStatus: source.firebaseAssociation.status,
    associationEvidence: source.firebaseAssociation.evidence,
  };
};

export const markMissingRepositoriesUnavailable = (
  dashboardData: DashboardData,
  visibleRepositoryIds: Set<string> | string[],
  options?: GithubSyncOptions,
): GithubSyncBatchResult => {
  const visible = visibleRepositoryIds instanceof Set
    ? visibleRepositoryIds
    : new Set(visibleRepositoryIds);

  const nextData: DashboardData = {
    ...dashboardData,
    projects: [...dashboardData.projects],
  };

  const reports: GithubSyncReport[] = [];
  const now = nowOrNowFallback(options?.now);

  for (const project of dashboardData.projects) {
    const externalRepositoryId = project.externalSources?.github?.externalRepositoryId;
    if (!externalRepositoryId || visible.has(externalRepositoryId)) {
      continue;
    }

    const projectWasUnavailable = project.externalSources?.github?.synchronizationStatus === "unavailable";
    if (projectWasUnavailable) {
      continue;
    }

    const unavailableImport = toUnavailableImportCandidate(project, now);
    if (!unavailableImport) {
      continue;
    }

    const baseline = applyGithubRepositoryImport({
      ...nextData,
      projects: nextData.projects,
    }, unavailableImport, options);

    if (baseline.report.projectId === project.id) {
      nextData.projects = baseline.data.projects;
      reports.push({
        ...baseline.report,
        outcome: "unavailable",
        projectId: project.id,
        projectTitle: project.title,
      });
    }
  }

  return { data: nextData, reports };
};

export const applyGithubImportBatch = applyGithubRepositoryImportBatch;

export const calculateExternalActivityStatus = (project: Project, candidate?: GithubRepositoryImport): ExternalActivityStatus => {
  if (candidate) {
    return inferExternalActivityStatus(candidate, nowOrNowFallback(candidate.synchronizationTimestamp));
  }
  if (project.externalSources?.github?.synchronizationStatus === "unavailable") return "unavailable";
  return project.externalActivityStatus ?? "never_committed";
};
