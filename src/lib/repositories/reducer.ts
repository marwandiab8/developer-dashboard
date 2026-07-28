import { DashboardData } from "../models";
import { DashboardAction } from "./types";

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
      const updatedIdeas = state.ideas.map((idea) =>
        idea.id === action.payload.ideaId
          ? ({
              ...idea,
              status: "converted" as const,
              linkedTaskId: action.payload.taskId,
              updatedAt: nowIso(),
            } as typeof idea)
          : idea,
      ) as typeof state.ideas;
      const updatedTasks = [action.payload.task, ...state.tasks] as typeof state.tasks;
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
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({
              ...task,
              status: "in_progress" as const,
              startedAt: task.startedAt ?? nowIso(),
              updatedAt: nowIso(),
            } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
    }

    case "task_block": {
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({
              ...task,
              status: "blocked" as const,
              blockedReason: action.payload.reason,
              updatedAt: nowIso(),
            } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
    }

    case "task_complete": {
      const updated = state.tasks.map((task) =>
        task.id === action.payload.id
          ? ({
              ...task,
              status: "completed" as const,
              completedAt: nowIso(),
              updatedAt: nowIso(),
            } as typeof task)
          : task,
      ) as typeof state.tasks;
      const target = updated.find((task) => task.id === action.payload.id);
      return target ? touchProject({ ...state, tasks: updated }, target.projectId) : { ...state, tasks: updated };
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
      return touchProject(
        {
          ...state,
          codexPrompts: [...state.codexPrompts.filter((prompt) => prompt.id !== action.payload.id), action.payload],
        },
        action.payload.projectId,
      );
    }

    case "prompt_mark_used": {
      const updated = state.codexPrompts.map((prompt) =>
        prompt.id === action.payload.id
          ? ({
              ...prompt,
              status: "used" as const,
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
      return touchProject(
        {
          ...state,
          developmentSessions: [action.payload, ...state.developmentSessions],
        },
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

    case "session_note_append": {
      const updated = state.developmentSessions.map((session) =>
        session.id === action.payload.id
          ? ({
              ...session,
              notes: `${session.notes}\n\n${action.payload.note}`.trim(),
              tasksWorkedOn: session.tasksWorkedOn,
            } as typeof session)
          : session,
      ) as typeof state.developmentSessions;
      const target = updated.find((session) => session.id === action.payload.id);
      return target ? touchProject({ ...state, developmentSessions: updated }, target.projectId) : { ...state, developmentSessions: updated };
    }

    case "activity_add":
      return {
        ...state,
        activities: [action.payload, ...state.activities],
      };

    default:
      return state;
  }
}
