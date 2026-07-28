import { DashboardData, ImportantLink, Project } from "../models";
import { SearchResult } from "./types";
import { SCHEMA_VERSION, STORAGE_KEY } from "../constants";
import { nowIso } from "../utils/time";
import { dashboardDataSchema } from "../validation";
import { seedDashboardData } from "../seed";

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const normaliseLinks = (raw: unknown): ImportantLink[] => {
  if (!Array.isArray(raw)) return [];

  const fallback = nowIso();
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

  const toLinks = raw
    .filter(isObject)
    .map((value) => {
      const row = value as Partial<ImportantLink>;
      return {
        id: row.id && typeof row.id === "string" ? row.id : `${makeFallbackId()}`,
        projectId: row.projectId && typeof row.projectId === "string" ? row.projectId : "",
        title: row.title && typeof row.title === "string" ? row.title : "Untitled link",
        url: row.url && typeof row.url === "string" ? row.url : "https://example.com",
        notes: row.notes && typeof row.notes === "string" ? row.notes : "",
        section: row.section && typeof row.section === "string" ? row.section : "General",
        tags: Array.isArray(row.tags) ? row.tags.filter((item): item is string => typeof item === "string") : [],
        createdAt: row.createdAt && typeof row.createdAt === "string" ? row.createdAt : fallback,
        updatedAt: row.updatedAt && typeof row.updatedAt === "string" ? row.updatedAt : fallback,
      };
    })
    .filter((link) => link.projectId && link.url);

  return toLinks;
};

const makeFallbackId = () =>
  `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.replace(/[^a-z0-9]/g, "").slice(0, 32);

export const createMigrationLayer = (raw: unknown): DashboardData => {
  const fallback = seedDashboardData();

  if (!raw || typeof raw !== "object") {
    return { ...fallback, schemaVersion: SCHEMA_VERSION };
  }

  const parsed = dashboardDataSchema.safeParse(raw);
  if (parsed.success) {
    if (parsed.data.schemaVersion === SCHEMA_VERSION) return parsed.data;
    if (parsed.data.schemaVersion < SCHEMA_VERSION) {
      return {
        ...fallback,
        schemaVersion: SCHEMA_VERSION,
        projects: parsed.data.projects ?? fallback.projects,
        ideas: parsed.data.ideas ?? fallback.ideas,
        tasks: parsed.data.tasks ?? fallback.tasks,
        brainDumps: parsed.data.brainDumps ?? fallback.brainDumps,
        scratchpads: parsed.data.scratchpads ?? fallback.scratchpads,
        architectureDecisions: parsed.data.architectureDecisions ?? fallback.architectureDecisions,
        codexPrompts: parsed.data.codexPrompts ?? fallback.codexPrompts,
        notes: parsed.data.notes ?? fallback.notes,
        importantLinks: normaliseLinks(parsed.data.importantLinks ?? fallback.importantLinks),
        developmentSessions: parsed.data.developmentSessions ?? fallback.developmentSessions,
        activities: parsed.data.activities ?? fallback.activities,
      };
    }
  }

  return fallback;
};

export const loadDashboardData = (): DashboardData => {
  if (!isBrowser()) {
    return seedDashboardData();
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    return createMigrationLayer(parsed);
  } catch {
    const seeded = seedDashboardData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

export const saveDashboardData = (data: DashboardData): void => {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const markProjectUpdated = (
  data: DashboardData,
  projectId: string,
): DashboardData => {
  const now = nowIso();
  return {
    ...data,
    projects: data.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            updatedAt: now,
            lastWorkedAt: now,
          }
        : project,
    ),
  };
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

export interface DashboardRepository {
  load: () => DashboardData;
  save: (data: DashboardData) => void;
}

export const createLocalRepository = (): DashboardRepository => ({
  load: () => loadDashboardData(),
  save: (data) => saveDashboardData(data),
});

export const getProjectOrThrow = (data: DashboardData, id: string, projects: Project[]): Project => {
  const found = projects.find((project) => project.id === id);
  if (!found) {
    throw new Error(`Project not found: ${id}`);
  }
  return found;
};
