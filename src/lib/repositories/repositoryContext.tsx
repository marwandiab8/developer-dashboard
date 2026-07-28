"use client";

import {
  type ArchitectureDecision,
  type BrainDump,
  type CodexPrompt,
  type DashboardData,
  type DevelopmentSession,
  type Idea,
  type ImportantLink,
  type Note,
  type Project,
  type ActivityType,
  type CaptureClassification,
  type Scratchpad,
  type Task,
} from "../models";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
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
import { createLocalRepository, searchDashboard } from "./localAdapter";
import { dashboardReducer } from "./reducer";
import { type DashboardAction, type SearchResult } from "./types";

type ActivityInput = {
  projectId: string;
  type: ActivityType;
  summary: string;
  entityType: string;
  entityId: string;
  metadata: string;
};

const ActivityTypeEnum = new Set<ActivityType>([
  "project_created",
  "idea_captured",
  "idea_converted",
  "task_started",
  "task_completed",
  "decision_accepted",
  "prompt_used",
  "session_started",
  "session_completed",
  "resume_generated",
  "ai_context_generated",
]);

export interface DashboardContextValue {
  data: DashboardData;
  lastActionError: string | null;
  clearLastActionError: () => void;

  createProject: (title: string, purpose: string) => Promise<Project>;
  runQuickCapture: (payload: { projectId: string; text: string; classification: CaptureClassification }) => void;

  addIdea: (idea: Omit<Idea, "id" | "createdAt" | "updatedAt" | "linkedTaskId">) => Idea;
  updateIdea: (id: string, updates: Partial<Idea>) => void;
  archiveIdea: (id: string) => void;
  convertIdeaToTask: (ideaId: string) => Task | null;

  addTask: (task: Omit<Task, "id" | "createdAt" | "updatedAt">) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  startTask: (id: string) => void;
  blockTask: (id: string, reason: string) => void;
  completeTask: (id: string) => void;

  addBrainDump: (payload: Omit<BrainDump, "id" | "createdAt" | "updatedAt" | "status" | "convertedEntityType" | "convertedEntityId">) => BrainDump;
  updateBrainDump: (id: string, updates: Partial<BrainDump>) => void;
  deleteBrainDump: (id: string) => void;
  convertBrainDumpToIdea: (id: string) => void;
  convertBrainDumpToTask: (id: string) => void;

  updateScratchpad: (projectId: string, markdown: string) => void;
  getProjectScratchpad: (projectId: string) => Scratchpad | null;

  upsertDecision: (
    decision: Omit<ArchitectureDecision, "id" | "createdAt" | "updatedAt"> & { decidedAt?: string }
  ) => ArchitectureDecision;
  updateDecisionStatus: (id: string, status: ArchitectureDecision["status"]) => void;

  upsertPrompt: (prompt: Omit<CodexPrompt, "id" | "createdAt" | "updatedAt" | "lastUsedAt">) => CodexPrompt;
  markPromptUsed: (id: string, summary: string) => void;

  addNote: (note: Omit<Note, "id" | "createdAt" | "updatedAt">) => Note;
  updateNote: (id: string, updates: Partial<Note>) => void;

  addLink: (link: Omit<ImportantLink, "id" | "createdAt" | "updatedAt">) => ImportantLink;
  updateLink: (id: string, updates: Partial<ImportantLink>) => void;

  startSession: (session: Omit<DevelopmentSession, "id" | "startedAt" | "endedAt" | "status">) => DevelopmentSession;
  endSession: (id: string, updates: Partial<DevelopmentSession>) => void;
  appendSessionNote: (id: string, note: string) => void;

  search: (query: string) => SearchResult[];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);
const repository = createLocalRepository();

const makeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const randomHex = () => Math.random().toString(16).replace(".", "").padEnd(16, "0").slice(0, 16);
  return `${randomHex().slice(0, 8)}-${randomHex().slice(0, 4)}-4${randomHex().slice(0, 3)}-${["8","9","a","b"][Date.now() % 4]}${randomHex().slice(0, 3)}-${randomHex().slice(0, 12)}`;
};

function buildActivity(event: ActivityInput) {
  return activityEventSchema.parse({
    id: makeId(),
    ...event,
    createdAt: nowIso(),
  });
}

