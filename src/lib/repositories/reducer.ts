import { DashboardData } from "../models";
import { DashboardAction } from "./types";
import { calculateTaskActiveDuration, MAX_UNCLOSED_SESSION_MS, normalizeTaskStatus } from "../workflow";

const nowIso = () => new Date().toISOString();

const touchProject = (data: DashboardData, projectId: string): DashboardData => {
  const now = nowIso();
  return {
    ...data,
    projects: data.projects.map((project) =>
      project.id === projectId
        ? { ...project, lastWorkedAt: now, updatedAt: now }
        : project,
    ),
  };
};

const boundedElapsed = (startedAt: string | null, endedAt: string) => {
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(end - start, MAX_UNCLOSED_SESSION_MS);
};

const refreshTaskDuration = (data: DashboardData, taskId: string | null): DashboardData => {
  if (!taskId) return data;
  const total = calculateTaskActiveDuration(data.developmentSessions, taskId);
  return {
    ...data,
    tasks: data.tasks.map((task) => task.id === taskId
      ? { ...task, totalActiveDurationMs: total }
      : task),
  };
};

export function dashboardReducer(state: DashboardData, action: DashboardAction): DashboardData {
  switch (action.type) {
    case "seed":
      return action.payload;

    case "project_upsert":
      return {
        ...state,
        projects: [
          ...state.projects.filter((project) => project.id !== action.payload.id),
          action.payload,
        ],
      };

    case "project_update":
      return touchProject(
        {
          ...state,
          projects: state.projects.map((project) =>
            project.id === action.payload.id
              ? { ...project, ...action.payload.updates, updatedAt: nowIso() }
              : project,
          ),
        },
        action.payload.id,
      );

    case "idea_add": {
      return touchProject(
        {
          ...state,
          ideas: [action.payload, ...state.ideas],
        },
        action.payload.projectId,
      );
    }

    case "idea_update": {
      const updated = state.ideas.map((idea) =>
        idea.id === action.payload.id
          ? { ...idea, ...action.payload.updates, updatedAt: nowIso() }
          : idea,
      );
      const target = updated.find((idea) => idea.id === action.payload.id);
      return target ? touchProject({ ...state, ideas: updated }, target.projectId) : { ...state, ideas: updated };
    }

    case "idea_archive": {
      const updated = state.ideas.map((idea) =>
        idea.id === action.payload.id
          ? ({ ...idea, status: "archived" as const, updatedAt: nowIso() } as typeof idea)
          : idea,
      ) as typeof state.ideas;
      const target = updated.find((idea) => idea.id === action.payload.id);
      return target ? touchProject({ ...state, ideas: updated }, target.projectId) : { ...state, ideas: updated };
    }

    case "idea_to_task": {
      const sourceIdea = state.ideas.find((idea) => idea.id === action.payload.ideaId);
      if (!sourceIdea || sourceIdea.linkedTaskId) {
        return state;
      }
      const convertedAt = action.payload.convertedAt ?? nowIso();
      const updatedIdeas = state.ideas.map((idea) =>
        idea.id === action.payload.ideaId
          ? ({
              ...idea,
              status: "converted" as const,
              linkedTaskId: action.payload.taskId,
              convertedAt,
              updatedAt: convertedAt,
            } as typeof idea)
          : idea,
      ) as typeof state.ideas;
      const updatedTasks = state.tasks.some((task) => task.id === action.payload.task.id)
        ? state.tasks
        : [action.payload.task, ...state.tasks] as typeof state.tasks;
      return touchProject(
        {
          ...state,
          ideas: updatedIdeas,
          tasks: updatedTasks,
        },
        action.payload.task.projectId,
      );
    }

    case "task_add": {
      if (state.tasks.some((task) => task.id === action.payload.id)) return state;
      return touchProject(
        {
          ...state,
          tasks: [action.payload, ...state.tasks],
        },
        action.payload.projectId,
      );
    }

    case "task_update": {
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({ ...task, ...action.payload.updates, updatedAt: nowIso() } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
    }

    case "task_start": {
      const at = nowIso();
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({
              ...task,
              status: "in_progress" as const,
              startedAt: task.startedAt ?? at,
              lastWorkedAt: at,
              completedAt: null,
              blockedReason: "",
              updatedAt: at,
            } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
    }

    case "task_block": {
      const at = nowIso();
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({
              ...task,
              status: "blocked" as const,
              blockedReason: action.payload.reason,
              lastWorkedAt: at,
              completedAt: null,
              updatedAt: at,
            } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
    }

    case "task_complete": {
      const at = nowIso();
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({
              ...task,
              status: "completed" as const,
              completedAt: at,
              lastWorkedAt: at,
              blockedReason: "",
              updatedAt: at,
            } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
    }

    case "task_set_status": {
      const target = state.tasks.find((task) => task.id === action.payload.id);
      if (!target) return state;
      const previousStatus = normalizeTaskStatus(target.status);
      const nextStatus = normalizeTaskStatus(action.payload.status);
      const updated = state.tasks.map((task) => {
        if (task.id !== action.payload.id) return task;
        return {
          ...task,
          status: nextStatus,
          blockedReason: nextStatus === "blocked"
            ? action.payload.blocker ?? task.blockedReason
            : "",
          readyAt: nextStatus === "ready" ? task.readyAt ?? action.payload.at : task.readyAt,
          startedAt: nextStatus === "in_progress" ? task.startedAt ?? action.payload.at : task.startedAt,
          completedAt: nextStatus === "completed" ? action.payload.at : null,
          lastWorkedAt: ["in_progress", "blocked", "completed"].includes(nextStatus)
            ? action.payload.at
            : task.lastWorkedAt,
          updatedAt: action.payload.at,
          ...(previousStatus === "completed" && nextStatus !== "completed"
            ? { completedAt: null }
            : {}),
        };
      }) as typeof state.tasks;
      return touchProject({ ...state, tasks: updated }, target.projectId);
    }

    case "brain_dump_add": {
      return touchProject(
        {
          ...state,
          brainDumps: [action.payload, ...state.brainDumps],
        },
        action.payload.projectId,
      );
    }

    case "brain_dump_update": {
      const updated = state.brainDumps.map((entry) =>
        entry.id === action.payload.id
          ? ({ ...entry, ...action.payload.updates, updatedAt: nowIso() } as typeof entry)
          : entry,
      ) as typeof state.brainDumps;
      const target = updated.find((entry) => entry.id === action.payload.id);
      return target ? touchProject({ ...state, brainDumps: updated }, target.projectId) : { ...state, brainDumps: updated };
    }

    case "brain_dump_delete": {
      const target = state.brainDumps.find((entry) => entry.id === action.payload.id);
      const next = {
        ...state,
        brainDumps: state.brainDumps.filter((entry) => entry.id !== action.payload.id),
      };
      return target ? touchProject(next, target.projectId) : next;
    }

    case "scratchpad_update": {
      const existing = state.scratchpads.find((entry) => entry.projectId === action.payload.projectId);
      const updatedAt = nowIso();
      const updatedScratchpads = existing
        ? state.scratchpads.map((entry) =>
            entry.projectId === action.payload.projectId
              ? { ...entry, markdown: action.payload.markdown, updatedAt }
              : entry,
          )
        : [...state.scratchpads, { projectId: action.payload.projectId, markdown: action.payload.markdown, updatedAt }];
      return touchProject({ ...state, scratchpads: updatedScratchpads }, action.payload.projectId);
    }

    case "architecture_decision_upsert": {
      return touchProject(
        {
          ...state,
          architectureDecisions: [
            ...state.architectureDecisions.filter((decision) => decision.id !== action.payload.id),
            action.payload,
          ],
        },
        action.payload.projectId,
      );
    }

    case "architecture_decision_update_status": {
      const target = state.architectureDecisions.find((decision) => decision.id === action.payload.id);
      if (!target) return state;
      const updated = state.architectureDecisions.map((decision) =>
        decision.id === action.payload.id
          ? { ...decision, status: action.payload.status, updatedAt: nowIso() }
          : decision,
      );
      return touchProject({ ...state, architectureDecisions: updated }, target.projectId);
    }

    case "prompt_upsert": {
      const next = {
        ...state,
        codexPrompts: [...state.codexPrompts.filter((prompt) => prompt.id !== action.payload.id), action.payload],
        tasks: action.payload.relatedTaskId
          ? state.tasks.map((task) => task.id === action.payload.relatedTaskId
            ? {
                ...task,
                promptRecordIds: task.promptRecordIds.includes(action.payload.id)
                  ? task.promptRecordIds
                  : [...task.promptRecordIds, action.payload.id],
              }
            : task)
          : state.tasks,
      };
      return touchProject(
        next,
        action.payload.projectId,
      );
    }

    case "prompt_mark_used": {
      const updated = state.codexPrompts.map((prompt) =>
        prompt.id === action.payload.id
          ? ({
              ...prompt,
              status: "completed" as const,
              resultSummary: action.payload.usedSummary,
              lastUsedAt: nowIso(),
              updatedAt: nowIso(),
            } as typeof prompt)
          : prompt,
      ) as typeof state.codexPrompts;
      const target = updated.find((prompt) => prompt.id === action.payload.id);
      return target ? touchProject({ ...state, codexPrompts: updated }, target.projectId) : { ...state, codexPrompts: updated };
    }

    case "note_add": {
      return touchProject(
        {
          ...state,
          notes: [action.payload, ...state.notes],
        },
        action.payload.projectId,
      );
    }

    case "note_update": {
      const updated = state.notes.map((note) =>
        note.id === action.payload.id
          ? { ...note, ...action.payload.updates, updatedAt: nowIso() }
          : note,
      );
      const target = updated.find((note) => note.id === action.payload.id);
      return target ? touchProject({ ...state, notes: updated }, target.projectId) : { ...state, notes: updated };
    }

    case "link_add": {
      return touchProject(
        {
          ...state,
          importantLinks: [action.payload, ...state.importantLinks],
        },
        action.payload.projectId,
      );
    }

    case "link_update": {
      const updated = state.importantLinks.map((link) =>
        link.id === action.payload.id
          ? { ...link, ...action.payload.updates, updatedAt: nowIso() }
          : link,
      );
      const target = updated.find((link) => link.id === action.payload.id);
      return target ? touchProject({ ...state, importantLinks: updated }, target.projectId) : { ...state, importantLinks: updated };
    }

    case "session_start": {
      if (state.developmentSessions.some((session) => session.id === action.payload.id)) return state;
      const next = {
          ...state,
          developmentSessions: [action.payload, ...state.developmentSessions],
          tasks: action.payload.taskId
            ? state.tasks.map((task) => task.id === action.payload.taskId
              ? {
                  ...task,
                  status: "in_progress" as const,
                  startedAt: task.startedAt ?? action.payload.startedAt,
                  lastWorkedAt: action.payload.startedAt,
                  workSessionIds: task.workSessionIds.includes(action.payload.id)
                    ? task.workSessionIds
                    : [...task.workSessionIds, action.payload.id],
                  updatedAt: action.payload.startedAt,
                }
              : task)
            : state.tasks,
          codexPrompts: action.payload.promptRecordId
            ? state.codexPrompts.map((prompt) => prompt.id === action.payload.promptRecordId
              ? {
                  ...prompt,
                  relatedSessionId: action.payload.id,
                  status: "started" as const,
                  lastUsedAt: action.payload.startedAt,
                  updatedAt: action.payload.startedAt,
                }
              : prompt)
            : state.codexPrompts,
        };
      return touchProject(
        next,
        action.payload.projectId,
      );
    }

    case "session_end": {
      const updated = state.developmentSessions.map((session) =>
        session.id === action.payload.id
          ? ({
              ...session,
              ...action.payload.updates,
              status: "completed" as const,
              endedAt: action.payload.updates.endedAt ?? nowIso(),
              updatedAt: nowIso(),
            } as typeof session)
          : session,
      ) as typeof state.developmentSessions;
      const target = updated.find((session) => session.id === action.payload.id);
      return target ? touchProject({ ...state, developmentSessions: updated }, target.projectId) : { ...state, developmentSessions: updated };
    }

    case "session_pause": {
      const target = state.developmentSessions.find((session) => session.id === action.payload.id);
      if (!target || target.status !== "active") return state;
      const activeDurationMs = target.activeDurationMs
        + boundedElapsed(target.activeStartedAt, action.payload.at);
      const sessions = state.developmentSessions.map((session) => session.id === target.id
        ? {
            ...session,
            status: "paused" as const,
            activeStartedAt: null,
            activeDurationMs,
            nextStep: action.payload.nextStep ?? session.nextStep,
            nextStartingPoint: action.payload.nextStep ?? session.nextStartingPoint,
          }
        : session);
      const withDuration = refreshTaskDuration({ ...state, developmentSessions: sessions }, target.taskId);
      return touchProject(withDuration, target.projectId);
    }

    case "session_resume": {
      const target = state.developmentSessions.find((session) => session.id === action.payload.id);
      if (!target || target.status !== "paused") return state;
      const sessions = state.developmentSessions.map((session) => session.id === target.id
        ? {
            ...session,
            status: "active" as const,
            activeStartedAt: action.payload.at,
            resumeFromNote: action.payload.resumeFromNote ?? session.resumeFromNote,
          }
        : session);
      const tasks = target.taskId
        ? state.tasks.map((task) => task.id === target.taskId
          ? {
              ...task,
              status: "in_progress" as const,
              startedAt: task.startedAt ?? action.payload.at,
              lastWorkedAt: action.payload.at,
              updatedAt: action.payload.at,
            }
          : task)
        : state.tasks;
      return touchProject({ ...state, developmentSessions: sessions, tasks }, target.projectId);
    }

    case "session_finish": {
      const target = state.developmentSessions.find((session) => session.id === action.payload.id);
      if (!target || target.status === "completed" || target.status === "abandoned") return state;
      const activeDurationMs = target.activeDurationMs
        + (target.status === "active" ? boundedElapsed(target.activeStartedAt, action.payload.at) : 0);
      const sessions = state.developmentSessions.map((session) => session.id === target.id
        ? {
            ...session,
            ...action.payload.updates,
            status: action.payload.status,
            endedAt: action.payload.at,
            activeStartedAt: null,
            activeDurationMs,
          }
        : session) as typeof state.developmentSessions;
      const withDuration = refreshTaskDuration({ ...state, developmentSessions: sessions }, target.taskId);
      return touchProject(withDuration, target.projectId);
    }

    case "session_correct": {
      const target = state.developmentSessions.find((session) => session.id === action.payload.id);
      if (!target) return state;
      const sessions = state.developmentSessions.map((session) => session.id === target.id
        ? { ...session, activeDurationMs: action.payload.activeDurationMs }
        : session);
      const withDuration = refreshTaskDuration({ ...state, developmentSessions: sessions }, target.taskId);
      return touchProject(withDuration, target.projectId);
    }

    case "session_note_append": {
      const updated = state.developmentSessions.map((session) =>
        session.id === action.payload.id
          ? ({
              ...session,
              notes: session.notes.length > 0
                ? `${session.notes}\n\n${action.payload.note}`
                : action.payload.note,
              tasksWorkedOn: session.tasksWorkedOn,
            } as typeof session)
          : session,
      ) as typeof state.developmentSessions;
      const target = updated.find((session) => session.id === action.payload.id);
      return target ? touchProject({ ...state, developmentSessions: updated }, target.projectId) : { ...state, developmentSessions: updated };
    }

    case "activity_add":
      if (state.activities.some((activity) => activity.id === action.payload.id)) {
        return state;
      }

      return {
        ...state,
        activities: [action.payload, ...state.activities],
      };

    default:
      return state;
  }
}