function ensureType(type: string): ActivityType {
  if (ActivityTypeEnum.has(type as ActivityType)) {
    return type as ActivityType;
  }
  return "project_created";
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const seedData = useMemo(() => seedDashboardData(), []);
  const [data, dispatch] = useReducer(dashboardReducer, seedData);
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastActionError, setLastActionError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const hydrate = async () => {
      const loadedData = repository.load();
      if (!isActive) return;
      dispatch({ type: "seed", payload: loadedData });
      await Promise.resolve();
      if (!isActive) return;
      setIsHydrated(true);
    };
    void hydrate();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    repository.save(data);
  }, [data, isHydrated]);

  const dispatchAction = useCallback((payload: { action: DashboardAction; activity?: ActivityInput }) => {
    dispatch(payload.action);
    if (payload.activity) {
      dispatch({
        type: "activity_add",
        payload: buildActivity({
          projectId: payload.activity.projectId,
          type: ensureType(payload.activity.type),
          summary: payload.activity.summary,
          entityType: payload.activity.entityType,
          entityId: payload.activity.entityId,
          metadata: payload.activity.metadata,
        }),
      });
    }
    setLastActionError(null);
  }, []);

  const clearLastActionError = useCallback(() => setLastActionError(null), []);

  const createProject = useCallback(async (title: string, purpose: string): Promise<Project> => {
    const now = nowIso();
    const slug = title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 64);

    const parsed = projectSchema.parse({
      id: makeId(),
      title,
      slug: slug || "project",
      purpose,
      status: "active",
      currentBranch: "main",
      currentObjective: "",
      currentBlocker: "",
      nextRecommendedTask: "",
      createdAt: now,
      updatedAt: now,
      lastWorkedAt: now,
    });

    dispatchAction({
      action: { type: "project_upsert", payload: parsed },
      activity: {
        projectId: parsed.id,
        type: "project_created",
        summary: `Created project: ${parsed.title}`,
        entityType: "project",
        entityId: parsed.id,
        metadata: "manual",
      },
    });

    return parsed;
  }, [dispatchAction]);

  const getProjectScratchpad = useCallback(
    (projectId: string): Scratchpad | null =>
      data.scratchpads.find((entry) => entry.projectId === projectId) ?? null,
    [data.scratchpads],
  );

  const addIdea = useCallback(
    (idea: Omit<Idea, "id" | "createdAt" | "updatedAt" | "linkedTaskId">): Idea => {
      const now = nowIso();
      const parsed = ideaSchema.parse({
        ...idea,
        id: makeId(),
        linkedTaskId: null,
        createdAt: now,
        updatedAt: now,
      });
      dispatchAction({
        action: { type: "idea_add", payload: parsed },
        activity: {
          projectId: parsed.projectId,
          type: "idea_captured",
          summary: `Captured idea: ${parsed.text}`,
          entityType: "idea",
          entityId: parsed.id,
          metadata: "capture",
        },
      });
      return parsed;
    },
    [dispatchAction],
  );

  const updateIdea = useCallback(
    (id: string, updates: Partial<Idea>) => {
      dispatchAction({ action: { type: "idea_update", payload: { id, updates } } });
    },
    [dispatchAction],
  );

  const archiveIdea = useCallback(
    (id: string) => {
      dispatchAction({ action: { type: "idea_archive", payload: { id } } });
    },
    [dispatchAction],
  );

  const convertIdeaToTask = useCallback((ideaId: string): Task | null => {
    const idea = data.ideas.find((entry) => entry.id === ideaId);
    if (!idea) {
      setLastActionError("Idea not found.");
      return null;
    }
    const now = nowIso();
    const parsed = taskSchema.parse({
      id: makeId(),
      projectId: idea.projectId,
      title: idea.text,
      details: idea.description || "",
      type: "feature",
      status: "ready",
      priority: idea.priority,
      blockedReason: "",
      sourceIdeaId: idea.id,
      acceptanceCriteria: "",
      implementationNotes: "",
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    dispatchAction({
      action: {
        type: "idea_to_task",
        payload: {
          ideaId: idea.id,
          taskId: parsed.id,
          task: parsed,
        },
      },
      activity: {
        projectId: idea.projectId,
        type: "idea_converted",
        summary: `Converted idea to task: ${parsed.title}`,
        entityType: "task",
        entityId: parsed.id,
        metadata: idea.id,
      },
    });

    return parsed;
  }, [data.ideas, dispatchAction]);

  const addTask = useCallback(
    (task: Omit<Task, "id" | "createdAt" | "updatedAt">): Task => {
      const now = nowIso();
      const parsed = taskSchema.parse({
        ...task,
        id: makeId(),
        createdAt: now,
        updatedAt: now,
      });
      dispatchAction({ action: { type: "task_add", payload: parsed } });
      return parsed;
    },
    [dispatchAction],
  );

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    dispatchAction({ action: { type: "task_update", payload: { id, updates } } });
  }, [dispatchAction]);

  const startTask = useCallback((id: string) => {
    const task = data.tasks.find((entry) => entry.id === id);
    if (!task) {
      setLastActionError("Task not found.");
      return;
    }
    dispatchAction({
      action: { type: "task_start", payload: { id } },
      activity: {
        projectId: task.projectId,
        type: "task_started",
        summary: `Started task: ${task.title}`,
        entityType: "task",
        entityId: task.id,
        metadata: "start",
      },
    });
  }, [data.tasks, dispatchAction]);

  const blockTask = useCallback((id: string, reason: string) => {
    dispatchAction({ action: { type: "task_block", payload: { id, reason } } });
  }, [dispatchAction]);

  const completeTask = useCallback((id: string) => {
    const task = data.tasks.find((entry) => entry.id === id);
    if (!task) {
      setLastActionError("Task not found.");
      return;
    }
    dispatchAction({
      action: { type: "task_complete", payload: { id } },
      activity: {
        projectId: task.projectId,
        type: "task_completed",
        summary: `Completed task: ${task.title}`,
        entityType: "task",
        entityId: task.id,
        metadata: "complete",
      },
    });
  }, [data.tasks, dispatchAction]);

  const addBrainDump = useCallback(
    (payload: Omit<BrainDump, "id" | "createdAt" | "updatedAt" | "status" | "convertedEntityType" | "convertedEntityId">): BrainDump => {
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
      dispatchAction({ action: { type: "brain_dump_add", payload: parsed } });
      return parsed;
    },
    [dispatchAction],
  );

  const updateBrainDump = useCallback((id: string, updates: Partial<BrainDump>) => {
    dispatchAction({ action: { type: "brain_dump_update", payload: { id, updates } } });
  }, [dispatchAction]);

  const deleteBrainDump = useCallback((id: string) => {
    dispatchAction({ action: { type: "brain_dump_delete", payload: { id } } });
  }, [dispatchAction]);

  const convertBrainDumpToIdea = useCallback((id: string) => {
    const entry = data.brainDumps.find((item) => item.id === id);
    if (!entry) {
      setLastActionError("Brain dump entry not found.");
      return;
    }

    const created = addIdea({
      projectId: entry.projectId,
      text: entry.text,
      description: "Converted from brain dump",
      status: "accepted",
      priority: "medium",
      source: "other",
      tags: [],
    });

    dispatchAction({
      action: {
        type: "brain_dump_update",
        payload: {
          id,
          updates: {
            status: "converted",
            convertedEntityType: "idea",
            convertedEntityId: created.id,
          },
        },
      },
    });
  }, [data.brainDumps, addIdea, dispatchAction]);

  const convertBrainDumpToTask = useCallback((id: string) => {
    const entry = data.brainDumps.find((item) => item.id === id);
    if (!entry) {
      setLastActionError("Brain dump entry not found.");
      return;
    }

    const created = addTask({
      projectId: entry.projectId,
      title: entry.text.slice(0, 80),
      details: entry.text,
      type: "feature",
      status: "backlog",
      priority: "medium",
      blockedReason: "",
      sourceIdeaId: null,
      acceptanceCriteria: "",
      implementationNotes: "",
      startedAt: null,
      completedAt: null,
    });

    dispatchAction({
      action: {
        type: "brain_dump_update",
        payload: {
          id,
          updates: {
            status: "converted",
            convertedEntityType: "task",
            convertedEntityId: created.id,
          },
        },
      },
    });
  }, [data.brainDumps, addTask, dispatchAction]);

  const updateScratchpad = useCallback((projectId: string, markdown: string) => {
    const parsed = scratchpadSchema.parse({
      projectId,
      markdown,
      updatedAt: nowIso(),
    });
    dispatchAction({ action: { type: "scratchpad_update", payload: parsed } });
  }, [dispatchAction]);

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
      dispatchAction({ action: { type: "architecture_decision_upsert", payload: parsed } });
      return parsed;
    },
    [dispatchAction],
  );

  const updateDecisionStatus = useCallback((id: string, status: ArchitectureDecision["status"]) => {
    dispatchAction({ action: { type: "architecture_decision_update_status", payload: { id, status } } });
  }, [dispatchAction]);

  const upsertPrompt = useCallback(
    (prompt: Omit<CodexPrompt, "id" | "createdAt" | "updatedAt" | "lastUsedAt">): CodexPrompt => {
      const now = nowIso();
      const parsed = codexPromptSchema.parse({
        ...prompt,
        id: makeId(),
        status: prompt.status || "draft",
        relatedTaskId: prompt.relatedTaskId || null,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
      });
      dispatchAction({ action: { type: "prompt_upsert", payload: parsed } });
      return parsed;
    },
    [dispatchAction],
  );

  const markPromptUsed = useCallback((id: string, summary: string) => {
    dispatchAction({ action: { type: "prompt_mark_used", payload: { id, usedSummary: summary } } });
  }, [dispatchAction]);

  const addNote = useCallback(
    (note: Omit<Note, "id" | "createdAt" | "updatedAt">): Note => {
      const now = nowIso();
      const parsed = noteSchema.parse({
        ...note,
        id: makeId(),
        createdAt: now,
        updatedAt: now,
      });
      dispatchAction({ action: { type: "note_add", payload: parsed } });
      return parsed;
    },
    [dispatchAction],
  );

  const runQuickCapture = useCallback(
    (payload: { projectId: string; text: string; classification: CaptureClassification }) => {
      const parsed = quickCaptureSchema.parse(payload);
      const text = parsed.text.trim();
      if (!text) {
        setLastActionError("Quick capture requires text.");
        return;
      }

      if (parsed.classification === "idea") {
        addIdea({
          projectId: parsed.projectId,
          text,
          description: "",
          status: "inbox",
          priority: "medium",
          source: "other",
          tags: [],
        });
        return;
      }

      if (parsed.classification === "brain_dump") {
        addBrainDump({
          projectId: parsed.projectId,
          text,
        });
        return;
      }

      if (parsed.classification === "scratchpad") {
        const current = getProjectScratchpad(parsed.projectId);
        const next = current?.markdown ? `${current.markdown}\n\n${text}`.trim() : text;
        updateScratchpad(parsed.projectId, next);
        return;
      }

      if (parsed.classification === "task" || parsed.classification === "bug") {
        addTask({
          projectId: parsed.projectId,
          title: text,
          details: "",
          type: parsed.classification === "bug" ? "bug" : "feature",
          status: "backlog",
          priority: "medium",
          blockedReason: "",
          sourceIdeaId: null,
          acceptanceCriteria: "",
          implementationNotes: "",
          startedAt: null,
          completedAt: null,
        });
        return;
      }

      if (parsed.classification === "note") {
        addNote({
          projectId: parsed.projectId,
          title: text.slice(0, 70) || "Quick note",
          section: "capture",
          tags: [],
          markdown: text,
        });
      }
    },
    [addBrainDump, addIdea, addNote, addTask, getProjectScratchpad, updateScratchpad],
  );

  const updateNote = useCallback((id: string, updates: Partial<Note>) => {
    dispatchAction({ action: { type: "note_update", payload: { id, updates } } });
  }, [dispatchAction]);

  const addLink = useCallback(
    (link: Omit<ImportantLink, "id" | "createdAt" | "updatedAt">): ImportantLink => {
      const now = nowIso();
      const parsed = importantLinkSchema.parse({
        ...link,
        id: makeId(),
        createdAt: now,
        updatedAt: now,
      });
      dispatchAction({ action: { type: "link_add", payload: parsed } });
      return parsed;
    },
    [dispatchAction],
  );

  const updateLink = useCallback((id: string, updates: Partial<ImportantLink>) => {
    dispatchAction({ action: { type: "link_update", payload: { id, updates } } });
  }, [dispatchAction]);

  const startSession = useCallback(
    (session: Omit<DevelopmentSession, "id" | "startedAt" | "endedAt" | "status">): DevelopmentSession => {
      const now = nowIso();
      const parsed = developmentSessionSchema.parse({
        ...session,
        id: makeId(),
        startedAt: now,
        endedAt: null,
        status: "active",
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
      });
      dispatchAction({
        action: { type: "session_start", payload: parsed },
        activity: {
          projectId: parsed.projectId,
          type: "session_started",
          summary: `Started session: ${parsed.objective}`,
          entityType: "session",
          entityId: parsed.id,
          metadata: "start",
        },
      });
      return parsed;
    },
    [dispatchAction],
  );

  const endSession = useCallback((id: string, updates: Partial<DevelopmentSession>) => {
    const session = data.developmentSessions.find((entry) => entry.id === id);
    if (!session) {
      setLastActionError("Session not found.");
      return;
    }
    dispatchAction({
      action: {
        type: "session_end",
        payload: {
          id,
          updates: {
            ...updates,
            endedAt: nowIso(),
          },
        },
      },
      activity: {
        projectId: session.projectId,
        type: "session_completed",
        summary: `Completed session: ${session.objective}`,
        entityType: "session",
        entityId: id,
        metadata: "complete",
      },
    });
  }, [data.developmentSessions, dispatchAction]);

  const appendSessionNote = useCallback((id: string, note: string) => {
    dispatchAction({ action: { type: "session_note_append", payload: { id, note } } });
  }, [dispatchAction]);

  const search = useCallback((query: string) => searchDashboard(data, query), [data]);

  const contextValue = useMemo<DashboardContextValue>(
    () => ({
      data,
      lastActionError,
      clearLastActionError,
      createProject,
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

      addNote,
      updateNote,

      addLink,
      updateLink,

      startSession,
      endSession,
      appendSessionNote,

      search,
    }),
    [
      data,
      lastActionError,
      clearLastActionError,
      createProject,
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
      addNote,
      updateNote,
      addLink,
      updateLink,
      startSession,
      endSession,
      appendSessionNote,
      search,
    ],
  );

  if (!isHydrated) {
    return (
      <section
        className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600"
        role="status"
        aria-live="polite"
      >
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
